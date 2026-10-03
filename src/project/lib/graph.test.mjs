import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildGraph, loadFacts, computeDocStatus } from './graph.mjs';
import { makeFact } from './fact.mjs';

// ---------------------------------------------------------------------------
// Test helpers: hand-built parsed-doc objects following the Parse-to-graph
// contract (story 2 Design Notes). `graph.mjs` is exercised in isolation
// from `parse.mjs` here on purpose -- these are unit tests of `buildGraph`'s
// own resolution/typing/merge logic, not an integration test of the parser.
// ---------------------------------------------------------------------------

function doc(overrides = {}) {
  return {
    path: 'docs/a.md',
    hash: 'deadbeef',
    includeRoot: 'docs',
    frontmatterType: null,
    type: null,
    metaType: 'Document',
    declares: null,
    declaresLine: null,
    status: null,
    headings: [],
    facts: [],
    findings: [],
    ...overrides,
  };
}

function edgeFact({
  subject, relation, object, ref, line = 1, quote = 'evidence text', provenance = 'extracted', scope,
}) {
  return makeFact({
    kind: 'edge', subject, relation, object, ref: ref ?? object, scope, evidence: { line, quote }, provenance,
  });
}

function attrFact({ subject, relation, value, ref = 'r', line = 1, quote = 'evidence text', provenance = 'inferred' }) {
  return makeFact({ kind: 'attr', subject, relation, value, ref, evidence: { line, quote }, provenance });
}

function cfg(overrides = {}) {
  return {
    sources: { include: ['docs'], exclude: [] },
    types: {},
    relations: {},
    relatedRules: [],
    externalIds: [],
    concepts: [],
    ...overrides,
  };
}

function build({ docs, facts = new Map(), exists = () => false, config = cfg() }) {
  return buildGraph({ config, parsed: { docs }, facts, exists });
}

