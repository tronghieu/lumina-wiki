/**
 * @file graph.mjs
 * @description The one graph builder (AD-19): `buildGraph()` resolves every
 * fact's `object`/`ref` to a node id, types the raw relation into a
 * meta-relation, merges typed/`references`/`mentions` edges for the same
 * pair, and assembles the final node/edge/finding lists -- byte-identical on
 * unchanged input. Pure -- no I/O; `exists(path)` is injected so callers
 * supply filesystem access. Also `loadFacts(root)` (reads committed agent
 * fact envelopes, AD-10) and `computeDocStatus()` (the per-doc freshness
 * decision table, AD-12) -- both used by `project.mjs`'s `build`/`status`
 * subcommands, neither owned by this story beyond these two functions.
 *
 * Resolver assumption, spelled out because the frozen contract does not (a
 * companion `parse.mjs`, built in parallel, must match): every fact's
 * `object` (or `value`) is either a raw, unresolved string exactly as
 * written -- a path, a declared/external ID, or concept-mention text -- or
 * already a prefixed node id (`doc:`/`frag:`/`concept:`/`id:`), which
 * `buildGraph` treats as pre-resolved and passes through unchanged. Parse's
 * own concept-mention facts use the latter form (Design Notes: "object =
 * concept:<slug>"); `facts-write`-committed agent facts are expected to, per
 * AD-18's "canonicalizes subject/object against the current parse". A parsed
 * doc's own `findings[]` entries are `{id, file, line, message}` (severity
 * omitted, since `RULES` is the single source of truth for it); a `severity`
 * already present is kept as-is.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { RULES, META_RELATIONS } from '../ontology.mjs';
import { slug } from './markdown.mjs';
import { quoteMatches } from './evidence.mjs';
import { resolveIncludeRootForPattern } from './scope.mjs';

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

function severityOf(id) {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`graph.mjs: unknown finding id "${id}" (missing from ontology.mjs RULES)`);
  return rule.severity;
}

function makeFinding(id, file, line, message) {
  return { id, severity: severityOf(id), file, line, message };
}

function normalizeFinding(f) {
  return { id: f.id, severity: f.severity ?? severityOf(f.id), file: f.file, line: f.line, message: f.message };
}

// ---------------------------------------------------------------------------
// Small ordering / dedup helpers. Output must be byte-identical on unchanged
// input: nodes by id, edges by (from, relation, to), evidence by
// (file, line, quote), findings by (file, line, id, message).
// ---------------------------------------------------------------------------

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => cmp(a.id, b.id));
}

function sortEdges(edges) {
  return [...edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.relation, b.relation) || cmp(a.to, b.to));
}

function sortEvidence(list) {
  const sorted = [...list].sort((a, b) => cmp(a.file, b.file) || cmp(a.line, b.line) || cmp(a.quote, b.quote));
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const key = `${e.file}\u0000${e.line}\u0000${e.quote}\u0000${e.provenance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function sortFindings(findings) {
  const sorted = [...findings].sort(
    (a, b) => cmp(a.file, b.file) || cmp(a.line, b.line) || cmp(a.id, b.id) || cmp(a.message, b.message),
  );
  const seen = new Set();
  const out = [];
  for (const f of sorted) {
    const key = `${f.file}\u0000${f.line}\u0000${f.id}\u0000${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Virtual (repo-relative, forward-slash) path math. Deliberately not
// `node:path` -- these operate on strings that never touch a real
// filesystem, and must behave identically regardless of host OS.
// ---------------------------------------------------------------------------

function virtualDirname(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Join + normalize a virtual path; drops `.`, resolves `..`; null when `..` would escape the root. */
function normalizeVirtualPath(p) {
  const parts = [];
  let escaped = false;
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) escaped = true;
      else parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return escaped ? null : parts.join('/');
}

function docPathOfSubject(subject) {
  if (typeof subject !== 'string') return null;
  if (subject.startsWith('doc:')) return subject.slice(4);
  if (subject.startsWith('frag:')) return subject.slice(5).split('#')[0];
  return null;
}

// ---------------------------------------------------------------------------
// Node assembly
// ---------------------------------------------------------------------------

