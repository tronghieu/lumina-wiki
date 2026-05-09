/**
 * Pin deprecation warnings: deprecated flags must continue to function
 * AND must emit a warning to stderr.
 *
 * Source of truth: docs/cli-contract.md.
 *
 * If you remove a deprecated flag entirely, that requires a major
 * version bump and an entry in CHANGELOG.md — and a corresponding
 * removal of the test below.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const CLI = join(__dirname, 'lumina.js');

function runCli(args, { timeout = 10_000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
  });
}

test('--cwd emits a deprecation warning to stderr', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-'));
  try {
    const r = runCli(['uninstall', '--cwd', tmp, '--yes']);
    assert.match(
      r.stderr,
      /\[deprecated\][^\n]*--cwd[^\n]*v2\.0/,
      `expected deprecation warning on stderr; got: ${r.stderr.slice(0, 300)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--directory does NOT emit a deprecation warning', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-'));
  try {
    const r = runCli(['uninstall', '--directory', tmp, '--yes']);
    assert.doesNotMatch(
      r.stderr,
      /\[deprecated\]/,
      `--directory must not warn; got: ${r.stderr.slice(0, 300)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--cwd is still functional (warn-but-work, not warn-and-break)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-'));
  try {
    const r = runCli(['uninstall', '--cwd', tmp, '--yes']);
    // Exit 0 = uninstall succeeded; non-zero would mean the deprecation
    // accidentally broke the alias.
    assert.equal(r.status, 0, `uninstall via --cwd must still succeed; got status ${r.status}, stderr: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--cwd emits a deprecation warning on install subcommand', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-'));
  try {
    // Install scaffolds many files; bump timeout. The preAction hook fires
    // before the action body, so the warning is on stderr regardless of
    // how long install takes.
    const r = runCli(['install', '--cwd', tmp, '--yes'], { timeout: 60_000 });
    assert.match(
      r.stderr,
      /\[deprecated\][^\n]*--cwd[^\n]*v2\.0/,
      `expected deprecation warning on install stderr; got: ${r.stderr.slice(0, 300)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('global --cwd (before subcommand) also emits the warning', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-'));
  try {
    // Pins the global-options branch: `lumina --cwd <path> uninstall`.
    // Without this, a future refactor that only checks per-command opts
    // would silently drop the warning for global-flag users.
    const r = runCli(['--cwd', tmp, 'uninstall', '--yes']);
    assert.match(
      r.stderr,
      /\[deprecated\][^\n]*--cwd[^\n]*v2\.0/,
      `expected deprecation warning when --cwd is global; got: ${r.stderr.slice(0, 300)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path propagation regression — pins that --cwd / --directory actually direct
// writes to the target path, not silently to process.cwd().
//
// History: a `process.cwd()` default on the program-level --directory option
// caused commander to populate `globalOpts.directory` for every invocation,
// short-circuiting the merge expression
//   cmdOpts.directory ?? cmdOpts.cwd ?? globalOpts.directory ?? globalOpts.cwd ?? process.cwd()
// before it could see the user's --cwd value. The result: `install --cwd <X>`
// silently scaffolded into the test runner's cwd (the repo root) instead of
// <X>. The fix is in bin/lumina.js — drop the program-level default and rely
// on the trailing `?? process.cwd()` as the single source of truth.
// ---------------------------------------------------------------------------

test('install --cwd <tmp> writes into <tmp>, not cwd', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-cwd-install-'));
  try {
    const r = runCli(
      ['install', '--cwd', tmp, '--yes', '--packs', 'core'],
      { timeout: 60_000 },
    );
    assert.equal(r.status, 0, `install must succeed; stderr: ${r.stderr.slice(0, 400)}`);

    // Strong signal the install landed in <tmp>: manifest is written last,
    // and atomic-rename means it only exists if the install completed.
    assert.ok(
      existsSync(join(tmp, '_lumina', 'manifest.json')),
      `expected manifest at <tmp>/_lumina/manifest.json; cwd-leak likely`,
    );
    assert.ok(
      existsSync(join(tmp, 'README.md')),
      `expected <tmp>/README.md to be rendered`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('install --directory <tmp> writes into <tmp> (canonical flag)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-dir-install-'));
  try {
    const r = runCli(
      ['install', '--directory', tmp, '--yes', '--packs', 'core'],
      { timeout: 60_000 },
    );
    assert.equal(r.status, 0, `install must succeed; stderr: ${r.stderr.slice(0, 400)}`);
    assert.ok(
      existsSync(join(tmp, '_lumina', 'manifest.json')),
      `expected manifest at <tmp>/_lumina/manifest.json`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('global --cwd before subcommand also propagates path', () => {
  // Mirrors the `lumina --cwd <path> install` form. Same regression class:
  // if globalOpts.directory has a default value, this can be masked.
  const tmp = mkdtempSync(join(tmpdir(), 'lumi-dep-global-cwd-install-'));
  try {
    const r = runCli(
      ['--cwd', tmp, 'install', '--yes', '--packs', 'core'],
      { timeout: 60_000 },
    );
    assert.equal(r.status, 0, `install must succeed; stderr: ${r.stderr.slice(0, 400)}`);
    assert.ok(
      existsSync(join(tmp, '_lumina', 'manifest.json')),
      `global --cwd must propagate; expected <tmp>/_lumina/manifest.json`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
