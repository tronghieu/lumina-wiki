import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./merge-ids.mjs', import.meta.url));

function run(args, stdin) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', input: stdin });
}

test('non-destructive merge: existing keys win', () => {
  const r = run(['https://arxiv.org/abs/1706.03762'], '{"doi":"10.x/manual"}');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.doi, '10.x/manual'); // existing preserved, NOT overwritten
  assert.equal(out.arxiv, '1706.03762');
});

test('empty stdin → fresh merge from URL', () => {
  const r = run(['https://arxiv.org/abs/1706.03762'], '');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.arxiv, '1706.03762');
  assert.equal(out.doi, '10.48550/arxiv.1706.03762');
});

test('invalid URL → exit 2', () => {
  const r = run(['not-a-url'], '{}');
  assert.equal(r.status, 2);
});

test('invalid stdin JSON → exit 2', () => {
  const r = run(['https://example.com/x'], 'not-json');
  assert.equal(r.status, 2);
});

test('stdin array → exit 2', () => {
  const r = run(['https://example.com/x'], '[]');
  assert.equal(r.status, 2);
});

test('__proto__ in stdin is stripped', () => {
  const r = run(['https://example.com/x'], '{"__proto__":{"polluted":1},"doi":"10.x/y"}');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.doi, '10.x/y');
  assert.equal(out.polluted, undefined);
});

test('idempotency: second run with merged input → identical output', () => {
  const r1 = run(['https://arxiv.org/abs/1706.03762'], '{}');
  assert.equal(r1.status, 0);
  const r2 = run(['https://arxiv.org/abs/1706.03762'], r1.stdout);
  assert.equal(r2.status, 0);
  // Both runs should produce equivalent maps (JSON key order may differ).
  assert.deepEqual(JSON.parse(r1.stdout), JSON.parse(r2.stdout));
});