function findEdge(graph, from, to) {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

function findNode(graph, id) {
  return graph.nodes.find((n) => n.id === id);
}

// ---------------------------------------------------------------------------
// Node assembly
// ---------------------------------------------------------------------------

describe('buildGraph: node assembly', () => {
  test('every parsed doc becomes an in-scope doc node with the spec key order', () => {
    const a = doc({
      path: 'docs/adr/0009-x.md',
      metaType: 'Decision',
      type: 'ADR',
      status: 'partially-superseded',
      declares: 'ADR-0009',
    });
    const graph = build({ docs: [a] });
    const node = findNode(graph, 'doc:docs/adr/0009-x.md');
    assert.deepEqual(Object.keys(node), ['id', 'kind', 'metaType', 'type', 'status', 'declares', 'inScope']);
    assert.deepEqual(node, {
      id: 'doc:docs/adr/0009-x.md',
      kind: 'doc',
      metaType: 'Decision',
      type: 'ADR',
      status: 'partially-superseded',
      declares: 'ADR-0009',
      inScope: true,
    });
  });

  test('omits type, status, declares when null', () => {
    const graph = build({ docs: [doc({ path: 'docs/a.md' })] });
    const node = findNode(graph, 'doc:docs/a.md');
    assert.deepEqual(Object.keys(node), ['id', 'kind', 'metaType', 'inScope']);
  });

  test('nodes are sorted by id', () => {
    const graph = build({ docs: [doc({ path: 'docs/z.md' }), doc({ path: 'docs/a.md' })] });
    assert.deepEqual(
      graph.nodes.map((n) => n.id),
      ['doc:docs/a.md', 'doc:docs/z.md'],
    );
  });
});

// ---------------------------------------------------------------------------
// Reference resolution (AD-11)
// ---------------------------------------------------------------------------

describe('buildGraph: resolution', () => {
  test('declared ID (frontmatter id or H1) is an alias resolving to doc:<path>', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009' });
    const b = doc({
      path: 'docs/adr/0052.md',
      facts: [edgeFact({ subject: 'doc:docs/adr/0052.md', relation: 'mentions', object: 'ADR-0009' })],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/adr/0052.md', 'doc:docs/adr/0009.md');
    assert.ok(edge, 'expected an edge to the declaring doc');
    assert.equal(edge.relation, 'mentions');
  });

  test('two docs declaring the same ID: P10 on each (at its own declaresLine), id:<ID> node, resolves to neither', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009', declaresLine: 2 });
    const b = doc({ path: 'docs/adr/0009-dup.md', declares: 'ADR-0009', declaresLine: 1 });
    const c = doc({
      path: 'docs/c.md',
      facts: [edgeFact({ subject: 'doc:docs/c.md', relation: 'mentions', object: 'ADR-0009' })],
    });
    const graph = build({ docs: [a, b, c] });

    const p10 = graph.findings.filter((f) => f.id === 'P10');
    assert.equal(p10.length, 2);
    assert.deepEqual(
      p10.map((f) => [f.file, f.line]).sort(),
      [
        ['docs/adr/0009-dup.md', 1],
        ['docs/adr/0009.md', 2],
      ],
    );
    assert.equal(p10[0].severity, 'error');

    const edge = findEdge(graph, 'doc:docs/c.md', 'id:ADR-0009');
    assert.ok(edge, 'expected the mention to resolve to the id: placeholder, not either doc');
    assert.ok(findNode(graph, 'id:ADR-0009'));
  });

  test('body ID mention matching a type idPattern but undeclared: P09 + id:<ID> node', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'mentions', object: 'ADR-9999', line: 7 })],
    });
    const config = cfg({ types: { ADR: { metaType: 'Decision', idPattern: 'ADR-\\d{4}' } } });
    const graph = build({ docs: [a], config });

    const p09 = graph.findings.find((f) => f.id === 'P09');
    assert.ok(p09);
    assert.equal(p09.file, 'docs/a.md');
    assert.equal(p09.line, 7);
    assert.equal(p09.severity, 'warning');
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'id:ADR-9999'));
  });

  test('external-only ID match: no finding, resolves to id:<ID> with externalIds metaType', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'mentions', object: 'FR-17' })],
    });
    const config = cfg({ externalIds: [{ pattern: 'FR-\\d+', metaType: 'Requirement' }] });
    const graph = build({ docs: [a], config });

    assert.equal(graph.findings.length, 0);
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'id:FR-17'));
  });

  test('dangling frontmatter ref (no path, ID, or concept alias): P09, no node created', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'FR-group 17', line: 4 })],
    });
    const graph = build({ docs: [a] });

    const p09 = graph.findings.find((f) => f.id === 'P09');
    assert.ok(p09);
    assert.equal(p09.line, 4);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes.length, 1); // only the citing doc itself
  });

  test('link with a missing target: ignored, no finding (dead links are project tooling\'s job)', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'missing.md' })],
    });
    const graph = build({ docs: [a] });
    assert.equal(graph.findings.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  test('link to a URL: ignored', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'https://example.com/x' })],
    });
    const graph = build({ docs: [a] });
    assert.equal(graph.findings.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  test('link to a directory-like target: ignored', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: './adr/' })],
    });
    const graph = build({ docs: [a] });
    assert.equal(graph.findings.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  test('path resolution: doc-relative hit wins first', () => {
    const a = doc({
      path: 'docs/adr/a.md',
      facts: [edgeFact({ subject: 'doc:docs/adr/a.md', relation: 'link', object: 'b.md', ref: 'b.md' })],
    });
    const b = doc({ path: 'docs/adr/b.md' });
    const graph = build({ docs: [a, b] });
    assert.ok(findEdge(graph, 'doc:docs/adr/a.md', 'doc:docs/adr/b.md'));
  });

  test('path resolution: falls back to the citing doc\'s include root (the "data-models/x.md" pilot case)', () => {
    const a = doc({
      path: 'docs/adr/a.md',
      includeRoot: 'docs',
      facts: [edgeFact({ subject: 'doc:docs/adr/a.md', relation: 'related', object: 'data-models/x.md' })],
    });
    const target = doc({ path: 'docs/data-models/x.md', includeRoot: 'docs' });
    const graph = build({ docs: [a, target] });
    assert.ok(findEdge(graph, 'doc:docs/adr/a.md', 'doc:docs/data-models/x.md'));
  });

  test('path resolution: "other include roots" are tried in config order, not doc-path order', () => {
    // Two same-named targets under different roots; only the one whose root
    // comes first in config.sources.include should win. Alphabetically
    // 'docs' < 'zzz', so a first-appearance-by-doc-path ordering would pick
    // the 'docs' one -- this config declares 'zzz' first, so that must win.
    const citing = doc({
      path: 'mid/a.md',
      includeRoot: 'mid',
      facts: [edgeFact({ subject: 'doc:mid/a.md', relation: 'related', object: 'shared.md' })],
    });
    const zzz = doc({ path: 'zzz/shared.md', includeRoot: 'zzz' });
    const docsRoot = doc({ path: 'docs/shared.md', includeRoot: 'docs' });
    const config = cfg({ sources: { include: ['mid', 'zzz', 'docs'], exclude: [] } });
    const graph = build({ docs: [citing, zzz, docsRoot], config });
    assert.ok(findEdge(graph, 'doc:mid/a.md', 'doc:zzz/shared.md'), 'expected the config-order-first root to win');
    assert.equal(findEdge(graph, 'doc:mid/a.md', 'doc:docs/shared.md'), undefined);
  });

  test('path resolution: an existing out-of-scope file resolves to doc:<path> with inScope:false, no finding', () => {
    const a = doc({
      path: 'docs/adr/a.md',
      facts: [edgeFact({ subject: 'doc:docs/adr/a.md', relation: 'related', object: 'user-guide/faq.md' })],
    });
    const exists = (p) => p === 'docs/user-guide/faq.md';
    const graph = build({ docs: [a], exists });
    const node = findNode(graph, 'doc:docs/user-guide/faq.md');
    assert.deepEqual(node, { id: 'doc:docs/user-guide/faq.md', kind: 'doc', inScope: false });
    assert.equal(graph.findings.length, 0);
    assert.ok(findEdge(graph, 'doc:docs/adr/a.md', 'doc:docs/user-guide/faq.md'));
  });

  test('#anchor alone resolves within the citing doc', () => {
    const a = doc({
      path: 'docs/a.md',
      headings: [{ level: 2, text: 'See also', anchor: 'see-also', line: 10 }],
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: '#see-also' })],
    });
    const graph = build({ docs: [a] });
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'frag:docs/a.md#see-also'));
  });

  test('an unmatched anchor on a resolved doc falls back to the doc node (no crash, no P09)', () => {
    const a = doc({ path: 'docs/adr/a.md' });
    const b = doc({
      path: 'docs/adr/b.md',
      facts: [edgeFact({ subject: 'doc:docs/adr/b.md', relation: 'link', object: 'a.md#nope' })],
    });
    const graph = build({ docs: [a, b] });
    assert.ok(findEdge(graph, 'doc:docs/adr/b.md', 'doc:docs/adr/a.md'));
    assert.equal(graph.findings.length, 0);
  });

  test('concept mention: object is already concept:<slug> (pre-resolved by parse), passes through', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [
        edgeFact({ subject: 'doc:docs/a.md', relation: 'mentions', object: 'concept:credit-limit', ref: 'credit limit' }),
      ],
    });
    const config = cfg({ concepts: [{ name: 'credit limit' }] });
    const graph = build({ docs: [a], config });
    const edge = findEdge(graph, 'doc:docs/a.md', 'concept:credit-limit');
    assert.ok(edge);
    assert.equal(edge.relation, 'mentions');
    assert.deepEqual(findNode(graph, 'concept:credit-limit'), { id: 'concept:credit-limit', kind: 'concept' });
  });

  test('a raw ref matching a concept name/alias resolves to concept:<slug>', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'hạn mức' })],
    });
    const config = cfg({ concepts: [{ name: 'credit limit', aliases: ['hạn mức'] }] });
    const graph = build({ docs: [a], config });
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'concept:credit-limit'));
  });

  test('a root-absolute ref ("/docs/x.md") is tried at repo root only, never doc-relative', () => {
    const a = doc({
      path: 'docs/adr/a.md',
      includeRoot: 'docs',
      facts: [edgeFact({ subject: 'doc:docs/adr/a.md', relation: 'related', object: '/docs/x.md' })],
    });
    // The doc-relative candidate ("docs/adr" + "/docs/x.md" -> "docs/adr/docs/x.md") that would otherwise win if tried.
    const decoy = doc({ path: 'docs/adr/docs/x.md' });
    const target = doc({ path: 'docs/x.md' });
    const graph = build({ docs: [a, decoy, target] });
    assert.ok(findEdge(graph, 'doc:docs/adr/a.md', 'doc:docs/x.md'), 'expected the repo-root-absolute target');
    assert.equal(findEdge(graph, 'doc:docs/adr/a.md', 'doc:docs/adr/docs/x.md'), undefined, 'doc-relative must not be tried');
  });

  test('a relation naming an anchor its in-scope target lacks is dangling (P09), not widened to the doc; a body link still is', () => {
    const b = doc({ path: 'docs/b.md', headings: [{ level: 2, text: 'Status', anchor: 'status', line: 3 }] });
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'supersedes', object: 'b.md#gone', line: 2 })],
    });
    const graph = build({ docs: [a, b] });
    assert.equal(findEdge(graph, 'doc:docs/a.md', 'doc:docs/b.md'), undefined);
    assert.ok(graph.findings.some((f) => f.id === 'P09' && f.file === 'docs/a.md' && f.line === 2));

    const linkDoc = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'b.md#gone' })],
    });
    const linkGraph = build({ docs: [linkDoc, b] });
    assert.equal(findEdge(linkGraph, 'doc:docs/a.md', 'doc:docs/b.md').relation, 'references');
    assert.ok(!linkGraph.findings.some((f) => f.id === 'P09'));
  });
});

