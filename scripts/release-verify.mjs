#!/usr/bin/env node
/**
 * Release verification.
 *
 * Answers one question: did the version currently in `package.json` actually
 * ship? Merging a `chore(release):` commit publishes nothing -- publish.yml
 * triggers on `push: tags: v*` and on nothing else -- so a bumped version next
 * to a written CHANGELOG entry reads exactly like a release and need not be
 * one. 1.11.0 and 1.12.0 were both lost that way. See docs/DEVELOPMENT.md
 * section 6.
 *
 * Every check queries a remote on purpose. A tag that exists only on the
 * machine running this script is the precise failure being guarded against,
 * and `git tag --list` would report it as present.
 *
 * Usage:
 *   node scripts/release-verify.mjs [--retries N] [--delay MS]
 *
 * Exit codes:
 *   0  the version is tagged on the remote and live on npm under its channel
 *   1  it is not (the report says which check failed and what to do)
 *   3  a check could not be run at all (git/npm missing, network down)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Channel derivation
// ---------------------------------------------------------------------------

/**
 * Derive the npm dist-tag a version publishes to.
 *
 * This mirrors the bash in `.github/workflows/publish.yml` ("Verify tag matches
 * package version") deliberately and must not drift from it: that job is the
 * gate that decides whether a build moves `latest`, and this script exists to
 * confirm the gate did what was intended. The two are covered by the same
 * table of cases in release-verify.test.mjs.
 *
 * Build metadata is stripped first. It is not part of the pre-release, yet it
 * may itself contain a hyphen (`1.2.3+build-next` is a *stable* release) or
 * trail one (`1.2.3-next+build`).
 *
 * @param {string} version - e.g. "1.13.0", "1.13.0-next.0".
 * @returns {{channel: string, prerelease: boolean} | {error: string}}
 */
export function deriveChannel(version) {
  const precedence = String(version).split('+')[0];
  const dash = precedence.indexOf('-');

  if (dash === -1) {
    return { channel: 'latest', prerelease: false };
  }

  const channel = precedence.slice(dash + 1).split('.')[0];

  // npm refuses any dist-tag that parses as a SemVer range, so "x" and "v1"
  // are rejected here rather than after a publish has already happened.
  if (
    !/^[a-z][a-z0-9-]*$/.test(channel) ||
    channel === 'latest' ||
    channel === 'x' ||
    /^v[0-9]+$/.test(channel)
  ) {
    return { error: `unusable pre-release channel '${channel}'` };
  }

  return { channel, prerelease: true };
}

// ---------------------------------------------------------------------------
// Remote probes
// ---------------------------------------------------------------------------

const isWindows = process.platform === 'win32';

/**
 * A probe that could not run at all is reported as `unavailable`, and carries
 * whether retrying could help. Retries exist for the seconds right after a
 * publish, and a registry timeout or a 5xx is exactly what they are for --
 * treating every unavailability as fatal would spend the retry budget on
 * nothing. A missing executable, by contrast, will still be missing in 30s.
 */
function unavailable(message, { permanent = false } = {}) {
  return { unavailable: message, permanent };
}

function npm(args) {
  const result = spawnSync(isWindows ? 'npm.cmd' : 'npm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    // A hung registry should fail the check, not wedge CI.
    timeout: 30_000,
    // `npm` on Windows is a .cmd shim, which CreateProcess cannot execute
    // directly -- it needs a shell. scripts/ci-package.mjs does the same.
    // One consequence: a missing npm surfaces as a non-zero exit from the
    // shell rather than ENOENT, so on Windows it is retried before failing.
    shell: isWindows,
  });
  if (result.error?.code === 'ENOENT') {
    return unavailable('npm is not on PATH', { permanent: true });
  }
  if (result.error) {
    return unavailable(`npm ${args[0]} did not complete: ${result.error.code}`);
  }
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

// `git` is a real executable on Windows, so unlike npm it needs no shell.
function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error?.code === 'ENOENT') {
    return unavailable('git is not on PATH', { permanent: true });
  }
  if (result.error) {
    return unavailable(`git ${args[0]} did not complete: ${result.error.code}`);
  }
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

/** Does `refs/tags/v<version>` exist on `origin`? */
function remoteTagExists(version) {
  const ref = `refs/tags/v${version}`;
  const result = git(['ls-remote', '--tags', 'origin', ref]);
  if (result.unavailable) return result;
  if (result.status !== 0) {
    // Transport failures live here -- worth retrying.
    return unavailable(`git ls-remote failed: ${result.stderr || 'unknown error'}`);
  }
  return { found: result.stdout.includes(ref) };
}

