/**
 * Pin the public CLI contract: flag names and exit code matrix.
 *
 * Goal: any rename or removal of a STABLE flag, or any drift in the
 * exit code mapping, must fail this test before reaching users.
 *
 * Source of truth: docs/planning-artifacts/audits/cli-contract-audit.md
 * (and the `--help` text in bin/lumina.js).
 *
 * INTERNAL/hidden flags (--cwd, --project-name) are intentionally NOT
 * pinned here — those have no public contract and may change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const CLI = join(__dirname, 'lumina.js');

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// STABLE flag enumeration — keep in sync with audit doc.
// Each entry: flag name as a user would type it on the command line.
// ---------------------------------------------------------------------------
const STABLE_GLOBAL = [
  '--directory',
  '-y, --yes',
  '--no-update',
  '--re-link',
];

const STABLE_INSTALL = [
  '--packs',
  '--ide-targets',
  '--communication-language',
  '--document-output-language',
];

const STABLE_DISCOVER_RUN = [
  '--config',
  '--schedule',
  '--source',
  '--limit',
  '--dry-run',
  '--json',
];

// ---------------------------------------------------------------------------
// Help text contains all stable flag names
// ---------------------------------------------------------------------------

test('top-level --help advertises every STABLE global flag', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0, `--help should exit 0; got ${r.status}`);
  for (const flag of STABLE_GLOBAL) {
    assert.ok(r.stdout.includes(flag), `--help missing global flag: ${flag}`);
  }
});

test('install --help advertises every STABLE install flag', () => {
  const r = runCli(['install', '--help']);
  assert.equal(r.status, 0);
  for (const flag of STABLE_INSTALL) {
    assert.ok(r.stdout.includes(flag), `install --help missing flag: ${flag}`);
  }
});

test('discover run --help advertises every STABLE discover flag', () => {
  const r = runCli(['discover', 'run', '--help']);
  assert.equal(r.status, 0);
  for (const flag of STABLE_DISCOVER_RUN) {
    assert.ok(r.stdout.includes(flag), `discover run --help missing flag: ${flag}`);
  }
});

// ---------------------------------------------------------------------------
// Help text describes the documented exit code contract
// ---------------------------------------------------------------------------

test('--help exit code section documents codes 0/1/2/3', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Exit codes:/);
  assert.match(r.stdout, /^\s*0\s+success/m);
  assert.match(r.stdout, /^\s*1\s+user error/m);
  assert.match(r.stdout, /^\s*2\s+filesystem.*safety/m);
  assert.match(r.stdout, /^\s*3\s+internal.*network/m);
});

// ---------------------------------------------------------------------------
// Exit code matrix
// ---------------------------------------------------------------------------

test('exit 0 — --version', () => {
  const r = runCli(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+/);
});

test('exit 0 — --help', () => {
  assert.equal(runCli(['--help']).status, 0);
});

test('exit 1 — unknown flag', () => {
  const r = runCli(['install', '--this-flag-does-not-exist']);
  assert.equal(r.status, 1, `unknown flag should exit 1; got ${r.status}`);
});

test('exit 1 — unknown subcommand', () => {
  const r = runCli(['this-command-does-not-exist']);
  assert.equal(r.status, 1);
});

test('exit 2/3 — install fails on a non-writable target with fs/io error', () => {
  // Pin: filesystem-class errors exit 2 or 3, never 1 (user error).
  // Use a path under a regular file so mkdir resolves to ENOTDIR/EEXIST.
  const tmp = mkdtempSync(join(tmpdir(), 'lumina-test-'));
  try {
    // Create a file at the parent path so any subdir creation under it fails.
    const blocker = join(tmp, 'blocker');
    writeFileSync(blocker, '');
    const target = join(blocker, 'inside-a-file');
    const r = runCli(['install', '--yes', '--directory', target], { cwd: tmp });
    assert.notEqual(r.status, 0, 'install into invalid path must not succeed');
    assert.notEqual(r.status, 1, 'fs error must not collapse to "user error"');
    assert.ok([2, 3].includes(r.status), `expected 2 or 3; got ${r.status}\nstderr: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Backward-compat alias still functional (will be deprecated in v2 per
// owner decision, but for v1.x must continue to work as alias for --directory).
// ---------------------------------------------------------------------------

test('--cwd remains accepted as backward-compat alias for --directory', () => {
  // Driving install through to completion would require a sandbox; the cheap
  // test here is that commander does not reject the flag with exit 1.
  const tmp = mkdtempSync(join(tmpdir(), 'lumina-test-'));
  const target = join(tmp, 'sandbox');
  mkdirSync(target);
  try {
    const r = runCli(['uninstall', '--cwd', target, '--yes'], { cwd: tmp });
    // No installation in `target`, so command may fail — but NOT with
    // exit 1 ("unknown flag" shape from commander).
    assert.notEqual(r.status, null, 'process must terminate (timeout?)');
    assert.ok(
      !/unknown option/i.test(r.stderr),
      `--cwd should be accepted; got stderr: ${r.stderr.slice(0, 200)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Environment variable contract
// ---------------------------------------------------------------------------

test('LUMINA_NO_UPDATE_CHECK=1 suppresses update banner on --version', () => {
  const r = spawnSync(process.execPath, [CLI, '--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
  });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /Update available/i);
});