// ---------------------------------------------------------------------------
// Pre-prefixed agent references (doc:/frag:/concept:/id:) are validated, not
// trusted: an agent fact's object/subject may cite a doc, anchor, or concept
// that has since been deleted, renamed, or never existed.
// ---------------------------------------------------------------------------

describe('buildGraph: pre-prefixed agent references are validated', () => {
  function committed(docPath, fact) {
    return new Map([[docPath, {
      schemaVersion: 1, source: docPath, sourceHash: 'h', ontologyVersion: 'v', facts: [fact],
    }]]);
  }

  test('a doc: object pointing at a missing, non-existent doc is dangling (P09), no phantom node', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'doc:docs/gone.md', line: 3 });
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact) });
    assert.ok(graph.findings.some((f) => f.id === 'P09' && f.file === 'docs/a.md' && f.line === 3));
    assert.equal(findNode(graph, 'doc:docs/gone.md'), undefined);
  });

  test('a doc: object pointing at an existing out-of-scope file is still valid (inScope:false)', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'doc:docs/out-of-scope.md' });
    const exists = (p) => p === 'docs/out-of-scope.md';
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact), exists });
    assert.equal(graph.findings.filter((f) => f.id === 'P09').length, 0);
    assert.deepEqual(findNode(graph, 'doc:docs/out-of-scope.md'), { id: 'doc:docs/out-of-scope.md', kind: 'doc', inScope: false });
  });

  test('a frag: object naming an anchor that does not exist on that doc is dangling (P09), no phantom node', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'frag:docs/a.md#nope' });
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact) });
    assert.ok(graph.findings.some((f) => f.id === 'P09'));
    assert.equal(findNode(graph, 'frag:docs/a.md#nope'), undefined);
  });

  test('a concept: object naming an unconfigured concept is dangling (P09), no phantom node', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'concept:not-configured' });
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact) });
    assert.ok(graph.findings.some((f) => f.id === 'P09'));
    assert.equal(findNode(graph, 'concept:not-configured'), undefined);
  });

  test('an edge fact whose subject is a fragment not otherwise created still gets a node', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const b = doc({ path: 'docs/b.md' });
    const fact = edgeFact({ subject: 'frag:docs/a.md#row', relation: 'related', object: 'docs/b.md' });
    const graph = build({ docs: [a, b], facts: committed('docs/a.md', fact) });
    assert.ok(findNode(graph, 'frag:docs/a.md#row'), 'expected the edge subject node to exist');
    assert.ok(findEdge(graph, 'frag:docs/a.md#row', 'doc:docs/b.md'));
  });

  test('an id: object matching neither a type idPattern nor an externalIds pattern: P11, at the fact evidence line, still resolves', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({
      subject: 'doc:docs/a.md', relation: 'related', object: 'id:ZZ-1', line: 6,
    });
    const config = cfg({ types: { ADR: { metaType: 'Decision', idPattern: 'ADR-\\d{4}' } } });
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact), config });

    const p11 = graph.findings.find((f) => f.id === 'P11');
    assert.ok(p11, 'expected a P11 finding');
    assert.equal(p11.file, 'docs/a.md');
    assert.equal(p11.line, 6);
    assert.equal(p11.severity, 'warning');
    assert.ok(findNode(graph, 'id:ZZ-1'), 'the id: node still resolves despite the pattern mismatch');
    assert.equal(graph.findings.filter((f) => f.id === 'P09').length, 0, 'not also reported as dangling');
  });

  test('an id: object matching an externalIds pattern: no P11', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'id:FR-17' });
    const config = cfg({ externalIds: [{ pattern: 'FR-\\d+', metaType: 'Requirement' }] });
    const graph = build({ docs: [a], facts: committed('docs/a.md', fact), config });

    assert.equal(graph.findings.filter((f) => f.id === 'P11').length, 0);
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'id:FR-17'));
  });

  test('an already-prefixed id: object naming a duplicate declared ID: P10 only, no spurious P11', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009', declaresLine: 2 });
    const b = doc({ path: 'docs/adr/0009-dup.md', declares: 'ADR-0009', declaresLine: 1 });
    const c = doc({ path: 'docs/c.md' });
    // No type idPattern/externalIds configured -- "ADR-0009" matches nothing,
    // so without the declaredIdOwners guard this would also fire P11.
    const fact = edgeFact({ subject: 'doc:docs/c.md', relation: 'mentions', object: 'id:ADR-0009' });
    const graph = build({ docs: [a, b, c], facts: committed('docs/c.md', fact) });

    assert.equal(graph.findings.filter((f) => f.id === 'P10').length, 2);
    assert.equal(graph.findings.filter((f) => f.id === 'P11').length, 0);
    assert.ok(findEdge(graph, 'doc:docs/c.md', 'id:ADR-0009'));
  });
});

