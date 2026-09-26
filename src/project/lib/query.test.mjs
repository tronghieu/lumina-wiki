import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph, makeResolverContext, resolveFactRef } from './graph.mjs';
import { makeFact } from './fact.mjs';
import {
  queryNode, queryList, queryNeighbors, atFor, buildCtx,
} from './query.mjs';

// ---------------------------------------------------------------------------
// Same hand-built parsed-doc helpers as graph.test.mjs (story 2): these are
// unit tests of query.mjs's own logic, not an integration test of the parser.
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

/** Builds the graph plus the same `resolve()` closure `project.mjs` binds for `facts-write`/`query`. */
function setup({
  docs, facts = new Map(), exists = () => false, config = cfg(), texts = new Map(),
}) {
  const parsed = { docs, texts };
  const graph = buildGraph({ config, parsed, facts, exists });
  const resolverCtx = makeResolverContext({ config, parsed, exists });
  const resolve = (raw, citingDoc) => resolveFactRef(raw, citingDoc, resolverCtx);
  return { graph, parsed, resolve };
}

// ---------------------------------------------------------------------------
// queryNode: I/O matrix rows "Node by ID", "Concept", "Path", "Unknown ref",
// plus one test per `at` location kind (doc/frag/id -- concept covered by
// the "Concept" row itself).
// ---------------------------------------------------------------------------

