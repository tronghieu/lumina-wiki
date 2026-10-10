import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TYPE_PALETTE, NEUTRAL, typeColor, buildGraphModel, nodeTooltip, edgeCaption,
  nodeLabelHtml, linkLabelHtml, legendOf, EMPTY_WIKI,
} from './graph-model.mjs';
import { STRINGS, severityName } from './strings.mjs';

const wiki = JSON.parse(readFileSync(
  new URL('../../test-fixtures/contract/expected/wiki.json', import.meta.url), 'utf8'));
const model = buildGraphModel(wiki);
const byId = new Map(model.nodes.map((n) => [n.id, n]));
const bend = (l) => l.curvature * (l.source < l.target ? 1 : -1);
const between = (a, b) => model.links.filter((l) =>
  (l.source === a && l.target === b) || (l.source === b && l.target === a));

test('node set follows the keep rule', () => {
  const touched = new Set(wiki.edges.flatMap((e) => [e.from, e.to]));
  const expected = wiki.nodes
    .filter((n) => touched.has(n.id) || (n.kind === 'page' && n.type !== null))
    .map((n) => n.id);
  assert.deepEqual(model.nodes.map((n) => n.id), expected);
  for (const id of ['index', 'readings/deep-work/00-preface']) {
    assert.equal(byId.has(id), touched.has(id) || wiki.nodes.find((n) => n.id === id).type !== null);
  }
  assert.ok(!byId.has('index') && !byId.has('log'));
  assert.ok(byId.has('readings/deep-work/00-preface') && byId.has('summary/2024'));
  assert.equal(byId.get('missing:sources/gone').color, NEUTRAL);
  assert.equal(byId.get('url:https://example.org/lora').color, NEUTRAL);
});

test('links reference model nodes and have unique keys', () => {
  assert.equal(model.links.length, wiki.edges.length);
  for (const l of model.links) {
    assert.ok(byId.has(l.source) && byId.has(l.target));
  }
  assert.equal(new Set(model.links.map((l) => l.key)).size, model.links.length);
});

test('degree and neighbors', () => {
  const id = 'sources/lora';
  const touching = wiki.edges.filter((e) => e.from === id || e.to === id);
  const nbrs = new Set(touching.map((e) => (e.from === id ? e.to : e.from)));
  assert.equal(model.degree.get(id), touching.length);
  assert.deepEqual(model.neighbors.get(id), nbrs);
  assert.ok(!model.neighbors.get('concepts/rank').has('concepts/rank'));
  assert.equal(model.degree.get('concepts/rank'),
    wiki.edges.filter((e) => e.from === 'concepts/rank' || e.to === 'concepts/rank').length);
  for (const n of model.nodes) assert.ok(model.neighbors.has(n.id));
});

test('curvature separates parallel links and loops', () => {
  for (const [a, b] of [['sources/lora', 'sources/lora-2'], ['sources/lora', 'sources/deep-work']]) {
    const g = between(a, b);
    assert.equal(g.length, 2);
    assert.ok(g.every((l) => l.curvature !== 0));
    assert.notEqual(bend(g[0]) + 0, bend(g[1]) + 0);
  }
  const loops = model.links.filter((l) => l.source === 'concepts/rank' && l.target === 'concepts/rank');
  assert.equal(loops.length, 2);
  assert.notEqual(loops[0].curvature, loops[1].curvature);
  assert.ok(loops.every((l) => l.curvature !== 0));
  const lone = model.links.find((l) => l.type === 'authored');
  assert.equal(lone.curvature, 0);
});

test('link and node attributes on the fixture', () => {
  const sim = between('sources/lora', 'sources/lora-2').find((l) => l.type === 'similar_method_to');
  assert.equal(sim.directed, false);
  assert.equal(sim.confidence, 'high');
  for (const l of model.links) assert.equal(l.citation, l.type === 'cites');
  assert.equal(model.links.find((l) => l.type === 'uses_concept').confidence, 'medium');
  for (const n of model.nodes) assert.equal(n.val, 1 + Math.sqrt(model.degree.get(n.id) ?? 0));
});

test('colors', () => {
  const types = wiki.schema.entityTypes;
  for (const n of model.nodes.filter((x) => x.kind === 'page')) {
    const i = types.findIndex((t) => t.name === n.type);
    assert.equal(n.color, i < 0 ? NEUTRAL : TYPE_PALETTE[i % TYPE_PALETTE.length]);
  }
  assert.notEqual(byId.get('sources/lora').color, byId.get('concepts/rank').color);
  const many = Array.from({ length: TYPE_PALETTE.length + 1 }, (_, k) => ({ name: `t${k}` }));
  assert.equal(typeColor(`t${TYPE_PALETTE.length}`, many), TYPE_PALETTE[0]);
  assert.equal(typeColor('nope', types), NEUTRAL);
  assert.equal(typeColor(null, types), NEUTRAL);
  const untyped = model.nodes.find((n) => n.kind === 'page' && n.type === null);
  if (untyped) assert.equal(untyped.color, NEUTRAL);
});

