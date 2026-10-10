import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilter, matchValue, suggest, resolveValues, removeTerms, legendEntries } from './query.mjs';

const empty = { type: [], rel: [], conf: [] };
const P = (t) => parseFilter(t);

test('parseFilter: empty and blank', () => {
  for (const t of ['', '   \t ']) assert.deepEqual(P(t), { words: [], include: empty, exclude: empty });
});
test('parseFilter: words are folded', () => {
  assert.deepEqual(P('Đại  Số').words, ['dai', 'so']);
});
test('parseFilter: keys', () => {
  const r = P('type:sources rel:cites conf:high');
  assert.deepEqual(r.include, { type: ['sources'], rel: ['cites'], conf: ['high'] });
  assert.deepEqual(r.exclude, empty);
  assert.deepEqual(r.words, []);
});
test('parseFilter: exclusion', () => {
  const r = P('-type:people -rel:cites');
  assert.deepEqual(r.exclude, { type: ['people'], rel: ['cites'], conf: [] });
  assert.deepEqual(r.include, empty);
});
test('parseFilter: key case and value folding', () => {
  assert.deepEqual(P('TYPE:Sources').include.type, ['sources']);
});
test('parseFilter: quotes', () => {
  assert.deepEqual(P('"deep work" x').words, ['deep work', 'x']);
  assert.deepEqual(P('type:"x y"').include.type, ['x y']);
  assert.deepEqual(P('"open end').words, ['open end']);
});
test('parseFilter: empty value dropped', () => {
  assert.deepEqual(P('type:'), { words: [], include: empty, exclude: empty });
});
test('parseFilter: a half-typed exclusion filters nothing', () => {
  for (const x of ['-', '-t', '-ty', '-type', '-REL', '-conf']) assert.deepEqual(P(x), { words: [], include: empty, exclude: empty }, x);
  assert.deepEqual(P('-foo').words, ['-foo']);
  assert.deepEqual(P('ty').words, ['ty']);
  assert.deepEqual(P('-type:people').exclude.type, ['people']);
});
test('parseFilter: lookalikes are words', () => {
  assert.deepEqual(P('foo:bar -foo').words, ['foo:bar', '-foo']);
});
test('parseFilter: repeated keys accumulate', () => {
  assert.deepEqual(P('type:a type:b').include.type, ['a', 'b']);
});
test('parseFilter: non-string input', () => {
  for (const v of [null, undefined, 42]) assert.deepEqual(P(v), { words: [], include: empty, exclude: empty });
});

test('matchValue', () => {
  assert.equal(matchValue('so', 'sources'), true);
  assert.equal(matchValue('sources', 'sources'), true);
  assert.equal(matchValue('x', 'sources'), false);
  assert.equal(matchValue('', 'sources'), false);
  assert.equal(matchValue('SÓ', 'Sources'), true);
});

const vocab = { type: ['sources', 'concepts', 'summary', 'url'], rel: ['cites', 'uses_concept', 'other'], conf: ['high', 'none'] };
const labels = (t, v = vocab) => suggest(t, v).map((s) => s.label);

test('suggest: keys', () => {
  assert.deepEqual(labels(''), ['type:', 'rel:', 'conf:']);
  assert.deepEqual(suggest('ty', vocab), [{ label: 'type:', text: 'type:' }]);
  assert.equal(suggest('lor ty', vocab)[0].text, 'lor type:');
  assert.deepEqual(labels('lor '), ['type:', 'rel:', 'conf:']);
  assert.equal(suggest('lor ', vocab)[0].text, 'lor type:');
});
test('suggest: values', () => {
  const r = suggest('type:', vocab);
  assert.deepEqual(r.map((s) => s.label), ['type:sources', 'type:concepts', 'type:summary', 'type:url']);
  assert.equal(r[0].text, 'type:sources ');
  assert.deepEqual(labels('type:s'), ['type:sources', 'type:summary']);
  assert.deepEqual(labels('rel:'), ['rel:cites', 'rel:uses_concept', 'rel:other']);
  assert.deepEqual(labels('conf:'), ['conf:high', 'conf:none']);
  assert.equal(suggest('lor type:s', vocab)[0].text, 'lor type:sources ');
});
test('suggest: leaves out present values and keeps the sign', () => {
  assert.deepEqual(labels('type:sources type:'), ['type:concepts', 'type:summary', 'type:url']);
  assert.equal(labels('-type:sources type:').includes('type:sources'), true);
  assert.deepEqual(suggest('-type:c', vocab), [{ label: 'type:concepts', text: '-type:concepts ' }]);
});
test('suggest: quotes values with spaces', () => {
  assert.equal(suggest('type:', { type: ['a b'] })[0].text, 'type:"a b" ');
});
test('suggest: nothing for words and unknown keys', () => {
  assert.deepEqual(suggest('lor', vocab), []);
  assert.deepEqual(suggest('foo:', vocab), []);
});
test('suggest: no cap on values', () => {
  const big = { type: [], rel: Array.from({ length: 30 }, (_, i) => `r${i}`), conf: [] };
  assert.equal(suggest('rel:', big).length, 30);
});
test('suggest: keys are case-insensitive and signed', () => {
  assert.deepEqual(suggest('-ty', vocab), [{ label: 'type:', text: '-type:' }]);
  assert.equal(suggest('TY', vocab)[0].text, 'type:');
  assert.equal(suggest('TYPE:s', vocab)[0].label, 'type:sources');
});
test('suggest: an include term does not hide an exclude suggestion', () => {
  const r = suggest('type:sources -type:', vocab).find((s) => s.label === 'type:sources');
  assert.ok(r);
  assert.ok(r.text.endsWith('-type:sources '));
});
test('suggest: nothing inside an open quote', () => {
  assert.deepEqual(suggest('"deep ty', vocab), []);
});

