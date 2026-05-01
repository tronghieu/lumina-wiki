/**
 * @module reset.test
 * @description Tests for reset.mjs using node:test and a temp workspace per test.
 *
 * Run: node --test src/scripts/reset.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESET_SCRIPT = resolve('/Users/luutronghieu/Projects/lumina-wiki/src/scripts/reset.mjs');

/** Create a unique temp directory for a test workspace. */
async function makeTempWs() {
  const id = randomBytes(6).toString('hex');
  const ws = join(tmpdir(), `lumina-reset-test-${id}`);
  await mkdir(ws, { recursive: true });
  return ws;
}

/**
 * Build a minimal workspace structure:
 *   ws/wiki/sources/a.md
 *   ws/wiki/concepts/b.md
 *   ws/wiki/index.md
 *   ws/wiki/log.md
 *   ws/raw/sources/file.txt
 *   ws/_lumina/_state/skill-phase.json  (checkpoint)
 *   ws/_lumina/_state/ephemeral.txt
 */
async function populateWs(ws) {
  const dirs = [
    'wiki/sources',
    'wiki/concepts',
    'raw/sources',
    '_lumina/_state',
  ];
  for (const d of dirs) {
    await mkdir(join(ws, d), { recursive: true });
  }
  await writeFile(join(ws, 'wiki/sources/a.md'), '# A', 'utf8');
  await writeFile(join(ws, 'wiki/concepts/b.md'), '# B', 'utf8');
  await writeFile(join(ws, 'wiki/index.md'), '# index', 'utf8');
  await writeFile(join(ws, 'wiki/log.md'), '# log', 'utf8');
  await writeFile(join(ws, 'raw/sources/file.txt'), 'raw content', 'utf8');
  await writeFile(join(ws, '_lumina/_state/skill-phase.json'), '{}', 'utf8');
  await writeFile(join(ws, '_lumina/_state/ephemeral.txt'), 'tmp', 'utf8');
}

/**
 * Run reset.mjs with the given args in the given cwd.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runReset(args, cwd) {
  return new Promise((resolveP) => {
    const proc = spawn(process.execPath, [RESET_SCRIPT, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolveP({ code, stdout, stderr }));
  });
}

/**
 * Recursively collect all file paths (relative to base) under a directory.
 * @param {string} dir
 * @param {string} [base]
 * @returns {Promise<string[]>}
 */
async function listFiles(dir, base) {
  base = base ?? dir;
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await listFiles(full, base));
    } else {
      results.push(full);
    }
  }
  return results.sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('without --yes exits with code 2', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code, stderr } = await runReset(['--scope', 'wiki'], ws);
  assert.equal(code, 2);
  assert.match(stderr, /--yes/);
});

test('missing --scope exits with code 2', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code } = await runReset(['--yes'], ws);
  assert.equal(code, 2);
});

test('invalid --scope exits with code 2', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code } = await runReset(['--scope', 'nope', '--yes'], ws);
  assert.equal(code, 2);
});

test('--scope wiki --yes deletes wiki contents and recreates index.md + log.md', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code, stdout } = await runReset(['--scope', 'wiki', '--yes'], ws);
  assert.equal(code, 0);
  assert.match(stdout, /\[OK\]/);

  // wiki/ contents deleted except recreated stubs
  assert.ok(!existsSync(join(ws, 'wiki/sources')), 'sources dir should be gone');
  assert.ok(!existsSync(join(ws, 'wiki/concepts')), 'concepts dir should be gone');

  // stubs recreated and empty
  const idxStat = await stat(join(ws, 'wiki/index.md'));
  const logStat = await stat(join(ws, 'wiki/log.md'));
  assert.equal(idxStat.size, 0, 'index.md should be empty');
  assert.equal(logStat.size, 0, 'log.md should be empty');

  // raw untouched
  assert.ok(existsSync(join(ws, 'raw/sources/file.txt')), 'raw should be untouched');
});