// ---------------------------------------------------------------------------
// Per-fact resolution outcome (the non-enumerable `resolution` map read by
// `project.mjs`'s `status`): 'resolved' | 'dangling' | 'ignored'.
// ---------------------------------------------------------------------------

describe('buildGraph: resolution outcome map', () => {
  function outcome(graph, docPath, fact) {
    return graph.resolution.get(`${docPath}\u0000${fact.id}`);
  }

  test('a normally-resolved reference is "resolved"', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({ path: 'docs/b.md' });
    const fact = edgeFact({ subject: 'doc:docs/b.md', relation: 'related', object: 'a.md' });
    b.facts = [fact];
    const graph = build({ docs: [a, b] });
    assert.equal(outcome(graph, 'docs/b.md', fact), 'resolved');
  });

  test('an undeclared ID-shaped reference is "dangling", even though it gets an id: placeholder edge', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'ADR-9999' });
    a.facts = [fact];
    const config = cfg({ types: { ADR: { metaType: 'Decision', idPattern: 'ADR-\\d{4}' } } });
    const graph = build({ docs: [a], config });
    assert.ok(findEdge(graph, 'doc:docs/a.md', 'id:ADR-9999'), 'still gets a placeholder edge');
    assert.equal(outcome(graph, 'docs/a.md', fact), 'dangling');
  });

  test('a self-loop is "resolved" (the reference is fine; only the edge is dropped)', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'doc:docs/a.md' });
    a.facts = [fact];
    const graph = build({ docs: [a] });
    assert.equal(graph.edges.length, 0);
    assert.equal(outcome(graph, 'docs/a.md', fact), 'resolved');
  });

  test('an ignored link target (URL) is "ignored", not dangling', () => {
    const a = doc({ path: 'docs/a.md' });
    const fact = edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'https://example.com/x' });
    a.facts = [fact];
    const graph = build({ docs: [a] });
    assert.equal(outcome(graph, 'docs/a.md', fact), 'ignored');
  });

  test('the resolution map is not enumerated by JSON.stringify', () => {
    const a = doc({ path: 'docs/a.md' });
    const graph = build({ docs: [a] });
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(graph))), ['nodes', 'edges', 'findings']);
  });
});

// ---------------------------------------------------------------------------
// Relation typing (Design Notes typing order) and inversion
// ---------------------------------------------------------------------------