function buildDocNode(doc) {
  const node = { id: `doc:${doc.path}`, kind: 'doc', metaType: doc.metaType ?? 'Document' };
  if (doc.type != null) node.type = doc.type;
  if (doc.status != null) node.status = doc.status;
  if (doc.declares != null) node.declares = doc.declares;
  node.inScope = true;
  return node;
}

/** Idempotent: never overwrites a node already present (in particular, a pre-seeded in-scope doc node). */
function ensureNode(nodesById, id, inScope) {
  if (nodesById.has(id)) return nodesById.get(id);
  let node;
  if (id.startsWith('doc:')) node = { id, kind: 'doc', inScope: inScope === true };
  else if (id.startsWith('frag:')) node = { id, kind: 'frag' };
  else if (id.startsWith('concept:')) node = { id, kind: 'concept' };
  else node = { id, kind: 'id' };
  nodesById.set(id, node);
  return node;
}

// ---------------------------------------------------------------------------
// Reference resolution (AD-11): declared project ID, path#anchor, path,
// concept alias, external ID pattern, else dangling.
// ---------------------------------------------------------------------------

/**
 * Every distinct `includeRoot` seen across `docs`, ordered by the
 * `sources.include` pattern (config order) that produces it -- not by which
 * doc happens to appear first once paths are sorted. Reuses
 * `scope.mjs#resolveIncludeRootForPattern` (the same function parse.mjs used
 * to compute each doc's own `includeRoot`) to find, for each pattern in
 * turn, which not-yet-seen roots it accounts for.
 */
function rootsInConfigOrder(config, docs) {
  // `config.sources.include` is already defaulted and validated non-empty
  // by `loadConfig` -- no need to re-apply the `['docs']` default here.
  const include = config.sources.include;
  const seen = new Set();
  const ordered = [];
  for (const pattern of include) {
    for (const doc of docs) {
      const root = doc.includeRoot;
      if (root === undefined || root === null || seen.has(root)) continue;
      if (resolveIncludeRootForPattern(pattern, doc.path) === root) {
        seen.add(root);
        ordered.push(root);
      }
    }
  }
  return ordered;
}

