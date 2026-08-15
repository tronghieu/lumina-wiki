/**
 * @file edges.mjs
 * @description Graph-edge primitives shared by the writer (wiki.mjs) and the
 * checker (lint.mjs). Pure — no I/O, no side effects.
 *
 * The reverse-edge gate is the project's headline invariant, and it used to be
 * spelled out in six places: inline in addEdge and batchEdges, via a
 * skipReverseFor() helper in removeEdge and replaceEdge, and open-coded again
 * in lint's checkL06 and fixL06. Worse, the helper was an incomplete copy — it
 * omitted the `typeDef.reverse` check its callers each added by hand, so a
 * caller trusting it alone would have written an edge with `type: null` for
 * the one EDGE_TYPES entry (`appears_in`) that has a null reverse and no
 * terminal flag. One definition now, with that check folded in.
 */

import { EDGE_TYPES } from '../schemas.mjs';
import { isExempt } from './globs.mjs';

/** Name -> EDGE_TYPES entry. Built once; the array is static, 42 entries. */
const BY_NAME = new Map(EDGE_TYPES.map(t => [t.name, t]));

/**
 * Edge types that are declared in EDGE_TYPES but do not belong in
 * edges.jsonl: citations have their own file (`graph/citations.jsonl`) and
 * their own commands. They stay in the schema because lint has to recognise
 * the pair in order to reason about rows an older version already wrote into
 * the wrong file.
 * @type {Set<string>}
 */
export const CITATION_EDGE_TYPES = new Set(['cites', 'cited_by']);

/**
 * Look up an edge type definition by name.
 * @param {string} name
 * @returns {object|null} The EDGE_TYPES entry, or null when unknown.
 */
export function edgeTypeByName(name) {
  return BY_NAME.get(name) ?? null;
}

/**
 * Whether a forward edge of this type is allowed to exist without a reverse:
 * the type declares no reverse, is terminal, is symmetric (sorted endpoints
 * already cover both directions), or the target is exemption-matched.
 * @param {object} typeDef An EDGE_TYPES entry.
 * @param {string} toSlug  The forward edge's target.
 * @returns {boolean}
 */
export function skipReverseFor(typeDef, toSlug) {
  return Boolean(
    !typeDef.reverse || typeDef.terminal || typeDef.symmetric || isExempt(toSlug),
  );
}

/**
 * Build the reverse of a forward edge, or null when the gate says there is
 * none. The single place a reverse edge is constructed.
 * @param {object} typeDef      An EDGE_TYPES entry.
 * @param {string} fromSlug     The forward edge's source.
 * @param {string} toSlug       The forward edge's target.
 * @param {string} [confidence] Carried over from the forward edge when set.
 * @returns {object|null}
 */
export function reverseEdgeFor(typeDef, fromSlug, toSlug, confidence) {
  if (skipReverseFor(typeDef, toSlug)) return null;
  return {
    from: toSlug,
    type: typeDef.reverse,
    to: fromSlug,
    ...(confidence ? { confidence } : {}),
  };
}

/**
 * Identity key for an edge, ignoring confidence. Symmetric types sort their
 * endpoints so the two storage orders collapse to one key.
 * @param {object} edge
 * @returns {string}
 */
export function edgeKey(edge) {
  const typeDef = BY_NAME.get(edge.type);
  if (typeDef && typeDef.symmetric) {
    const endpoints = [edge.from, edge.to].sort();
    return `${endpoints[0]}|${edge.type}|${endpoints[1]}`;
  }
  return `${edge.from}|${edge.type}|${edge.to}`;
}

/**
 * Canonical storage form of an edge: symmetric types get sorted endpoints.
 * @param {object} edge
 * @returns {object}
 */
export function normalizeEdge(edge) {
  const typeDef = BY_NAME.get(edge.type);
  if (typeDef && typeDef.symmetric) {
    const [a, b] = [edge.from, edge.to].sort();
    return { ...edge, from: a, to: b };
  }
  return edge;
}
