import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMUNITY_PALETTE, communityColor, communityList, nodeFill } from './communities.mjs';
import { buildGraphModel, NEUTRAL } from './graph-model.mjs';

const wiki = JSON.parse(readFileSync(new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'));
const list = communityList(wiki);

test('fixture: one entry per community, in order, sized by members', () => {
  assert.equal(list.length, wiki.communities.length);
  list.forEach((c, i) => {
    assert.equal(c.index, i);
    assert.equal(c.name, wiki.communities[i].name);
    assert.equal(c.members.length, c.size);
    assert.equal(c.color, COMMUNITY_PALETTE[i % 10]);
  });
  assert.deepEqual(list.map((c) => c.title), ['LoRA', 'Deep Work', 'index', 'log', '0', '2024']);
});

test('fixture: each community page sits in exactly the entry its index names', () => {
  const all = list.flatMap((c) => c.members.map((m) => m.id));
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((id) => !id.startsWith('url:') && !id.startsWith('missing:')));
  for (const n of wiki.nodes) {
    if (n.kind === 'page' && n.community != null) {
      assert.ok(list[n.community].members.some((m) => m.id === n.id));
    }
  }
  assert.equal(all.length, wiki.nodes.filter((n) => n.kind === 'page' && n.community != null).length);
});

test('fixture: first entry members in collator order', () => {
  assert.deepEqual(list[0].members.map((m) => m.id), ['people/ada-park', 'concepts/adapters', 'sources/lora', 'sources/lora-2']);
});

test('communityColor cycles and rejects bad indexes', () => {
  assert.equal(communityColor(0), communityColor(COMMUNITY_PALETTE.length));
  for (const bad of [null, -1, 1.5, undefined]) assert.equal(communityColor(bad), null);
});

test('hand-made: title fallback, collator order, id tie-break, empty', () => {
  const page = (id, title) => ({ id, title, kind: 'page', community: 0 });
  const w = { nodes: [page('z', 'zebra'), page('d', 'Đại số'), page('a', 'apple'), page('y2', 'same'), page('y1', 'same')], communities: [{ name: 'nope', size: 5 }] };
  const [c] = communityList(w);
  assert.equal(c.title, 'nope');
  assert.deepEqual(c.members.map((m) => m.id), ['a', 'd', 'y1', 'y2', 'z']);
  assert.deepEqual(communityList({ nodes: [] }), []);
});

test('communityColor is the palette lookup', () => {
  for (const i of [0, 1, 9, 10, 23]) assert.equal(communityColor(i), COMMUNITY_PALETTE[i % COMMUNITY_PALETTE.length]);
});

test('nodeFill: type mode returns own color; community mode colors pages only', () => {
  const nodes = buildGraphModel(wiki).nodes;
  for (const n of nodes) assert.equal(nodeFill(n, 'type'), n.color);
  const paged = nodes.filter((n) => n.kind === 'page' && Number.isInteger(n.community));
  assert.ok(paged.length > 0);
  for (const n of paged) assert.equal(nodeFill(n, 'community'), COMMUNITY_PALETTE[n.community % 10]);
  for (const n of nodes.filter((x) => x.kind === 'url' || x.kind === 'missing')) assert.equal(nodeFill(n, 'community'), n.color);
  assert.equal(nodeFill({ kind: 'page', community: null, color: '#123456' }, 'community'), NEUTRAL);
});

test('communityList survives malformed communities', () => {
  assert.deepEqual(communityList({ nodes: [], communities: null }), []);
  assert.deepEqual(communityList({ nodes: [], communities: 'x' }), []);
  const r = communityList({ nodes: [{ id: 'a', kind: 'page', community: 1 }], communities: [null, { name: 'sources/lora', size: 1 }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].index, 1);
  assert.deepEqual(r[0].members, [{ id: 'a', title: 'a' }]);
});
