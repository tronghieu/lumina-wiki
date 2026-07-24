/**
 * Tests for src/installer/layout.js — the canonical layout data + checkLayout().
 *
 * Pattern follows commands.test.js: spawnSync the real CLI into a temp
 * sandbox OUTSIDE the repo, then assert checkLayout() against the actual
 * install output. This is the AD-5 anti-drift gate: if layout.js lists a
 * directory or file that install does not actually create, the first test
 * below fails.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, rm as rmPath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { checkLayout, baseDirs, packDirs, seedFiles, engineCriticalPaths } from './layout.js';

const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'lumina-layout-test-'));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

function installSandbox(workspace, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [CLI, 'install', '--yes', '--no-update', '--directory', workspace, ...extraArgs],
    { encoding: 'utf8', timeout: 30000 },
  );
}

describe('checkLayout — anti-drift gate against the real installer', () => {
  test('fresh core-only install has zero missing entries', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'core-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace);
      assert.equal(result.status, 0, result.stderr);

      const report = await checkLayout(workspace, ['core']);
      assert.deepEqual(report.missingDirs, []);
      assert.deepEqual(report.missingSeedFiles, []);
      assert.deepEqual(report.missingEngine, []);
      assert.equal(report.ok, true);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('fresh full-pack install (research,reading) has zero missing entries', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'full-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace, ['--packs', 'core,research,reading']);
      assert.equal(result.status, 0, result.stderr);

      const report = await checkLayout(workspace, ['core', 'research', 'reading']);
      assert.deepEqual(report.missingDirs, []);
      assert.deepEqual(report.missingSeedFiles, []);
      assert.deepEqual(report.missingEngine, []);
      assert.equal(report.ok, true);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('learning pack dirs are only expected/checked when learning is installed', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'learning-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace, ['--packs', 'core,learning']);
      assert.equal(result.status, 0, result.stderr);

      const report = await checkLayout(workspace, ['core', 'learning']);
      assert.equal(report.ok, true);
      assert.deepEqual(report.missingDirs, []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('detects a missing required directory and a missing seed file, nothing else', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'broken-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace);
      assert.equal(result.status, 0, result.stderr);

      // Remove one required dir and one seed file to prove detection works.
      await rmPath(join(workspace, 'wiki', 'concepts'), { recursive: true, force: true });
      await rmPath(join(workspace, 'wiki', 'log.md'), { force: true });

      const report = await checkLayout(workspace, ['core']);
      assert.equal(report.ok, false);
      assert.deepEqual(report.missingDirs, ['wiki/concepts']);
      assert.deepEqual(report.missingSeedFiles, ['wiki/log.md']);
      assert.deepEqual(report.missingEngine, []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('reports missing engine-critical paths distinctly from missingDirs', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'engine-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace);
      assert.equal(result.status, 0, result.stderr);

      await rmPath(join(workspace, '_lumina', 'scripts'), { recursive: true, force: true });

      const report = await checkLayout(workspace, ['core']);
      assert.equal(report.ok, false);
      assert.deepEqual(report.missingEngine, ['_lumina/scripts']);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('defaults packs argument to [\'core\']', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'default-arg-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = installSandbox(workspace);
      assert.equal(result.status, 0, result.stderr);

      const report = await checkLayout(workspace);
      assert.equal(report.ok, true);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('layout data shape', () => {
  test('exports are pure data with the expected keys', () => {
    assert.ok(Array.isArray(baseDirs));
    assert.ok(baseDirs.length > 0);
    assert.ok(typeof packDirs === 'object');
    assert.ok(Array.isArray(packDirs.research));
    assert.ok(Array.isArray(packDirs.reading));
    assert.ok(Array.isArray(packDirs.learning));
    assert.equal(packDirs.core, undefined, 'core dirs live in baseDirs, not packDirs');
    assert.ok(Array.isArray(seedFiles));
    for (const f of seedFiles) {
      assert.ok(typeof f.relPath === 'string');
      assert.ok(typeof f.kind === 'string');
    }
    assert.ok(Array.isArray(engineCriticalPaths));
  });
});