describe('queryNode', () => {
  test('Node by ID: a declared ID resolves to its doc; node.at quotes the declared-ID line; in[]/out[] carry {relation, from|to, evidence}', () => {
    const a = doc({
      path: 'docs/adr/0009.md', metaType: 'Decision', status: 'accepted', declares: 'ADR-0009', declaresLine: 2,
    });
    const b = doc({
      path: 'docs/adr/0052.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0052.md', relation: 'mentions', object: 'ADR-0009', line: 5, quote: 'ADR-0009',
      })],
    });
    const texts = new Map([
      ['docs/adr/0009.md', 'line one\nid: ADR-0009\nline three'],
      ['docs/adr/0052.md', 'a\nb\nc\nd\nADR-0009 mentioned here'],
    ]);
    const { graph, parsed, resolve } = setup({ docs: [a, b], texts });

    const result = queryNode('ADR-0009', { graph, parsed, resolve });
    assert.ok(result);
    assert.deepEqual(result.node, {
      id: 'doc:docs/adr/0009.md',
      metaType: 'Decision',
      status: 'accepted',
      frags: [],
      at: { file: 'docs/adr/0009.md', line: 2, quote: 'id: ADR-0009' },
    });
    assert.deepEqual(result.out, []);
    assert.deepEqual(result.in, [{
      relation: 'mentions',
      from: 'doc:docs/adr/0052.md',
      evidence: [{ file: 'docs/adr/0052.md', line: 5, quote: 'ADR-0009' }],
    }]);
  });

  test('Concept: an alias resolves to the concept node; in[] holds every mentions edge, each with file:line', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({
        subject: 'doc:docs/a.md', relation: 'mentions', object: 'concept:credit-limit', ref: 'credit limit', line: 3, quote: 'credit limit',
      })],
    });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({
        subject: 'doc:docs/b.md', relation: 'mentions', object: 'concept:credit-limit', ref: 'hạn mức', line: 7, quote: 'hạn mức',
      })],
    });
    const config = cfg({ concepts: [{ name: 'credit limit', aliases: ['hạn mức'] }] });
    const { graph, parsed, resolve } = setup({ docs: [a, b], config });

    const result = queryNode('hạn mức', { graph, parsed, resolve });
    assert.ok(result);
    assert.equal(result.node.id, 'concept:credit-limit');
    assert.equal(result.node.metaType, 'Concept');
    assert.deepEqual(result.in.map((e) => e.from).sort(), ['doc:docs/a.md', 'doc:docs/b.md']);
    // "at" for a concept: the first sorted evidence of an edge into it.
    assert.deepEqual(result.node.at, { file: 'docs/a.md', line: 3, quote: 'credit limit' });
  });

  test('Path: a bare repo-relative path resolves to its doc: node; a doc with no declared ID gets at = {file, line:1, quote:<first line>}', () => {
    const a = doc({ path: 'docs/adr/0052-new.md', metaType: 'Decision' });
    const texts = new Map([['docs/adr/0052-new.md', '# ADR-0052: New Decision\nsecond line']]);
    const { graph, parsed, resolve } = setup({ docs: [a], texts });
    const result = queryNode('docs/adr/0052-new.md', { graph, parsed, resolve });
    assert.equal(result.node.id, 'doc:docs/adr/0052-new.md');
    assert.deepEqual(result.node.at, { file: 'docs/adr/0052-new.md', line: 1, quote: '# ADR-0052: New Decision' });
  });

  test('Unknown ref: nothing resolves -> null', () => {
    const a = doc({ path: 'docs/a.md' });
    const { graph, parsed, resolve } = setup({ docs: [a] });
    assert.equal(queryNode('NOPE-1', { graph, parsed, resolve }), null);
  });

  test('at (doc:): a leading UTF-8 BOM is stripped from the quoted line', () => {
    const a = doc({
      path: 'docs/a.md', declares: 'X-1', declaresLine: 1,
    });
    const texts = new Map([['docs/a.md', '﻿id: X-1\nbody']]);
    const { graph, parsed, resolve } = setup({ docs: [a], texts });
    const result = queryNode('X-1', { graph, parsed, resolve });
    assert.deepEqual(result.node.at, { file: 'docs/a.md', line: 1, quote: 'id: X-1' });
  });

  test('an undeclared type-shaped ID (dangling placeholder) resolves the same as its id: node id', () => {
    const a = doc({
      path: 'docs/conventions/c002.md',
      facts: [edgeFact({
        subject: 'doc:docs/conventions/c002.md', relation: 'mentions', object: 'C005', line: 4, quote: 'C005',
      })],
    });
    const config = cfg({ types: { Convention: { metaType: 'Rule', idPattern: 'C\\d{3}' } } });
    const { graph, parsed, resolve } = setup({ docs: [a], config });

    const byBareId = queryNode('C005', { graph, parsed, resolve });
    const byPrefixed = queryNode('id:C005', { graph, parsed, resolve });
    assert.ok(byBareId);
    assert.equal(byBareId.node.id, 'id:C005');
    assert.deepEqual(byBareId, byPrefixed);
  });

  test('a ref with "#" whose anchor does not exist is not found, not the whole doc', () => {
    const a = doc({
      path: 'docs/adr/0052-new.md',
      metaType: 'Decision',
      headings: [{
        level: 2, text: 'Status', anchor: 'status', line: 8,
      }],
    });
    const { graph, parsed, resolve } = setup({ docs: [a] });
    assert.equal(queryNode('docs/adr/0052-new.md#nope', { graph, parsed, resolve }), null);
  });

  test('at (frag:): the heading line and heading text', () => {
    const a = doc({
      path: 'docs/adr/0052.md',
      headings: [{
        level: 2, text: 'Status', anchor: 'status', line: 8,
      }],
    });
    const b = doc({
      path: 'docs/adr/0009.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0009.md', relation: 'link', object: '0052.md#status', line: 4, quote: '[x](0052.md#status)',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const result = queryNode('docs/adr/0052.md#status', { graph, parsed, resolve });
    assert.equal(result.node.id, 'frag:docs/adr/0052.md#status');
    assert.deepEqual(result.node.at, { file: 'docs/adr/0052.md', line: 8, quote: 'Status' });
  });

  test('at (id:): the first sorted evidence of an edge into it', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({
        subject: 'doc:docs/a.md', relation: 'mentions', object: 'FR-99', line: 9, quote: 'FR-99 zzz',
      })],
    });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({
        subject: 'doc:docs/b.md', relation: 'mentions', object: 'FR-99', line: 2, quote: 'FR-99 aaa',
      })],
    });
    const config = cfg({ externalIds: [{ pattern: 'FR-\\d+', metaType: 'Requirement' }] });
    const { graph, parsed, resolve } = setup({ docs: [a, b], config });
    const result = queryNode('FR-99', { graph, parsed, resolve });
    assert.equal(result.node.id, 'id:FR-99');
    assert.equal(result.node.metaType, 'Requirement');
    assert.deepEqual(result.node.at, { file: 'docs/a.md', line: 9, quote: 'FR-99 zzz' }); // 'docs/a.md' < 'docs/b.md'
  });

  test('at (id:): an outgoing-only node (inverse relation, e.g. superseded_by) falls back to outgoing evidence', () => {
    const a = doc({
      path: 'docs/adr/9998.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/9998.md', relation: 'superseded_by', object: 'ADR-9998', line: 5, quote: 'superseded_by: ADR-9998',
      })],
    });
    const config = cfg({
      relations: { superseded_by: { relation: 'supersedes', inverse: true } },
      externalIds: [{ pattern: 'ADR-\\d{4}', metaType: 'Decision' }],
    });
    const { graph, parsed, resolve } = setup({ docs: [a], config });
    const result = queryNode('id:ADR-9998', { graph, parsed, resolve });
    assert.ok(result);
    assert.equal(result.in.length, 0);
    assert.equal(result.out.length, 1);
    assert.deepEqual(result.node.at, { file: 'docs/adr/9998.md', line: 5, quote: 'superseded_by: ADR-9998' });
  });

  test('a doc node lists its own frag: children in `frags`, sorted; a non-doc node has no `frags`', () => {
    const a = doc({
      path: 'docs/adr/0052.md',
      headings: [{
        level: 2, text: 'Status', anchor: 'status', line: 8,
      }],
    });
    const b = doc({
      path: 'docs/adr/0009.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0009.md', relation: 'link', object: '0052.md#status', line: 4, quote: '[x](0052.md#status)',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const docResult = queryNode('docs/adr/0052.md', { graph, parsed, resolve });
    assert.deepEqual(docResult.node.frags, ['frag:docs/adr/0052.md#status']);
    const fragResult = queryNode('docs/adr/0052.md#status', { graph, parsed, resolve });
    assert.ok(!Object.hasOwn(fragResult.node, 'frags'));
  });

  test('`frags` lists every parsed heading, including one nothing links to (so it has no graph node)', () => {
    const a = doc({
      path: 'docs/adr/0009.md',
      headings: [
        { level: 2, text: 'Status', anchor: 'status', line: 8 },
        { level: 2, text: 'Context', anchor: 'context', line: 12 },
      ],
    });
    const { graph, parsed, resolve } = setup({ docs: [a] });
    assert.ok(!graph.nodes.some((n) => n.kind === 'frag'));
    const result = queryNode('docs/adr/0009.md', { graph, parsed, resolve });
    assert.deepEqual(result.node.frags, ['frag:docs/adr/0009.md#context', 'frag:docs/adr/0009.md#status']);
  });

  test('a frag: id with no "#" keeps its whole path in `at.file`', () => {
    const { graph, parsed, resolve } = setup({ docs: [doc({ path: 'docs/a.md' })] });
    const ctx = buildCtx({ graph, parsed, resolve });
    assert.deepEqual(atFor({ id: 'frag:docs/a.md', kind: 'frag' }, ctx), { file: 'docs/a.md', line: 1, quote: '' });
  });

  test('evidence keeps a non-empty `scope`, dropped when absent', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009' });
    const b = doc({
      path: 'docs/adr/0052.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0052.md', relation: 'supersedes', object: 'ADR-0009', line: 3, quote: 'x', scope: 'the AP clause',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const result = queryNode('ADR-0009', { graph, parsed, resolve });
    assert.deepEqual(result.in[0].evidence, [{
      file: 'docs/adr/0052.md', line: 3, quote: 'x', scope: 'the AP clause',
    }]);
  });

  test('in[] is ordered by (relation, from), not merely by from', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009' });
    const b = doc({
      path: 'docs/b.md',
      facts: [edgeFact({
        subject: 'doc:docs/b.md', relation: 'mentions', object: 'ADR-0009', line: 1, quote: 'x',
      })],
    });
    const c = doc({
      path: 'docs/a.md',
      facts: [edgeFact({
        subject: 'doc:docs/a.md', relation: 'supersedes', object: 'ADR-0009', line: 1, quote: 'y',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b, c] });
    const result = queryNode('ADR-0009', { graph, parsed, resolve });
    assert.deepEqual(result.in.map((e) => [e.relation, e.from]), [
      ['mentions', 'doc:docs/b.md'],
      ['supersedes', 'doc:docs/a.md'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// queryList: I/O matrix row "List".
// ---------------------------------------------------------------------------

describe('queryList', () => {
  test('List: filters by meta-type and status, sorted by id', () => {
    const a = doc({
      path: 'docs/a.md', metaType: 'Decision', status: 'superseded', declares: 'ADR-1', declaresLine: 1,
    });
    const b = doc({
      path: 'docs/b.md', metaType: 'Decision', status: 'accepted', declares: 'ADR-2', declaresLine: 1,
    });
    const c = doc({ path: 'docs/c.md', metaType: 'Requirement', status: 'superseded' });
    const texts = new Map([
      ['docs/a.md', 'ADR-1 text'],
      ['docs/b.md', 'ADR-2 text'],
      ['docs/c.md', 'c text'],
    ]);
    const { graph, parsed, resolve } = setup({ docs: [a, b, c], texts });

    const items = queryList({ metaType: 'Decision', status: 'superseded' }, { graph, parsed, resolve });
    assert.deepEqual(items.map((i) => i.id), ['doc:docs/a.md']);
    assert.equal(items[0].status, 'superseded');
    assert.equal(items[0].metaType, 'Decision');
  });

  test('no --status: every node of the meta-type, regardless of status', () => {
    const a = doc({ path: 'docs/a.md', metaType: 'Decision', status: 'superseded' });
    const b = doc({ path: 'docs/b.md', metaType: 'Decision', status: 'accepted' });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const items = queryList({ metaType: 'Decision' }, { graph, parsed, resolve });
    assert.deepEqual(items.map((i) => i.id), ['doc:docs/a.md', 'doc:docs/b.md']);
  });

  test('lists an external id: node (metaType from externalIds, not from any doc)', () => {
    const a = doc({
      path: 'docs/a.md',
      facts: [edgeFact({
        subject: 'doc:docs/a.md', relation: 'mentions', object: 'FR-1', line: 2, quote: 'FR-1',
      })],
    });
    const config = cfg({ externalIds: [{ pattern: 'FR-\\d+', metaType: 'Requirement' }] });
    const { graph, parsed, resolve } = setup({ docs: [a], config });
    const items = queryList({ metaType: 'Requirement' }, { graph, parsed, resolve });
    assert.deepEqual(items.map((i) => i.id), ['id:FR-1']);
    assert.equal(items[0].metaType, 'Requirement');
  });

  test('Decision without --status includes a frag: node, which inherits its doc\'s metaType', () => {
    const a = doc({
      path: 'docs/adr/0052.md',
      metaType: 'Decision',
      headings: [{
        level: 2, text: 'Status', anchor: 'status', line: 8,
      }],
    });
    const b = doc({
      path: 'docs/adr/0009.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0009.md', relation: 'link', object: '0052.md#status', line: 4, quote: 'x',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const items = queryList({ metaType: 'Decision' }, { graph, parsed, resolve });
    assert.deepEqual(
      items.map((i) => i.id).sort(),
      ['doc:docs/adr/0052.md', 'frag:docs/adr/0052.md#status'],
    );
  });
});

// ---------------------------------------------------------------------------
// queryNeighbors: I/O matrix row "Neighbors".
// ---------------------------------------------------------------------------

describe('queryNeighbors', () => {
  test('Neighbors: direction + relation filter one hop, each item {relation, node, evidence}', () => {
    const a = doc({ path: 'docs/adr/0009.md', metaType: 'Decision', declares: 'ADR-0009' });
    const b = doc({
      path: 'docs/adr/0052.md',
      metaType: 'Decision',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0052.md', relation: 'supersedes', object: 'ADR-0009', line: 6, quote: 'Supersedes ADR-0009',
      })],
    });
    // A second, differently-typed in-edge the --relation filter must drop.
    const c = doc({
      path: 'docs/adr/0011.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0011.md', relation: 'mentions', object: 'ADR-0009', line: 7, quote: 'ADR-0009',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b, c] });

    const items = queryNeighbors('ADR-0009', { direction: 'in', relation: 'supersedes' }, { graph, parsed, resolve });
    assert.equal(items.length, 1);
    assert.equal(items[0].relation, 'supersedes');
    assert.equal(items[0].node.id, 'doc:docs/adr/0052.md');
    assert.deepEqual(items[0].evidence, [{ file: 'docs/adr/0052.md', line: 6, quote: 'Supersedes ADR-0009' }]);
  });

  test('no --relation: every relation in the given direction, from distinct citing docs', () => {
    const a = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009' });
    const b = doc({
      path: 'docs/adr/0052.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0052.md', relation: 'supersedes', object: 'ADR-0009', line: 6, quote: 'a',
      })],
    });
    const c = doc({
      path: 'docs/adr/0011.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0011.md', relation: 'mentions', object: 'ADR-0009', line: 7, quote: 'b',
      })],
    });
    const { graph, parsed, resolve } = setup({ docs: [a, b, c] });
    const items = queryNeighbors('ADR-0009', { direction: 'in' }, { graph, parsed, resolve });
    assert.deepEqual(items.map((i) => i.relation).sort(), ['mentions', 'supersedes']);
  });

  test('direction "out": neighbor node ids are the edges\' `to` endpoints', () => {
    const a = doc({
      path: 'docs/adr/0052.md',
      facts: [edgeFact({
        subject: 'doc:docs/adr/0052.md', relation: 'supersedes', object: 'ADR-0009', line: 3, quote: 'x',
      })],
    });
    const b = doc({ path: 'docs/adr/0009.md', declares: 'ADR-0009' });
    const { graph, parsed, resolve } = setup({ docs: [a, b] });
    const items = queryNeighbors('doc:docs/adr/0052.md', { direction: 'out' }, { graph, parsed, resolve });
    const expectedIds = graph.edges.filter((e) => e.from === 'doc:docs/adr/0052.md').map((e) => e.to).sort();
    assert.deepEqual(items.map((i) => i.node.id).sort(), expectedIds);
  });

  test('a ref matching no node returns null', () => {
    const a = doc({ path: 'docs/a.md' });
    const { graph, parsed, resolve } = setup({ docs: [a] });
    assert.equal(queryNeighbors('NOPE', { direction: 'out' }, { graph, parsed, resolve }), null);
  });
});
