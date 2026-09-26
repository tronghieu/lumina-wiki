/**
 * @file query.mjs
 * @description Fixed query operations (CAP-7, CAP-10, AD-28): `queryNode`,
 * `queryList`, `queryNeighbors`, all pure -- no I/O, computed over an
 * already-built graph. `project.mjs`'s `query` subcommand wraps these with
 * ref resolution, arg parsing and freshness. No query language, path search,
 * multi-hop walk, or full-text search (spec boundary).
 *
 * A node's own `at` location (spec):
 *   - `doc:`  -- its declared-ID line, else line 1, quoting that line's text.
 *   - `frag:` -- its heading line and heading text.
 *   - `id:`/`concept:` -- the first sorted evidence of an edge into it, or
 *     (when it has none, e.g. an inverse-only relation like `superseded_by`)
 *     the first sorted evidence of an edge out of it.
 *
 * `resolve` is `(raw, citingDoc) => resolveFactRef(raw, citingDoc, ctx)`
 * (same signature `facts-write` builds, see `project.mjs`). A prefixed node
 * id (`doc:`/`frag:`/`concept:`/`id:`) resolves through it too (via
 * `validatePrefixed`), which is how a non-`doc` node's `metaType` is
 * recovered here -- `buildGraph()` doesn't store it on those nodes.
 */

import { cmp, sortEvidence } from './graph.mjs';

const ROOT_CITING_DOC = { path: '', includeRoot: '' };

/** `{file, line, quote}` only -- drops `provenance`/`scope` (spec: an item's `evidence[]` is exactly this shape). */
function trimEvidence(evidence) {
  return evidence.map((e) => ({ file: e.file, line: e.line, quote: e.quote }));
}

/** `graph.nodes[].metaType` when present (doc nodes); otherwise recovered from the resolver -- the same lookup `validatePrefixed` does for a fact's own subject/object. Exported (view.mjs): `view` colors every node by meta-type, not only doc nodes, so it needs this same recovery instead of a second copy. */
export function nodeMetaType(node, resolve) {
  if (node.metaType !== undefined) return node.metaType;
  const result = resolve(node.id, ROOT_CITING_DOC);
  return result.kind === 'resolved' ? result.metaType : undefined;
}

/** A leading UTF-8 BOM is not part of any line's text (same strip `parse.mjs#frontmatterLines` does). */
function stripBom(text) {
  return String(text ?? '').replace(/^﻿/, '');
}

function lineText(text, line) {
  const lines = stripBom(text).split(/\r\n|\r|\n/);
  return lines[line - 1] ?? '';
}

function atForDoc(node, { docsByPath, texts }) {
  const path = node.id.slice(4);
  const doc = docsByPath.get(path);
  const line = doc?.declaresLine ?? 1;
  return { file: path, line, quote: lineText(texts.get(path), line) };
}

function atForFrag(node, { docsByPath }) {
  const hashIdx = node.id.indexOf('#');
  const path = node.id.slice(5, hashIdx);
  const anchor = node.id.slice(hashIdx + 1);
  const heading = docsByPath.get(path)?.headings?.find((h) => h.anchor === anchor);
  return { file: path, line: heading?.line ?? 1, quote: heading?.text ?? '' };
}

/**
 * `id:`/`concept:` nodes: the first sorted evidence of an edge into them
 * (spec), combined across every incoming edge since a node can be cited by
 * more than one; falls back to the first sorted evidence of an edge out of
 * it when it has no incoming edge at all (an inverse-only relation, e.g.
 * `superseded_by`, makes the node only ever a `from`).
 */
function atForResolved(node, { edgesInByTarget, edgesOutBySource }) {
  const incoming = sortEvidence((edgesInByTarget.get(node.id) ?? []).flatMap((e) => e.evidence));
  const first = incoming[0] ?? sortEvidence((edgesOutBySource.get(node.id) ?? []).flatMap((e) => e.evidence))[0];
  return first ? { file: first.file, line: first.line, quote: first.quote } : { file: '', line: 1, quote: '' };
}

/** Exported (view.mjs): the node's own source location, same `{file, line, quote}` every query op reports, reused so `view` doesn't recompute it a second way. */
export function atFor(node, ctx) {
  if (node.kind === 'doc') return atForDoc(node, ctx);
  if (node.kind === 'frag') return atForFrag(node, ctx);
  return atForResolved(node, ctx);
}

/** `{id, metaType?, status?, at}`, key order matching the spec exactly. `metaType` is a parameter -- computed once by the caller, not recomputed here. */
function nodeSummary(node, metaType, ctx) {
  return {
    id: node.id,
    ...(metaType !== undefined ? { metaType } : {}),
    ...(node.status !== undefined ? { status: node.status } : {}),
    at: atFor(node, ctx),
  };
}

/** `edgesInByTarget`/`edgesOutBySource`: every edge indexed once by its `to`/`from` endpoint, so `atForResolved` (called once per `id:`/`concept:` node) is O(1) amortized instead of an O(E) scan of the whole edge list per node -- an O(N*E) `view` render on a real corpus otherwise. */
function indexEdgesByEndpoint(edges) {
  const byTarget = new Map();
  const bySource = new Map();
  for (const e of edges) {
    if (!byTarget.has(e.to)) byTarget.set(e.to, []);
    byTarget.get(e.to).push(e);
    if (!bySource.has(e.from)) bySource.set(e.from, []);
    bySource.get(e.from).push(e);
  }
  return { byTarget, bySource };
}

