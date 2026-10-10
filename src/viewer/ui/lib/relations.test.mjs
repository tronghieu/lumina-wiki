import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relationsOf, headerFields } from './relations.mjs';

const dir = new URL('../../test-fixtures/contract/expected/', import.meta.url);
const wiki = JSON.parse(readFileSync(new URL('wiki.json', dir), 'utf8'));
const pages = JSON.parse(readFileSync(new URL('pages.json', dir), 'utf8'));
const triples = (groups) =>
  groups.flatMap((g) => g.items.map((i) => `${g.type}|${g.direction}|${i.id}`)).sort();
const find = (groups, type, direction) => groups.find((g) => g.type === type && g.direction === direction);

test('sources/lora groups, order, and items', () => {
  const got = relationsOf(wiki, 'sources/lora').map((g) => ({
    type: g.type, direction: g.direction, ids: g.items.map((i) => i.id),
  }));
  assert.deepEqual(got, [
    // people/ada-park -> sources/lora
    { type: 'authored', direction: 'in', ids: ['people/ada-park'] },
    // sources/lora -> sources/deep-work, and -> missing:sources/gone ("Deep Work" sorts before "sources/gone")
    { type: 'cites', direction: 'out', ids: ['sources/deep-work', 'missing:sources/gone'] },
    // sources/deep-work -> sources/lora, and sources/lora-2 -> sources/lora
    { type: 'cites', direction: 'in', ids: ['sources/deep-work', 'sources/lora-2'] },
    // sources/lora -> url:https://example.org/lora
    { type: 'see_also_url', direction: 'out', ids: ['url:https://example.org/lora'] },
    // undirected sources/lora -- sources/lora-2
    { type: 'similar_method_to', direction: 'both', ids: ['sources/lora-2'] },
    // sources/lora -> concepts/adapters
    { type: 'uses_concept', direction: 'out', ids: ['concepts/adapters'] },
  ]);
  const groups = relationsOf(wiki, 'sources/lora');
  assert.equal(find(groups, 'cites', 'out').items.find((i) => i.id === 'missing:sources/gone').kind, 'missing');
  assert.equal(find(groups, 'see_also_url', 'out').items[0].kind, 'url');
  assert.equal(find(groups, 'uses_concept', 'out').items[0].confidence, 'medium');
  assert.equal(find(groups, 'similar_method_to', 'both').items[0].confidence, 'high');
});

const mini = (titles) => ({
  nodes: [{ id: 'p', kind: 'page', title: 'P' }, ...titles.map(([id, title]) => ({ id, kind: 'page', title }))],
  edges: titles.map(([id]) => ({ from: 'p', to: id, type: 'related_to', directed: true, confidence: null })),
});
const orderOf = (titles) => relationsOf(mini(titles), 'p')[0].items.map((i) => i.id);

test('items order by title, case-insensitive, ties by id', () => {
  assert.deepEqual(
    orderOf([['x/3', 'b'], ['x/4', 'A'], ['x/2', 'Same'], ['x/1', 'Same']]),
    ['x/4', 'x/3', 'x/1', 'x/2'],
  );
  assert.deepEqual(orderOf([['z', 'zebra'], ['d', 'Đại số'], ['a', 'apple']]), ['a', 'd', 'z']);
});

test('self-loops are listed once', () => {
  const groups = relationsOf(wiki, 'concepts/rank');
  const part = find(groups, 'part_of', 'out');
  assert.equal(part.items.length, 1);
  assert.equal(part.items[0].id, 'concepts/rank');
  assert.equal(find(groups, 'part_of', 'in'), undefined);
  assert.equal(find(groups, 'related_to', 'both').items.length, 1);
});

test('no edges or unknown id gives []', () => {
  assert.deepEqual(relationsOf(wiki, 'index'), []);
  assert.deepEqual(relationsOf(wiki, 'nope/nothing'), []);
});

test('mutual citations show under out and in', () => {
  const groups = relationsOf(wiki, 'sources/lora');
  assert.ok(find(groups, 'cites', 'out').items.some((i) => i.id === 'sources/deep-work'));
  assert.ok(find(groups, 'cites', 'in').items.some((i) => i.id === 'sources/deep-work'));
});

test('headerFields on a fixture page', () => {
  const page = pages['sources/lora-2'];
  const got = headerFields(page, wiki.schema.entityTypes);
  assert.deepEqual(got.map((f) => f.key), ['created', 'updated', 'authors', 'year', 'importance', 'provenance']);
  assert.equal(got.find((f) => f.key === 'authors').text, 'Ada Park, Ben Ito');
  assert.equal(got.find((f) => f.key === 'year').text, '2025');
});

test('headerFields skips blank values', () => {
  const types = [{ name: 't', required: ['created', 'updated', 'note', 'empty', 'ok'] }];
  const frontmatter = { created: null, updated: '', note: '   ', empty: [], ok: 'v' };
  assert.deepEqual(headerFields({ type: 't', frontmatter }, types), [{ key: 'ok', text: 'v' }]);
});

test('headerFields truncation', () => {
  const types = [{ name: 't', required: ['big'] }];
  const text = (big) => headerFields({ type: 't', frontmatter: { big } }, types)[0].text;
  const plain = text('a'.repeat(500));
  assert.equal(plain.length, 203);
  assert.ok(plain.endsWith('...'));
  const cut = text(`${'a'.repeat(199)}\u{1F600}more text`);
  assert.ok(cut.endsWith('...'));
  assert.ok(cut.slice(0, -3).endsWith('a'));
  assert.equal(cut.length, 202);
  if (cut.isWellFormed) assert.ok(cut.isWellFormed());
});

test('headerFields edge cases', () => {
  const types = [{ name: 'sources', required: ['title', 'tags', 'meta', 'big', 'gone', 'empty', 'created'] }];
  const frontmatter = {
    created: '2026-01-01', tags: ['a', 2, true], meta: { k: 1 }, big: 'x'.repeat(500), empty: [], title: 'T',
  };
  const got = headerFields({ type: 'sources', frontmatter }, types);
  assert.deepEqual(got.map((f) => f.key), ['created', 'tags', 'meta', 'big']);
  assert.equal(got[1].text, 'a, 2, true');
  assert.equal(got[2].text, '{"k":1}');
  assert.equal(got[3].text.length, 203);
  assert.ok(got[3].text.endsWith('...'));
  assert.equal(headerFields({ type: 'sources', frontmatter: { updated: 7 } }, types)[0].text, '7');
  for (const type of [null, 'unknown']) {
    assert.deepEqual(headerFields({ type, frontmatter: { created: 'c', year: 1 } }, types), [{ key: 'created', text: 'c' }]);
  }
});

test('headerFields ignores inherited and unrequired constructor', () => {
  const req = [{ name: 't', required: ['constructor'] }];
  assert.deepEqual(headerFields({ type: 't', frontmatter: {} }, req), []);
  assert.deepEqual(headerFields({ type: 't', frontmatter: { constructor: 'x' } }, req), [{ key: 'constructor', text: 'x' }]);
  assert.deepEqual(headerFields({ type: 't', frontmatter: { constructor: 'x' } }, [{ name: 't', required: [] }]), []);
});
