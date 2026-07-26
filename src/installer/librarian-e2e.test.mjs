/**
 * Full librarian-mode end-to-end test (AD-1 through AD-11): drives the real
 * CLI through the whole "agent + hub + spokes" story in one shared fake-HOME
 * environment — global skill install, registering a small fleet of wikis,
 * resolving by alias, the chat-inbox attachment drop the routing preamble
 * documents, a fleet-wide doctor sweep with a break/repair cycle, a second
 * agent install proving both idempotency and foreign-skill safety, the
 * chat-driven three-phase provisioning flow (`wikis inspect` -> agent asks
 * the user -> `wikis add --provision`) that turns a bare directory — which
 * may already hold the user's own files, since real wikis get pointed at
 * existing project folders — into a registered, working minimal-profile
 * wiki without ever touching what was already there, and finally the
 * lifecycle's missing act: `lumina uninstall` on one project wiki, proving
 * the teardown is scoped to that one directory (the rest of the fleet, the
 * global registry, and globally-installed agent skills all survive
 * untouched) and that a fleet command meeting a half-torn-down member
 * afterward degrades gracefully instead of crashing. No CI gate or e2e
 * suite in this repo called `uninstall` before this file did — every
 * holistic suite covered install/reinstall exhaustively and stopped one
 * step short of the lifecycle.
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
import { join, extname, relative, sep } from 'node:path';
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

function toPosix(p) {
  return p.split(sep).join('/');
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
      out.push(toPosix(relative(root, abs)));
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
 * Walk `root` and throw if any symlink's target no longer resolves — the
 * exact failure mode an out-of-order (or partially skipped) cleanup step
 * produces: the link itself survives, but whatever it pointed at is gone.
 */
async function assertNoDanglingSymlinks(root) {
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (!(await pathExists(full))) {
          throw new Error(`Dangling symlink left behind: ${toPosix(relative(root, full))}`);
        }
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  }
  await walk(root);
}

/**
 * Top-level entry names in `dir`, or `[]` if `dir` doesn't exist — used to
 * check "no lumi-* entries left" without a separate existence check first.
 */