describe('buildGraph: typing and inversion', () => {
  test('a raw key that is itself a meta-relation name types directly, no inversion', () => {
    const a = doc({ path: 'docs/a.md', metaType: 'Decision' });
    const b = doc({
      path: 'docs/b.md',
      metaType: 'Decision',
      facts: [edgeFact({ subject: 'doc:docs/b.md', relation: 'supersedes', object: 'a.md' })],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.relation, 'supersedes');
  });

  test('relations map with inverse: true flips edge direction', () => {
    const a = doc({ path: 'docs/a.md', metaType: 'Decision' }); // superseded doc
    const b = doc({
      path: 'docs/b.md',
      metaType: 'Decision',
      facts: [edgeFact({ subject: 'doc:docs/b.md', relation: 'superseded_by', object: 'a.md' })],
    });
    const config = cfg({ relations: { superseded_by: { relation: 'supersedes', inverse: true } } });
    const graph = build({ docs: [a, b], config });
    const edge = findEdge(graph, 'doc:docs/a.md', 'doc:docs/b.md');
    assert.ok(edge, 'expected the inverted edge: a supersedes b');
    assert.equal(edge.relation, 'supersedes');
    assert.equal(findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md'), undefined);
  });

  test('"related" typed via relatedRules by (source meta-type, target meta-type), with inversion', () => {
    const decision = doc({ path: 'docs/decision.md', metaType: 'Decision' });
    const capability = doc({
      path: 'docs/capability.md',
      metaType: 'Capability',
      facts: [edgeFact({ subject: 'doc:docs/capability.md', relation: 'related', object: 'decision.md' })],
    });
    const config = cfg({
      relatedRules: [{ source: 'Capability', target: 'Decision', relation: 'governs', inverse: true }],
    });
    const graph = build({ docs: [decision, capability], config });
    const edge = findEdge(graph, 'doc:docs/decision.md', 'doc:docs/capability.md');
    assert.ok(edge, 'expected Decision governs Capability');
    assert.equal(edge.relation, 'governs');
  });

  test('"related" with no matching relatedRules falls back to references', () => {
    const a = doc({ path: 'docs/a.md', metaType: 'Structure' });
    const b = doc({
      path: 'docs/b.md',
      metaType: 'Capability',
      facts: [edgeFact({ subject: 'doc:docs/b.md', relation: 'related', object: 'a.md' })],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.relation, 'references');
  });

  test('a relations entry for "related" overrides relatedRules', () => {
    const decision = doc({ path: 'docs/decision.md', metaType: 'Decision' });
    const capability = doc({
      path: 'docs/capability.md',
      metaType: 'Capability',
      facts: [edgeFact({ subject: 'doc:docs/capability.md', relation: 'related', object: 'decision.md' })],
    });
    const config = cfg({
      relatedRules: [{ source: 'Capability', target: 'Decision', relation: 'governs', inverse: true }],
      relations: { related: { relation: 'satisfies', inverse: false } },
    });
    const graph = build({ docs: [decision, capability], config });
    const edge = findEdge(graph, 'doc:docs/capability.md', 'doc:docs/decision.md');
    assert.ok(edge);
    assert.equal(edge.relation, 'satisfies');
  });

  test('an external ID target uses externalIds[].metaType for relatedRules matching', () => {
    const decision = doc({
      path: 'docs/decision.md',
      metaType: 'Decision',
      facts: [edgeFact({ subject: 'doc:docs/decision.md', relation: 'related', object: 'FR-42' })],
    });
    const config = cfg({
      externalIds: [{ pattern: 'FR-\\d+', metaType: 'Requirement' }],
      relatedRules: [{ source: 'Decision', target: 'Requirement', relation: 'satisfies', inverse: false }],
    });
    const graph = build({ docs: [decision], config });
    const edge = findEdge(graph, 'doc:docs/decision.md', 'id:FR-42');
    assert.ok(edge);
    assert.equal(edge.relation, 'satisfies');
  });

  test('a raw relation key named after an inherited Object.prototype member is not a relations mapping', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({ subject: 'doc:docs/b.md', relation: 'toString', object: 'a.md' })],
    });
    // No own "toString" key in config.relations -- only the inherited Object.prototype.toString.
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.ok(edge);
    assert.equal(edge.relation, 'references'); // falls through to the default, not "undefined"
  });
});

// ---------------------------------------------------------------------------
// Merge and self-loop drop
// ---------------------------------------------------------------------------

describe('buildGraph: merge', () => {
  test('two facts for the same (from, relation, to) combine evidence', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({
      path: 'docs/b.md',
      facts: [
        edgeFact({ subject: 'doc:docs/b.md', relation: 'link', object: 'a.md', line: 3, quote: 'first mention' }),
        edgeFact({ subject: 'doc:docs/b.md', relation: 'link', object: 'a.md', line: 9, quote: 'second mention' }),
      ],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.evidence.length, 2);
    assert.deepEqual(
      edge.evidence.map((e) => e.line),
      [3, 9],
    );
  });

  test('a typed edge wins over references and mentions for the same pair', () => {
    const decision = doc({ path: 'docs/decision.md', metaType: 'Decision' });
    const capability = doc({
      path: 'docs/capability.md',
      metaType: 'Capability',
      declares: 'CAP-1',
      facts: [
        // typed via relatedRules
        edgeFact({ subject: 'doc:docs/capability.md', relation: 'related', object: 'decision.md', quote: 'related quote' }),
        // a plain markdown link to the same doc -> references
        edgeFact({ subject: 'doc:docs/capability.md', relation: 'link', object: 'decision.md', quote: 'link quote' }),
      ],
    });
    const config = cfg({
      relatedRules: [{ source: 'Capability', target: 'Decision', relation: 'governs', inverse: false }],
    });
    const graph = build({ docs: [decision, capability], config });
    const edgesForPair = graph.edges.filter((e) => e.from === 'doc:docs/capability.md' && e.to === 'doc:docs/decision.md');
    assert.equal(edgesForPair.length, 1);
    assert.equal(edgesForPair[0].relation, 'governs');
  });

  test('self-loops are dropped', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'link', object: 'doc:docs/a.md' })],
    });
    const graph = build({ docs: [a] });
    assert.equal(graph.edges.length, 0);
  });

  test('a scoped fact\'s evidence carries scope', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({
        subject: 'doc:docs/b.md', relation: 'supersedes', object: 'a.md', scope: 'row: Retry policy',
      })],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.evidence.length, 1);
    assert.equal(edge.evidence[0].scope, 'row: Retry policy');
  });

  test('a scope-less fact\'s evidence has no scope key', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({ subject: 'doc:docs/b.md', relation: 'supersedes', object: 'a.md' })],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.evidence.length, 1);
    assert.equal(Object.hasOwn(edge.evidence[0], 'scope'), false);
  });

  test('two evidence entries on the same edge differing only in scope both survive (not deduped)', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({
      path: 'docs/b.md',
      facts: [
        edgeFact({
          subject: 'doc:docs/b.md', relation: 'supersedes', object: 'a.md', line: 5, quote: 'same quote', scope: 'row A',
        }),
        edgeFact({
          subject: 'doc:docs/b.md', relation: 'supersedes', object: 'a.md', line: 5, quote: 'same quote', scope: 'row B',
        }),
      ],
    });
    const graph = build({ docs: [a, b] });
    const edge = findEdge(graph, 'doc:docs/b.md', 'doc:docs/a.md');
    assert.equal(edge.evidence.length, 2);
    assert.deepEqual(edge.evidence.map((e) => e.scope).sort(), ['row A', 'row B']);
  });
});

