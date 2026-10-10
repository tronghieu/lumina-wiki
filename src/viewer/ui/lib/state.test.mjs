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
    query: '',
    colorMode: 'type',
    showLint: false,
  });
  assert.deepEqual(Object.keys(initialState).sort(), ['collapsed', 'colorMode', 'filter', 'query', 'selectedEdge', 'showLint', 'showOrphans']);
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

test('setQuery sets, coerces non-strings to empty, and is a no-op when unchanged', () => {
  const q = reducer(frozen(initialState), { type: 'setQuery', value: 'abc' });
  assert.equal(q.query, 'abc');
  const s = frozen(q);
  assert.equal(reducer(s, { type: 'setQuery', value: 'abc' }), s);
  assert.equal(reducer(s, { type: 'setQuery', value: 5 }).query, '');
  const i = frozen(initialState);
  assert.equal(reducer(i, { type: 'setQuery', value: undefined }), i);
});

test('setColorMode sets only its field, rejects unknown modes, and is a no-op when unchanged', () => {
  const i = frozen(initialState);
  const c = reducer(i, { type: 'setColorMode', value: 'community' });
  assert.equal(c.colorMode, 'community');
  assert.deepEqual({ ...c, colorMode: 'type' }, i);
  const s = frozen(c);
  assert.equal(reducer(s, { type: 'setColorMode', value: 'community' }), s);
  for (const v of ['bogus', '', null, undefined, 1]) assert.equal(reducer(s, { type: 'setColorMode', value: v }), s, String(v));
  assert.equal(reducer(i, { type: 'setColorMode', value: 'type' }), i);
  assert.equal(reducer(i, { type: 'setColorMode', value: 'bogus' }), i);
  assert.equal(reducer(s, { type: 'setColorMode', value: 'type' }).colorMode, 'type');
});

test('setShowLint stores a boolean, coerces non-booleans to false, and is a no-op when unchanged', () => {
  const i = frozen(initialState);
  const on = reducer(i, { type: 'setShowLint', value: true });
  assert.equal(on.showLint, true);
  assert.deepEqual({ ...on, showLint: false }, i);
  const s = frozen(on);
  assert.equal(reducer(s, { type: 'setShowLint', value: true }), s);
  for (const v of ['true', 1, null, undefined]) assert.equal(reducer(s, { type: 'setShowLint', value: v }).showLint, false, String(v));
  assert.equal(reducer(i, { type: 'setShowLint', value: false }), i);
  assert.equal(reducer(i, { type: 'setShowLint', value: 'x' }), i);
});

test('setFilter and toggleFolder leave colorMode and showLint alone', () => {
  const s = frozen({ ...initialState, colorMode: 'community', showLint: true });
  for (const a of [{ type: 'setFilter', value: 'x' }, { type: 'toggleFolder', path: 'a' }]) {
    const n = reducer(s, a);
    assert.equal(n.colorMode, 'community');
    assert.equal(n.showLint, true);
  }
});
