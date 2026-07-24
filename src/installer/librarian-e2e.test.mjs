/**
 * Full librarian-mode end-to-end test (AD-1 through AD-11): drives the real
 * CLI through the whole "agent + hub + spokes" story in one shared fake-HOME
 * environment — global skill install, registering a small fleet of wikis,
 * resolving by alias, the chat-inbox attachment drop the routing preamble
 * documents, a fleet-wide doctor sweep with a break/repair cycle, and a
 * second agent install proving both idempotency and foreign-skill safety.
 *
 * Complements, rather than replaces, the narrower single-concern suites:
 * commands-agents.test.js (CAP-8/CAP-9 unit-level checks), wikis-command.test.js
 * (per-verb CLI checks), and ci-agent-host-isolation.mjs (the cross-target CI
 * gate). This file is the sequential story a real deployment lives through,
 * so it runs as ordered subtests (`t.test`, each awaited before the next
 * starts) inside one outer test sharing one environment, rather than
 * independent tests whose relative order node:test does not guarantee.
 *
 * Run directly (`node src/installer/librarian-e2e.test.mjs`), the same way
 * commands.test.js / commands-agents.test.js are invoked, to dodge the
 * runner's cross-file multiplexing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, mkdir, rm, readFile, writeFile, copyFile, readdir, access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { normalizeKey } from './registry.js';

const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const LIBRARIAN_PREAMBLE_ANCHOR = 'Read `README.md` at the project root before this SKILL.md.';
const PREAMBLE_HEADING = '## Workspace resolution (multi-wiki mode)';
const INSTALL_TIMEOUT = 60000;

// ---------------------------------------------------------------------------
// Small filesystem helpers (hash-based snapshotting, collision-safe copy)
// ---------------------------------------------------------------------------

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function walkFiles(base, root = base, out = []) {
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const abs = join(base, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(abs, root, out);
    } else if (entry.isFile()) {
      out.push(relative(root, abs));
    }
  }
  return out;
}

async function snapshotFiles(root) {
  const files = (await walkFiles(root)).sort();
  const map = new Map();
  for (const rel of files) map.set(rel, await hashFile(join(root, rel)));
  return map;
}

function diffSnapshots(before, after) {
  const beforeKeys = new Set(before.keys());
  const afterKeys = new Set(after.keys());
  const added = [...afterKeys].filter((k) => !beforeKeys.has(k)).sort();
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k)).sort();
  const changed = [...beforeKeys]
    .filter((k) => afterKeys.has(k) && before.get(k) !== after.get(k))
    .sort();
  return { added, removed, changed };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirrors the librarian-preamble.md chat-inbox instruction verbatim: copy
 * the attachment into destDir under its own name; if that name is already
 * taken, suffix — never overwrite — until a free name is found.
 */
async function collisionSafeCopy(srcPath, destDir, baseName) {
  const ext = extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  let candidate = join(destDir, baseName);
  let n = 1;
  while (await pathExists(candidate)) {
    candidate = join(destDir, `${stem}-${n}${ext}`);
    n += 1;
  }
  await copyFile(srcPath, candidate);
  return candidate;
}

function runCli(args, { cwd = REPO_ROOT, env = {}, timeout = 30000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', ...env },
  });
}

const EMPTY_DIFF = { added: [], removed: [], changed: [] };

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

