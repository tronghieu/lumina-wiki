import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, ancestorsOf, flattenPages } from './tree.mjs';

const wiki = JSON.parse(readFileSync(new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'));
const types = wiki.schema.entityTypes;
const pages = wiki.nodes.filter((n) => n.kind === 'page');
const P = (id, title = id) => ({ kind: 'page', id, title });

test('fixture: every page once, no url/missing ids', () => {
  const ids = flattenPages(buildTree(wiki.nodes, types));
  assert.deepEqual([...ids].sort(), pages.map((n) => n.id).sort());
  assert.ok(!ids.some((i) => i.startsWith('url:') || i.startsWith('missing:')));
});

test('fixture: top level order and nesting', () => {
  const tree = buildTree(wiki.nodes, types);
  assert.deepEqual(tree.slice(0, 2).map((r) => [r.kind, r.id]), [['page', 'index'], ['page', 'log']]);
  const names = tree.filter((r) => r.kind === 'folder').map((r) => r.name);
  const order = types.map((t) => t.name).filter((n) => names.includes(n));
  assert.deepEqual(names, order);
  const readings = tree.find((r) => r.path === 'readings');
  const dw = readings.children.find((r) => r.path === 'readings/deep-work');
  assert.equal(dw.name, 'deep-work');
  assert.deepEqual(dw.children.map((r) => r.id), ['readings/deep-work/00-preface', 'readings/deep-work/01-focus']);
});

test('fixture: node titles are shown', () => {
  const all = (rows) => rows.flatMap((r) => (r.kind === 'page' ? [r] : all(r.children)));
  const find = (rows, id) => all(rows).find((r) => r.id === id);
  const tree = buildTree(wiki.nodes, types);
  assert.equal(find(tree, 'summary/2024').title, '2024');
  assert.equal(find(tree, 'readings/deep-work/00-preface').title, '0');
});

test('non-entity folder sorts after typed folders', () => {
  const tree = buildTree([P('zzz/a'), P('aaa/b'), P('concepts/c')], [{ name: 'concepts' }]);
  assert.deepEqual(tree.map((r) => r.name), ['concepts', 'aaa', 'zzz']);
});

test('pages sort by title case-insensitively, id breaks ties', () => {
  const tree = buildTree([P('f/3', 'beta'), P('f/2', 'Alpha'), P('f/1', 'alpha'), P('f/4', 'Gamma')], []);
  assert.deepEqual(flattenPages(tree), ['f/1', 'f/2', 'f/3', 'f/4']);
});

test('sibling sub-folders sort by name regardless of input order', () => {
  const ids = ['readings/deep-work/a', 'readings/deep-work-2/a', 'readings/alpha/a'];
  for (const input of [ids, [...ids].reverse()]) {
    const tree = buildTree(input.map((i) => P(i)), []);
    assert.deepEqual(tree[0].children.map((r) => r.name), ['alpha', 'deep-work', 'deep-work-2']);
  }
});

test('root pages order by id, not title', () => {
  const tree = buildTree([{ kind: 'page', id: 'b', title: 'Alpha' }, { kind: 'page', id: 'a', title: 'Zulu' }], []);
  assert.deepEqual(flattenPages(tree), ['a', 'b']);
});

test('titles with diacritics sort with the base letter', () => {
  const titles = ['apple', 'Zebra', 'Éclair', 'Đại số', 'Ứng dụng', 'banana'];
  const tree = buildTree(titles.map((t, i) => P(`f/${i}`, t)), []);
  assert.deepEqual(tree[0].children.map((r) => r.title), ['apple', 'banana', 'Đại số', 'Éclair', 'Ứng dụng', 'Zebra']);
});

test('numeric titles sort by value', () => {
  const tree = buildTree([P('f/a', '10'), P('f/b', '9'), P('f/c', '2')], []);
  assert.deepEqual(tree[0].children.map((r) => r.title), ['2', '9', '10']);
});

test('same title orders by id', () => {
  const tree = buildTree([P('f/2', 'same'), P('f/1', 'same')], []);
  assert.deepEqual(flattenPages(tree), ['f/1', 'f/2']);
});

test('sub-folders come before pages', () => {
  const tree = buildTree([P('f/a'), P('f/z/b')], []);
  assert.deepEqual(tree[0].children.map((r) => r.kind), ['folder', 'page']);
});

test('page id equal to a folder path keeps both rows', () => {
  const tree = buildTree([P('readings/deep-work'), P('readings/deep-work/01')], []);
  const kids = tree[0].children;
  assert.deepEqual(kids.map((r) => r.kind), ['folder', 'page']);
  assert.equal(kids[0].path, 'readings/deep-work');
  assert.equal(kids[1].id, 'readings/deep-work');
});

test('empty input and input order independence', () => {
  assert.deepEqual(buildTree([], types), []);
  const shuffled = wiki.nodes.map((_, i) => wiki.nodes[(i * 7 + 3) % wiki.nodes.length]);
  assert.equal(new Set(shuffled).size, wiki.nodes.length);
  assert.deepEqual(buildTree(shuffled, types), buildTree(wiki.nodes, types));
});

test('ancestorsOf', () => {
  assert.deepEqual(ancestorsOf('index'), []);
  assert.deepEqual(ancestorsOf('sources/lora'), ['sources']);
  assert.deepEqual(ancestorsOf('readings/deep-work/01-focus'), ['readings', 'readings/deep-work']);
});
