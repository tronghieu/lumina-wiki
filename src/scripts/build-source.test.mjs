import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./build-source.mjs', import.meta.url));

function run(...args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('provider only → entry without url', () => {
  const r = run('arxiv');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.provider, 'arxiv');
  assert.match(out.fetched_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(!('url' in out));
});

test('provider + url → entry with url', () => {
  const r = run('s2', 'https://api.semanticscholar.org/graph/v1/paper/x');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.url, 'https://api.semanticscholar.org/graph/v1/paper/x');
});

test('missing provider → exit 2', () => {
  const r = run();
  assert.equal(r.status, 2);
});

test('invalid provider slug → exit 2', () => {
  const r = run('Bad Provider!');
  assert.equal(r.status, 2);
});

test('shell-meta payload in url is data, not executed', () => {
  const evil = "https://x.test/';require('child_process').exec('echo PWNED')//";
  const r = run('pdf', evil);
  assert.ok(r.status === 0 || r.status === 2);
  if (r.status === 0) {
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'expected single JSON line');
    const out = JSON.parse(lines[0]);
    assert.equal(out.provider, 'pdf');
    // url present as plain data — no extra command execution echo on stderr
    assert.equal(r.stderr, '');
  }
});