/** Exported (view.mjs): the shared `{graph, edges, byId, docsByPath, texts, resolve}` context `atFor`/`nodeMetaType` need. */
export function buildCtx({ graph, parsed, resolve }) {
  const { byTarget, bySource } = indexEdgesByEndpoint(graph.edges);
  return {
    graph,
    edges: graph.edges,
    edgesInByTarget: byTarget,
    edgesOutBySource: bySource,
    byId: new Map(graph.nodes.map((n) => [n.id, n])),
    docsByPath: new Map(parsed.docs.map((d) => [d.path, d])),
    texts: parsed.texts ?? new Map(),
    resolve,
  };
}

/**
 * Resolve `ref` to an existing graph node: first as a node id already in the
 * graph, else through `resolve()` cited from the repo root (declared ID,
 * path, concept alias, or external ID pattern) -- including an
 * ID-shaped-but-undeclared reference, whose `dangling` result still names
 * the `id:<ref>` placeholder node when one exists in the graph. A ref
 * carrying `#` that resolves to a whole `doc:` node (its anchor didn't
 * exist) is not found -- callers wrote it expecting a fragment.
 * @returns {object|null} the node from `graph.nodes`, or `null` when nothing resolves.
 */
function findNode(ref, { byId, resolve }) {
  if (byId.has(ref)) return byId.get(ref);
  const result = resolve(ref, ROOT_CITING_DOC);
  if (result.kind === 'resolved') {
    if (ref.includes('#') && result.targetId.startsWith('doc:')) return null;
    return byId.get(result.targetId) ?? null;
  }
  if (result.kind === 'dangling' && result.placeholder && byId.has(result.placeholder)) {
    return byId.get(result.placeholder);
  }
  return null;
}

/**
 * `query node <ref>`: the node plus its outgoing/incoming edges.
 * @returns {{node: object, out: object[], in: object[]}|null} `null` when `ref` resolves to no node.
 */
export function queryNode(ref, { graph, parsed, resolve }) {
  const ctx = buildCtx({ graph, parsed, resolve });
  const node = findNode(ref, ctx);
  if (!node) return null;

  const out = graph.edges
    .filter((e) => e.from === node.id)
    .map((e) => ({ relation: e.relation, to: e.to, evidence: trimEvidence(e.evidence) }))
    .sort((a, b) => cmp(a.relation, b.relation) || cmp(a.to, b.to));

  const inEdges = graph.edges
    .filter((e) => e.to === node.id)
    .map((e) => ({ relation: e.relation, from: e.from, evidence: trimEvidence(e.evidence) }))
    .sort((a, b) => cmp(a.relation, b.relation) || cmp(a.from, b.from));

  return { node: nodeSummary(node, nodeMetaType(node, resolve), ctx), out, in: inEdges };
}

/**
 * `query list --meta-type T [--status S]`: every node whose `metaType` is
 * `T` (and whose `status` is `S`, when given), sorted by id. `metaType` is
 * not validated here -- `project.mjs` already checked it against
 * `META_TYPES` before calling.
 * @returns {object[]} `{id, metaType, status, at}` items.
 */
export function queryList({ metaType, status }, { graph, parsed, resolve }) {
  const ctx = buildCtx({ graph, parsed, resolve });
  const items = [];
  for (const node of graph.nodes) {
    const nodeType = nodeMetaType(node, resolve);
    if (nodeType !== metaType) continue;
    if (status !== undefined && node.status !== status) continue;
    items.push(nodeSummary(node, nodeType, ctx));
  }
  return items.sort((a, b) => cmp(a.id, b.id));
}

/**
 * `query neighbors <ref> --direction in|out [--relation R]`: one hop from
 * `ref`'s node. `relation` is not validated here -- `project.mjs` already
 * checked it against `META_RELATIONS` before calling.
 * @returns {object[]|null} `{relation, node, evidence[]}` items, sorted by
 *   `(relation, node.id)`; `null` when `ref` resolves to no node.
 */
export function queryNeighbors(ref, { direction, relation }, { graph, parsed, resolve }) {
  const ctx = buildCtx({ graph, parsed, resolve });
  const node = findNode(ref, ctx);
  if (!node) return null;

  const matching = graph.edges.filter((e) => {
    if (direction === 'out' ? e.from !== node.id : e.to !== node.id) return false;
    if (relation !== undefined && e.relation !== relation) return false;
    return true;
  });

  return matching
    .map((e) => {
      // Every edge endpoint is a node `buildGraph()` already `ensureNode`'d, so this is always found.
      const otherNode = ctx.byId.get(direction === 'out' ? e.to : e.from);
      return {
        relation: e.relation,
        node: nodeSummary(otherNode, nodeMetaType(otherNode, resolve), ctx),
        evidence: trimEvidence(e.evidence),
      };
    })
    .sort((a, b) => cmp(a.relation, b.relation) || cmp(a.node.id, b.node.id));
}
