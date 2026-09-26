/**
 * @file fact.mjs
 * @description The one fact record shape (AD-18): both the deterministic
 * parse and the agent-facing `facts-write` build every record through
 * `makeFact()`, so parse and agent facts, or edge and attr facts, can never
 * drift into incompatible shapes. Pure — no I/O.
 */

import { sha256Hex, canonicalJson } from './hash.mjs';

const KINDS = new Set(['edge', 'attr']);
const PROVENANCES = new Set(['extracted', 'inferred']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Compute a fact id: the first 16 hex chars of the sha256 of the canonical
 * JSON of `[kind, relation, subject, object ?? value, scope ?? null]` (AD-18),
 * so key order inside an object `value` never changes the id.
 * @param {{kind: string, relation: string, subject: string, object?: *, value?: *, scope?: *}} parts
 * @returns {string} 16 lowercase hex chars
 */
export function factId({ kind, relation, subject, object, value, scope } = {}) {
  const payload = canonicalJson([kind, relation, subject, object ?? value, scope ?? null]);
  return sha256Hex(payload).slice(0, 16);
}

/**
 * Build and validate one fact record. Key order matches the spec exactly:
 * `id, kind, subject, relation, object|value, ref, scope?, evidence{line, quote}, provenance`.
 * @param {object} input
 * @param {'edge'|'attr'} input.kind
 * @param {string} input.subject
 * @param {string} input.relation
 * @param {string} [input.object] required when kind is 'edge'
 * @param {*} [input.value] required when kind is 'attr'
 * @param {string} input.ref
 * @param {string} [input.scope]
 * @param {{line: number, quote: string}} input.evidence
 * @param {'extracted'|'inferred'} input.provenance
 * @returns {object} the fact record
 */
export function makeFact({
  kind,
  subject,
  relation,
  object,
  value,
  ref,
  scope,
  evidence,
  provenance,
} = {}) {
  if (!KINDS.has(kind)) {
    throw new TypeError(`kind must be "edge" or "attr", got ${JSON.stringify(kind)}`);
  }
  if (!isNonEmptyString(subject)) {
    throw new TypeError('subject must be a non-empty string');
  }
  if (!isNonEmptyString(relation)) {
    throw new TypeError('relation must be a non-empty string');
  }
  if (!isNonEmptyString(ref)) {
    throw new TypeError('ref must be a non-empty string');
  }

  const hasObject = object !== undefined;
  const hasValue = value !== undefined;

  if (hasObject && hasValue) {
    throw new TypeError('fact cannot have both object and value');
  }
  if (kind === 'edge' && !hasObject) {
    throw new TypeError('edge fact requires object');
  }
  if (kind === 'attr' && !hasValue) {
    throw new TypeError('attr fact requires value');
  }

  if (!evidence || !Number.isInteger(evidence.line) || evidence.line < 1) {
    throw new TypeError('evidence.line must be an integer >= 1');
  }
  if (typeof evidence.quote !== 'string' || evidence.quote.length === 0) {
    throw new TypeError('evidence.quote must not be empty');
  }

  if (!PROVENANCES.has(provenance)) {
    throw new TypeError(
      `provenance must be "extracted" or "inferred", got ${JSON.stringify(provenance)}`
    );
  }

  const id = factId({ kind, relation, subject, object, value, scope });

  return {
    id,
    kind,
    subject,
    relation,
    ...(hasObject ? { object } : { value }),
    ref,
    ...(scope !== undefined && scope !== null ? { scope } : {}),
    evidence: { line: evidence.line, quote: evidence.quote },
    provenance,
  };
}
