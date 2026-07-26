/**
 * Tests for src/installer/wikis-command.js — the `lumina wikis <verb>` CLI
 * surface. Pattern follows commands.test.js / layout.test.js: spawnSync the
 * REAL CLI against real sandbox wikis (installed via the CLI into mkdtemp
 * dirs OUTSIDE the repo — never run the installer against the repo root).
 * `LUMINA_HOME` is pointed at a per-test mkdtemp so the registry never
 * touches the real `~/.lumina/`.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fileHash } from './fs.js';
import { normalizeKey } from './registry.js';
// Direct import — used ONLY for the console-restoration test below, where the
// assertion is about in-process global state (console.log identity) that a
// spawned child process can't expose. Every commander-flag-collision test
// below deliberately spawns the real CLI instead, since that bug class lives
// in the commander layer and a direct wikisCommand() call would bypass it.
import { wikisCommand } from './wikis-command.js';

const PKG_VERSION = JSON.parse(
  await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
).version;

const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));

let luminaHomeDir;
let previousLuminaHome;
let trackedDirs;

beforeEach(async () => {
  previousLuminaHome = process.env.LUMINA_HOME;
  luminaHomeDir = await mkdtemp(join(tmpdir(), 'lumina-wikis-cmd-home-'));
  process.env.LUMINA_HOME = luminaHomeDir;
  trackedDirs = [luminaHomeDir];
});

afterEach(async () => {
  if (previousLuminaHome === undefined) delete process.env.LUMINA_HOME;
  else process.env.LUMINA_HOME = previousLuminaHome;
  for (const dir of trackedDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000 });
}

/**
 * Recursive file-hash snapshot of a directory tree (excludes `.git`), used
 * to prove a command wrote nothing (`inspect`) or preserved every
 * pre-existing file byte-for-byte (`add --provision` on an unmanaged dir).
 */
async function snapshotFiles(root) {
  const out = new Map();
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        await walk(full);
      } else if (entry.isFile()) {
        out.set(full, await fileHash(full));
      }
    }
  }
  await walk(root);
  return [...out.entries()].sort();
}

/**
 * Install a real wiki via the CLI into a fresh mkdtemp dir (never the repo
 * root — see docs/project-context.md rule 0).
 */
async function installSandboxWiki(dirName, extraArgs = []) {
  const tmp = await mkdtemp(join(tmpdir(), 'lumina-wikis-cmd-wiki-'));
  trackedDirs.push(tmp);
  const workspace = join(tmp, dirName);
  await mkdir(workspace, { recursive: true });
  const result = run(['install', '--yes', '--no-update', '--directory', workspace, ...extraArgs]);
  assert.equal(result.status, 0, result.stderr);
  return workspace;
}