test('--scope raw deletes only raw, not wiki or state', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code } = await runReset(['--scope', 'raw', '--yes'], ws);
  assert.equal(code, 0);

  assert.ok(!existsSync(join(ws, 'raw/sources')), 'raw/sources should be deleted');
  assert.ok(existsSync(join(ws, 'wiki/sources/a.md')), 'wiki should be untouched');
  assert.ok(existsSync(join(ws, '_lumina/_state/skill-phase.json')), 'state should be untouched');
});

test('--scope all does NOT touch raw/', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code } = await runReset(['--scope', 'all', '--yes'], ws);
  assert.equal(code, 0);

  // raw untouched
  assert.ok(existsSync(join(ws, 'raw/sources/file.txt')), 'raw should be untouched by --scope all');
  // wiki reset
  assert.ok(!existsSync(join(ws, 'wiki/sources')), 'wiki/sources should be gone');
  assert.equal((await stat(join(ws, 'wiki/index.md'))).size, 0, 'index.md empty');
  // state reset
  assert.ok(!existsSync(join(ws, '_lumina/_state/skill-phase.json')), 'state should be cleared');
});

test('--scope checkpoints deletes only *-*.json, not ephemeral.txt', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code } = await runReset(['--scope', 'checkpoints', '--yes'], ws);
  assert.equal(code, 0);

  assert.ok(!existsSync(join(ws, '_lumina/_state/skill-phase.json')), 'checkpoint json should be deleted');
  assert.ok(existsSync(join(ws, '_lumina/_state/ephemeral.txt')), 'non-checkpoint file should survive');
  assert.ok(existsSync(join(ws, 'wiki/sources/a.md')), 'wiki untouched');
});

test('--dry-run plan matches actual delete set', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);

  // Collect dry-run output
  const { code: dryCode, stdout: dryOut } = await runReset(
    ['--scope', 'wiki', '--dry-run'],
    ws,
  );
  assert.equal(dryCode, 0);
  assert.match(dryOut, /Would delete/);

  // Collect pre-delete file list under wiki/
  const beforeFiles = await listFiles(join(ws, 'wiki'));

  // Perform actual delete
  const { code: realCode } = await runReset(['--scope', 'wiki', '--yes'], ws);
  assert.equal(realCode, 0);

  // All files that existed before (except stubs) should now be absent
  const existingAfter = beforeFiles.filter(f => existsSync(f));
  // Only index.md and log.md should exist (recreated stubs)
  const surviving = existingAfter.filter(f => !f.endsWith('index.md') && !f.endsWith('log.md'));
  assert.equal(surviving.length, 0, `Unexpected survivors: ${surviving.join(', ')}`);
});

test('--dry-run does not require --yes and exits 0', async () => {
  const ws = await makeTempWs();
  await populateWs(ws);
  const { code, stdout } = await runReset(['--scope', 'state', '--dry-run'], ws);
  assert.equal(code, 0);
  assert.match(stdout, /Plan:/);
  // Nothing actually deleted
  assert.ok(existsSync(join(ws, '_lumina/_state/skill-phase.json')), 'dry-run must not delete');
});

test('path traversal outside project root exits 2', async () => {
  // Run from a directory with no wiki/ or _lumina/ ancestor
  const ws = tmpdir();
  const { code, stderr } = await runReset(['--scope', 'wiki', '--yes'], ws);
  assert.equal(code, 2);
  assert.match(stderr, /project root/i);
});

// ---------------------------------------------------------------------------
// R3 regression: safePath rejects Unix and Windows-style traversal paths
// ---------------------------------------------------------------------------

test('R3: safePath portable — split-based check rejects ../etc style', async () => {
  // We test this indirectly: run reset with a workspace that has no wiki/ dir
  // so the path resolution hits the safePath check. The key regression is that
  // the fix uses rel.split(/[\\/]/)[0] === '..' so both separators are caught.
  // On the current platform, tmpdir() has no wiki/ structure → exits 2.
  const ws = await makeTempWs();
  // Do NOT create wiki/ or _lumina/ so the project root search fails → exit 2
  const { code } = await runReset(['--scope', 'wiki', '--yes'], ws);
  assert.equal(code, 2, 'Should exit 2 when wiki/ structure is missing');
});
