/**
 * @module ontology
 * @description Meta-ontology for project mode. Pure data — no I/O, no imports,
 * no side-effects. Separate from the classic wiki's `src/scripts/schemas.mjs`.
 *
 * Lint and cross-doc queries key only on these meta-types and meta-relations,
 * never on a project's own type or relation names (see `ontology.md`).
 */

// ---------------------------------------------------------------------------
// META_TYPES
// Fixed list of eleven meta-types every project type maps onto. `governance:
// true` on the three lint depends on (Decision, Requirement, Rule); the rest
// carry no lint of their own. `lifecycle` is set only on Decision.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MetaType
 * @property {boolean} governance
 * @property {readonly string[]} [lifecycle]
 */

/** @type {Readonly<Record<string, MetaType>>} */
export const META_TYPES = Object.freeze({
  Decision: Object.freeze({
    governance: true,
    lifecycle: Object.freeze(['proposed', 'accepted', 'superseded', 'deprecated']),
  }),
  Requirement: Object.freeze({ governance: true }),
  Rule: Object.freeze({ governance: true }),
  Capability: Object.freeze({ governance: false }),
  Process: Object.freeze({ governance: false }),
  Structure: Object.freeze({ governance: false }),
  Concept: Object.freeze({ governance: false }),
  Actor: Object.freeze({ governance: false }),
  Issue: Object.freeze({ governance: false }),
  Evidence: Object.freeze({ governance: false }),
  Document: Object.freeze({ governance: false }),
});

// ---------------------------------------------------------------------------
// META_RELATIONS
// Fixed list of ten meta-relations. `references` is the default and the
// fallback for a project relation with no mapping (ontology.md). Order is the
// canonical order used in `ontology.md`.
// ---------------------------------------------------------------------------

/** @type {readonly string[]} */
export const META_RELATIONS = Object.freeze([
  'supersedes',
  'satisfies',
  'governs',
  'depends-on',
  'part-of',
  'contradicts',
  'justified-by',
  'owned-by',
  'mentions',
  'references',
]);

// ---------------------------------------------------------------------------
// RULES
// Every finding id the engine emits. `owner` is either a meta-relation name
// (the relation the rule is attached to) or the literal string 'engine' for
// rules with no single owning relation. An id the engine emits but that is
// missing here fails the tests (AD-7).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} owner - a META_RELATIONS entry, or 'engine'.
 * @property {'error'|'warning'|'info'} severity
 * @property {string} finding
 */

/** @type {readonly Rule[]} */
export const RULES = Object.freeze([
  Object.freeze({ id: 'P01', owner: 'supersedes',  severity: 'error',   finding: 'supersedes cycle' }),
  Object.freeze({ id: 'P02', owner: 'supersedes',  severity: 'warning', finding: 'superseded target status is not superseded' }),
  Object.freeze({ id: 'P03', owner: 'supersedes',  severity: 'warning', finding: 'doc cites a superseded part' }),
  Object.freeze({ id: 'P04', owner: 'satisfies',   severity: 'warning', finding: 'requirement nothing satisfies' }),
  Object.freeze({ id: 'P05', owner: 'governs',     severity: 'warning', finding: 'governor is superseded' }),
  Object.freeze({ id: 'P06', owner: 'depends-on',  severity: 'error',   finding: 'depends-on cycle' }),
  Object.freeze({ id: 'P07', owner: 'part-of',     severity: 'error',   finding: 'part-of cycle' }),
  Object.freeze({ id: 'P08', owner: 'contradicts', severity: 'warning', finding: 'contradiction' }),
  Object.freeze({ id: 'P09', owner: 'engine',      severity: 'warning', finding: 'dangling reference' }),
  Object.freeze({ id: 'P10', owner: 'engine',      severity: 'error',   finding: 'duplicate declared ID' }),
  Object.freeze({ id: 'P11', owner: 'engine',      severity: 'warning', finding: 'external ID pattern mismatch' }),
  Object.freeze({ id: 'P12', owner: 'engine',      severity: 'warning', finding: 'unmapped doc type' }),
  Object.freeze({ id: 'P13', owner: 'engine',      severity: 'warning', finding: 'stale facts' }),
  Object.freeze({ id: 'P14', owner: 'engine',      severity: 'error',   finding: 'broken evidence' }),
  Object.freeze({ id: 'P15', owner: 'engine',      severity: 'info',    finding: 'rename candidate' }),
  Object.freeze({ id: 'P16', owner: 'engine',      severity: 'warning', finding: 'include pattern matches no files' }),
  // P17-P20 added in story 2 (deterministic parse): frontmatter and status.
  Object.freeze({ id: 'P17', owner: 'engine',      severity: 'warning', finding: 'frontmatter does not parse' }),
  Object.freeze({ id: 'P18', owner: 'engine',      severity: 'warning', finding: 'agent fact sets document status' }),
  Object.freeze({ id: 'P19', owner: 'engine',      severity: 'warning', finding: 'status sources disagree' }),
  Object.freeze({ id: 'P20', owner: 'engine',      severity: 'warning', finding: 'Decision status outside lifecycle' }),
]);
