import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from './state.mjs';

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
const frozen = (s) => deepFreeze(structuredClone(s));

test('initialState is frozen with the documented shape', () => {
  assert.ok(Object.isFrozen(initialState));
  assert.deepEqual(initialState, {
    collapsed: {},
    selectedEdge: null,
    filter: '',
    showOrphans: true,
    hops: null,
    query: '',
  });
  assert.deepEqual(Object.keys(initialState).sort(), ['collapsed', 'filter', 'hops', 'query', 'selectedEdge', 'showOrphans']);
});

test('toggleFolder closes then opens', () => {
  const closed = reducer(frozen(initialState), { type: 'toggleFolder', path: 'a' });
  assert.deepEqual(closed.collapsed, { a: true });
  const open = reducer(frozen(closed), { type: 'toggleFolder', path: 'a' });
  assert.deepEqual(open.collapsed, {});
  assert.ok(!('a' in open.collapsed));
});

test('openFolders removes listed paths', () => {
  const s = frozen({ ...initialState, collapsed: { a: true, b: true, c: true } });
  const next = reducer(s, { type: 'openFolders', paths: ['a', 'c', 'x'] });
  assert.deepEqual(next.collapsed, { b: true });
});

test('openFolders is a no-op when none was closed', () => {
  const s = frozen({ ...initialState, collapsed: { b: true } });
  assert.equal(reducer(s, { type: 'openFolders', paths: ['a'] }), s);
  assert.equal(reducer(s, { type: 'openFolders', paths: [] }), s);
});

test('selectEdge sets, and is a no-op when unchanged', () => {
  const next = reducer(frozen(initialState), { type: 'selectEdge', key: 'k' });
  assert.equal(next.selectedEdge, 'k');
  const s = frozen(next);
  assert.equal(reducer(s, { type: 'selectEdge', key: 'k' }), s);
});

test('clearEdge resets, and is a no-op when already null', () => {
  const s = frozen({ ...initialState, selectedEdge: 'k' });
  assert.equal(reducer(s, { type: 'clearEdge' }).selectedEdge, null);
  assert.equal(reducer(initialState, { type: 'clearEdge' }), initialState);
});

test('unknown action returns the same object', () => {
  const s = frozen(initialState);
  assert.equal(reducer(s, { type: 'nope' }), s);
});

test('inherited and special folder names toggle like any other', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const closed = reducer(frozen(initialState), { type: 'toggleFolder', path: name });
    assert.ok(Object.hasOwn(closed.collapsed, name), name);
    assert.equal(closed.collapsed[name], true, name);
    const open = reducer(frozen(closed), { type: 'toggleFolder', path: name });
    assert.ok(!Object.hasOwn(open.collapsed, name), name);
    const s = frozen(initialState);
    assert.equal(reducer(s, { type: 'openFolders', paths: [name] }), s, name);
  }
});

test('setFilter sets, coerces non-strings to empty, and is a no-op when unchanged', () => {
  const f = reducer(frozen(initialState), { type: 'setFilter', value: 'type:sources' });
  assert.equal(f.filter, 'type:sources');
  const s = frozen(f);
  assert.equal(reducer(s, { type: 'setFilter', value: 'type:sources' }), s);
  for (const v of [5, null, undefined, {}, true]) assert.equal(reducer(s, { type: 'setFilter', value: v }).filter, '', String(v));
  const i = frozen(initialState);
  for (const v of ['', 5, undefined, null]) assert.equal(reducer(i, { type: 'setFilter', value: v }), i, String(v));
  assert.equal(s.filter, 'type:sources');
});

test('setShowOrphans stores a boolean and is a no-op when unchanged', () => {
  const off = reducer(frozen(initialState), { type: 'setShowOrphans', value: false });
  assert.equal(off.showOrphans, false);
  const s = frozen(off);
  assert.equal(reducer(s, { type: 'setShowOrphans', value: false }), s);
  assert.equal(reducer(s, { type: 'setShowOrphans', value: true }).showOrphans, true);
  for (const v of ['true', 1, null, undefined]) assert.equal(reducer(s, { type: 'setShowOrphans', value: v }), s, String(v));
  const i = frozen(initialState);
  assert.equal(reducer(i, { type: 'setShowOrphans', value: true }), i);
  for (const v of ['true', 1, undefined]) assert.equal(reducer(i, { type: 'setShowOrphans', value: v }).showOrphans, false, String(v));
});

test('setHops accepts null, 1, 2, 3 and maps anything else to null', () => {
  for (const v of [1, 2, 3]) assert.equal(reducer(frozen(initialState), { type: 'setHops', value: v }).hops, v);
  const two = frozen(reducer(frozen(initialState), { type: 'setHops', value: 2 }));
  for (const v of [4, 0, '2', undefined, null]) assert.equal(reducer(two, { type: 'setHops', value: v }).hops, null, String(v));
  assert.equal(reducer(two, { type: 'setHops', value: 2 }), two);
  const i = frozen(initialState);
  for (const v of [null, 4, '2', undefined]) assert.equal(reducer(i, { type: 'setHops', value: v }), i);
});

test('setQuery sets, coerces non-strings to empty, and is a no-op when unchanged', () => {
  const q = reducer(frozen(initialState), { type: 'setQuery', value: 'abc' });
  assert.equal(q.query, 'abc');
  const s = frozen(q);
  assert.equal(reducer(s, { type: 'setQuery', value: 'abc' }), s);
  assert.equal(reducer(s, { type: 'setQuery', value: 5 }).query, '');
  const i = frozen(initialState);
  assert.equal(reducer(i, { type: 'setQuery', value: undefined }), i);
});
