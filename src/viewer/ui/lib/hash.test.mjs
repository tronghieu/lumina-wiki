import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idToHash, hashToId, openPageId } from './hash.mjs';

const wiki = JSON.parse(
  readFileSync(new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'),
);

const ids = [
  'index', 'sources/lora', 'readings/deep-work/01-focus', 'sources/a b',
  'sources/100%', 'sources/x#y', 'sources/q?a=1', 'sources/tiếng-việt',
  ...wiki.nodes.filter((n) => n.kind === 'page').map((n) => n.id),
];

test('round trip', () => {
  for (const id of ids) assert.equal(hashToId(idToHash(id)), id, id);
});

test('null cases', () => {
  for (const h of [undefined, null, 5, '', '#', 'x', '#x', '#/', '#/%E0%A4%A']) {
    assert.equal(hashToId(h), null, String(h));
  }
});

test('idToHash output is safe', () => {
  for (const id of ids) {
    const h = idToHash(id);
    assert.ok(!h.includes(' ') && !h.includes('?') && !h.slice(1).includes('#'), h);
  }
});

test('openPageId opens only real pages', () => {
  const pageIds = new Set(wiki.nodes.filter((n) => n.kind === 'page').map((n) => n.id));
  assert.equal(openPageId('#/sources/lora', pageIds), 'sources/lora');
  for (const h of ['#/nope', '#/missing:sources/gone', '#/url:https://example.org/lora', '', '#']) {
    assert.equal(openPageId(h, pageIds), null, h);
  }
});