test('suggest offers nothing for a value typed in full', () => {
  const vocab = { type: ['sources', 'summary'], rel: ['cites'], conf: [] };
  assert.deepEqual(suggest('type:sources rel:cites', vocab), []);
  assert.deepEqual(suggest('type:s', vocab).map((s) => s.label), ['type:sources', 'type:summary']);
});

test('resolveValues', () => {
  const r = (v, n) => [...resolveValues(v, n)];
  assert.deepEqual(r(['authored'], ['authored', 'authored_by', 'cites']), ['authored']);
  assert.deepEqual(r(['auth'], ['authored', 'authored_by', 'cites']), ['authored', 'authored_by']);
  assert.equal(resolveValues(['s'], ['sources', 'summary', 'people']).size, 2);
  assert.equal(resolveValues(['zzz'], ['sources']).size, 0);
  assert.deepEqual(r(['SÓURCES'], ['Sources']), ['Sources']);
  assert.equal(resolveValues([], ['sources']).size, 0);
});

test('removeTerms', () => {
  const keyIs = (k, ex) => (t) => t.key === k && t.exclude === ex;
  assert.equal(removeTerms('a type:x -type:y b', keyIs('type', true)), 'a type:x b');
  assert.equal(removeTerms('a type:x -type:y b', keyIs('type', false)), 'a -type:y b');
  assert.equal(removeTerms('"deep work" rel:c  x', (t) => t.key === 'rel'), '"deep work" x');
  assert.equal(removeTerms('"deep work" x', (t) => t.value === 'x'), '"deep work"');
  assert.equal(removeTerms('a  b', (t) => t.value === 'a'), 'b');
});

const legend = ['type:sources', 'type:summary', 'type:concepts', 'url', 'missing'].map((key) => ({ key, label: `L-${key}`, color: '#123', variant: 'v' }));
const L = (text) => Object.fromEntries(legendEntries(legend, text).map((e) => [e.kind, e]));
test('legendEntries: click results', () => {
  assert.equal(L('type:so').sources.next, '');
  assert.equal(L('-type:sources').sources.next, '');
  assert.equal(L('').sources.next, 'type:sources');
  assert.equal(L('type:concepts').sources.next, 'type:concepts type:sources');
});
test('legendEntries: prefix picks several', () => {
  const e = L('type:s');
  assert.equal(e.sources.picked && e.summary.picked, true);
  assert.equal(e.concepts.off, true);
  assert.equal(e.sources.next, '');
});
test('legendEntries: other picked kind leaves the rest', () => {
  const e = L('type:sources type:concepts');
  assert.equal(e.sources.picked, true);
  assert.equal(e.summary.off, true);
  assert.equal(e.sources.next, 'type:concepts');
});
test('legendEntries: exclusion and passthrough', () => {
  const e = L('-type:url');
  assert.equal(e.url.off, true);
  assert.equal(e.url.picked, false);
  assert.equal(e.url.next, '');
  assert.equal(L('').sources.off || L('').sources.picked, false);
  const f = L('')
  assert.deepEqual([f.sources.kind, f.url.kind, f.missing.kind], ['sources', 'url', 'missing']);
  assert.deepEqual([f.url.label, f.url.color, f.url.variant], ['L-url', '#123', 'v']);
});

test('legendEntries: unclosed quote is closed before the new term', () => {
  const legend = [{ key: 'type:sources' }, { key: 'type:concepts' }];
  const { next } = legendEntries(legend, '"foo').find((e) => e.kind === 'sources');
  assert.equal(next, '"foo" type:sources');
  const q = parseFilter(next);
  assert.deepEqual(q.words, ['foo']);
  assert.deepEqual(q.include.type, ['sources']);
  assert.equal(legendEntries(legend, next).find((e) => e.kind === 'sources').picked, true);
});
