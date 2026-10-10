import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fold, foldWords, searchPages } from './search.mjs';

const fixture = JSON.parse(
  fs.readFileSync(new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'),
);
const nodes = fixture.nodes;
const find = (ns, q, limit) => searchPages(ns, q, limit).results;
const slugOf = (id) => id.slice(id.lastIndexOf('/') + 1);
const page = (id, title) => ({ id, title, kind: 'page', type: 'concepts' });

test('fold', () => {
  assert.equal(fold('  Đại   Số '), 'dai so');
  assert.equal(fold('Éclair'), 'eclair');
  assert.equal(fold('école'), 'ecole');
  assert.equal(fold(42), '42');
  assert.equal(fold(''), '');
});

test('fixture: title, slug, case', () => {
  const lor = find(nodes, 'lor');
  const titles = lor.map((r) => r.title);
  assert.ok(titles.includes('LoRA') && titles.includes('LoRA follow-up'));
  assert.deepEqual(titles.slice(0, 2), ['LoRA', 'LoRA follow-up']);
  for (const r of lor) assert.ok(fold(r.title).includes('lor') || fold(slugOf(r.id)).includes('lor'));

  const foc = find(nodes, '01-foc');
  assert.equal(foc.length, 1);
  assert.ok(foc[0].id.endsWith('01-focus'));

  assert.ok(find(nodes, 'FOCUS').some((r) => r.title === 'Focus is a skill'));

  const deep = find(nodes, 'deep');
  assert.ok(deep.some((r) => r.title === 'Deep Work'));
  for (const r of deep) assert.ok(fold(r.title).includes('deep') || fold(slugOf(r.id)).includes('deep'));
});

test('fixture: no match, no url or missing, folders are not searched', () => {
  assert.deepEqual(find(nodes, 'zzz'), []);
  assert.deepEqual(find(nodes, '   '), []);
  for (const q of ['lora', 'work', 'a', 'gone', 'example'])
    for (const r of find(nodes, q)) assert.ok(!/^(url|missing):/.test(r.id));
  // "readings" and "sources" occur in the fixture only as id folders.
  assert.deepEqual(find(nodes, 'readings'), []);
  assert.deepEqual(find(nodes, 'sources'), []);
});

test('diacritics', () => {
  assert.equal(find([page('a/x', 'Đại số')], 'dai so')[0].title, 'Đại số');
  assert.equal(find([page('a/y', 'Éclair')], 'eclair')[0].title, 'Éclair');
});

test('rank order', () => {
  // graph: "Graph theory" rank 0 (title prefix); "Knowledge graph" rank 1 (title word);
  // "Notes" rank 2 (slug word in notes-graph); "Paragraph" and "Yak" rank 3 (inside a word),
  // ordered by title: Paragraph before Yak.
  const ns = [
    page('x/paragraph', 'Paragraph'),
    page('x/paragraph-notes', 'Yak'),
    page('x/notes-graph', 'Notes'),
    page('x/kg', 'Knowledge graph'),
    page('x/gt', 'Graph theory'),
  ];
  assert.deepEqual(find(ns, 'graph').map((r) => r.title), [
    'Graph theory',
    'Knowledge graph',
    'Notes',
    'Paragraph',
    'Yak',
  ]);
});

test('ties by title then id', () => {
  const ns = [page('b/z', 'Alpha'), page('a/z', 'Alpha'), page('c/z', 'Algae')];
  assert.deepEqual(find(ns, 'al').map((r) => r.id), ['c/z', 'a/z', 'b/z']);
});

test('limit and non-page kinds', () => {
  const ns = [page('a', 'a1'), page('b', 'a2'), page('c', 'a3')];
  assert.equal(find(ns, 'a', 2).length, 2);
  const other = [
    { id: 'url:https://a', title: 'alpha', kind: 'url' },
    { id: 'missing:alpha', title: 'alpha', kind: 'missing' },
  ];
  assert.deepEqual(find(other, 'alpha'), []);
});

test('return shape and total', () => {
  const many = Array.from({ length: 50 }, (_, i) => page(`m/p${i}`, `Match ${i}`));
  const all = searchPages(many, 'match');
  assert.equal(all.results.length, 20);
  assert.equal(all.total, 50);
  assert.equal(searchPages(many, 'match', 5).total, 50);
  assert.deepEqual(searchPages([{ ...page('a/b', 'Beta'), type: 'sources' }], 'bet').results, [
    { id: 'a/b', title: 'Beta', type: 'sources' },
  ]);
  assert.deepEqual(searchPages(many, ' '), { results: [], total: 0 });
});

test('word breaks', () => {
  const lora = page('c/lora', 'Low-Rank Adaptation (LoRA)');
  assert.equal(find([lora], 'low rank')[0].title, lora.title);
  assert.equal(find([page('sources/lora-2', 'Second')], 'lora 2')[0].id, 'sources/lora-2');
  // Word boundary (rank 1) beats a match inside a word (rank 3).
  const ns = [page('c/xlora', 'Xlorax'), lora];
  assert.deepEqual(find(ns, 'lora').map((r) => r.id), ['c/lora', 'c/xlora']);
  assert.equal(find([page('c/dw', 'The Deep Work rules')], 'deep wo').length, 1);
  assert.deepEqual(find([page('c/dw', 'The Deep Work rules'), page('c/x', 'Deep Worker')], 'deep wo').map((r) => r.id), ['c/x', 'c/dw']);
});

test('folds', () => {
  assert.equal(find([page('a/p', '\u0141\u00f3d\u017a')], 'lodz').length, 1);
  assert.equal(find([page('a/s', 'Stra\u00dfe')], 'strasse').length, 1);
  assert.equal(find([page('a/o', '\u00d8resund')], 'oresund').length, 1);
  assert.equal(find([page('a/f', '\ufb01le')], 'file').length, 1);
  assert.equal(fold('\u00e6\u0153'), 'aeoe');
});

test('foldWords', () => {
  assert.equal(foldWords('Low-Rank Adaptation (LoRA)'), 'low rank adaptation lora');
  assert.equal(foldWords('deep_work'), 'deep work');
  assert.equal(foldWords(''), '');
  assert.equal(foldWords('-- (!) __'), '');
});

test('rank tiers are not alphabetical', () => {
  const ids = (ns, q) => find(ns, q).map((r) => r.id);
  assert.deepEqual(ids([page('x/a', 'A graph'), page('x/g', 'Graph zeta')], 'graph'), ['x/g', 'x/a']);
  assert.deepEqual(ids([page('x/paragraph', 'Alpha'), page('x/notes-graph', 'Zulu')], 'graph'), ['x/notes-graph', 'x/paragraph']);
  assert.equal(searchPages([page('x/p', 'Paragraph')], 'graph').total, 1);
  assert.deepEqual(ids([page('x/a', 'Big graph'), page('x/z', 'Graphite')], 'graph'), ['x/z', 'x/a']);
});

test('tie order', () => {
  const ids = (ns, q) => find(ns, q).map((r) => r.id);
  assert.deepEqual(ids([page('x/b', 'Match 10'), page('x/a', 'Match 2')], 'match'), ['x/a', 'x/b']);
  assert.deepEqual(ids([page('x/2', 'apple'), page('x/1', 'Apple')], 'app'), ['x/1', 'x/2']);
});

test('script-aware folds', () => {
  assert.equal(find([page('a/d', 'D\u1ea1i s\u1ed1'.normalize('NFD'))], 'dai so').length, 1);
  assert.equal(find([page('a/k', '\u304c\u304e')], '\u304b\u304d').length, 0);
  assert.equal(find([page('a/k', '\u304c\u304e')], '\u304c\u304e').length, 1);
  assert.equal(find([page('a/i', '\u0131\u015f\u0131k')], 'isik').length, 1);
  assert.equal(find([page('a/t', '\u00feorn')], 'th').length, 1);
  assert.equal(find([page('a/e', '\u00d0ata')], 'data').length, 1);
});

test('foldWords of decomposed text', () => {
  const c = 'Đại số (\u00c9clair)';
  assert.equal(foldWords(c.normalize('NFD')), foldWords(c.normalize('NFC')));
  assert.equal(foldWords(c.normalize('NFD')), 'dai so eclair');
});
