import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraphModel, EMPTY_WIKI } from './graph-model.mjs';
import {
  nodeBucket, relationBucket, confidenceBucket, vocabulary, visibleSets, selectedLink,
} from './filter.mjs';
import { reducer, initialState } from './state.mjs';

const wiki = JSON.parse(readFileSync(
  new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'));
const model = buildGraphModel(wiki);
const ALL = { filter: '', showOrphans: true, hops: null };
const tri = (e) => `${e.from} ${e.type} ${e.to}`;
const sort = (a) => [...a].sort();

function run(settings, openId = null, w = wiki, m = model) {
  const v = visibleSets(m, w, { ...ALL, ...settings }, openId);
  return { nodes: sort(v.nodeIds), links: sort([...v.linkKeys].map((k) => k.replaceAll('\0', ' '))), v };
}
// Fixture facts computed from the raw data, never from the function under test.
const allNodes = sort(model.nodes.map((n) => n.id));
const triples = (pred) => sort(wiki.edges.filter(pred).map(tri));
const among = (ids) => triples((e) => ids.includes(e.from) && ids.includes(e.to));
const SOURCES = ['sources/deep-work', 'sources/lora', 'sources/lora-2'];

// Plain breadth-first walk over the given edges, either direction.
function walk(edges, start, hops) {
  const seen = new Set([start]);
  let frontier = [start];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const e of edges) {
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
        if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b); }
      }
    }
    frontier = next;
  }
  return sort(seen);
}

function mini(nodes, edges) {
  return {
    nodes: nodes.map(([id, type, title]) => ({ id, kind: 'page', type, title, community: 0 })),
    edges,
    communities: [],
    schema: { entityTypes: [{ name: 'concepts' }], relationTypes: [{ name: 'related_to' }] },
  };
}

test('buckets', () => {
  const rt = [{ name: 'cites' }];
  assert.equal(nodeBucket({ kind: 'page', type: 'sources' }), 'sources');
  assert.equal(nodeBucket({ kind: 'page', type: null }), 'other');
  assert.equal(nodeBucket({ kind: 'url', type: null }), 'url');
  assert.equal(nodeBucket({ kind: 'missing', type: null }), 'missing');
  assert.equal(relationBucket('cites', rt), 'cites');
  assert.equal(relationBucket('mentions', rt), 'other');
  assert.deepEqual(['high', 'medium', 'low', null, 'certain'].map(confidenceBucket),
    ['high', 'medium', 'low', 'none', 'none']);
});

test('defaults give every node and link; neighbors match the model', () => {
  const r = run({});
  assert.deepEqual(r.nodes, allNodes);
  assert.equal(allNodes.length, 11);
  assert.deepEqual(r.links, triples(() => true));
  assert.equal(r.links.length, 13);
  assert.deepEqual(r.v.neighbors, model.neighbors);
});

test('missing showOrphans counts as true; non-positive hops as no depth', () => {
  const v = visibleSets(model, wiki, { filter: '' }, 'sources/lora-2');
  assert.deepEqual(sort(v.nodeIds), allNodes);
  for (const hops of [0, -1, undefined]) {
    assert.deepEqual(run({ hops }, 'sources/lora-2').nodes, allNodes);
  }
});

test('free text', () => {
  const lor = ['sources/lora', 'sources/lora-2', 'url:https://example.org/lora'];
  assert.deepEqual(run({ filter: 'lor' }).nodes, lor);
  assert.deepEqual(run({ filter: 'lor' }).links, among(lor));
  assert.deepEqual(run({ filter: 'LOR' }).nodes, lor);
  assert.deepEqual(run({ filter: 'deep work' }).nodes, ['sources/deep-work']);
  assert.deepEqual(run({ filter: 'work deep' }).nodes, ['sources/deep-work']);
  assert.deepEqual(run({ filter: 'focus skill' }).nodes, ['readings/deep-work/01-focus']);
  assert.deepEqual(run({ filter: 'zzzz' }).nodes, []);
});

test('type terms', () => {
  assert.deepEqual(run({ filter: 'type:sources' }).nodes, SOURCES);
  assert.deepEqual(run({ filter: 'type:sources' }).links, among(SOURCES));
  assert.equal(among(SOURCES).length, 5);
  const both = [...SOURCES, 'concepts/adapters', 'concepts/rank'];
  assert.deepEqual(run({ filter: 'type:sources type:concepts' }).nodes, sort(both));
  assert.deepEqual(run({ filter: 'type:sources type:concepts' }).links, among(both));
  assert.deepEqual(run({ filter: 'type:so' }).nodes, SOURCES);
  assert.deepEqual(run({ filter: 'TYPE:Sources' }).nodes, SOURCES);
  const none = run({ filter: 'type:zzz' });
  assert.deepEqual([none.nodes, none.links], [[], []]);
  assert.deepEqual(run({ filter: 'type:url' }).nodes, ['url:https://example.org/lora']);
  assert.deepEqual(run({ filter: 'type:missing' }).nodes, ['missing:sources/gone']);
  assert.deepEqual(run({ filter: 'type:other' }).nodes, []);
  const noPeople = allNodes.filter((id) => id !== 'people/ada-park');
  assert.deepEqual(run({ filter: '-type:people' }).nodes, noPeople);
  assert.deepEqual(run({ filter: '-type:people' }).links, among(noPeople));
  assert.equal(among(noPeople).length, 12);
});

