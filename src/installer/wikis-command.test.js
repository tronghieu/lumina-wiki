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
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fileHash } from './fs.js';
import { normalizeKey } from './registry.js';

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

  test('add rejects a directory that is not a Lumina wiki (exit 2)', async () => {
    const notWiki = await mkdtemp(join(tmpdir(), 'lumina-not-a-wiki-'));
    trackedDirs.push(notWiki);

    const result = run(['wikis', 'add', notWiki, '--json']);
    assert.equal(result.status, 2);
    const err = JSON.parse(result.stderr);
    assert.equal(err.code, 2);
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

describe('cold start', () => {
  test('node bin/lumina.js --version --no-update still succeeds', () => {
    const result = spawnSync(process.execPath, [CLI, '--version', '--no-update'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
  });
});
