import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./parse-ids.mjs', import.meta.url));

function run(...args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('arxiv abs URL → both arxiv and doi', () => {
  const r = run('https://arxiv.org/abs/1706.03762');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.arxiv, '1706.03762');
  assert.equal(out.doi, '10.48550/arxiv.1706.03762');
  assert.equal(out.url, 'https://arxiv.org/abs/1706.03762');
});

test('doi.org URL → doi only', () => {
  const r = run('https://doi.org/10.1109/ABC.2020.1');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.doi, '10.1109/abc.2020.1');
});

test('plain URL → just url', () => {
  const r = run('https://example.com/article');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.url, 'https://example.com/article');
  assert.equal(out.doi, undefined);
});

test('shell-meta payload in URL — argv handling does not execute it', () => {
  // The point of the wrapper is that argv values cannot escape into a shell
  // or eval. We verify the script returns cleanly (URL embedded as data, not
  // executed) and the process has no extra side-channel output.
  const evil = "https://evil.com/x';require('child_process').exec('echo PWNED')//";
  const r = run(evil);
  assert.ok(r.status === 0 || r.status === 2);
  // Output (if any) must be a single JSON line — no extra command execution echo.
  if (r.status === 0) {
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    JSON.parse(lines[0]);
  }
});

test('non-URL traversal string → exit 2', () => {
  const r = run('../../etc/passwd');
  assert.equal(r.status, 2);
});

test('missing arg → exit 2', () => {
  const r = run();
  assert.equal(r.status, 2);
});
