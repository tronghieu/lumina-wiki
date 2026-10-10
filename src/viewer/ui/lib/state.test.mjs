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
  assert.deepEqual(initialState, { collapsed: {}, selectedEdge: null });
});

test('toggleFolder closes then opens', () => {
  const closed = reducer(frozen(initialState), { type: 'toggleFolder', path: 'a' });
  assert.deepEqual(closed.collapsed, { a: true });
  const open = reducer(frozen(closed), { type: 'toggleFolder', path: 'a' });
  assert.deepEqual(open.collapsed, {});
  assert.ok(!('a' in open.collapsed));
});

test('openFolders removes listed paths', () => {
  const s = frozen({ collapsed: { a: true, b: true, c: true }, selectedEdge: null });
  const next = reducer(s, { type: 'openFolders', paths: ['a', 'c', 'x'] });
  assert.deepEqual(next.collapsed, { b: true });
});

test('openFolders is a no-op when none was closed', () => {
  const s = frozen({ collapsed: { b: true }, selectedEdge: null });
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
  const s = frozen({ collapsed: {}, selectedEdge: 'k' });
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