test('an unknown key is plain text', () => {
  assert.deepEqual(run({ filter: 'foo:bar' }).nodes, []);
  const w = mini([['concepts/x', 'concepts', 'foo:bar thing'], ['concepts/y', 'concepts', 'plain'],
    ['concepts/z', 'concepts', 'Đại số']], []);
  const m = buildGraphModel(w);
  assert.deepEqual(run({ filter: 'foo:bar' }, null, w, m).nodes, ['concepts/x']);
  assert.deepEqual(run({ filter: 'dai so' }, null, w, m).nodes, ['concepts/z']);
});

test('type:other finds a page outside an entity folder', () => {
  const w = mini([['loose', null, 'Loose'], ['concepts/a', 'concepts', 'A']],
    [{ from: 'loose', to: 'concepts/a', type: 'related_to' }]);
  const m = buildGraphModel(w);
  assert.deepEqual(run({ filter: 'type:other' }, null, w, m).nodes, ['loose']);
});

test('relation terms', () => {
  const cites = triples((e) => e.type === 'cites');
  assert.equal(cites.length, 5);
  const r = run({ filter: 'rel:cites' });
  assert.deepEqual(r.nodes, allNodes);
  assert.deepEqual(r.links, cites);
  const off = run({ filter: 'rel:cites', showOrphans: false });
  assert.deepEqual(off.nodes, sort([...SOURCES, 'missing:sources/gone']));
  assert.deepEqual(off.links, cites);
  assert.deepEqual(run({ filter: '-rel:cites' }).nodes, allNodes);
  assert.deepEqual(run({ filter: '-rel:cites' }).links, triples((e) => e.type !== 'cites'));
  const other = run({ filter: 'rel:other' });
  assert.deepEqual(other.nodes, allNodes);
  assert.deepEqual(other.links, ['sources/deep-work mentions concepts/rank']);
});

test('the citation network', () => {
  const r = run({ filter: 'type:sources rel:cites', showOrphans: false });
  assert.deepEqual(r.nodes, SOURCES);
  assert.deepEqual(r.links, [
    'sources/deep-work cites sources/lora', 'sources/deep-work cites sources/lora-2',
    'sources/lora cites sources/deep-work', 'sources/lora-2 cites sources/lora',
  ]);
});

test('confidence terms', () => {
  const r = run({ filter: 'conf:high conf:medium' });
  assert.deepEqual(r.nodes, allNodes);
  assert.deepEqual(r.links, ['sources/lora similar_method_to sources/lora-2', 'sources/lora uses_concept concepts/adapters']);
  assert.deepEqual(run({ filter: 'conf:low' }).links, ['readings/deep-work/01-focus annotates sources/deep-work']);
  assert.equal(run({ filter: 'conf:none' }).links.length, 10);
  assert.deepEqual(run({ filter: '-conf:none' }).links.length, 3);
});

test('orphans off', () => {
  const linked = allNodes.filter((id) => id !== 'readings/deep-work/00-preface' && id !== 'summary/2024');
  const r = run({ showOrphans: false });
  assert.deepEqual(r.nodes, linked);
  assert.equal(r.links.length, 13);
  // A self-loop counts as a link.
  const w = mini([['concepts/a', 'concepts', 'A'], ['concepts/b', 'concepts', 'B']],
    [{ from: 'concepts/a', to: 'concepts/a', type: 'related_to' }]);
  const m = buildGraphModel(w);
  const loop = run({ showOrphans: false }, null, w, m);
  assert.deepEqual(loop.nodes, ['concepts/a']);
  assert.deepEqual(loop.links, ['concepts/a related_to concepts/a']);
  assert.equal(loop.v.neighbors.get('concepts/a').size, 0);
});