// ---------------------------------------------------------------------------
// Findings passthrough and agent-fact findings (P18)
// ---------------------------------------------------------------------------

describe('buildGraph: findings', () => {
  test('a parsed finding without severity gets it filled from RULES', () => {
    const a = doc({
      path: 'docs/a.md',
      findings: [{ id: 'P12', file: 'docs/a.md', line: 2, message: 'unmapped doc type "kep"' }],
    });
    const graph = build({ docs: [a] });
    assert.deepEqual(graph.findings, [
      { id: 'P12', severity: 'warning', file: 'docs/a.md', line: 2, message: 'unmapped doc type "kep"' },
    ]);
  });

  test('an agent attr fact setting document-level status: P18, parsed status is unaffected', () => {
    const a = doc({ path: 'docs/a.md', status: 'accepted' });
    const facts = new Map([
      [
        'docs/a.md',
        {
          schemaVersion: 1,
          source: 'docs/a.md',
          sourceHash: 'h',
          ontologyVersion: 'v',
          facts: [attrFact({ subject: 'doc:docs/a.md', relation: 'status', value: 'superseded', line: 5 })],
        },
      ],
    ]);
    const graph = build({ docs: [a], facts });
    const p18 = graph.findings.find((f) => f.id === 'P18');
    assert.ok(p18);
    assert.equal(p18.file, 'docs/a.md');
    assert.equal(p18.line, 5);
    assert.equal(findNode(graph, 'doc:docs/a.md').status, 'accepted');
  });

  test('an agent attr fact setting a fragment\'s status is applied, no finding', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const facts = new Map([
      [
        'docs/a.md',
        {
          schemaVersion: 1,
          source: 'docs/a.md',
          sourceHash: 'h',
          ontologyVersion: 'v',
          facts: [attrFact({ subject: 'frag:docs/a.md#row', relation: 'status', value: 'superseded' })],
        },
      ],
    ]);
    const graph = build({ docs: [a], facts });
    assert.equal(graph.findings.length, 0);
    const frag = findNode(graph, 'frag:docs/a.md#row');
    assert.equal(frag.status, 'superseded');
  });

  test('a fragment cited by two envelopes\' status facts resolves by source-path order, not Map insertion order', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const envelopeFor = (source, value) => ({
      schemaVersion: 1, source, sourceHash: 'h', ontologyVersion: 'v',
      facts: [attrFact({ subject: 'frag:docs/a.md#row', relation: 'status', value })],
    });
    // Inserted with the alphabetically-LATER source first, to prove the
    // result does not depend on Map/readdir insertion order.
    const facts = new Map([
      ['docs/z-later.md', envelopeFor('docs/z-later.md', 'from-z')],
      ['docs/a-first.md', envelopeFor('docs/a-first.md', 'from-a')],
    ]);
    // Both envelopes' docs are in scope: only an in-scope doc's envelope feeds the graph.
    const graph = build({ docs: [doc({ path: 'docs/a-first.md' }), a, doc({ path: 'docs/z-later.md' })], facts });
    assert.equal(findNode(graph, 'frag:docs/a.md#row').status, 'from-a');
  });
});

// ---------------------------------------------------------------------------
// Invalid committed facts (agent-written JSON, not trusted input) are
// skipped, never crash the build.
// ---------------------------------------------------------------------------

describe('buildGraph: invalid facts are skipped', () => {
  function envelopeWithFacts(source, facts) {
    return new Map([[source, { schemaVersion: 1, source, sourceHash: 'h', ontologyVersion: 'v', facts }]]);
  }

  test('a null fact entry is skipped, not a crash', () => {
    const a = doc({ path: 'docs/a.md' });
    const graph = build({ docs: [a], facts: envelopeWithFacts('docs/a.md', [null]) });
    assert.equal(graph.edges.length, 0);
  });

  test('a fact missing evidence is skipped, not a crash', () => {
    const a = doc({ path: 'docs/a.md' });
    const bad = { id: 'x', kind: 'edge', subject: 'doc:docs/a.md', relation: 'related', object: 'docs/b.md', provenance: 'inferred' };
    const graph = build({ docs: [a], facts: envelopeWithFacts('docs/a.md', [bad]) });
    assert.equal(graph.edges.length, 0);
  });

  test('a fact with a non-string object is skipped, not a crash', () => {
    const a = doc({ path: 'docs/a.md' });
    const bad = {
      id: 'x', kind: 'edge', subject: 'doc:docs/a.md', relation: 'related', object: 42,
      evidence: { line: 1, quote: 'q' }, provenance: 'inferred',
    };
    const graph = build({ docs: [a], facts: envelopeWithFacts('docs/a.md', [bad]) });
    assert.equal(graph.edges.length, 0);
  });

  test('a malformed attr fact is skipped, not a crash', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const bad = { id: 'x', kind: 'attr', subject: 'frag:docs/a.md#row', relation: 'status', provenance: 'inferred' }; // no evidence
    const graph = build({ docs: [a], facts: envelopeWithFacts('docs/a.md', [bad]) });
    assert.equal(findNode(graph, 'frag:docs/a.md#row'), undefined);
  });

  test('a frag: subject whose anchor is gone mints no phantom node or edge (edge and attr facts)', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({ path: 'docs/b.md' });
    const facts = envelopeWithFacts('docs/a.md', [
      edgeFact({ subject: 'frag:docs/a.md#gone', relation: 'related', object: 'doc:docs/b.md' }),
      attrFact({ subject: 'frag:docs/a.md#gone', relation: 'status', value: 'accepted' }),
    ]);
    const graph = build({ docs: [a, b], facts });
    assert.equal(findNode(graph, 'frag:docs/a.md#gone'), undefined);
    assert.equal(graph.edges.length, 0);
  });

  test('a non-string status value is not applied to a fragment', () => {
    const a = doc({ path: 'docs/a.md', headings: [{ level: 2, text: 'Row', anchor: 'row', line: 4 }] });
    const facts = envelopeWithFacts('docs/a.md', [attrFact({ subject: 'frag:docs/a.md#row', relation: 'status', value: { x: 1 } })]);
    const graph = build({ docs: [a], facts });
    assert.equal(findNode(graph, 'frag:docs/a.md#row'), undefined);
  });
});