/** What does the registry hold for this package? */
function npmView(pkg, field) {
  // npm retries fetches twice by default with a five-minute timeout each. That
  // would nest its backoff inside this script's own retry loop and let a single
  // unreachable registry hold a CI job for many minutes. Fail the request fast
  // and let the loop here be the only thing that retries.
  const result = npm([
    'view',
    pkg,
    field,
    '--json',
    '--fetch-retries=0',
    '--fetch-timeout=15000',
  ]);
  if (result.unavailable) return result;
  if (result.status !== 0) {
    // A version that does not exist yet is the expected "not released" answer,
    // not a broken check -- distinguish it from a registry that is unreachable.
    if (/E404|not found|is not in this registry/i.test(result.stderr)) {
      return { missing: true };
    }
    // 5xx, ETIMEDOUT, ECONNRESET, and a missing npm on Windows all land here.
    return unavailable(`npm view failed: ${result.stderr.split('\n')[0] || 'unknown error'}`);
  }
  try {
    return { value: JSON.parse(result.stdout) };
  } catch {
    return unavailable(`npm view returned unparseable JSON for ${pkg} ${field}`, {
      permanent: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Is another attempt worth making?
 *
 * A verified release stops the loop, and so does a probe that can never
 * succeed on this machine. Everything else -- a dist-tag that has not become
 * visible yet, a registry 5xx, a git transport hiccup -- is what the retries
 * exist for, since this runs seconds after a publish.
 *
 * @param {{ok: boolean, blocked: ?string, blockedPermanent: boolean}} result
 */
export function shouldRetry(result) {
  if (result.ok) return false;
  if (result.blocked && result.blockedPermanent) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const PASS = 'pass';
const FAIL = 'FAIL';

function line(state, label, detail) {
  return `  [${state}] ${label}${detail ? ` -- ${detail}` : ''}`;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs(argv) {
  const opts = { retries: 0, delay: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--retries') {
      opts.retries = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (arg === '--delay') {
      opts.delay = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else {
      return { error: `unknown argument '${arg}'` };
    }
  }
  if (!Number.isInteger(opts.retries) || opts.retries < 0) {
    return { error: '--retries expects a non-negative integer' };
  }
  if (!Number.isInteger(opts.delay) || opts.delay < 0) {
    return { error: '--delay expects a non-negative integer (milliseconds)' };
  }
  return opts;
}

/** One full pass over the three checks. */
function attempt(name, version, channel) {
  const report = [];
  let ok = true;
  let blocked = null;
  let blockedPermanent = false;

  const note = (probe) => {
    if (blocked) return;
    blocked = probe.unavailable;
    blockedPermanent = probe.permanent === true;
  };

  const tag = remoteTagExists(version);
  if (tag.unavailable) {
    note(tag);
  } else if (tag.found) {
    report.push(line(PASS, `git tag v${version} on origin`));
  } else {
    ok = false;
    report.push(
      line(FAIL, `git tag v${version} on origin`, 'not found, so publish.yml never ran'),
    );
  }

  const published = npmView(`${name}@${version}`, 'version');
  if (published.unavailable) {
    note(published);
  } else if (published.missing) {
    ok = false;
    report.push(line(FAIL, `npm has ${name}@${version}`, 'version not published'));
  } else {
    report.push(line(PASS, `npm has ${name}@${version}`));
  }

  const tags = npmView(name, 'dist-tags');
  if (tags.unavailable) {
    note(tags);
  } else if (tags.missing) {
    ok = false;
    report.push(line(FAIL, `dist-tag ${channel}`, 'package has no dist-tags'));
  } else {
    const actual = tags.value?.[channel];
    if (actual === version) {
      report.push(line(PASS, `dist-tag ${channel} -> ${version}`));
    } else {
      ok = false;
      report.push(
        line(FAIL, `dist-tag ${channel}`, `points at ${actual ?? 'nothing'}, expected ${version}`),
      );
    }
  }

  // A blocked probe is not a pass. Leaving `ok` true here would let the retry
  // loop exit on its `result.ok` check before ever reaching the retry logic,
  // which is the whole reason the retries exist.
  return { ok: ok && !blocked, blocked, blockedPermanent, report };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    process.stderr.write(`release-verify: ${opts.error}\n`);
    process.exit(1);
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  } catch (err) {
    process.stderr.write(`release-verify: cannot read package.json -- ${err.message}\n`);
    process.exit(3);
  }

  const { name, version } = pkg;
  const derived = deriveChannel(version);
  if (derived.error) {
    process.stderr.write(
      `release-verify: ${version} cannot publish -- ${derived.error}.\n` +
        'publish.yml would reject this version rather than guess a channel.\n',
    );
    process.exit(1);
  }

  const { channel } = derived;
  process.stdout.write(`${name} ${version} -> dist-tag ${channel}\n`);

  let result;
  for (let attemptNo = 0; attemptNo <= opts.retries; attemptNo += 1) {
    result = attempt(name, version, channel);
    if (!shouldRetry(result)) break;
    if (attemptNo < opts.retries) {
      const why = result.blocked
        ? `a probe could not run (${result.blocked})`
        : 'not visible yet';
      process.stdout.write(
        `  ...${why}, retrying in ${opts.delay}ms ` +
          `(${attemptNo + 1}/${opts.retries})\n`,
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(opts.delay);
    }
  }

  if (result.blocked) {
    process.stderr.write(`release-verify: could not complete the check -- ${result.blocked}\n`);
    process.exit(3);
  }

  process.stdout.write(`${result.report.join('\n')}\n`);

  if (result.ok) {
    process.stdout.write(`\n${version} is released.\n`);
    process.exit(0);
  }

  process.stdout.write(
    `\n${version} is NOT released.\n` +
      `Tag the release commit and push it:  git tag v${version} && git push origin v${version}\n` +
      'If the tag is already on origin, publish.yml ran and failed -- read its log.\n' +
      'Never re-tag an older release commit to catch up: publish.yml reads the version\n' +
      "out of the commit being tagged, so the job passes its own check and pushes that\n" +
      'commit\'s build to its channel. Roll missed content into the next version instead.\n',
  );
  process.exit(1);
}

// Only run when invoked as a command. Without this guard, importing
// deriveChannel -- which the tests do -- would execute the whole CLI, hit the
// network, and exit the test runner before a single case had run.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
