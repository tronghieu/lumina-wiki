import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lintIndex, findingsFor, worstOf, SEVERITY_RANK, lintResult, LINT_LOADING, ringsOf } from './lint-marks.mjs';

const lint = JSON.parse(fs.readFileSync(new URL('../../test-fixtures/contract/expected/lint.json', import.meta.url), 'utf8'));
const index = lintIndex(lint);
const withNode = lint.findings.filter((f) => f.nodeId !== null);

test('fixture: marked pages, workspace, summary, total', () => {
  assert.deepEqual([...index.byNode.keys()].sort(), [...new Set(withNode.map((f) => f.nodeId))].sort());
  assert.ok(!index.byNode.has('readings/deep-work/01-focus'));
  assert.deepEqual(index.workspace, lint.findings.filter((f) => f.nodeId === null));
  assert.equal(index.workspace.length, 2);
  assert.deepEqual(index.summary, lint.summary);
  assert.equal(index.total, lint.findings.length);
});

test('fixture: worst severity of a page with mixed findings is error', () => {
  // sources/lora carries an error, a warning, and an info finding.
  assert.equal(index.byNode.get('sources/lora').worst, 'error');
});

test('fixture: folders mark every ancestor and nothing else', () => {
  assert.deepEqual(
    [...index.folders.keys()].sort(),
    ['concepts', 'people', 'readings', 'readings/deep-work', 'sources', 'summary'],
  );
  assert.equal(index.folders.get('sources'), 'error');
});

test('findingsFor', () => {
  assert.deepEqual(findingsFor(index, 'sources/lora'), lint.findings.filter((f) => f.nodeId === 'sources/lora'));
  assert.deepEqual(findingsFor(index, 'nope'), []);
});

test('bad input gives the empty index', () => {
  for (const bad of [null, undefined, 'x', {}, { findings: 'x' }]) {
    const i = lintIndex(bad);
    assert.equal(i.byNode.size, 0);
    assert.equal(i.folders.size, 0);
    assert.deepEqual(i.workspace, []);
    assert.deepEqual(i.summary, { errors: 0, warnings: 0, info: 0 });
    assert.equal(i.total, 0);
  }
  const ok = { id: 'x', severity: 'info', message: 'm', nodeId: 'a/b' };
  const i = lintIndex({ findings: [null, 5, { id: 'x', severity: 'error', nodeId: 'a/b' }, ok] });
  assert.equal(i.total, 1);
  assert.deepEqual(findingsFor(i, 'a/b'), [ok]);
});

test('worstOf over every pair', () => {
  const vals = ['error', 'warning', 'info', null, 'bogus'];
  for (const a of vals) {
    for (const b of vals) {
      const r = Math.max(SEVERITY_RANK[a] ?? 0, SEVERITY_RANK[b] ?? 0);
      const got = worstOf(a, b);
      if (r === 0) assert.equal(got, null);
      else assert.equal(SEVERITY_RANK[got], r);
    }
  }
});

test('folder mark takes the worst of its pages', () => {
  const f = (severity, nodeId) => ({ id: 'i', severity, message: 'm', nodeId });
  const i = lintIndex({ findings: [f('info', 'a/b/x'), f('error', 'a/c/y')] });
  assert.equal(i.folders.get('a'), 'error');
  assert.equal(i.folders.get('a/b'), 'info');
});

test('worstOf ignores prototype-key severities', () => {
  assert.equal(worstOf('error', 'constructor'), 'error');
  assert.equal(worstOf('toString', 'info'), 'info');
  assert.equal(worstOf('__proto__', 'hasOwnProperty'), null);
  assert.equal(worstOf('warning', 'warning'), 'warning');
});

test('merge order does not change the worst severity', () => {
  const f = (severity, nodeId) => ({ id: 'i', severity, message: 'm', nodeId });
  for (const order of [['error', 'warning', 'info'], ['info', 'error', 'warning']]) {
    const i = lintIndex({ findings: order.map((s) => f(s, 'a/b/x')) });
    assert.equal(i.byNode.get('a/b/x').worst, 'error');
    assert.equal(i.folders.get('a/b'), 'error');
  }
  assert.equal(index.byNode.get('sources/lora-2').worst, 'error');
  assert.equal(index.folders.get('sources'), 'error');
});

test('lintResult: only a well-formed ok reply is ready', () => {
  const good = { id: 'i', severity: 'info', message: 'm', nodeId: 'a/b' };
  const bad = [
    lintResult(false, lint),
    lintResult(true, null),
    lintResult(true, {}),
    lintResult(true, { findings: 'x' }),
    lintResult(true, { error: 'boom' }),
    lintResult(true, { findings: [1] }),
    lintResult(true, { findings: [good, { ...good, severity: 'hint' }] }),
    lintResult(true, { findings: [{ ...good, severity: 'constructor' }] }),
  ];
  for (const r of bad) {
    assert.equal(r.status, 'failed');
    assert.equal(r.index.total, 0);
    assert.equal(r.index.byNode.size, 0);
  }
  const ready = lintResult(true, lint);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.index.total, 23);
  const empty = lintResult(true, { findings: [] });
  assert.equal(empty.status, 'ready');
  assert.equal(empty.index.total, 0);
});

test('LINT_LOADING is a frozen loading state with an empty index', () => {
  assert.equal(LINT_LOADING.status, 'loading');
  assert.equal(LINT_LOADING.index.total, 0);
  assert.equal(LINT_LOADING.index.byNode.size, 0);
  assert.ok(Object.isFrozen(LINT_LOADING));
});

test('ringsOf', () => {
  assert.equal(ringsOf(index, false), null);
  const m = ringsOf(index, true);
  assert.ok(m instanceof Map);
  assert.equal(m.size, index.byNode.size);
  assert.equal(m.get('sources/lora'), 'error');
  const e = ringsOf(lintIndex(null), true);
  assert.ok(e instanceof Map);
  assert.equal(e.size, 0);
});

test('ringsOf colors a page by its worst severity, not its first finding', () => {
  const f = (severity) => ({ id: 'L1', severity, message: 'm', nodeId: 'a/p', file: 'wiki/a/p.md', line: 1, fixable: false });
  const body = { findings: ['info', 'error', 'warning'].map(f) };
  assert.equal(ringsOf(lintIndex(body), true).get('a/p'), 'error');
  // Fixture: sources/lora-2 lists a warning before its errors.
  assert.equal(lint.findings.find((x) => x.nodeId === 'sources/lora-2').severity, 'warning');
  assert.equal(ringsOf(index, true).get('sources/lora-2'), 'error');
});