test(
  'librarian-mode end-to-end: agent install, fleet registration, resolve, chat inbox, doctor, idempotency',
  { timeout: 300000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'lumina-librarian-e2e-'));
    const fakeHome = join(root, 'home');
    await mkdir(fakeHome, { recursive: true });
    const homeEnv = { HOME: fakeHome, USERPROFILE: fakeHome, LUMINA_HOME: join(fakeHome, '.lumina') };

    let scratch; // agent-host install target, reused across steps 1 and 7
    let wikiA; // "AI Engineering" — core + research
    let wikiB; // "Work Social" — core only
    let baselineA;
    let baselineB;
    let resolvedAPath;
    let firstCopyPath;
    let secondCopyPath;

    try {
      // -----------------------------------------------------------------
      // Step 1 — agent-host install
      // -----------------------------------------------------------------
      await t.test('step 1: agent-host install places global skills + a classic project install', async () => {
        scratch = join(root, 'agent-scratch');
        await mkdir(scratch, { recursive: true });
        const result = runCli(['install', '--yes', '--no-update', '--agents', 'openclaw'], {
          cwd: scratch, env: homeEnv, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(result.status, 0, result.stderr);

        const globalDir = join(fakeHome, '.openclaw', 'skills');
        const entries = await readdir(globalDir, { withFileTypes: true });
        const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        assert.ok(skillDirs.includes('lumi-hub'), 'lumi-hub missing from global skills dir');
        const lumiSkills = skillDirs.filter((name) => name.startsWith('lumi-') && name !== 'lumi-hub');
        assert.ok(lumiSkills.length >= 20, `expected the full lumi-* skill set, got ${lumiSkills.length}`);

        for (const name of lumiSkills) {
          const content = await readFile(join(globalDir, name, 'SKILL.md'), 'utf8');
          assert.ok(content.includes(PREAMBLE_HEADING), `${name}/SKILL.md missing routing preamble`);
          assert.ok(!content.includes(LIBRARIAN_PREAMBLE_ANCHOR), `${name}/SKILL.md still has the raw anchor line`);
        }
        const hubContent = await readFile(join(globalDir, 'lumi-hub', 'SKILL.md'), 'utf8');
        assert.ok(!hubContent.includes(PREAMBLE_HEADING), 'lumi-hub must not be preamble-injected');

        const manifestPath = join(fakeHome, '.lumina', 'agents', 'openclaw-manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        assert.ok(manifest.skills.includes('lumi-hub'));
        for (const name of lumiSkills) assert.ok(manifest.skills.includes(name), `manifest missing ${name}`);

        // The classic project payload happened normally alongside the global install.
        await access(join(scratch, '_lumina', 'manifest.json'));
        await access(join(scratch, 'wiki', 'index.md'));
      });

      // -----------------------------------------------------------------
      // Step 2 — create two wikis
      // -----------------------------------------------------------------
      await t.test('step 2: create two wikis (one core-only, one with the research pack)', async () => {
        wikiA = join(root, 'wikis', 'ai-engineering');
        wikiB = join(root, 'wikis', 'work-social');
        await mkdir(wikiA, { recursive: true });
        await mkdir(wikiB, { recursive: true });

        const resultA = runCli(
          ['install', '--yes', '--no-update', '--directory', wikiA, '--packs', 'core,research'],
          { env: homeEnv, timeout: INSTALL_TIMEOUT },
        );
        assert.equal(resultA.status, 0, resultA.stderr);

        const resultB = runCli(
          ['install', '--yes', '--no-update', '--directory', wikiB],
          { env: homeEnv, timeout: INSTALL_TIMEOUT },
        );
        assert.equal(resultB.status, 0, resultB.stderr);

        await access(join(wikiA, '_lumina', 'manifest.json'));
        await access(join(wikiB, '_lumina', 'manifest.json'));

        baselineA = await snapshotFiles(wikiA);
        baselineB = await snapshotFiles(wikiB);
      });

      // -----------------------------------------------------------------
      // Step 3 — register both, assert non-destructive
      // -----------------------------------------------------------------
      await t.test('step 3: register both wikis via the CLI without touching their files', async () => {
        const addA = runCli(
          ['wikis', 'add', wikiA, '--name', 'AI Engineering', '--alias', 'kỹ thuật AI', '--alias', 'ai-eng', '--json'],
          { env: homeEnv },
        );
        assert.equal(addA.status, 0, addA.stderr);
        const addedA = JSON.parse(addA.stdout);
        assert.equal(addedA.key, normalizeKey('AI Engineering'));
        assert.deepEqual(addedA.entry.packs.slice().sort(), ['core', 'research']);

        const addB = runCli(['wikis', 'add', wikiB, '--name', 'Work Social', '--json'], { env: homeEnv });
        assert.equal(addB.status, 0, addB.stderr);
        const addedB = JSON.parse(addB.stdout);
        assert.equal(addedB.key, normalizeKey('Work Social'));
        assert.deepEqual(addedB.entry.packs, ['core']);

        const afterAddA = await snapshotFiles(wikiA);
        const afterAddB = await snapshotFiles(wikiB);
        assert.deepEqual(diffSnapshots(baselineA, afterAddA), EMPTY_DIFF, 'registration must not touch wiki A files');
        assert.deepEqual(diffSnapshots(baselineB, afterAddB), EMPTY_DIFF, 'registration must not touch wiki B files');
      });

      // -----------------------------------------------------------------
      // Step 4 — resolve
      // -----------------------------------------------------------------
      await t.test('step 4: resolve by alias succeeds; resolve of an unknown query exits 2 with sorted candidates', async () => {
        const resolveOk = runCli(['wikis', 'resolve', 'kỹ thuật AI', '--json'], { env: homeEnv });
        assert.equal(resolveOk.status, 0, resolveOk.stderr);
        const resolved = JSON.parse(resolveOk.stdout);
        assert.equal(resolved.path, wikiA);
        assert.ok(resolved.packs.includes('research'));
        resolvedAPath = resolved.path;

        const resolveMissing = runCli(['wikis', 'resolve', 'nonexistent', '--json'], { env: homeEnv });
        assert.equal(resolveMissing.status, 2);
        const err = JSON.parse(resolveMissing.stderr);
        assert.equal(err.code, 2);
        assert.ok(Array.isArray(err.candidates));
        assert.equal(err.candidates.length, 2);
        const keys = err.candidates.map((c) => c.key);
        assert.deepEqual(keys, keys.slice().sort((a, b) => a.localeCompare(b)));
      });

      // -----------------------------------------------------------------
      // Step 5 — chat-inbox attachment drop
      // -----------------------------------------------------------------
      await t.test('step 5: chat-inbox attachment drop into raw/tmp/, collision-safe on the second copy', async () => {
        const cacheDir = join(root, 'chat-cache');
        await mkdir(cacheDir, { recursive: true });
        const attachmentSrc = join(cacheDir, 'lecture-notes.txt');
        await writeFile(attachmentSrc, 'these are the lecture notes\n', 'utf8');

        const rawTmp = join(resolvedAPath, 'raw', 'tmp');
        firstCopyPath = join(rawTmp, 'lecture-notes.txt');
        await copyFile(attachmentSrc, firstCopyPath);
        const firstHashBefore = await hashFile(firstCopyPath);

        secondCopyPath = await collisionSafeCopy(attachmentSrc, rawTmp, 'lecture-notes.txt');
        assert.notEqual(secondCopyPath, firstCopyPath, 'second drop must not overwrite the first');

        await access(firstCopyPath);
        await access(secondCopyPath);
        const firstHashAfter = await hashFile(firstCopyPath);
        assert.equal(firstHashAfter, firstHashBefore, 'first attachment copy must be unmodified by the second drop');
        assert.equal(await hashFile(secondCopyPath), await hashFile(attachmentSrc));
      });

      // -----------------------------------------------------------------
      // Step 6 — fleet doctor, break, fix
      // -----------------------------------------------------------------
      await t.test('step 6: fleet doctor is clean, flags exactly the broken wiki, --fix restores it', async () => {
        const doctorClean = runCli(['wikis', 'doctor', '--json'], { env: homeEnv });
        assert.equal(doctorClean.status, 0, doctorClean.stderr);
        const cleanReport = JSON.parse(doctorClean.stdout);
        assert.equal(cleanReport.schemaVersion, 1);
        assert.equal(cleanReport.wikis.length, 2);
        for (const w of cleanReport.wikis) {
          assert.equal(w.structureOk, true, `${w.key} structureOk`);
          assert.equal(w.lintOk, true, `${w.key} lintOk`);
        }

        // Break wiki B ("Work Social"): a required (empty) directory + the
        // append-only log — additive-only per AD-6, so both are recoverable.
        await rm(join(wikiB, 'wiki', 'people'), { recursive: true, force: true });
        await rm(join(wikiB, 'wiki', 'log.md'), { force: true });

        const doctorBroken = runCli(['wikis', 'doctor', '--json'], { env: homeEnv });
        assert.equal(doctorBroken.status, 1);
        const brokenReport = JSON.parse(doctorBroken.stdout);
        const byKey = Object.fromEntries(brokenReport.wikis.map((w) => [w.key, w]));
        const aKey = normalizeKey('AI Engineering');
        const bKey = normalizeKey('Work Social');
        assert.equal(byKey[aKey].structureOk, true, 'wiki A must not be flagged');
        assert.equal(byKey[aKey].lintOk, true);
        assert.equal(byKey[bKey].structureOk, false, 'wiki B must be flagged');
        assert.ok(byKey[bKey].issues.some((i) => i.includes('wiki/people')));
        assert.ok(byKey[bKey].issues.some((i) => i.includes('wiki/log.md')));

        const doctorFix = runCli(['wikis', 'doctor', 'Work Social', '--fix', '--json'], { env: homeEnv });
        assert.equal(doctorFix.status, 0, doctorFix.stderr);
        const fixed = JSON.parse(doctorFix.stdout).wikis[0];
        assert.equal(fixed.structureOk, true);
        assert.equal(fixed.lintOk, true);
        assert.deepEqual(fixed.issues, []);

        const doctorRecheck = runCli(['wikis', 'doctor', '--json'], { env: homeEnv });
        assert.equal(doctorRecheck.status, 0, doctorRecheck.stderr);
      });

      // -----------------------------------------------------------------
      // Step 7 — foreign skill survival + agent-install idempotency
      // -----------------------------------------------------------------
      await t.test('step 7: a foreign skill survives a re-install byte-identical, and the agent install is idempotent', async () => {
        const globalDir = join(fakeHome, '.openclaw', 'skills');
        const foreignDir = join(globalDir, 'my-notes-skill');
        await mkdir(foreignDir, { recursive: true });
        const foreignSkillMd = join(foreignDir, 'SKILL.md');
        const foreignContent = '---\nname: my-notes-skill\ndescription: a foreign skill unrelated to Lumina\n---\nHello from a foreign skill.\n';
        await writeFile(foreignSkillMd, foreignContent, 'utf8');

        const reinstall = runCli(['install', '--yes', '--no-update', '--agents', 'openclaw'], {
          cwd: scratch, env: homeEnv, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(reinstall.status, 0, reinstall.stderr);
        assert.equal(await readFile(foreignSkillMd, 'utf8'), foreignContent, 'foreign skill must survive byte-identical');

        const before = await snapshotFiles(globalDir);
        const secondReinstall = runCli(['install', '--yes', '--no-update', '--agents', 'openclaw'], {
          cwd: scratch, env: homeEnv, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(secondReinstall.status, 0, secondReinstall.stderr);
        const after = await snapshotFiles(globalDir);
        assert.deepEqual(diffSnapshots(before, after), EMPTY_DIFF, 'a second identical agent install must be byte-identical');
      });

      // -----------------------------------------------------------------
      // Step 8 — registry non-pollution
      // -----------------------------------------------------------------
      await t.test('step 8: neither wiki directory picked up any trace of the global registry', async () => {
        const finalA = await snapshotFiles(wikiA);
        const finalB = await snapshotFiles(wikiB);

        const diffA = diffSnapshots(baselineA, finalA);
        assert.deepEqual(diffA.removed, [], 'wiki A must not lose any file');
        assert.deepEqual(diffA.changed, [], 'wiki A must not have any file mutated');
        assert.deepEqual(
          diffA.added,
          [relative(wikiA, firstCopyPath), relative(wikiA, secondCopyPath)].sort(),
          'wiki A must only gain the two chat-inbox attachment drops',
        );
        assert.ok(diffA.added.every((p) => p.startsWith('raw/tmp/')));

        const diffB = diffSnapshots(baselineB, finalB);
        assert.deepEqual(diffB, EMPTY_DIFF, 'wiki B must return to its exact baseline after the break/repair cycle');

        for (const rel of [...finalA.keys(), ...finalB.keys()]) {
          assert.ok(!rel.includes('.lumina'), `unexpected registry trace in wiki path: ${rel}`);
          assert.ok(!rel.toLowerCase().includes('wikis.json'), `unexpected registry file leaked into wiki: ${rel}`);
        }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