test('unknown relation type is directed', () => {
  assert.ok(!wiki.schema.relationTypes.some((r) => r.name === 'mentions'));
  const l = model.links.find((x) => x.type === 'mentions');
  assert.equal(l.directed, true);
});

test('nodeTooltip', () => {
  assert.equal(nodeTooltip(byId.get('sources/lora')), 'LoRA (sources)');
  assert.equal(nodeTooltip({ kind: 'page', type: null, title: 'index' }), 'index');
  assert.equal(nodeTooltip(byId.get('missing:sources/gone')), `sources/gone (${STRINGS.missingSuffix})`);
  const u = byId.get('url:https://example.org/lora');
  assert.equal(nodeTooltip(u), `${u.title} (${STRINGS.externalSuffix})`);
});

test('edgeCaption', () => {
  const t = (id) => id.toUpperCase();
  assert.equal(edgeCaption({ source: 'a', target: 'b', type: 'cites', directed: true, confidence: null }, t),
    'A -> cites -> B');
  assert.equal(edgeCaption({ source: 'a', target: 'b', type: 'r', directed: false, confidence: 'high' }, t),
    `A -- r -- B (${STRINGS.confidenceLabel}: high)`);
});

test('hand-made cases', () => {
  const mk = (id) => ({ id, kind: 'page', type: 't', title: id, community: 0 });
  const schema = { entityTypes: [{ name: 't' }], relationTypes: [] };
  const e = (from, to, type) => ({ from, to, type, directed: true, confidence: null });
  const m = buildGraphModel({
    schema, communities: [], nodes: [mk('a'), mk('b')],
    edges: [e('a', 'b', 'x'), e('b', 'a', 'y'), e('a', 'b', 'z'), e('a', 'ghost', 'x')],
  });
  assert.equal(m.links.length, 3);
  assert.equal(new Set(m.links.map(bend)).size, 3);
  const empty = buildGraphModel({ schema, nodes: [], edges: [], communities: [] });
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.links, []);
  assert.equal(empty.degree.size, 0);
  assert.equal(empty.neighbors.size, 0);
});

const hand = (nodes, edges) => buildGraphModel({
  schema: { entityTypes: [{ name: 't' }], relationTypes: [] }, communities: [], nodes, edges,
});
const pg = (id, type) => ({ id, kind: 'page', type, title: id, community: 0 });
const ed = (from, to) => ({ from, to, type: 'x', directed: true, confidence: null });

test('keep rule on hand-made wikis', () => {
  const m = hand([pg('index', null), pg('a', 't')], [ed('index', 'a')]);
  const idx = m.nodes.find((n) => n.id === 'index');
  assert.ok(idx);
  assert.equal(idx.color, NEUTRAL);
  const ids = new Set(m.nodes.map((n) => n.id));
  for (const l of m.links) assert.ok(ids.has(l.source) && ids.has(l.target));
});

test('legendOf', () => {
  const types = wiki.schema.entityTypes;
  const legend = legendOf(model, types);
  assert.deepEqual(legend.map((x) => x.label), [
    'sources', 'concepts', 'people', 'summary', 'readings', STRINGS.legendUrl, STRINGS.legendMissing,
  ]);
  for (const x of legend.slice(0, 5)) assert.equal(x.color, typeColor(x.label, types));
  assert.deepEqual(legend.slice(5).map((x) => x.variant), ['hollow', 'missing']);
  const m = hand([pg('index', null), pg('a', 't'), { id: 'url:u', kind: 'url', type: null, title: 'u', community: 0 }],
    [ed('index', 'a'), ed('a', 'url:u')]);
  assert.deepEqual(legendOf(m, [{ name: 't' }]).map((x) => x.key), ['type:t', 'other', 'url']);
  assert.deepEqual(legendOf(hand([], []), [{ name: 't' }]), []);
});

test('html labels are escaped', () => {
  const html = nodeLabelHtml({ kind: 'page', type: null, title: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  const l = linkLabelHtml({ type: '<b>x</b>', confidence: '"><script>' });
  assert.ok(!l.includes('<b>') && !l.includes('<script'));
  assert.equal(linkLabelHtml({ type: '<b>', confidence: null }), '&lt;b&gt;');
});

test('the placeholder wiki builds an empty model and an empty legend', () => {
  const m = buildGraphModel(EMPTY_WIKI);
  assert.deepEqual([m.nodes, m.links], [[], []]);
  assert.equal(m.neighbors.size, 0);
  assert.equal(m.degree.size, 0);
  assert.deepEqual(legendOf(m, EMPTY_WIKI.schema.entityTypes), []);
});

test('severityName maps the three severities and passes anything else through as text', () => {
  assert.equal(severityName('error'), 'error');
  assert.equal(severityName('warning'), 'warning');
  assert.equal(severityName('info'), 'note');
  assert.equal(severityName('constructor'), 'constructor');
  assert.equal(severityName(undefined), 'undefined');
});