test('orphans off together with other filters', () => {
  // 01-focus has one link, annotates; with that relation hidden it has no visible link.
  const r = run({ filter: '-rel:annotates', showOrphans: false });
  assert.ok(!r.nodes.includes('readings/deep-work/01-focus'));
  assert.deepEqual(r.nodes, allNodes.filter((id) => !['readings/deep-work/01-focus', 'readings/deep-work/00-preface', 'summary/2024'].includes(id)));
  // Only concepts/rank keeps a link (its two self-loops) once sources are hidden.
  const k = run({ filter: '-type:sources', showOrphans: false });
  assert.deepEqual(k.nodes, ['concepts/rank']);
  assert.deepEqual(k.links, ['concepts/rank part_of concepts/rank', 'concepts/rank related_to concepts/rank']);
});

test('orphans off with an open page', () => {
  const linked = allNodes.filter((id) => id !== 'readings/deep-work/00-preface' && id !== 'summary/2024');
  assert.deepEqual(run({ showOrphans: false }, 'sources/lora-2').nodes, linked);
  assert.deepEqual(run({ showOrphans: false }, 'summary/2024').nodes, sort([...linked, 'summary/2024']));
});

test('depth', () => {
  const open = 'sources/lora-2';
  const d1 = walk(wiki.edges, open, 1);
  assert.deepEqual(d1, ['sources/deep-work', 'sources/lora', 'sources/lora-2']);
  const r1 = run({ hops: 1 }, open);
  assert.deepEqual(r1.nodes, d1);
  assert.deepEqual(r1.links, among(d1));
  assert.equal(r1.links.length, 5);
  for (const k of r1.v.linkKeys) {
    const l = model.links.find((x) => x.key === k);
    assert.ok(r1.v.nodeIds.has(l.source) && r1.v.nodeIds.has(l.target));
  }
  const d2 = walk(wiki.edges, open, 2);
  assert.equal(d2.length, 9); // adds rank, adapters, gone, url, ada-park, 01-focus
  assert.deepEqual(run({ hops: 2 }, open).nodes, d2);
  assert.deepEqual(run({ hops: 2 }, open).links, among(d2));
  assert.deepEqual(run({ hops: 3 }, open).nodes, walk(wiki.edges, open, 3));
  assert.deepEqual(run({ hops: 3 }, open).nodes, d2);
});

test('depth walks visible links only', () => {
  const open = 'sources/lora-2';
  const noCites = wiki.edges.filter((e) => e.type !== 'cites');
  assert.deepEqual(run({ filter: '-rel:cites', hops: 1 }, open).nodes, ['sources/lora', 'sources/lora-2']);
  const d3 = run({ filter: '-rel:cites', hops: 3 }, open);
  assert.deepEqual(d3.nodes, walk(noCites, open, 3));
  assert.ok(!d3.nodes.includes('sources/deep-work'));
  assert.ok(d3.links.every((l) => !l.includes(' cites ')));
  // The only source between ada-park and the rest is hidden, so the walk stops at once.
  const a = run({ filter: '-type:sources', hops: 3 }, 'people/ada-park');
  assert.deepEqual(a.nodes, ['people/ada-park']);
  assert.deepEqual(a.links, []);
});

test('no usable open page means no depth', () => {
  assert.deepEqual(run({ hops: 1 }, null).nodes, allNodes);
  assert.deepEqual(run({ hops: 1 }, 'index').nodes, allNodes);
  assert.deepEqual(run({ hops: 1, filter: 'type:sources' }, 'index').nodes, SOURCES);
});

test('the open page stays when its kind is filtered out', () => {
  const r = run({ filter: 'type:concepts' }, 'sources/lora');
  assert.deepEqual(r.nodes, ['concepts/adapters', 'concepts/rank', 'sources/lora']);
  assert.deepEqual(r.links, [
    'concepts/rank part_of concepts/rank', 'concepts/rank related_to concepts/rank',
    'sources/lora uses_concept concepts/adapters',
  ]);
  assert.deepEqual(run({ filter: 'zzzz' }, 'sources/lora').nodes, ['sources/lora']);
});

test('neighbors follow the visible links', () => {
  // lora-2 and deep-work are joined only by a cites link.
  const all = run({}).v.neighbors;
  assert.ok(all.get('sources/lora-2').has('sources/deep-work'));
  const v = run({ filter: '-rel:cites' }).v.neighbors;
  assert.ok(!v.get('sources/lora-2').has('sources/deep-work'));
  assert.ok(v.get('sources/lora-2').has('sources/lora'));
  assert.ok(v.get('sources/lora').has('sources/lora-2'));
  assert.deepEqual([...v.keys()].sort(), allNodes);
  for (const [id, set] of v) assert.ok(!set.has(id));
  assert.equal(v.get('summary/2024').size, 0);
});

