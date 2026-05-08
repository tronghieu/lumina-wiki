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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const CLI = join(__dirname, 'lumina.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
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
