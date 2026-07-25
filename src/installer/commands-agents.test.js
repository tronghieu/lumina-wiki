/**
 * Tests for the AI-agent global install path (CAP-8) and the CAP-9
 * non-destructive uninstall fix in src/installer/commands.js.
 *
 * Every test spawns the real CLI with HOME/USERPROFILE overridden to a
 * disposable temp directory, so os.homedir()-based global skill paths and
 * the LUMINA_HOME-derived agents manifest (which falls back to
 * ~/.lumina when LUMINA_HOME is unset) both land inside the sandbox and
 * never touch the real machine.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const LIBRARIAN_PREAMBLE_ANCHOR = 'Read `README.md` at the project root before this SKILL.md.';
const PREAMBLE_HEADING = '## Workspace resolution (multi-wiki mode)';

async function makeTmpDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

function runCli(args, { cwd = REPO_ROOT, env = {}, timeout = 30000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', ...env },
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// The CAP-9 uninstall bug this file guards against left every single
// `.claude/skills/lumi-*` entry behind on a completely vanilla
// install-then-uninstall cycle. A bare `access()`/`readdir()` check is not
// enough to catch a regression of that shape: a dangling symlink (pointing
// at a `.agents/skills/<id>` target that uninstall already removed) still
// shows up as a directory entry and still exists as a link, it just fails
// to *resolve* — which is exactly the state the original bug left. `lstat`
// (not `stat`/`access`) is required to see it.
async function assertNoLuminaClaudeSkillLinks(claudeSkillsDir) {
  let entries;
  try {
    entries = await readdir(claudeSkillsDir);
  } catch {
    return; // .claude/skills does not exist at all — nothing to check.
  }
  const luminaEntries = entries.filter(name => name.startsWith('lumi-'));
  assert.deepEqual(
    luminaEntries, [],
    `.claude/skills must contain zero lumi-* entries after uninstall, found: ${luminaEntries.join(', ')}`,
  );
  for (const name of ['lumi-init', 'lumi-ask']) {
    await assert.rejects(
      () => lstat(join(claudeSkillsDir, name)),
      /ENOENT/,
      `${name} must not exist in .claude/skills at all after uninstall, not even as a dangling symlink`,
    );
  }
}

describe('AI-agent global install (CAP-8)', () => {
  test('places every lumi-* skill plus lumi-hub in the platform global dir, injects the preamble, and writes the agents manifest', async () => {
    const tmp = await makeTmpDir('lumina-agents-install-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);

      const globalDir = join(fakeHome, '.openclaw', 'skills');

      // A core skill whose source carries the AD-7 anchor line got injected.
      const initSkillMd = await readFile(join(globalDir, 'lumi-init', 'SKILL.md'), 'utf8');
      assert.ok(initSkillMd.includes(PREAMBLE_HEADING), 'expected routing preamble heading in lumi-init/SKILL.md');
      assert.ok(!initSkillMd.includes(LIBRARIAN_PREAMBLE_ANCHOR), 'expected the anchor line to be replaced in lumi-init/SKILL.md');

      // lumi-hub has no anchor line — copied verbatim from source.
      const hubSrc = await readFile(join(REPO_ROOT, 'src', 'skills', 'agents', 'hub', 'SKILL.md'), 'utf8');
      const hubDest = await readFile(join(globalDir, 'lumi-hub', 'SKILL.md'), 'utf8');
      assert.equal(hubDest, hubSrc);

      // Research/reading/learning pack skills are all present too (every pack,
      // not just core — agent installs are not pack-selectable).
      await access(join(globalDir, 'lumi-research-discover', 'SKILL.md'));
      await access(join(globalDir, 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(globalDir, 'lumi-learning-reflect', 'SKILL.md'));

      // Shipped {{...}} placeholders in reference files survive untouched
      // (never run through the template engine).
      const verifyRefs = await readFile(
        join(globalDir, 'lumi-verify', 'references', 'reviewers.md'), 'utf8',
      ).catch(() => null);
      if (verifyRefs !== null) {
        const srcRefs = await readFile(
          join(REPO_ROOT, 'src', 'skills', 'core', 'verify', 'references', 'reviewers.md'), 'utf8',
        );
        assert.equal(verifyRefs, srcRefs);
      }

      // Agents manifest tracks ownership (AD-2/AD-8).
      const manifestPath = join(fakeHome, '.lumina', 'agents', 'openclaw-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(manifest.version, 1);
      assert.equal(manifest.platform, 'openclaw');
      assert.ok(manifest.skills.includes('lumi-init'));
      assert.ok(manifest.skills.includes('lumi-hub'));
      assert.ok(manifest.skills.includes('lumi-research-discover'));

      // No workspace payload leaked into the global skills directory or its
      // ancestor — agent installs are skills-only (CAP-8).
      assert.equal(await exists(join(fakeHome, '.openclaw', 'wiki')), false);
      assert.equal(await exists(join(fakeHome, '.openclaw', '_lumina')), false);

      // --agents is documented as a GLOBAL, skills-only install: the classic
      // per-project payload must NOT be scaffolded, even though --directory
      // pointed at a real workspace directory. --directory is accepted but
      // unused in agents-only mode (CAP-10 fix).
      assert.equal(await exists(join(workspace, '_lumina')), false, '--agents must not scaffold _lumina/ into --directory');
      assert.equal(await exists(join(workspace, 'wiki')), false, '--agents must not scaffold wiki/ into --directory');
      assert.equal(await exists(join(workspace, 'README.md')), false, '--agents must not scaffold README.md into --directory');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('with no --directory at all, the process cwd stays pristine while the global skills dir is populated', async () => {
    const tmp = await makeTmpDir('lumina-agents-nocwd-');
    const cwdSandbox = join(tmp, 'cwd-sandbox');
    const fakeHome = join(tmp, 'home');
    await mkdir(cwdSandbox, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      // No --directory/--cwd flag at all: bin/lumina.js defaults it to
      // process.cwd(), which here is cwdSandbox (via runCli's `cwd` option).
      // Before the CAP-10 fix, this is exactly the shape of the documented
      // bug — the classic per-project install ran into whatever directory
      // the user happened to be in.
      const result = runCli(
        ['install', '--yes', '--no-update', '--agents', 'openclaw'],
        { cwd: cwdSandbox, env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);

      const entries = await readdir(cwdSandbox);
      assert.deepEqual(entries, [], `cwd must stay pristine under --agents, found: ${entries.join(', ')}`);

      await access(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('foreign skill directory in the global skills dir survives an agent install byte-identical', async () => {
    const tmp = await makeTmpDir('lumina-agents-foreign-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    const foreignDir = join(fakeHome, '.openclaw', 'skills', 'my-own-skill');
    await mkdir(foreignDir, { recursive: true });
    const foreignSkillMdPath = join(foreignDir, 'SKILL.md');
    const foreignContent = '---\nname: my-own-skill\ndescription: not a Lumina skill\n---\nHello.\n';
    await writeFile(foreignSkillMdPath, foreignContent, 'utf8');
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);

      const after = await readFile(foreignSkillMdPath, 'utf8');
      assert.equal(after, foreignContent, 'foreign skill must survive an agent install untouched');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('unknown --agents value exits 2', async () => {
    const tmp = await makeTmpDir('lumina-agents-invalid-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'not-a-real-platform'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Unknown agent target/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('acknowledgment notice is printed under --yes without blocking on input', async () => {
    const tmp = await makeTmpDir('lumina-agents-ack-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome }, timeout: 30000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Installed Lumina skills globally for OpenClaw/);
      // Registration is chat-driven (the agent runs `lumina wikis add` on
      // the user's behalf via lumi-hub) — the notice must not hand the user
      // a raw `lumina wikis add` command to type themselves.
      assert.doesNotMatch(result.stdout, /lumina wikis add/);
      assert.match(result.stdout, /Open a chat with OpenClaw/);
      assert.match(result.stdout, /lumina wikis doctor/);
      // --yes must never pause for acknowledgment (would hang the process).
      assert.doesNotMatch(result.stdout, /Press Enter to continue/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('classic install (no --agents) never touches HOME', async () => {
    const tmp = await makeTmpDir('lumina-agents-classic-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await exists(join(fakeHome, '.openclaw')), false);
      assert.equal(await exists(join(fakeHome, '.hermes')), false);
      assert.equal(await exists(join(fakeHome, '.lumina')), false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a foreign real directory colliding with a real Lumina skill name (lumi-ask) survives an agent install and a re-install, on both OpenClaw and Hermes', async () => {
    const tmp = await makeTmpDir('lumina-agents-collision-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    const env = { HOME: fakeHome, USERPROFILE: fakeHome };

    for (const platform of ['openclaw', 'hermes']) {
      const platformDir = platform === 'openclaw' ? '.openclaw' : '.hermes';
      const collidingDir = join(fakeHome, platformDir, 'skills', 'lumi-ask');
      const marker = join(collidingDir, 'marker.txt');
      const foreignContent = `user-owned content colliding with lumi-ask on ${platform}\n`;
      await mkdir(collidingDir, { recursive: true });
      await writeFile(marker, foreignContent, 'utf8');

      const args = ['install', '--yes', '--no-update', '--directory', workspace, '--agents', platform];

      const first = runCli(args, { env });
      assert.equal(first.status, 0, first.stderr);
      assert.equal(await readFile(marker, 'utf8'), foreignContent, `${platform}: fresh agent install must not touch the colliding lumi-ask directory`);

      // Every other skill still installed normally alongside the collision.
      await access(join(fakeHome, platformDir, 'skills', 'lumi-init', 'SKILL.md'));

      const second = runCli(args, { env });
      assert.equal(second.status, 0, second.stderr);
      assert.equal(await readFile(marker, 'utf8'), foreignContent, `${platform}: re-install must not touch the colliding lumi-ask directory`);

      // The platform agents manifest must not claim ownership of lumi-ask —
      // otherwise a later deselection could delete the still-foreign directory.
      const manifestPath = join(fakeHome, '.lumina', 'agents', `${platform}-manifest.json`);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.ok(!manifest.skills.includes('lumi-ask'), `${platform}: lumi-ask must not be recorded as owned while its global path is foreign content`);
    }

    await cleanTmp(tmp);
  });

  test('the foreign-collision warning is printed and the install still exits 0', async () => {
    const tmp = await makeTmpDir('lumina-agents-collision-warn-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    const collidingDir = join(fakeHome, '.openclaw', 'skills', 'lumi-ask');
    await mkdir(collidingDir, { recursive: true });
    await writeFile(join(collidingDir, 'marker.txt'), 'not a Lumina skill\n', 'utf8');
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /does not recognize as its own/);
      assert.match(result.stdout, /lumi-ask/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a post-install swap to fingerprint-foreign content at ~/.openclaw/skills/lumi-ask survives a re-install, with a warning (regression: manifest-membership short-circuit)', async () => {
    // Regression test for a bug an independent audit found: an earlier
    // isLuminaOwnedSkillEntry did `if (recordedInManifest) return true`
    // before any fingerprint check. Every lumi-* id gets recorded in the
    // platform agents manifest on the very first install, so from the
    // SECOND install onward every lumi-* path was treated as
    // unconditionally owned no matter what currently occupied it. This
    // test installs cleanly first (so the manifest genuinely does record
    // lumi-ask), THEN swaps in fingerprint-foreign content, THEN
    // re-installs — the exact sequence the short-circuit got wrong.
    const tmp = await makeTmpDir('lumina-agents-second-collision-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    const env = { HOME: fakeHome, USERPROFILE: fakeHome };
    const args = ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'];
    try {
      const first = runCli(args, { env });
      assert.equal(first.status, 0, first.stderr);

      const lumiAskDir = join(fakeHome, '.openclaw', 'skills', 'lumi-ask');
      const skillMdPath = join(lumiAskDir, 'SKILL.md');
      await access(skillMdPath);
      const manifestPath = join(fakeHome, '.lumina', 'agents', 'openclaw-manifest.json');
      const manifestBefore = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.ok(manifestBefore.skills.includes('lumi-ask'), 'lumi-ask must be genuinely recorded before the swap');

      // Swap the genuine Lumina content out for unambiguously foreign, but
      // still fingerprintable, content.
      await rm(lumiAskDir, { recursive: true, force: true });
      await mkdir(lumiAskDir, { recursive: true });
      const foreignContent = '---\nname: not-lumi-ask\ndescription: unrelated content that happens to sit at the lumi-ask path\n---\nHello.\n';
      await writeFile(skillMdPath, foreignContent, 'utf8');

      const second = runCli(args, { env });
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /will not touch content it does not recognize|does not recognize as its own/);

      assert.equal(await readFile(skillMdPath, 'utf8'), foreignContent, 'foreign content must survive even though lumi-ask was previously recorded as installed here');

      const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.ok(!manifestAfter.skills.includes('lumi-ask'), 'lumi-ask must no longer be recorded as owned once its path is foreign');

      // Every other skill still refreshed normally alongside the collision.
      await access(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('re-running the same agent install is idempotent', async () => {
    const tmp = await makeTmpDir('lumina-agents-idempotent-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const args = ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'];
      const env = { HOME: fakeHome, USERPROFILE: fakeHome };
      const first = runCli(args, { env });
      assert.equal(first.status, 0, first.stderr);
      const before = await readFile(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'), 'utf8');

      const second = runCli(args, { env });
      assert.equal(second.status, 0, second.stderr);
      const after = await readFile(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'), 'utf8');

      assert.equal(after, before);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('uninstall non-destructive skills removal (CAP-9)', () => {
  test('foreign skill in .agents/skills survives uninstall while lumi-* entries are removed', async () => {
    const tmp = await makeTmpDir('lumina-uninstall-foreign-');
    const workspace = join(tmp, 'wiki-project');
    await mkdir(workspace, { recursive: true });
    try {
      const install = runCli(['install', '--yes', '--no-update', '--directory', workspace]);
      assert.equal(install.status, 0, install.stderr);

      const foreignDir = join(workspace, '.agents', 'skills', 'custom-skill');
      await mkdir(foreignDir, { recursive: true });
      const foreignSkillMdPath = join(foreignDir, 'SKILL.md');
      const foreignContent = '---\nname: custom-skill\ndescription: user-authored, not Lumina\n---\nHi.\n';
      await writeFile(foreignSkillMdPath, foreignContent, 'utf8');

      const uninstall = runCli(['uninstall', '--yes', '--directory', workspace]);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      // Foreign entry survives, byte-identical.
      const after = await readFile(foreignSkillMdPath, 'utf8');
      assert.equal(after, foreignContent);

      // lumi-* entries are gone.
      assert.equal(await exists(join(workspace, '.agents', 'skills', 'lumi-init')), false);
      assert.equal(await exists(join(workspace, '.agents', 'skills', 'lumi-ask')), false);

      // Mirror on the .claude/skills side (CAP-9's original bug: this side
      // silently kept every lumi-* symlink, dangling, on every uninstall).
      await assertNoLuminaClaudeSkillLinks(join(workspace, '.claude', 'skills'));

      // .agents/ itself survives because it still holds the foreign entry.
      await access(join(workspace, '.agents', 'skills', 'custom-skill', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('uninstall with no foreign skills removes .agents/ entirely', async () => {
    const tmp = await makeTmpDir('lumina-uninstall-clean-');
    const workspace = join(tmp, 'wiki-project');
    await mkdir(workspace, { recursive: true });
    try {
      const install = runCli(['install', '--yes', '--no-update', '--directory', workspace]);
      assert.equal(install.status, 0, install.stderr);

      const uninstall = runCli(['uninstall', '--yes', '--directory', workspace]);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      assert.equal(await exists(join(workspace, '.agents')), false);

      // Mirror on the .claude/skills side — same call sites, same outcome.
      await assertNoLuminaClaudeSkillLinks(join(workspace, '.claude', 'skills'));
    } finally {
      await cleanTmp(tmp);
    }
  });
});