test('vocabulary', () => {
  const v = vocabulary(model, wiki);
  assert.deepEqual(v.type, ['sources', 'concepts', 'people', 'summary', 'readings', 'url', 'missing']);
  assert.deepEqual(v.rel, ['cites', 'similar_method_to', 'uses_concept', 'authored', 'annotates',
    'related_to', 'part_of', 'see_also_url', 'other']);
  assert.deepEqual(v.conf, ['high', 'medium', 'low', 'none']);
  const w = mini([['concepts/a', 'concepts', 'A'], ['concepts/b', 'concepts', 'B']],
    [{ from: 'concepts/a', to: 'concepts/b', type: 'related_to' }]);
  assert.deepEqual(vocabulary(buildGraphModel(w), w), { type: ['concepts'], rel: ['related_to'], conf: ['none'] });
});

test('the placeholder wiki', () => {
  const m = buildGraphModel(EMPTY_WIKI);
  assert.deepEqual(vocabulary(m, EMPTY_WIKI), { type: [], rel: [], conf: [] });
  const v = visibleSets(m, EMPTY_WIKI, ALL, null);
  assert.equal(v.nodeIds.size, 0);
  assert.equal(v.linkKeys.size, 0);
  assert.equal(v.neighbors.size, 0);
});

test('slug-only and punctuation matches', () => {
  assert.deepEqual(run({ filter: '01' }).nodes, ['readings/deep-work/01-focus']);
  assert.deepEqual(run({ filter: 'lora 2' }).nodes, ['sources/lora-2']);
  assert.deepEqual(run({ filter: 'lora-2' }).nodes, ['sources/lora-2']);
  const plain = run({ filter: 'deep work' }).nodes;
  assert.ok(plain.length > 0);
  assert.deepEqual(run({ filter: 'deep-work' }).nodes, plain);
  assert.deepEqual(run({ filter: 'deep_work' }).nodes, plain);
  assert.deepEqual(run({ filter: '"deep work"' }).nodes, plain);
});

test('every word must match, not any', () => {
  assert.deepEqual(run({ filter: 'lora follow' }).nodes, ['sources/lora-2']);
});

test('exact names beat prefixes', () => {
  const w = mini([['concepts/a', 'concepts', 'A'], ['concepts/b', 'concepts', 'B'], ['concepts/c', 'concepts', 'C']], [
    { from: 'concepts/a', to: 'concepts/b', type: 'authored' },
    { from: 'concepts/b', to: 'concepts/c', type: 'authored_by' },
  ]);
  w.schema.relationTypes = [{ name: 'authored' }, { name: 'authored_by' }];
  const m = buildGraphModel(w);
  assert.deepEqual(run({ filter: 'rel:authored' }, null, w, m).links, ['concepts/a authored concepts/b']);
  assert.deepEqual(run({ filter: '-rel:authored' }, null, w, m).links, ['concepts/b authored_by concepts/c']);
  assert.deepEqual(run({ filter: 'rel:auth' }, null, w, m).links,
    ['concepts/a authored concepts/b', 'concepts/b authored_by concepts/c']);
  assert.deepEqual(run({ filter: 'type:s' }).nodes, sort([...SOURCES, 'summary/2024']));
});

test('open and matchCount', () => {
  assert.equal(run({}, 'sources/lora').v.open, 'sources/lora');
  assert.equal(run({}, null).v.open, null);
  assert.equal(run({}, 'index').v.open, null);
  const z = run({ filter: 'zzzz' }, 'sources/lora');
  assert.deepEqual(z.nodes, ['sources/lora']);
  assert.equal(z.v.matchCount, 0);
  assert.equal(run({}).v.matchCount, 11);
});

test('selectedLink follows visibility', () => {
  const cites = model.links.find((l) => l.type === 'cites');
  const hidden = run({ filter: '-rel:cites' }).v;
  const shown = run({}).v;
  assert.equal(selectedLink(model, hidden, cites.key), null);
  assert.equal(selectedLink(model, shown, cites.key), cites);
  assert.equal(selectedLink(model, shown, null), null);
  assert.equal(selectedLink(model, shown, 'nope'), null);
});

test('the reducer state drives the filter', () => {
  let s = reducer(initialState, { type: 'setFilter', value: 'type:sources' });
  assert.deepEqual(sort(visibleSets(model, wiki, s, null).nodeIds), SOURCES);
  s = reducer(initialState, { type: 'setShowOrphans', value: false });
  const gone = ['readings/deep-work/00-preface', 'summary/2024'];
  assert.deepEqual(sort(visibleSets(model, wiki, s, null).nodeIds), allNodes.filter((id) => !gone.includes(id)));
  s = reducer(initialState, { type: 'setHops', value: 1 });
  assert.deepEqual(sort(visibleSets(model, wiki, s, 'sources/lora-2').nodeIds), walk(wiki.edges, 'sources/lora-2', 1));
  assert.deepEqual(sort(visibleSets(model, wiki, initialState, null).nodeIds), allNodes);
});