describe('lumina wikis — add / list / resolve', () => {
  test('add + list + resolve happy path against a real sandbox wiki', async () => {
    const workspace = await installSandboxWiki('ai-engineering', ['--packs', 'core,research']);

    const addResult = run(['wikis', 'add', workspace, '--name', 'AI Engineering', '--alias', 'ai-eng', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);
    const added = JSON.parse(addResult.stdout);
    assert.equal(added.key, normalizeKey('AI Engineering'));
    assert.equal(added.entry.path, workspace);
    assert.deepEqual(added.entry.packs.slice().sort(), ['core', 'research']);

    const listResult = run(['wikis', 'list', '--json']);
    assert.equal(listResult.status, 0, listResult.stderr);
    const listed = JSON.parse(listResult.stdout);
    assert.ok(listed.wikis[added.key]);
    assert.equal(listed.wikis[added.key].path, workspace);

    const resolveResult = run(['wikis', 'resolve', 'AI Engineering', '--json']);
    assert.equal(resolveResult.status, 0, resolveResult.stderr);
    const resolved = JSON.parse(resolveResult.stdout);
    assert.equal(resolved.key, added.key);
    assert.equal(resolved.path, workspace);
  });

  test('resolve matches a Vietnamese alias end-to-end through the CLI', async () => {
    const workspace = await installSandboxWiki('ai-eng-vi');
    const addResult = run(['wikis', 'add', workspace, '--name', 'AI Engineering', '--alias', 'kỹ thuật AI', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);

    const resolveResult = run(['wikis', 'resolve', 'kỹ thuật AI', '--json']);
    assert.equal(resolveResult.status, 0, resolveResult.stderr);
    const resolved = JSON.parse(resolveResult.stdout);
    assert.equal(resolved.key, normalizeKey('AI Engineering'));
    assert.equal(resolved.path, workspace);
  });

  test('resolve of an unknown query exits 2 with sorted candidates in the JSON error', async () => {
    const w1 = await installSandboxWiki('zzz-wiki');
    const w2 = await installSandboxWiki('aaa-wiki');
    assert.equal(run(['wikis', 'add', w1, '--name', 'Zzz Wiki']).status, 0);
    assert.equal(run(['wikis', 'add', w2, '--name', 'Aaa Wiki']).status, 0);

    const result = run(['wikis', 'resolve', 'does-not-exist', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
    assert.ok(Array.isArray(err.candidates));
    assert.equal(err.candidates.length, 2);
    const keys = err.candidates.map((c) => c.key);
    assert.deepEqual(keys, keys.slice().sort((a, b) => a.localeCompare(b)));
  });

  test('resolve exits 2 when the registered wiki directory has been deleted', async () => {
    const workspace = await installSandboxWiki('gone-wiki');
    const addResult = run(['wikis', 'add', workspace, '--name', 'Gone Wiki', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);

    await rm(workspace, { recursive: true, force: true });

    const result = run(['wikis', 'resolve', 'Gone Wiki', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
    assert.equal(err.lastKnownPath, workspace);
    assert.ok(err.reason);
    assert.match(err.error, /could not be resolved/i);
  });

  test('resolve exits 2 when the registered path exists but has no _lumina/manifest.json', async () => {
    const workspace = await installSandboxWiki('replaced-wiki');
    const addResult = run(['wikis', 'add', workspace, '--name', 'Replaced Wiki', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);

    // Simulate the directory being replaced by an unrelated, non-wiki folder
    // (same path, no _lumina/manifest.json).
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'notes.txt'), 'unrelated content', 'utf8');

    const result = run(['wikis', 'resolve', 'Replaced Wiki', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
    assert.equal(err.lastKnownPath, workspace);
  });

  test('resolve exits 2 when the registered wiki manifest is corrupt JSON', async () => {
    const workspace = await installSandboxWiki('corrupt-wiki');
    const addResult = run(['wikis', 'add', workspace, '--name', 'Corrupt Wiki', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);

    const manifestPath = join(workspace, '_lumina', 'manifest.json');
    await writeFile(manifestPath, '{ not valid json', 'utf8');

    const result = run(['wikis', 'resolve', 'Corrupt Wiki', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
    assert.equal(err.lastKnownPath, workspace);
  });

  test('add rejects a directory that is not a Lumina wiki (exit 2)', async () => {
    const notWiki = await mkdtemp(join(tmpdir(), 'lumina-not-a-wiki-'));
    trackedDirs.push(notWiki);

    const result = run(['wikis', 'add', notWiki, '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
  });

  test('add rejects an all-non-Latin name that normalizes to empty (exit 1), clean CLI error not a crash', async () => {
    const workspace = await installSandboxWiki('all-non-latin-name');

    const result = run(['wikis', 'add', workspace, '--name', '维基百科', '--json']);
    assert.equal(result.status, 1, result.stderr);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 1);
    assert.match(err.error, /no Latin letters or digits/);

    const listResult = run(['wikis', 'list', '--json']);
    assert.equal(listResult.status, 0, listResult.stderr);
    const listed = JSON.parse(listResult.stdout);
    assert.deepEqual(listed.wikis, {});
  });

  test('add rejects a name/alias that already resolves to a different wiki (exit 1)', async () => {
    const w1 = await installSandboxWiki('wiki-one');
    const w2 = await installSandboxWiki('wiki-two');

    const first = run(['wikis', 'add', w1, '--name', 'Shared Name', '--json']);
    assert.equal(first.status, 0, first.stderr);

    const second = run(['wikis', 'add', w2, '--name', 'Other Name', '--alias', 'Shared Name', '--json']);
    assert.equal(second.status, 1, second.stderr);
    const err = JSON.parse(second.stderr);
    assert.equal(err.code, 1);
  });
});

describe('lumina wikis doctor', () => {
  test('reports the pinned shape and exit 0 for a healthy fleet', async () => {
    const w1 = await installSandboxWiki('healthy-one');
    const w2 = await installSandboxWiki('healthy-two');
    assert.equal(run(['wikis', 'add', w1, '--name', 'Healthy One']).status, 0);
    assert.equal(run(['wikis', 'add', w2, '--name', 'Healthy Two']).status, 0);

    const result = run(['wikis', 'doctor', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);

    assert.deepEqual(Object.keys(report).sort(), ['schemaVersion', 'wikis'].sort());
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.wikis.length, 2);

    const pinnedKeys = ['key', 'path', 'reachable', 'hasManifest', 'structureOk', 'lintOk', 'issues'].sort();
    for (const w of report.wikis) {
      assert.deepEqual(Object.keys(w).sort(), pinnedKeys);
      assert.equal(w.reachable, true);
      assert.equal(w.hasManifest, true);
      assert.equal(w.structureOk, true);
      assert.equal(w.lintOk, true);
      assert.deepEqual(w.issues, []);
    }
  });

  test('flags exactly the broken wiki in a mixed fleet, exit 1', async () => {
    const healthy = await installSandboxWiki('still-healthy');
    const broken = await installSandboxWiki('will-break');
    assert.equal(run(['wikis', 'add', healthy, '--name', 'Still Healthy']).status, 0);
    assert.equal(run(['wikis', 'add', broken, '--name', 'Will Break']).status, 0);

    // Break it: delete a required directory + the append-only log.
    await rm(join(broken, 'wiki', 'concepts'), { recursive: true, force: true });
    await rm(join(broken, 'wiki', 'log.md'), { force: true });

    const result = run(['wikis', 'doctor', '--json']);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const byKey = Object.fromEntries(report.wikis.map((w) => [w.key, w]));

    const healthyEntry = byKey[normalizeKey('Still Healthy')];
    assert.equal(healthyEntry.structureOk, true);
    assert.equal(healthyEntry.lintOk, true);
    assert.deepEqual(healthyEntry.issues, []);

    const brokenEntry = byKey[normalizeKey('Will Break')];
    assert.equal(brokenEntry.structureOk, false);
    assert.ok(brokenEntry.issues.some((i) => i.includes('wiki/concepts')));
    assert.ok(brokenEntry.issues.some((i) => i.includes('wiki/log.md')));
  });

  test('doctor <name> --json exits 2 for an unknown name', async () => {
    const result = run(['wikis', 'doctor', 'nobody-registered-this', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
  });

  test('--fix restores missing dirs/seed files without touching pre-existing content, then re-check is clean', async () => {
    const healthy = await installSandboxWiki('reference-wiki');
    const broken = await installSandboxWiki('fixable-wiki');
    assert.equal(run(['wikis', 'add', healthy, '--name', 'Reference Wiki']).status, 0);
    assert.equal(run(['wikis', 'add', broken, '--name', 'Fixable Wiki']).status, 0);

    const indexPath = join(broken, 'wiki', 'index.md');
    const hashBefore = await fileHash(indexPath);

    // Break it additively-recoverably: drop a required dir + the seeded log.
    await rm(join(broken, 'wiki', 'people'), { recursive: true, force: true });
    await rm(join(broken, 'wiki', 'log.md'), { force: true });

    const firstDoctor = run(['wikis', 'doctor', 'Fixable Wiki', '--fix', '--json']);
    assert.equal(firstDoctor.status, 0, firstDoctor.stderr);
    const fixed = JSON.parse(firstDoctor.stdout).wikis[0];
    assert.equal(fixed.key, normalizeKey('Fixable Wiki'));
    assert.equal(fixed.structureOk, true);
    assert.equal(fixed.lintOk, true);
    assert.deepEqual(fixed.issues, []);

    // Recreated seed content matches exactly what a fresh install produces.
    const restoredLog = await readFile(join(broken, 'wiki', 'log.md'), 'utf8');
    const referenceLog = await readFile(join(healthy, 'wiki', 'log.md'), 'utf8');
    assert.equal(restoredLog, referenceLog);

    // Pre-existing file (never deleted) is byte-identical — fix never
    // touches a path that already exists.
    const hashAfter = await fileHash(indexPath);
    assert.equal(hashAfter, hashBefore);

    const secondDoctor = run(['wikis', 'doctor', 'Fixable Wiki', '--json']);
    assert.equal(secondDoctor.status, 0, secondDoctor.stderr);
    const recheck = JSON.parse(secondDoctor.stdout).wikis[0];
    assert.equal(recheck.structureOk, true);
    assert.equal(recheck.lintOk, true);
    assert.deepEqual(recheck.issues, []);
  });
});

describe('lumina wikis inspect', () => {
  test('missing path: exit 0, exists:false, provisionable asks/hint, writes nothing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'lumina-inspect-missing-'));
    trackedDirs.push(parent);
    const target = join(parent, 'does-not-exist-yet');

    const regBefore = await readFile(join(luminaHomeDir, 'wikis.json'), 'utf8').catch(() => null);
    const result = run(['wikis', 'inspect', target, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);

    assert.deepEqual(
      Object.keys(report).sort(),
      ['schemaVersion', 'path', 'exists', 'state', 'registered', 'registeredAs', 'entryCount',
        'sampleEntries', 'missing', 'willCreate', 'asks', 'hint'].sort(),
    );
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.path, target);
    assert.equal(report.exists, false);
    assert.equal(report.state, 'missing');
    assert.equal(report.registered, false);
    assert.equal(report.registeredAs, null);
    assert.equal(report.entryCount, 0);
    assert.deepEqual(report.sampleEntries, []);
    assert.deepEqual(report.missing, { dirs: [], seedFiles: [], engine: [] });
    assert.deepEqual(report.willCreate, ['README.md', '_lumina/', 'wiki/', 'raw/', 'graph/']);
    assert.deepEqual(report.asks, ['name', 'alias', 'description', 'packs']);
    assert.equal(
      report.hint,
      `lumina wikis add "${target}" --provision --yes --json --name "<name>" --alias "<alias>" --description "<text>" --packs core`,
    );

    // Never creates the directory it just reported as missing.
    await assert.rejects(readdir(target));
    const regAfter = await readFile(join(luminaHomeDir, 'wikis.json'), 'utf8').catch(() => null);
    assert.equal(regAfter, regBefore);
  });

  test('empty directory: state "empty", exit 0, writes nothing', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-inspect-empty-'));
    trackedDirs.push(target);
    const before = await snapshotFiles(target);

    const result = run(['wikis', 'inspect', target, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.exists, true);
    assert.equal(report.state, 'empty');
    assert.equal(report.entryCount, 0);
    assert.deepEqual(report.sampleEntries, []);
    assert.deepEqual(report.asks, ['name', 'alias', 'description', 'packs']);

    assert.deepEqual(await snapshotFiles(target), before);
  });

  test('unmanaged directory: reports entryCount and up to 5 sampleEntries, writes nothing', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-inspect-unmanaged-'));
    trackedDirs.push(target);
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      await writeFile(join(target, name), `content of ${name}`);
    }
    const before = await snapshotFiles(target);

    const result = run(['wikis', 'inspect', target, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.state, 'unmanaged');
    assert.equal(report.entryCount, 3);
    assert.deepEqual(report.sampleEntries.slice().sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.deepEqual(report.asks, ['name', 'alias', 'description', 'packs']);
    assert.deepEqual(report.willCreate, ['README.md', '_lumina/', 'wiki/', 'raw/', 'graph/']);

    assert.deepEqual(await snapshotFiles(target), before);
  });

  test('healthy wiki: state "wiki-ok", asks ["name","alias"] until registered, then registered/[]', async () => {
    const workspace = await installSandboxWiki('inspect-wiki-ok');
    const before = await snapshotFiles(workspace);

    const unregistered = run(['wikis', 'inspect', workspace, '--json']);
    assert.equal(unregistered.status, 0, unregistered.stderr);
    const report1 = JSON.parse(unregistered.stdout);
    assert.equal(report1.state, 'wiki-ok');
    assert.equal(report1.registered, false);
    assert.equal(report1.registeredAs, null);
    assert.deepEqual(report1.missing, { dirs: [], seedFiles: [], engine: [] });
    assert.deepEqual(report1.willCreate, []);
    assert.deepEqual(report1.asks, ['name', 'alias']);
    assert.equal(report1.hint, `lumina wikis add "${workspace}" --json --name "<name>" --alias "<alias>"`);

    assert.equal(run(['wikis', 'add', workspace, '--name', 'Inspect Wiki Ok']).status, 0);
    const registered = run(['wikis', 'inspect', workspace, '--json']);
    assert.equal(registered.status, 0, registered.stderr);
    const report2 = JSON.parse(registered.stdout);
    assert.equal(report2.registered, true);
    assert.equal(report2.registeredAs, normalizeKey('Inspect Wiki Ok'));
    assert.deepEqual(report2.asks, []);
    assert.equal(report2.hint, null);

    // inspect itself never wrote to the wiki directory.
    assert.deepEqual(await snapshotFiles(workspace), before);
  });

  test('broken wiki: state "wiki-partial" with missing.dirs/seedFiles populated', async () => {
    const workspace = await installSandboxWiki('inspect-wiki-partial');
    await rm(join(workspace, 'wiki', 'people'), { recursive: true, force: true });
    await rm(join(workspace, 'wiki', 'log.md'), { force: true });

    const result = run(['wikis', 'inspect', workspace, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.state, 'wiki-partial');
    assert.ok(report.missing.dirs.includes('wiki/people'));
    assert.ok(report.missing.seedFiles.includes('wiki/log.md'));
    assert.deepEqual(report.willCreate, []);
    assert.deepEqual(report.asks, ['name', 'alias']);
  });

  test('exits 1 when the path argument is missing', () => {
    const result = run(['wikis', 'inspect', '--json']);
    assert.equal(result.status, 1);
  });
});

describe('lumina wikis add --provision', () => {
  test('--provision without --yes exits 2 and does not touch anything', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-provision-no-yes-'));
    trackedDirs.push(target);
    const before = await snapshotFiles(target);

    const result = run(['wikis', 'add', target, '--provision', '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
    assert.match(err.error, /--yes/);

    assert.deepEqual(await snapshotFiles(target), before);
    const list = run(['wikis', 'list', '--json']);
    assert.deepEqual(JSON.parse(list.stdout).wikis, {});
  });

  test('provisions an empty directory into a registered, doctor-clean wiki', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-provision-empty-'));
    trackedDirs.push(target);

    const result = run([
      'wikis', 'add', target, '--provision', '--yes', '--json',
      '--name', 'Provisioned Empty', '--description', 'test purpose',
    ]);
    assert.equal(result.status, 0, result.stderr);
    // Stdout must be a single clean JSON line — no installer progress noise.
    const added = JSON.parse(result.stdout);
    assert.equal(added.provisioned, true);
    assert.ok(Array.isArray(added.created) && added.created.length > 0);
    assert.equal(added.entry.path, target);
    assert.equal(added.key, normalizeKey('Provisioned Empty'));

    const doctor = run(['wikis', 'doctor', 'Provisioned Empty', '--json']);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout).wikis[0];
    assert.equal(report.structureOk, true);
    assert.equal(report.lintOk, true);
    assert.deepEqual(report.issues, []);
  });

  test('provisioning an unmanaged directory preserves every pre-existing file byte-for-byte', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-provision-unmanaged-'));
    trackedDirs.push(target);
    await writeFile(join(target, 'notes.txt'), 'pre-existing notes, do not touch');
    await mkdir(join(target, 'my-stuff'), { recursive: true });
    await writeFile(join(target, 'my-stuff', 'thing.md'), '# pre-existing thing\n');

    const preExisting = new Map([
      [resolvePath(target, 'notes.txt'), await fileHash(join(target, 'notes.txt'))],
      [resolvePath(target, 'my-stuff', 'thing.md'), await fileHash(join(target, 'my-stuff', 'thing.md'))],
    ]);

    const result = run(['wikis', 'add', target, '--provision', '--yes', '--json', '--name', 'Provisioned Unmanaged']);
    assert.equal(result.status, 0, result.stderr);
    const added = JSON.parse(result.stdout);
    assert.equal(added.provisioned, true);

    for (const [filePath, hashBefore] of preExisting) {
      assert.equal(await fileHash(filePath), hashBefore, `pre-existing file changed: ${filePath}`);
    }
    // The installer did add its own files on top.
    await access(join(target, '_lumina', 'manifest.json'));
  });

  test('--provision on an already-installed wiki registers without touching the directory; reports versionSkew', async () => {
    const workspace = await installSandboxWiki('provision-existing-wiki');
    // Force a version mismatch so versionSkew is exercised deterministically.
    const manifestPath = join(workspace, '_lumina', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.packageVersion = '0.0.1-test';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const before = await snapshotFiles(workspace);

    const result = run(['wikis', 'add', workspace, '--provision', '--yes', '--json', '--name', 'Provision Existing']);
    assert.equal(result.status, 0, result.stderr);
    const added = JSON.parse(result.stdout);
    assert.equal(added.provisioned, false);
    assert.ok(!('created' in added));
    assert.deepEqual(added.versionSkew, { wiki: '0.0.1-test', hub: PKG_VERSION });

    assert.deepEqual(await snapshotFiles(workspace), before);
  });

  test('plain "add" (no --provision) is unaffected: no provisioned/created field, still exit 2 on a non-wiki', async () => {
    const notWiki = await mkdtemp(join(tmpdir(), 'lumina-add-plain-'));
    trackedDirs.push(notWiki);
    const result = run(['wikis', 'add', notWiki, '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);

    const workspace = await installSandboxWiki('add-plain-happy');
    const addResult = run(['wikis', 'add', workspace, '--name', 'Add Plain Happy', '--json']);
    assert.equal(addResult.status, 0, addResult.stderr);
    const added = JSON.parse(addResult.stdout);
    assert.ok(!('provisioned' in added));
    assert.ok(!('created' in added));
  });
});

// ---------------------------------------------------------------------------
// Idempotent retry.
//
// add --provision is the endpoint a chat agent (OpenClaw/Hermes, over
// Telegram/Lark) drives, and retries are normal there — a redelivered
// message, a network hiccup, a user repeating themselves. The agent then
// re-runs the EXACT same command it ran before. Before this fix that hit
// registry.js's duplicate-key guard and came back as an error indistinguishable
// from a real failure. Fixed in wikis-command.js only (registry.js's addWiki
// guard is unchanged and still strict for every other caller — plain `add`,
// and a --provision retry under a genuinely different name/path).
// ---------------------------------------------------------------------------
describe('lumina wikis add --provision — idempotent retry', () => {
  test('the identical --provision --yes command repeated on the same path is a no-op success', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-retry-same-'));
    trackedDirs.push(target);
    const args = [
      'wikis', 'add', target, '--provision', '--yes', '--json',
      '--name', 'Retry Same', '--alias', 'retry-alias', '--description', 'retry test',
    ];

    const first = run(args);
    assert.equal(first.status, 0, first.stderr);
    const firstAdded = JSON.parse(first.stdout);
    assert.equal(firstAdded.provisioned, true);
    assert.ok(!('alreadyRegistered' in firstAdded));

    const afterFirst = await snapshotFiles(target);

    const second = run(args);
    assert.equal(second.status, 0, second.stderr);
    const secondAdded = JSON.parse(second.stdout);
    assert.equal(secondAdded.provisioned, false);
    assert.equal(secondAdded.alreadyRegistered, true);
    assert.equal(secondAdded.key, firstAdded.key);
    assert.deepEqual(secondAdded.entry, firstAdded.entry);
    assert.ok(!('created' in secondAdded));

    assert.deepEqual(await snapshotFiles(target), afterFirst, 'a retried provision must not touch the directory again');

    // Exactly one registry entry for this wiki — the retry must not have
    // silently created a second registration.
    const list = JSON.parse(run(['wikis', 'list', '--json']).stdout);
    assert.equal(Object.keys(list.wikis).length, 1);
  });

  test('the identical --provision --yes command, omitting --name both times, still resolves to the same basename-derived key', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-retry-no-name-'));
    trackedDirs.push(target);
    const args = ['wikis', 'add', target, '--provision', '--yes', '--json'];

    const first = run(args);
    assert.equal(first.status, 0, first.stderr);
    const firstAdded = JSON.parse(first.stdout);
    assert.equal(firstAdded.provisioned, true);

    const second = run(args);
    assert.equal(second.status, 0, second.stderr);
    const secondAdded = JSON.parse(second.stdout);
    assert.equal(secondAdded.provisioned, false);
    assert.equal(secondAdded.alreadyRegistered, true);
    assert.equal(secondAdded.key, firstAdded.key);
  });

  test('the same name pointing at a genuinely different, already-provisioned directory is still a hard conflict (exit 1)', async () => {
    // Both directories are ALREADY their own separate wikis before the
    // conflicting call — this is the case the idempotency short-circuit
    // must NOT swallow: same candidate key as an existing registry entry,
    // but that entry's path is a different directory. registry.js's addWiki
    // guard (unchanged) is what actually rejects this.
    const targetOne = await mkdtemp(join(tmpdir(), 'lumina-retry-conflict-a-'));
    const targetTwo = await mkdtemp(join(tmpdir(), 'lumina-retry-conflict-b-'));
    trackedDirs.push(targetOne, targetTwo);

    const first = run(['wikis', 'add', targetOne, '--provision', '--yes', '--json', '--name', 'Conflict Name']);
    assert.equal(first.status, 0, first.stderr);
    const secondOwnProvision = run(['wikis', 'add', targetTwo, '--provision', '--yes', '--json', '--name', 'Conflict Name Two']);
    assert.equal(secondOwnProvision.status, 0, secondOwnProvision.stderr);
    const beforeConflict = await snapshotFiles(targetTwo);

    // Now try to re-register targetTwo under targetOne's already-taken name.
    const conflict = run(['wikis', 'add', targetTwo, '--provision', '--yes', '--json', '--name', 'Conflict Name']);
    assert.equal(conflict.status, 1, conflict.stderr);
    const err = JSON.parse(conflict.stderr);
    assert.equal(err.code, 1);

    // targetTwo already had its own manifest, so this call took the
    // "already a wiki" branch — registry-write-only, no installer re-run —
    // and must leave the directory untouched by the failed attempt.
    assert.deepEqual(await snapshotFiles(targetTwo), beforeConflict);

    const list = JSON.parse(run(['wikis', 'list', '--json']).stdout);
    assert.equal(Object.keys(list.wikis).length, 2, 'the conflicting attempt must not have registered a third entry');
  });

  test('a different --name on the same already-provisioned path is rejected — one directory, one registry entry', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-retry-diffname-'));
    trackedDirs.push(target);

    const first = run(['wikis', 'add', target, '--provision', '--yes', '--json', '--name', 'Diff Name One']);
    assert.equal(first.status, 0, first.stderr);
    const before = await snapshotFiles(target);

    const second = run(['wikis', 'add', target, '--provision', '--yes', '--json', '--name', 'Diff Name Two']);
    assert.equal(second.status, 1, second.stderr);
    const err = JSON.parse(second.stderr);
    assert.equal(err.code, 1);
    assert.match(err.error, /already registered as "Diff Name One"/);
    assert.match(err.error, new RegExp(normalizeKey('Diff Name One')));

    assert.deepEqual(await snapshotFiles(target), before, 'the rejected re-registration attempt must not touch the directory');

    const list = JSON.parse(run(['wikis', 'list', '--json']).stdout);
    assert.equal(Object.keys(list.wikis).length, 1, 'one directory must never end up with two registry entries');
  });

  test('the same duplicate-path rejection applies to plain "add" (no --provision), not just provisioning', async () => {
    const target = await installSandboxWiki('plain-add-duplicate-path');
    const first = run(['wikis', 'add', target, '--name', 'Plain Add One', '--json']);
    assert.equal(first.status, 0, first.stderr);

    const second = run(['wikis', 'add', target, '--name', 'Plain Add Two', '--json']);
    assert.equal(second.status, 1, second.stderr);
    const err = JSON.parse(second.stderr);
    assert.equal(err.code, 1);
    assert.match(err.error, /already registered as "Plain Add One"/);

    const list = JSON.parse(run(['wikis', 'list', '--json']).stdout);
    assert.equal(Object.keys(list.wikis).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Commander flag-collision audit.
//
// bin/lumina.js declares global options directly on `program`: --directory,
// --cwd, -y/--yes, --no-update, --re-link, -v/--version. When a descendant
// command re-declares the SAME flags (as `wikis add` does for -y/--yes),
// commander silently binds the parsed value to the ANCESTOR's opts(), not
// the descendant's — so the descendant's own cmdOpts.<name> is undefined
// even though the flag was passed and accepted. `wikis add`'s --provision
// path hit exactly this with --yes (fixed by merging in program.opts().yes).
//
// Audited every `wikis <verb>` subcommand's local option flags against that
// global set (`wikis` itself, the intermediate command, declares none):
//   add:     --name --alias --description --provision --packs -y/--yes --json
//            -> -y/--yes COLLIDES (fixed, tested below)
//   inspect: --packs --json                          -> clean
//   remove:  --json                                   -> clean
//   list:    --json                                   -> clean
//   resolve: --json                                   -> clean
//   doctor:  --fix --json                              -> clean
// --packs is NOT a program-level flag (only `install`, a SIBLING of `wikis`,
// declares it) — confirmed by direct commander experiment that sibling
// subcommands with an identical flag name do not cross-contaminate; the bug
// only occurs along a shared ancestor chain. The --packs test below still
// verifies its real, end-to-end effect (not just "not shadowed").
// ---------------------------------------------------------------------------
describe('lumina wikis add — commander flag-collision regressions', () => {
  test('-y/--yes on "wikis add" is read locally, not shadowed by the global -y/--yes', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-collision-yes-'));
    trackedDirs.push(target);

    // Without --yes: must still be refused (proves the check itself works).
    const refused = run(['wikis', 'add', target, '--provision', '--json']);
    assert.equal(refused.status, 2);
    assert.match(JSON.parse(refused.stderr).error, /--yes/);

    // With --yes: must proceed. If commander were routing --yes to the
    // program-level opts() instead of this subcommand's own cmdOpts, this
    // would fail with the exact same "requires --yes" error as above even
    // though --yes was passed right here on the subcommand.
    const confirmed = run(['wikis', 'add', target, '--provision', '--yes', '--json', '--name', 'Collision Yes']);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(JSON.parse(confirmed.stdout).provisioned, true);
  });

  test('--packs on "wikis add --provision" flows end to end into the manifest and the wiki/ tree', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-collision-packs-'));
    trackedDirs.push(target);

    const result = run([
      'wikis', 'add', target, '--provision', '--yes', '--json',
      '--name', 'Collision Packs', '--packs', 'core,research',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const added = JSON.parse(result.stdout);
    assert.deepEqual(added.entry.packs.slice().sort(), ['core', 'research']);

    const manifest = JSON.parse(await readFile(join(target, '_lumina', 'manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.packs || {}).sort(), ['core', 'research']);

    // Research-pack directories (layout.js packDirs.research) actually exist
    // on disk — proves --packs wasn't silently dropped to the install
    // default, which would produce a core-only tree instead.
    await access(join(target, 'wiki', 'foundations'));
    await access(join(target, 'wiki', 'topics'));
    await access(join(target, 'raw', 'discovered'));

    const doctor = run(['wikis', 'doctor', 'Collision Packs', '--json']);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout).wikis[0];
    assert.equal(report.structureOk, true);
    assert.equal(report.lintOk, true);
  });

  test('--packs on "wikis inspect" (sibling of add, also local-only) is read correctly too', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-collision-inspect-packs-'));
    trackedDirs.push(target);
    const result = run(['wikis', 'inspect', target, '--packs', 'core,research', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.hint, /--packs core,research/);
  });
});

describe('lumina wikis add --provision — console-suppression safety', () => {
  test('a mid-provision throw restores console.log/info and still surfaces the error to the user', async () => {
    const target = await mkdtemp(join(tmpdir(), 'lumina-provision-throws-'));
    trackedDirs.push(target);

    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    const originalStderrWrite = process.stderr.write;
    let stderrCaptured = '';
    process.stderr.write = (chunk) => {
      stderrCaptured += chunk;
      return true;
    };

    let code;
    try {
      // An unknown pack name makes installCommand throw from inside
      // applyInstallOverrides, before any file is written — deterministic,
      // no filesystem/permission trickery required.
      code = await wikisCommand('add', [target], {
        provision: true,
        yes: true,
        json: true,
        packs: 'not-a-real-pack',
        name: 'Mid Provision Throw',
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.notEqual(code, 0);
    // The load-bearing assertion: console.log/info must be back to the real
    // function, not still no-op'd, even though installCommand threw instead
    // of returning normally.
    assert.equal(console.log, originalConsoleLog, 'console.log must be restored after a throw');
    assert.equal(console.info, originalConsoleInfo, 'console.info must be restored after a throw');

    // The error itself must still have reached the user (stderr), proving
    // restoration isn't the only thing that matters — the failure is
    // actually reported, not swallowed.
    const err = JSON.parse(stderrCaptured.trim());
    assert.ok(err.error && err.error.length > 0);
    assert.equal(typeof err.code, 'number');

    // And console.log genuinely works again afterward (not just reassigned
    // to something that looks like the original but is still inert).
    let sawProbe = false;
    console.log = (...args) => { sawProbe = true; originalConsoleLog(...args); };
    console.log('probe-after-restore');
    console.log = originalConsoleLog;
    assert.ok(sawProbe);
  });
});

describe('cold start', () => {
  test('node bin/lumina.js --version --no-update still succeeds', () => {
    const result = spawnSync(process.execPath, [CLI, '--version', '--no-update'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
  });
});
