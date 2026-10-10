// The classic-viewer copy and the project-mode original must never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCommunities } from './communities.mjs';
import { detectCommunities as original } from '../../project/lib/view.mjs';

const both = (nodes, edges) => {
  const copy = detectCommunities(nodes, edges);
  assert.deepEqual(copy, original(nodes, edges));
  return copy;
};

test('seven-node fixture matches the original and the known result', () => {
  const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'z'].map((x) => ({ id: `concept:${x}` }));
  const e = (from, to) => ({ from: `concept:${from}`, to: `concept:${to}` });
  const edges = [e('a1', 'a2'), e('a2', 'a3'), e('a3', 'a1'), e('a3', 'b1'), e('b1', 'b2'), e('b2', 'b3'), e('b3', 'b1')];
  const result = both(nodes, edges);
  assert.deepEqual(result.of, [0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(result.list, [
    { name: 'a3', size: 3 },
    { name: 'b1', size: 3 },
    { name: 'z', size: 1 },
  ]);
});

test('40-node seeded graph matches the original and finds the four planted communities', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const ids = Array.from({ length: 40 }, (_, i) => `sources/n${String(i).padStart(2, '0')}`).sort();
  const nodes = ids.map((id) => ({ id }));
  const edges = [];
  for (let i = 0; i < 40; i++) {
    for (let j = i + 1; j < 40; j++) {
      const same = Math.floor(i / 10) === Math.floor(j / 10);
      if (rnd() < (same ? 0.7 : 0.02)) edges.push({ from: ids[i], to: ids[j] });
    }
  }
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  const result = both(nodes, edges);
  assert.equal(result.list.length, 4);
});

test('edge cases match the original', () => {
  const n = (...xs) => xs.map((id) => ({ id }));
  const ed = (from, to) => ({ from, to });
  both([], []);
  both(n('a', 'b', 'c'), []);
  both(n('a', 'b'), [ed('a', 'ghost'), ed('a', 'b')]);
  both(n('a', 'b'), [ed('a', 'a'), ed('a', 'b')]);
  both(n('a', 'b', 'c'), [ed('a', 'b'), ed('a', 'b'), ed('b', 'c')]);
});