describe('buildGraph: only an in-scope doc\'s envelope feeds the graph', () => {
  test('an envelope for a deleted/out-of-scope doc adds no node or edge', () => {
    const a = doc({ path: 'docs/a.md' });
    const facts = new Map([['docs/gone.md', {
      schemaVersion: 1, source: 'docs/gone.md', sourceHash: 'h', ontologyVersion: 'v',
      facts: [edgeFact({ subject: 'doc:docs/gone.md', relation: 'depends-on', object: 'id:ADR-9999' })],
    }]]);
    const graph = build({ docs: [a], facts });
    assert.deepEqual(graph.nodes.map((n) => n.id), ['doc:docs/a.md']);
    assert.equal(graph.edges.length, 0);
  });

  test('a case-only-renamed key still feeds its doc (case-insensitive match)', () => {
    const a = doc({ path: 'docs/adr.md' });
    const b = doc({ path: 'docs/b.md' });
    const facts = new Map([['docs/ADR.md', {
      schemaVersion: 1, source: 'docs/adr.md', sourceHash: 'h', ontologyVersion: 'v',
      facts: [edgeFact({ subject: 'doc:docs/adr.md', relation: 'related', object: 'doc:docs/b.md' })],
    }]]);
    const graph = build({ docs: [a, b], facts });
    assert.ok(findEdge(graph, 'doc:docs/adr.md', 'doc:docs/b.md'));
  });
});

describe('buildGraph: only an envelope matching CURRENT_SCHEMA_VERSION feeds the graph', () => {
  test('an envelope written by a newer engine contributes no edges', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({ path: 'docs/b.md' });
    const facts = new Map([['docs/a.md', {
      schemaVersion: 2, source: 'docs/a.md', sourceHash: 'h', ontologyVersion: 'v',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'doc:docs/b.md' })],
    }]]);
    const graph = build({ docs: [a, b], facts });
    assert.equal(graph.edges.length, 0);
  });

  test('an envelope with no schemaVersion at all contributes no edges', () => {
    const a = doc({ path: 'docs/a.md' });
    const b = doc({ path: 'docs/b.md' });
    const facts = new Map([['docs/a.md', {
      source: 'docs/a.md', sourceHash: 'h', ontologyVersion: 'v',
      facts: [edgeFact({ subject: 'doc:docs/a.md', relation: 'related', object: 'doc:docs/b.md' })],
    }]]);
    const graph = build({ docs: [a, b], facts });
    assert.equal(graph.edges.length, 0);
  });
});

// ---------------------------------------------------------------------------
// loadFacts
// ---------------------------------------------------------------------------