async function readdirOrEmpty(dir) {
  try {
    return await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
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

    // Steps 9-15: the three-phase provisioning flow, against a directory
    // that already holds the user's own files (Vietnamese names/content) —
    // the realistic case, since an agent is pointed at an existing folder,
    // not an empty one.
    let wikiC;
    let wikiCBaseline;
    let wikiCKey;

    try {
      // -----------------------------------------------------------------
      // Step 1 — agent-host install
      // -----------------------------------------------------------------
      await t.test('step 1: agent-host install places global skills only — no project payload lands in the target directory', async () => {
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

        // --agents is a GLOBAL, skills-only install (CAP-10 fix): the target
        // directory (`scratch`, passed only as the process cwd, no
        // --directory flag) must gain no per-project payload at all.
        assert.equal(await pathExists(join(scratch, '_lumina')), false, '--agents must not scaffold _lumina/ into the cwd');
        assert.equal(await pathExists(join(scratch, 'wiki')), false, '--agents must not scaffold wiki/ into the cwd');
        assert.equal(await pathExists(join(scratch, 'README.md')), false, '--agents must not scaffold README.md into the cwd');
        assert.deepEqual(await readdir(scratch), [], 'the cwd must stay pristine under an agents-only install');
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
          [toPosix(relative(wikiA, firstCopyPath)), toPosix(relative(wikiA, secondCopyPath))].sort(),
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

      // -----------------------------------------------------------------
      // Step 9 — inspect a path that does not exist yet
      // -----------------------------------------------------------------
      await t.test('step 9: inspect a path that does not exist -> state "missing", full ask list, usable hint', async () => {
        const wikiCParent = join(root, 'wikis-provision');
        await mkdir(wikiCParent, { recursive: true });
        wikiC = join(wikiCParent, 'ghi-chu-du-an-ai');

        const inspectMissing = runCli(['wikis', 'inspect', wikiC, '--json'], { env: homeEnv });
        assert.equal(inspectMissing.status, 0, inspectMissing.stderr);
        const report = JSON.parse(inspectMissing.stdout);
        assert.equal(report.exists, false);
        assert.equal(report.state, 'missing');
        assert.deepEqual(report.asks.slice().sort(), ['alias', 'description', 'name', 'packs']);
        assert.equal(typeof report.hint, 'string');
        assert.ok(report.hint.includes('wikis add'), 'hint must be a usable "wikis add" command');
        assert.ok(report.hint.includes('--provision'));
        assert.ok(report.hint.includes(wikiC), 'hint must reference the inspected path');

        assert.equal(await pathExists(wikiC), false, 'inspect must never create the directory it reports as missing');
      });

      // -----------------------------------------------------------------
      // Step 10 — inspect a directory already holding the user's own files
      // -----------------------------------------------------------------
      await t.test('step 10: inspect a directory holding the user\'s own files -> state "unmanaged", writes nothing', async () => {
        await mkdir(wikiC, { recursive: true });
        await writeFile(
          join(wikiC, 'ghi-chú-dự-án.txt'),
          'Đây là ghi chú cá nhân của tôi về dự án nghiên cứu trí tuệ nhân tạo.\n',
          'utf8',
        );
        await writeFile(
          join(wikiC, 'README-cũ.md'),
          '# Dự án cũ\n\nNội dung tiếng Việt có dấu: ăn, ương, đường, đặc biệt.\n',
          'utf8',
        );
        await mkdir(join(wikiC, 'tài-liệu-tham-khảo'), { recursive: true });
        await writeFile(
          join(wikiC, 'tài-liệu-tham-khảo', 'nguồn.md'),
          'Ghi chú trong thư mục con, cũng có dấu tiếng Việt.\n',
          'utf8',
        );

        wikiCBaseline = await snapshotFiles(wikiC);
        assert.equal(wikiCBaseline.size, 3, 'sanity: three real files seeded before inspecting');

        const inspectUnmanaged = runCli(['wikis', 'inspect', wikiC, '--json'], { env: homeEnv });
        assert.equal(inspectUnmanaged.status, 0, inspectUnmanaged.stderr);
        const report = JSON.parse(inspectUnmanaged.stdout);
        assert.equal(report.state, 'unmanaged');
        assert.equal(report.entryCount, 3, 'two files + one subdirectory at the top level');
        assert.ok(report.sampleEntries.length > 0 && report.sampleEntries.length <= 5);
        assert.ok(
          report.sampleEntries.some((e) => e.normalize('NFC').includes('tài-liệu-tham-khảo'))
          || report.sampleEntries.some((e) => e.normalize('NFC').includes('ghi-chú-dự-án')),
          `sampleEntries should surface the seeded Vietnamese names, got: ${JSON.stringify(report.sampleEntries)}`,
        );

        const afterInspect = await snapshotFiles(wikiC);
        assert.deepEqual(diffSnapshots(wikiCBaseline, afterInspect), EMPTY_DIFF, 'inspect must write nothing');
      });

      // -----------------------------------------------------------------
      // Step 11 — provision that same unmanaged directory
      // -----------------------------------------------------------------
      await t.test('step 11: provisioning the unmanaged directory preserves every pre-existing file byte-for-byte', async () => {
        const provision = runCli([
          'wikis', 'add', wikiC, '--provision', '--yes', '--json',
          '--name', 'Dự Án Nghiên Cứu AI',
          '--alias', 'nghiên cứu ai',
          '--description', 'Kho lưu trữ ghi chú và tài liệu nghiên cứu về trí tuệ nhân tạo.',
          '--packs', 'core,research',
        ], { env: homeEnv, timeout: INSTALL_TIMEOUT });
        assert.equal(provision.status, 0, provision.stderr);
        const added = JSON.parse(provision.stdout);
        wikiCKey = added.key;
        assert.equal(added.provisioned, true);
        assert.ok(Array.isArray(added.created) && added.created.length > 0);

        // This is the single most important assertion in the whole file: the
        // user's real files — potentially synced to GitHub/Drive — must come
        // through byte-for-byte identical. Check both directions (nothing
        // removed/changed via the diff, AND every original hash still matches
        // by key) so a bug that swaps diffSnapshots' added/removed sides
        // can't slip through unnoticed.
        const afterProvision = await snapshotFiles(wikiC);
        const diff = diffSnapshots(wikiCBaseline, afterProvision);
        assert.deepEqual(diff.removed, [], 'no pre-existing file may be removed by provisioning');
        assert.deepEqual(diff.changed, [], 'no pre-existing file may be mutated by provisioning');
        for (const [relPath, hashBefore] of wikiCBaseline) {
          assert.ok(afterProvision.has(relPath), `pre-existing file disappeared: ${relPath}`);
          assert.equal(afterProvision.get(relPath), hashBefore, `pre-existing file mutated: ${relPath}`);
        }
        // Everything else that showed up is new Lumina scaffolding, not a
        // disguised rewrite of something the user already had.
        assert.ok(diff.added.length > 0, 'provisioning must actually add the wiki scaffold');
        assert.ok(diff.added.every((p) => !wikiCBaseline.has(p)));
      });

      // -----------------------------------------------------------------
      // Step 12 — the provisioned wiki is immediately usable
      // -----------------------------------------------------------------
      await t.test('step 12: the provisioned wiki is immediately usable — resolve, doctor, and its own engine run', async () => {
        const resolveResult = runCli(['wikis', 'resolve', 'nghiên cứu ai', '--json'], { env: homeEnv });
        assert.equal(resolveResult.status, 0, resolveResult.stderr);
        const resolved = JSON.parse(resolveResult.stdout);
        assert.equal(resolved.path, wikiC);
        assert.equal(resolved.key, wikiCKey);
        assert.ok(resolved.packs.includes('research'));

        const doctorResult = runCli(['wikis', 'doctor', wikiCKey, '--json'], { env: homeEnv });
        assert.equal(doctorResult.status, 0, doctorResult.stderr);
        const report = JSON.parse(doctorResult.stdout).wikis[0];
        assert.equal(report.structureOk, true);
        assert.equal(report.lintOk, true);
        assert.deepEqual(report.issues, []);

        // Proves the hub actually scaffolded a WORKING engine, not just a
        // directory tree — a read op through the wiki's own wiki.mjs.
        const engineResult = spawnSync(
          process.execPath,
          [join(wikiC, '_lumina', 'scripts', 'wiki.mjs'), 'list-entities'],
          {
            cwd: wikiC,
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
          },
        );
        assert.equal(engineResult.status, 0, engineResult.stderr);
        const listing = JSON.parse(engineResult.stdout);
        assert.equal(typeof listing.count, 'number');
        assert.ok(Array.isArray(listing.entities));
      });

      // -----------------------------------------------------------------
      // Step 13 — the Vietnamese --description reached the README
      // -----------------------------------------------------------------
      await t.test('step 13: --description reached the README\'s "## Project Purpose" section', async () => {
        const readme = await readFile(join(wikiC, 'README.md'), 'utf8');
        const purposeIdx = readme.indexOf('## Project Purpose');
        assert.ok(purposeIdx !== -1, 'README.md must have a "## Project Purpose" section');
        const purposeSection = readme.slice(purposeIdx);
        assert.ok(
          purposeSection.includes('Kho lưu trữ ghi chú và tài liệu nghiên cứu về trí tuệ nhân tạo.'),
          'the Vietnamese --description text must appear under Project Purpose',
        );
      });

      // -----------------------------------------------------------------
      // Step 14 — the minimal profile really is minimal
      // -----------------------------------------------------------------
      await t.test('step 14: minimal profile creates no per-project IDE/agent files anywhere in the wiki', async () => {
        for (const rel of ['.claude', '.agents', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursor']) {
          assert.equal(await pathExists(join(wikiC, rel)), false, `minimal profile must not create ${rel}`);
        }
        // Belt-and-suspenders: walk the whole tree in case one of these
        // shows up nested somewhere unexpected rather than at the root.
        const allFiles = await walkFiles(wikiC);
        for (const rel of allFiles) {
          const base = rel.split('/').pop();
          assert.ok(
            !['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].includes(base),
            `forbidden file found in the provisioned tree: ${rel}`,
          );
          assert.ok(
            !rel.startsWith('.claude/') && !rel.startsWith('.agents/') && !rel.startsWith('.cursor/'),
            `forbidden directory found in the provisioned tree: ${rel}`,
          );
        }
      });

      // -----------------------------------------------------------------
      // Step 15 — the realistic retry: identical command repeated
      // -----------------------------------------------------------------
      // What an always-on chat agent (OpenClaw/Hermes, over Telegram/Lark)
      // actually does on a redelivered message or a network hiccup it's
      // unsure landed: re-run the EXACT same command, same --name and all.
      // That must come back as a clean success the agent can word accurately
      // ("already added"), not an error it has to guess the meaning of.
      await t.test('step 15: repeating the identical --provision --yes command is a no-op success, not an error', async () => {
        const before = await snapshotFiles(wikiC);

        const identicalRetry = runCli([
          'wikis', 'add', wikiC, '--provision', '--yes', '--json',
          '--name', 'Dự Án Nghiên Cứu AI',
          '--alias', 'nghiên cứu ai',
          '--description', 'Kho lưu trữ ghi chú và tài liệu nghiên cứu về trí tuệ nhân tạo.',
          '--packs', 'core,research',
        ], { env: homeEnv, timeout: INSTALL_TIMEOUT });
        assert.equal(identicalRetry.status, 0, identicalRetry.stderr);
        const added = JSON.parse(identicalRetry.stdout);
        assert.equal(added.provisioned, false, 'must not reinstall/upgrade an already-provisioned wiki');
        assert.equal(added.alreadyRegistered, true);
        assert.equal(added.key, wikiCKey);
        assert.ok(!('created' in added));

        const after = await snapshotFiles(wikiC);
        assert.deepEqual(diffSnapshots(before, after), EMPTY_DIFF, 'directory must be byte-identical after the retry');

        const list = JSON.parse(runCli(['wikis', 'list', '--json'], { env: homeEnv }).stdout);
        const wikiCRegistrations = Object.entries(list.wikis).filter(([, entry]) => entry.path === wikiC);
        assert.equal(wikiCRegistrations.length, 1, 'the retry must not create a second registration for the same path');
      });

      // -----------------------------------------------------------------
      // Step 16 — a different --name on the same already-provisioned path
      // is now a hard conflict: one directory gets exactly one registry
      // entry (registry.js's addWiki, so this applies to every caller —
      // not a --provision-specific rule).
      // -----------------------------------------------------------------
      await t.test('step 16: re-provisioning under a genuinely different --name is rejected — one directory, one entry', async () => {
        const before = await snapshotFiles(wikiC);

        const secondProvision = runCli([
          'wikis', 'add', wikiC, '--provision', '--yes', '--json',
          '--name', 'Dự Án Nghiên Cứu AI (đăng ký lại)',
        ], { env: homeEnv, timeout: INSTALL_TIMEOUT });
        assert.equal(secondProvision.status, 1, secondProvision.stderr);
        const err = JSON.parse(secondProvision.stderr);
        assert.equal(err.code, 1);
        assert.ok(err.error.includes(wikiCKey), 'the error must name the existing key');

        const after = await snapshotFiles(wikiC);
        assert.deepEqual(diffSnapshots(before, after), EMPTY_DIFF, 'the rejected attempt must not touch the directory');

        const list = JSON.parse(runCli(['wikis', 'list', '--json'], { env: homeEnv }).stdout);
        const wikiCRegistrations = Object.entries(list.wikis).filter(([, entry]) => entry.path === wikiC);
        assert.equal(wikiCRegistrations.length, 1, 'wikiC must still have exactly one registry entry');
      });

      // -----------------------------------------------------------------
      // Step 17 — the well-behaved path: inspect first, so a duplicate
      // never even reaches phase 3
      // -----------------------------------------------------------------
      await t.test('step 17: inspecting an already-registered wiki reports registered:true and asks:[] — phase 3 is never reached', async () => {
        const inspectAgain = runCli(['wikis', 'inspect', wikiC, '--json'], { env: homeEnv });
        assert.equal(inspectAgain.status, 0, inspectAgain.stderr);
        const report = JSON.parse(inspectAgain.stdout);
        assert.equal(report.registered, true);
        assert.equal(report.registeredAs, wikiCKey);
        assert.deepEqual(report.asks, []);
        assert.equal(report.hint, null);
      });

      // -----------------------------------------------------------------
      // Step 18 — the missing act: uninstall. The lifecycle doesn't end at
      // "provisioned and idempotent" — a real user eventually decommissions
      // a project. Uninstalling wiki B ("Work Social", full-profile, so it
      // actually has its own .claude/skills/lumi-* links to tear down —
      // wiki C is minimal-profile and never had any) must be scoped to wiki
      // B alone: the rest of the fleet, the global registry, and the
      // globally-installed agent skills from step 1 all have to survive
      // byte-for-byte untouched.
      // -----------------------------------------------------------------
      await t.test('step 18: uninstalling one project wiki cleans only that directory, leaves the rest of the fleet and the hub alone', async () => {
        // Baselines for everything OUTSIDE wiki B, taken BEFORE the
        // uninstall — so "untouched" is proven, not assumed.
        const wikiABefore = await snapshotFiles(wikiA);
        const wikiCBefore = await snapshotFiles(wikiC);
        const globalSkillsDir = join(fakeHome, '.openclaw', 'skills');
        const globalSkillsBefore = await snapshotFiles(globalSkillsDir);
        const registryBefore = JSON.parse(runCli(['wikis', 'list', '--json'], { env: homeEnv }).stdout);

        // Sanity, on wiki B itself, BEFORE teardown: prove there is
        // something real to remove, so passing assertions afterward can't
        // be a vacuous "nothing was there to begin with."
        const claudeSkillsBefore = await readdirOrEmpty(join(wikiB, '.claude', 'skills'));
        const lumiLinksBefore = claudeSkillsBefore.filter((n) => n.startsWith('lumi-'));
        assert.ok(lumiLinksBefore.length > 0, 'sanity: wiki B must have real lumi-* skill links before teardown');
        await access(join(wikiB, 'CLAUDE.md')); // sanity: entry-point stub exists before teardown

        const uninstallResult = runCli(['uninstall', '--yes', '--directory', wikiB], { env: homeEnv, timeout: INSTALL_TIMEOUT });
        assert.equal(uninstallResult.status, 0, uninstallResult.stderr);

        // --- wiki B itself is genuinely clean ---------------------------
        await assert.rejects(access(join(wikiB, '_lumina')), 'the engine directory must be gone');
        await assert.rejects(access(join(wikiB, 'CLAUDE.md')), 'the entry-point stub file must be gone');

        const claudeSkillsAfter = await readdirOrEmpty(join(wikiB, '.claude', 'skills'));
        assert.deepEqual(
          claudeSkillsAfter.filter((n) => n.startsWith('lumi-')), [],
          'no lumi-* entries may remain in .claude/skills',
        );
        assert.deepEqual(
          await readdirOrEmpty(join(wikiB, '.agents', 'skills')).then((names) => names.filter((n) => n.startsWith('lumi-'))),
          [],
          'no lumi-* entries may remain in .agents/skills',
        );
        // .agents/ is fully pruned once empty (an empty leftover
        // .claude/skills/.claude, by contrast, is not something Lumina
        // guarantees to clean up — nobody asked for that, and it is not a
        // defect: no lumi-* entries and no dangling symlinks, checked
        // above and below, are what actually matter here).
        assert.equal(await pathExists(join(wikiB, '.agents')), false, '.agents must not be left behind empty');

        await assertNoDanglingSymlinks(wikiB);

        // wiki/ and raw/ are always preserved by uninstall (never Lumina's
        // to delete) — confirm the directories themselves are still there.
        await access(join(wikiB, 'wiki'));
        await access(join(wikiB, 'raw'));

        // --- the rest of the fleet is untouched --------------------------
        assert.deepEqual(await snapshotFiles(wikiA), wikiABefore, 'wiki A must be completely unaffected by wiki B\'s uninstall');
        assert.deepEqual(
          await snapshotFiles(wikiC), wikiCBefore,
          'wiki C — and the Vietnamese-named user files seeded into it in step 10 — must be completely unaffected',
        );

        // --- the hub itself is untouched ---------------------------------
        assert.deepEqual(
          await snapshotFiles(globalSkillsDir), globalSkillsBefore,
          'a per-project uninstall must never reach into the globally-installed agent skills',
        );
        const registryAfter = JSON.parse(runCli(['wikis', 'list', '--json'], { env: homeEnv }).stdout);
        assert.deepEqual(
          registryAfter, registryBefore,
          'uninstall has no concept of the global registry — wiki B must still be registered, pointing at its (now-stripped) directory',
        );

        // --- doctor meets a half-torn-down fleet member gracefully -------
        const doctorAfter = runCli(['wikis', 'doctor', '--json'], { env: homeEnv });
        assert.equal(doctorAfter.status, 1, doctorAfter.stderr); // one unhealthy wiki -> non-zero, but no crash
        const report = JSON.parse(doctorAfter.stdout);
        const byKey = Object.fromEntries(report.wikis.map((w) => [w.key, w]));

        const bKey = normalizeKey('Work Social');
        assert.equal(byKey[bKey].reachable, true, 'the directory itself still exists, just stripped');
        assert.equal(byKey[bKey].hasManifest, false);
        assert.equal(byKey[bKey].structureOk, false);
        assert.ok(byKey[bKey].issues.length > 0);

        // The rest of the fleet is reported healthy, unaffected by B's
        // teardown — a broken member doesn't drag the sweep down with it.
        const aKey = normalizeKey('AI Engineering');
        assert.equal(byKey[aKey].structureOk, true);
        assert.equal(byKey[aKey].lintOk, true);
        assert.equal(byKey[wikiCKey].structureOk, true);
        assert.equal(byKey[wikiCKey].lintOk, true);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