function resolveInDoc(path, anchor, ctx) {
  const doc = ctx.docsMap.get(path);
  const metaType = doc?.metaType;
  if (anchor) {
    const found = doc?.headings?.some((h) => h.anchor === anchor);
    if (found) return { kind: 'resolved', targetId: `frag:${path}#${anchor}`, metaType, inScope: true };
  }
  return { kind: 'resolved', targetId: `doc:${path}`, metaType, inScope: true };
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

function resolvePath(raw, citingDoc, ctx) {
  const hashIdx = raw.indexOf('#');
  const pathPart = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
  const anchorPart = hashIdx === -1 ? undefined : raw.slice(hashIdx + 1);

  if (SCHEME_RE.test(pathPart) || /^mailto:/i.test(pathPart)) return { kind: 'ignored' };
  if (pathPart !== '' && pathPart.endsWith('/')) return { kind: 'ignored' }; // directory-like link

  let decodedPath;
  let decodedAnchor;
  try {
    decodedPath = pathPart === '' ? '' : decodeURIComponent(pathPart);
  } catch {
    decodedPath = pathPart;
  }
  try {
    decodedAnchor = anchorPart === undefined ? undefined : decodeURIComponent(anchorPart);
  } catch {
    decodedAnchor = anchorPart;
  }

  if (decodedPath === '') return resolveInDoc(citingDoc.path, decodedAnchor, ctx); // `#y` alone: same doc

  if (decodedPath.startsWith('/')) {
    // A leading `/` means repo root only -- no doc-relative/include-root fallback.
    const rootCandidate = normalizeVirtualPath(decodedPath.slice(1));
    if (rootCandidate === null) return { kind: 'unresolved' };
    if (ctx.docsMap.has(rootCandidate)) return resolveInDoc(rootCandidate, decodedAnchor, ctx);
    if (ctx.exists(rootCandidate)) {
      return { kind: 'resolved', targetId: `doc:${rootCandidate}`, metaType: undefined, inScope: false };
    }
    return { kind: 'unresolved' };
  }

  const candidates = [];
  const pushCandidate = (base) => {
    const joined = base ? `${base}/${decodedPath}` : decodedPath;
    const normalized = normalizeVirtualPath(joined);
    if (normalized === null) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  pushCandidate(virtualDirname(citingDoc.path)); // doc-relative
  pushCandidate(citingDoc.includeRoot ?? ''); // the include root that selected the citing doc
  for (const root of ctx.otherRoots) {
    if (root !== citingDoc.includeRoot) pushCandidate(root);
  }
  pushCandidate(''); // repo root

  for (const candidate of candidates) {
    if (ctx.docsMap.has(candidate)) return resolveInDoc(candidate, decodedAnchor, ctx);
  }
  for (const candidate of candidates) {
    if (ctx.exists(candidate)) return { kind: 'resolved', targetId: `doc:${candidate}`, metaType: undefined, inScope: false };
  }
  return { kind: 'unresolved' };
}

function resolveConceptAlias(raw, concepts) {
  const norm = String(raw).normalize('NFC').toLowerCase();
  for (const c of concepts ?? []) {
    const names = [c.name, ...(c.aliases ?? [])];
    if (names.some((n) => String(n).normalize('NFC').toLowerCase() === norm)) {
      return `concept:${slug(c.name)}`;
    }
  }
  return null;
}

/**
 * A `pattern => RegExp` cache, built once per `buildGraph` call and threaded
 * through `ctx.testPattern`: `classifyIdShape`/`externalMetaTypeFor` run
 * over every type/externalId pattern for every fact, so compiling each
 * pattern's `RegExp` once instead of per call matters at real corpus sizes.
 */
function makePatternTester() {
  const cache = new Map();
  return (pattern) => {
    let re = cache.get(pattern);
    if (!re) {
      re = new RegExp(`^(?:${pattern})$`, 'u');
      cache.set(pattern, re);
    }
    return re;
  };
}

/** Does `raw` look like a project ID ('type', via some type's `idPattern`) or only an `externalIds` pattern ('external')? */
function classifyIdShape(raw, ctx) {
  for (const type of Object.values(ctx.config.types ?? {})) {
    if (type.idPattern && ctx.testPattern(type.idPattern).test(raw)) return 'type';
  }
  for (const ext of ctx.config.externalIds ?? []) {
    if (ctx.testPattern(ext.pattern).test(raw)) return 'external';
  }
  return null;
}

function externalMetaTypeFor(raw, ctx) {
  for (const ext of ctx.config.externalIds ?? []) {
    if (ctx.testPattern(ext.pattern).test(raw)) return ext.metaType;
  }
  return undefined;
}

/**
 * Resolve one raw ref in citing-doc context. Returns:
 *   {kind:'resolved', targetId, metaType, inScope}
 *   {kind:'ignored'}                        -- URL / directory-like link target
 *   {kind:'dangling', placeholder}          -- placeholder is `id:<raw>` (looks like a
 *                                               project ID) or null (plain dangling text)
 */
function resolveRef(raw, citingDoc, ctx) {
  const owners = ctx.declaredIdOwners.get(raw);
  if (owners) {
    if (owners.length === 1) {
      const path = owners[0];
      return { kind: 'resolved', targetId: `doc:${path}`, metaType: ctx.docsMap.get(path)?.metaType, inScope: true };
    }
    return { kind: 'resolved', targetId: `id:${raw}`, metaType: undefined, inScope: undefined };
  }

  const pathResult = resolvePath(raw, citingDoc, ctx);
  if (pathResult.kind === 'ignored' || pathResult.kind === 'resolved') return pathResult;

  const conceptId = resolveConceptAlias(raw, ctx.config.concepts);
  if (conceptId) return { kind: 'resolved', targetId: conceptId, metaType: 'Concept', inScope: undefined };

  const idKind = classifyIdShape(raw, ctx);
  if (idKind === 'external') {
    return {
      kind: 'resolved',
      targetId: `id:${raw}`,
      metaType: externalMetaTypeFor(raw, ctx),
      inScope: undefined,
    };
  }
  if (idKind === 'type') return { kind: 'dangling', placeholder: `id:${raw}` };
  return { kind: 'dangling', placeholder: null };
}

function metaTypeOfResolvedId(id, ctx) {
  if (id.startsWith('doc:')) return ctx.docsMap.get(id.slice(4))?.metaType;
  if (id.startsWith('frag:')) return ctx.docsMap.get(id.slice(5).split('#')[0])?.metaType;
  if (id.startsWith('concept:')) return 'Concept';
  if (id.startsWith('id:')) return externalMetaTypeFor(id.slice(3), ctx);
  return undefined;
}

function nodeIsInScope(id, ctx) {
  if (id.startsWith('doc:')) return ctx.docsMap.has(id.slice(4));
  if (id.startsWith('frag:')) return ctx.docsMap.has(id.slice(5).split('#')[0]);
  return undefined;
}

/**
 * Validate an already-prefixed reference (`doc:`/`frag:`/`concept:`/`id:` --
 * an agent fact's `object`/`subject`, canonicalized at write time per
 * AD-18) against the current parse and config, instead of trusting it as
 * pre-resolved: the doc/anchor/concept it names may since have been
 * deleted, renamed, or never existed. `id:` is always a valid open-ended
 * placeholder (external IDs and undeclared-but-ID-shaped references are
 * inherently unverifiable beyond their own pattern, already checked when
 * the placeholder was minted) and needs no further check here.
 * @returns {{valid: boolean, metaType?: string, inScope?: boolean}}
 */
function validatePrefixed(raw, ctx) {
  if (raw.startsWith('doc:')) {
    const path = raw.slice(4);
    if (ctx.docsMap.has(path)) return { valid: true, metaType: ctx.docsMap.get(path).metaType, inScope: true };
    if (ctx.exists(path)) return { valid: true, metaType: undefined, inScope: false };
    return { valid: false };
  }
  if (raw.startsWith('frag:')) {
    const [path, anchor] = raw.slice(5).split('#');
    const doc = ctx.docsMap.get(path);
    if (doc && doc.headings?.some((h) => h.anchor === anchor)) {
      return { valid: true, metaType: doc.metaType, inScope: true };
    }
    return { valid: false };
  }
  if (raw.startsWith('concept:')) {
    const conceptSlug = raw.slice(8);
    const known = (ctx.config.concepts ?? []).some((c) => slug(c.name) === conceptSlug);
    return known ? { valid: true, metaType: 'Concept', inScope: undefined } : { valid: false };
  }
  return { valid: true, metaType: metaTypeOfResolvedId(raw, ctx), inScope: nodeIsInScope(raw, ctx) };
}

// ---------------------------------------------------------------------------
// Relation typing (Design Notes): `relations` map for the key, key is a
// meta-relation name, `related` through `relatedRules`, else `references`.
// ---------------------------------------------------------------------------

function typeRelation({ rawKey, sourceMetaType, targetMetaType, config }) {
  const mapped = config.relations && Object.hasOwn(config.relations, rawKey) ? config.relations[rawKey] : undefined;
  if (mapped) return { relation: mapped.relation, inverse: !!mapped.inverse };
  if (META_RELATIONS.includes(rawKey)) return { relation: rawKey, inverse: false };
  if (rawKey === 'related') {
    const rule = (config.relatedRules ?? []).find((r) => r.source === sourceMetaType && r.target === targetMetaType);
    if (rule) return { relation: rule.relation, inverse: !!rule.inverse };
  }
  return { relation: 'references', inverse: false };
}

// ---------------------------------------------------------------------------
// Merge (Design Notes): keep typed edges, else `references`, else `mentions`,
// for one (from, to) pair; all evidence kept. Self-loops are dropped before
// this point (caller never pushes a from === to edge).
// ---------------------------------------------------------------------------

function mergeEdges(rawEdges) {
  const byTriple = new Map();
  for (const e of rawEdges) {
    const key = `${e.from}\u0000${e.relation}\u0000${e.to}`;
    if (!byTriple.has(key)) byTriple.set(key, { from: e.from, relation: e.relation, to: e.to, evidence: [] });
    byTriple.get(key).evidence.push(...e.evidence);
  }
  const byPair = new Map();
  for (const edge of byTriple.values()) {
    const pairKey = `${edge.from}\u0000${edge.to}`;
    if (!byPair.has(pairKey)) byPair.set(pairKey, new Map());
    byPair.get(pairKey).set(edge.relation, edge);
  }
  const result = [];
  for (const relMap of byPair.values()) {
    const typed = [...relMap.entries()].filter(([r]) => r !== 'references' && r !== 'mentions').map(([, e]) => e);
    const kept = typed.length > 0 ? typed : [relMap.get('references') ?? relMap.get('mentions')];
    // Evidence of dropped `references`/`mentions` edges moves onto the first kept edge.
    const target = [...kept].sort((x, y) => (x.relation < y.relation ? -1 : x.relation > y.relation ? 1 : 0))[0];
    for (const [r, edge] of relMap) {
      if (!kept.includes(edge) && (r === 'references' || r === 'mentions')) target.evidence.push(...edge.evidence);
    }
    result.push(...kept);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fact validity: a committed envelope is agent-written JSON, not trusted
// input -- a null entry, a fact missing `evidence`, or a non-string `object`
// must be skipped, never crash the build. Parse's own facts are also run
// through this (harmless: `makeFact` already guarantees the shape).
// ---------------------------------------------------------------------------

function hasValidEvidence(f) {
  return !!f.evidence && typeof f.evidence.line === 'number' && typeof f.evidence.quote === 'string';
}

function isValidEdgeFact(f) {
  return !!f && typeof f === 'object' && f.kind === 'edge'
    && typeof f.subject === 'string' && typeof f.relation === 'string' && typeof f.object === 'string'
    && typeof f.provenance === 'string' && hasValidEvidence(f);
}

function isValidAttrFact(f) {
  return !!f && typeof f === 'object' && f.kind === 'attr'
    && typeof f.subject === 'string' && typeof f.relation === 'string'
    && typeof f.provenance === 'string' && hasValidEvidence(f);
}

function resolutionKey(subjPath, factId) {
  return `${subjPath}\u0000${factId}`;
}

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

/**
 * Resolve, type, merge, and set status for the whole graph. Pure: `exists`
 * is the only filesystem access, injected as a synchronous predicate.
 * @param {object} params
 * @param {object} params.config - a validated `project.yaml` (see config.mjs).
 * @param {{docs: object[]}} params.parsed - `parseAll()`'s output (or, until
 *   `parse.mjs` exists, a hand-built equivalent following the Parse-to-graph
 *   contract): docs sorted by path, each `{path, hash, includeRoot,
 *   frontmatterType, type, metaType, declares, declaresLine, status, headings, facts, findings}`.
 * @param {Map<string, object>|Record<string, object>} params.facts -
 *   `loadFacts()`'s output: per-doc committed fact envelopes, keyed by
 *   source path. A malformed entry (`{error}`, or `null`) is skipped for
 *   graph-building (it still drives `computeDocStatus` -> 'stale' elsewhere).
 * @param {(path: string) => boolean} params.exists - true when `path`
 *   (repo-relative) exists on disk, in or out of scope.
 * @returns {{nodes: object[], edges: object[], findings: object[]}} plus a
 *   non-enumerable `resolution: Map<string, 'resolved'|'dangling'|'ignored'>`
 *   (key: `resolutionKey(sourcePath, fact.id)`), read by `project.mjs`'s
 *   `status` to tell a genuinely dangling reference from everything else
 *   (self-loop, an ignored link, a resolved node) -- excluded from
 *   `JSON.stringify` on purpose, so `build`'s output shape is unaffected.
 */
export function buildGraph({ config, parsed, facts, exists }) {
  const docsMap = new Map(parsed.docs.map((d) => [d.path, d]));
  const nodesById = new Map();
  const findings = [];
  const resolution = new Map();

  for (const doc of parsed.docs) {
    nodesById.set(`doc:${doc.path}`, buildDocNode(doc));
    for (const f of doc.findings ?? []) findings.push(normalizeFinding(f));
  }

  // Declared-ID map + P10 (duplicate declared ID resolves to neither doc).
  const declaredBy = new Map();
  for (const doc of parsed.docs) {
    if (doc.declares != null) {
      if (!declaredBy.has(doc.declares)) declaredBy.set(doc.declares, []);
      declaredBy.get(doc.declares).push(doc.path);
    }
  }
  for (const [id, owners] of declaredBy) {
    if (owners.length <= 1) continue;
    for (const owner of owners) {
      const others = owners.filter((o) => o !== owner);
      const line = docsMap.get(owner)?.declaresLine ?? 1;
      findings.push(makeFinding('P10', owner, line, `duplicate declared ID "${id}", also declared by ${others.join(', ')}`));
    }
  }

  // Sorted by source path (not readdir/Map-insertion order) so anything
  // order-sensitive downstream -- fragment status "first wins" -- is
  // deterministic regardless of how `loadFacts` walked the directory.
  const envelopeEntries = (facts instanceof Map ? [...facts.entries()] : Object.entries(facts ?? {}))
    .sort((a, b) => cmp(a[0], b[0]));
  const validEnvelopes = envelopeEntries
    .map(([, e]) => e)
    .filter((e) => e && !e.error && Array.isArray(e.facts));

  const ctx = {
    config,
    docsMap,
    declaredIdOwners: declaredBy,
    exists: typeof exists === 'function' ? exists : () => false,
    otherRoots: rootsInConfigOrder(config, parsed.docs),
    testPattern: makePatternTester(),
  };

  const rawEdges = [];
  const edgeFacts = [
    ...parsed.docs.flatMap((d) => d.facts ?? []),
    ...validEnvelopes.flatMap((e) => e.facts),
  ].filter(isValidEdgeFact);

  for (const fact of edgeFacts) {
    const subjPath = docPathOfSubject(fact.subject);
    if (subjPath === null) continue; // malformed subject; nothing to attribute the fact to
    const citingDoc = docsMap.get(subjPath) ?? { path: subjPath, includeRoot: virtualDirname(subjPath), metaType: undefined };
    // An edge's subject node must exist even when the citing doc is no
    // longer in scope (a committed fact citing a since-deleted/renamed doc).
    ensureNode(nodesById, fact.subject, ctx.docsMap.has(subjPath));

    const raw = fact.object;
    const already = /^(?:doc|frag|concept|id):/.test(raw);
    let result;
    if (already) {
      const v = validatePrefixed(raw, ctx);
      result = v.valid
        ? { kind: 'resolved', targetId: raw, metaType: v.metaType, inScope: v.inScope }
        : { kind: 'dangling', placeholder: null }; // unknown doc/anchor/concept: dangling, no phantom node
    } else {
      result = resolveRef(raw, citingDoc, ctx);
    }

    if (result.kind === 'ignored') {
      resolution.set(resolutionKey(subjPath, fact.id), 'ignored'); // URL / directory-like link target: never a finding
      continue;
    }
    if (result.kind === 'dangling') {
      resolution.set(resolutionKey(subjPath, fact.id), 'dangling');
      // Links: unresolvable = ignored ("dead links are project tooling's job"),
      // whether or not the text happens to look like a project ID.
      if (fact.relation === 'link') continue;
      findings.push(makeFinding('P09', subjPath, fact.evidence.line, `dangling reference "${raw}"`));
      // An ID-shaped-but-undeclared reference still gets its id:<ID>
      // placeholder node and edge (AD-11: "id: nodes exist only for IDs
      // with no single definition (external, undeclared, or declared
      // twice)"); plain dangling text (placeholder === null) gets neither.
      // Either way the reference itself stays 'dangling' -- P09 already says so.
      if (result.placeholder === null) continue;
      result = { kind: 'resolved', targetId: result.placeholder, metaType: undefined, inScope: undefined };
    } else {
      resolution.set(resolutionKey(subjPath, fact.id), 'resolved');
    }

    ensureNode(nodesById, result.targetId, result.inScope);
    const { relation, inverse } = typeRelation({
      rawKey: fact.relation,
      sourceMetaType: citingDoc.metaType,
      targetMetaType: result.metaType,
      config,
    });
    const from = inverse ? result.targetId : fact.subject;
    const to = inverse ? fact.subject : result.targetId;
    if (from === to) continue; // self-loop drop (still 'resolved': the reference is fine, it just points at itself)
    rawEdges.push({
      from,
      relation,
      to,
      evidence: [{ file: subjPath, line: fact.evidence.line, quote: fact.evidence.quote, provenance: fact.provenance }],
    });
  }

  // Attr facts (agent-only; parse emits edges only, per the parse contract):
  // status on a fragment is applied (first envelope, by sorted source path,
  // wins); status on a document is P18 and the parsed status wins (AD-19).
  for (const envelope of validEnvelopes) {
    for (const fact of envelope.facts) {
      if (!isValidAttrFact(fact) || fact.relation !== 'status') continue;
      const subjPath = docPathOfSubject(fact.subject);
      if (subjPath === null) continue;
      if (fact.subject.startsWith('doc:')) {
        findings.push(
          makeFinding(
            'P18',
            subjPath,
            fact.evidence.line,
            `agent fact sets status on document "${fact.subject}"; document status stays from the parse`,
          ),
        );
      } else if (fact.subject.startsWith('frag:')) {
        const node = ensureNode(nodesById, fact.subject);
        if (node.status === undefined) node.status = fact.value;
      }
    }
  }

  const edges = mergeEdges(rawEdges);

  const result = {
    nodes: sortNodes([...nodesById.values()]),
    edges: sortEdges(edges).map((e) => ({ ...e, evidence: sortEvidence(e.evidence) })),
    findings: sortFindings(findings),
  };
  Object.defineProperty(result, 'resolution', { value: resolution, enumerable: false });
  return result;
}

// ---------------------------------------------------------------------------
// loadFacts (AD-10): one committed envelope per source doc at
// `_lumina/facts/<repo-relative source path>.json`.
// ---------------------------------------------------------------------------

async function walkFacts(base, relDir, out) {
  let entries;
  try {
    entries = await readdir(join(base, relDir), { withFileTypes: true });
  } catch {
    return; // ponytail: an unreadable subdirectory is treated as empty; surfaced by lint's own fs errors if it matters
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFacts(base, rel, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const sourcePath = rel.slice(0, -'.json'.length);
      try {
        const text = await readFile(join(base, rel), 'utf8');
        out.set(sourcePath, JSON.parse(text));
      } catch (e) {
        out.set(sourcePath, { error: e.message });
      }
    }
  }
}

/**
 * Read every committed fact envelope under `_lumina/facts/`.
 * @param {string} root absolute repo root.
 * @returns {Promise<Map<string, object>>} keyed by repo-relative source doc
 *   path; a malformed file is `{error: string}` instead of a real envelope.
 */
export async function loadFacts(root) {
  const factsRoot = join(root, '_lumina', 'facts');
  const out = new Map();
  try {
    await access(factsRoot);
  } catch {
    return out;
  }
  await walkFacts(factsRoot, '', out);
  return out;
}

// ---------------------------------------------------------------------------
// computeDocStatus (AD-12): fresh / changed / stale / never-ingested.
// ---------------------------------------------------------------------------

/**
 * One doc's freshness state. Pure: every check is passed in as data.
 * @param {object} params
 * @param {string} params.path - the doc's repo-relative path (must match `envelope.source`).
 * @param {string} params.hash - the doc's current content hash.
 * @param {{schemaVersion: number, source: string, sourceHash: string, ontologyVersion: string, facts: object[]}|{error: string}|null|undefined} params.envelope
 *   - `loadFacts()`'s entry for this doc; `undefined` when never ingested,
 *   `null` when the fact file's JSON parsed to a bare `null`.
 * @param {string} params.ontologyVersion - the engine's current `ontologyVersion`.
 * @param {number} [params.schemaVersion] - the engine's current (highest
 *   understood) envelope `schemaVersion`; omit to skip this check.
 * @param {string} params.sourceText - the doc's current full text (AD-22 quote check).
 * @param {(fact: object) => boolean} params.refResolves - true when `fact`'s
 *   object/value still resolves in the freshly built graph.
 * @returns {'fresh'|'changed'|'stale'|'never-ingested'}
 */
export function computeDocStatus({ path, hash, envelope, ontologyVersion, schemaVersion, sourceText, refResolves }) {
  if (envelope === undefined) return 'never-ingested';
  if (
    envelope === null
    || envelope.error
    || !Array.isArray(envelope.facts)
    || typeof envelope.sourceHash !== 'string'
  ) return 'stale';
  if (typeof envelope.schemaVersion === 'number' && envelope.schemaVersion > schemaVersion) return 'stale';
  if (envelope.source !== path) return 'stale';
  if (envelope.ontologyVersion !== ontologyVersion) return 'stale';
  for (const fact of envelope.facts) {
    const quote = fact?.evidence?.quote;
    if (typeof quote !== 'string' || !quoteMatches(sourceText, quote)) return 'stale';
    if (!refResolves(fact)) return 'stale';
  }
  return envelope.sourceHash === hash ? 'fresh' : 'changed';
}