describe('loadFacts', () => {
  test('returns an empty map when _lumina/facts does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-graph-facts-'));
    try {
      const facts = await loadFacts(dir);
      assert.equal(facts.size, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reads a valid envelope keyed by its repo-relative source path, and flags a malformed one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-graph-facts-'));
    try {
      const factsDir = join(dir, '_lumina', 'facts', 'docs', 'adr');
      await mkdir(factsDir, { recursive: true });
      const envelope = { schemaVersion: 1, source: 'docs/adr/0009.md', sourceHash: 'h', ontologyVersion: 'v', facts: [] };
      await writeFile(join(factsDir, '0009.md.json'), JSON.stringify(envelope));
      await writeFile(join(factsDir, 'broken.md.json'), '{ not json');

      const facts = await loadFacts(dir);
      assert.equal(facts.size, 2);
      assert.deepEqual(facts.get('docs/adr/0009.md'), envelope);
      assert.ok(facts.get('docs/adr/broken.md').error);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an unreadable nested facts directory throws (EACCES), not treated as empty', async (t) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      t.skip('chmod 000 does not deny reads here (Windows, or running as root)');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'lumina-graph-facts-'));
    const locked = join(dir, '_lumina', 'facts', 'locked');
    try {
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);
      await assert.rejects(loadFacts(dir), (e) => {
        assert.match(e.code ?? '', /EACCES|EPERM/);
        return true;
      });
    } finally {
      await chmod(locked, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// computeDocStatus
// ---------------------------------------------------------------------------

// A fact `buildGraph` would keep, so only the check under test decides the state.
function validFact(quote) {
  return {
    kind: 'edge', subject: 'doc:docs/a.md', relation: 'cites', object: 'doc:docs/b.md', provenance: 'extracted', evidence: { line: 1, quote },
  };
}

describe('computeDocStatus', () => {
  test('never-ingested when there is no fact file', () => {
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope: undefined, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true }),
      'never-ingested',
    );
  });

  test('fresh when the hash matches and every fact still checks out', () => {
    const envelope = {
      sourceHash: 'h1',
      ontologyVersion: 'v1',
      facts: [validFact('quoted text')],
    };
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 'quoted text here', refResolves: () => true }),
      'fresh',
    );
  });

  test('changed when the hash differs but every fact still checks out', () => {
    const envelope = { sourceHash: 'h1', ontologyVersion: 'v1', facts: [validFact('quoted text')] };
    assert.equal(
      computeDocStatus({ hash: 'h2', envelope, ontologyVersion: 'v1', sourceText: 'quoted text here', refResolves: () => true }),
      'changed',
    );
  });

  test('stale when a fact\'s quote is gone', () => {
    const envelope = { sourceHash: 'h1', ontologyVersion: 'v1', facts: [validFact('gone now')] };
    assert.equal(
      computeDocStatus({ hash: 'h2', envelope, ontologyVersion: 'v1', sourceText: 'totally different text', refResolves: () => true }),
      'stale',
    );
  });

  test('stale when a fact\'s ref no longer resolves', () => {
    const envelope = { sourceHash: 'h1', ontologyVersion: 'v1', facts: [validFact('quoted text')] };
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 'quoted text here', refResolves: () => false }),
      'stale',
    );
  });

  test('stale when a fact is malformed, even with a matching hash and quote', () => {
    const envelope = { sourceHash: 'h1', ontologyVersion: 'v1', facts: [{ ...validFact('quoted text'), kind: 'bogus' }] };
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 'quoted text here', refResolves: () => true }),
      'stale',
    );
  });

  test('stale when ontologyVersion differs, even with a matching hash', () => {
    const envelope = { sourceHash: 'h1', ontologyVersion: 'v-old', facts: [] };
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope, ontologyVersion: 'v-new', sourceText: 't', refResolves: () => true }),
      'stale',
    );
  });

  test('stale for a malformed (unreadable) fact file', () => {
    const envelope = { error: 'Unexpected token' };
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true }),
      'stale',
    );
  });

  test('stale when the fact file\'s JSON parsed to a bare null', () => {
    assert.equal(
      computeDocStatus({ hash: 'h1', envelope: null, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true }),
      'stale',
    );
  });

  test('stale when the envelope schemaVersion is newer than the engine understands', () => {
    // Otherwise fresh (source, ontologyVersion, hash all match): only the schema check makes it stale.
    const envelope = { schemaVersion: 2, source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', schemaVersion: 1, sourceText: 't', refResolves: () => true,
      }),
      'stale',
    );
  });

  test('an envelope schemaVersion matching the engine\'s exactly is fine', () => {
    const envelope = { schemaVersion: 1, source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', schemaVersion: 1, sourceText: 't', refResolves: () => true,
      }),
      'fresh',
    );
  });

  test('stale when the envelope schemaVersion is missing (verify-evidence would call it malformed)', () => {
    const envelope = { source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', schemaVersion: 1, sourceText: 't', refResolves: () => true,
      }),
      'stale',
    );
  });

  test('stale when the envelope schemaVersion is older than the engine\'s (verify-evidence would call it malformed)', () => {
    const envelope = { schemaVersion: 0, source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', schemaVersion: 1, sourceText: 't', refResolves: () => true,
      }),
      'stale',
    );
  });

  test('schemaVersion check is skipped entirely when the param is omitted', () => {
    const envelope = { source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true,
      }),
      'fresh',
    );
  });

  test('stale when the envelope\'s source differs from the doc\'s current path', () => {
    const envelope = { source: 'docs/renamed-from.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true,
      }),
      'stale',
    );
  });

  test('a matching source is fine', () => {
    const envelope = { source: 'docs/a.md', sourceHash: 'h1', ontologyVersion: 'v1', facts: [] };
    assert.equal(
      computeDocStatus({
        path: 'docs/a.md', hash: 'h1', envelope, ontologyVersion: 'v1', sourceText: 't', refResolves: () => true,
      }),
      'fresh',
    );
  });
});

test('merge moves evidence of a dropped references edge onto the kept typed edge', () => {
  const docA = { path: 'docs/a.md', includeRoot: 'docs', type: null, metaType: 'Document', declares: null, declaresLine: null, status: null, headings: [], findings: [],
    facts: [
      { id: '1', kind: 'edge', subject: 'doc:docs/a.md', relation: 'supersedes', object: 'b.md', ref: 'b.md', evidence: { line: 2, quote: 'supersedes: b.md' }, provenance: 'extracted' },
      { id: '2', kind: 'edge', subject: 'doc:docs/a.md', relation: 'link', object: 'b.md', ref: 'b.md', evidence: { line: 9, quote: '[b](b.md)' }, provenance: 'extracted' },
    ] };
  const docB = { path: 'docs/b.md', includeRoot: 'docs', type: null, metaType: 'Document', declares: null, declaresLine: null, status: null, headings: [], facts: [], findings: [] };
  const g = buildGraph({ config: { sources: { include: ['docs'] }, types: {}, relations: {}, relatedRules: [], externalIds: [], concepts: [] }, parsed: { docs: [docA, docB] }, facts: new Map(), exists: () => false });
  const edges = g.edges.filter((e) => e.from === 'doc:docs/a.md' && e.to === 'doc:docs/b.md');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].relation, 'supersedes');
  assert.deepEqual(edges[0].evidence.map((e) => e.line), [2, 9]);
});
