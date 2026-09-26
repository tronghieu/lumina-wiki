/**
 * @file factfile.mjs
 * @description Everything `facts-write` and `verify-evidence` need that has
 * no filesystem access of its own (AD-10, AD-18, AD-22): validate one doc's
 * incoming fact set against the current parse, canonicalize each fact
 * through the shared resolver, build the committed envelope, and check a
 * committed envelope's evidence against the live docs. Pure -- no I/O.
 * `project.mjs` supplies everything that touches disk (`parsed`, `texts`,
 * the injected `resolve` closure over `lib/graph.mjs`'s resolver context)
 * and does the actual read/write.
 */

import { makeFact } from './fact.mjs';
import { makeQuoteMatcher, makeQuoteLocator } from './evidence.mjs';
import { slug } from './markdown.mjs';
import { CURRENT_SCHEMA_VERSION } from './config.mjs';
import {
  PREFIXED_ID_RE, sortFindings, makeFinding, cmp, isNewerSchema, foldPath, makeFactKeyOwner, widensToDoc,
} from './graph.mjs';

// ---------------------------------------------------------------------------
// Case-only rename (AD-10): on APFS/NTFS (case-insensitive, case-preserving
// filesystems), re-ingesting a doc renamed only by case keeps the fact
// file's on-disk name from before the rename -- `atomicWrite`'s rename onto
// an existing, case-differing entry overwrites its content but not its
// name. So a fact file's own path-derived key (from `loadFacts`'s directory
// walk) can differ from its envelope's declared `source`, or from a doc's
// own path, by case alone. Every such comparison folds through
// `graph.mjs#foldPath`: `sameSourcePath` below (envelope source vs. its own
// key), `graph.mjs#makeFactKeyOwner` (which doc a key belongs to --
// `buildGraph`, `verifyEvidence`, `findPruneCandidates`), and
// `makeEnvelopeLookup` (project.mjs, `computeDocStatuses`).
// ---------------------------------------------------------------------------

/** True when `a` and `b` name the same path, ignoring case (after NFC normalization) -- an equivalence test for two strings already known to be repo-relative paths, never a security check. */
export function sameSourcePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return foldPath(a) === foldPath(b);
}

// ---------------------------------------------------------------------------
// Subject validation: `doc:<source>` or `frag:<source>#<anchor>`, anchor
// retried once through `slug()` (AD-20's slugger, shared -- not a second one).
// ---------------------------------------------------------------------------

/** @returns {{ok: true, subject: string}|{ok: false}} */
function checkSubject(subject, source, doc) {
  if (typeof subject !== 'string') return { ok: false };
  if (subject === `doc:${source}`) return { ok: true, subject };

  const m = /^frag:([^#]*)#([\s\S]*)$/.exec(subject);
  if (!m || m[1] !== source) return { ok: false };

  const anchor = m[2];
  const headings = doc?.headings ?? [];
  const hasAnchor = (a) => headings.some((h) => h.anchor === a);
  if (hasAnchor(anchor)) return { ok: true, subject };

  const slugged = slug(anchor);
  if (slugged !== anchor && hasAnchor(slugged)) return { ok: true, subject: `frag:${source}#${slugged}` };

  return { ok: false };
}

// ---------------------------------------------------------------------------
// Object canonicalization through the shared resolver (AD-11): resolved ->
// its node id; unresolved and unprefixed -> kept as written (build reports
// P09); a prefixed doc:/frag:/concept: object that fails to resolve, or an
// anchor an in-scope target lacks (`widensToDoc`) -> rejected (`id:` never
// rejects: `resolve` always reports it as resolved).
// ---------------------------------------------------------------------------

/**
 * Canonicalize one fact object exactly as `facts-write` commits it -- also
 * `query resolve`'s whole answer, so the two never disagree.
 * @returns {{resolution: 'resolved'|'dangling'|'ignored', object: string, inScope?: boolean}}
 *   `object` is the value to commit (the node id when resolved, else `raw`).
 * @throws {Error} when the object is rejected.
 */
export function canonicalizeObject(raw, citingDoc, resolve) {
  const result = resolve(raw, citingDoc);
  if (result.kind === 'resolved') {
    if (widensToDoc(raw, result)) throw new Error(`object "${raw}" names an anchor the target doc does not have`);
    return { resolution: 'resolved', object: result.targetId, inScope: result.inScope };
  }
  if (result.kind === 'ignored') return { resolution: 'ignored', object: raw };
  if (PREFIXED_ID_RE.test(raw)) throw new Error(`object "${raw}" does not resolve`);
  return { resolution: 'dangling', object: raw };
}

// ---------------------------------------------------------------------------
// One fact: validate, canonicalize, build through `makeFact` (AD-18).
// ---------------------------------------------------------------------------

function prepareOneFact(raw, {
  source, doc, locateQuote, resolve,
}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('fact must be an object');
  }
  const {
    kind, subject, relation, object, value, ref: inputRef, scope, evidence, provenance,
  } = raw;

  // Only the checks that must run *before* the calls below -- everything
  // else (kind, relation, provenance, ref shape, object/value
  // presence/exclusivity) `makeFact` already enforces (fact.mjs); no need to
  // check it twice.
  if (!evidence || typeof evidence !== 'object' || typeof evidence.quote !== 'string' || evidence.quote.length === 0) {
    throw new Error('evidence.quote must be a non-empty string');
  }
  if (scope !== undefined && scope !== null && (typeof scope !== 'string' || scope.length === 0)) {
    throw new Error('scope must be a non-empty string');
  }

  const subjectCheck = checkSubject(subject, source, doc);
  if (!subjectCheck.ok) {
    throw new Error(`subject ${JSON.stringify(subject)} is not "doc:${source}" or one of its known fragments`);
  }
  const canonicalSubject = subjectCheck.subject;

  const line = locateQuote(evidence.quote);
  if (line === null) {
    throw new Error(`evidence.quote not found in ${source}: ${JSON.stringify(evidence.quote)}`);
  }

  let canonicalObject;
  if (kind === 'edge') {
    if (typeof object !== 'string' || object.length === 0) {
      throw new Error('object must be a non-empty string');
    }
    canonicalObject = canonicalizeObject(object, doc, resolve).object;
  }

  const ref = inputRef ?? (kind === 'edge' ? object : subject);

  return makeFact({
    kind,
    subject: canonicalSubject,
    relation,
    ...(kind === 'edge' ? { object: canonicalObject } : { value }),
    ref,
    scope,
    evidence: { line, quote: evidence.quote },
    provenance,
  });
}

// ---------------------------------------------------------------------------
// prepareEnvelope / serializeEnvelope
// ---------------------------------------------------------------------------

/**
 * Validate and canonicalize one doc's incoming fact set, and build the
 * envelope `facts-write` commits. All-or-nothing: any invalid fact makes
 * this throw with every problem listed, and nothing is built.
 * @param {{source: string, sourceHash: string, facts: object[]}} input as read from stdin.
 * @param {object} deps
 * @param {{docs: object[], texts: Map<string, string>}} deps.parsed `parseAll()`'s output.
 * @param {(raw: string, citingDoc: object) => object} deps.resolve the shared
 *   resolver (`lib/graph.mjs#resolveFactRef`, closed over a
 *   `makeResolverContext` context) -- injected so this module stays pure.
 * @param {string} deps.ontologyVersion the engine's current `ontologyVersion(config)`.
 * @returns {{schemaVersion: number, source: string, sourceHash: string, ontologyVersion: string, facts: object[]}}
 * @throws {Error & {errors: {index: number, message: string}[]}} when any fact is invalid.
 */
export function prepareEnvelope(input, { parsed, resolve, ontologyVersion }) {
  const source = input.source;
  const doc = parsed.docs.find((d) => d.path === source);
  const sourceText = parsed.texts.get(source) ?? '';
  // Built once per doc, not once per incoming fact: every fact in this call
  // is located against the same source text.
  const locateQuote = makeQuoteLocator(sourceText);

  const errors = [];
  const byId = new Map(); // id -> record, first write wins (dedup)
  const order = [];

  (input.facts ?? []).forEach((raw, index) => {
    try {
      const record = prepareOneFact(raw, {
        source, doc, locateQuote, resolve,
      });
      if (!byId.has(record.id)) {
        byId.set(record.id, record);
        order.push(record.id);
      }
    } catch (e) {
      errors.push({ index, message: e.message });
    }
  });

  if (errors.length > 0) {
    const err = new Error(`facts-write: ${errors.length} invalid fact(s)`);
    err.errors = errors;
    throw err;
  }

  const facts = order.map((id) => byId.get(id)).sort((a, b) => cmp(a.id, b.id));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    source,
    sourceHash: input.sourceHash,
    ontologyVersion,
    facts,
  };
}

/**
 * Serialize an envelope the way `facts-write` commits it: pretty JSON with a
 * trailing newline, key order preserved exactly as built by `prepareEnvelope`.
 * @param {object} envelope
 * @returns {string}
 */
export function serializeEnvelope(envelope) {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// verifyEvidence (CAP-11, AD-22): every committed fact file against the
// live docs. Report-only -- never edits a fact file.
// ---------------------------------------------------------------------------

export function isV1Envelope(envelope) {
  return !!envelope && typeof envelope === 'object' && !envelope.error
    && envelope.schemaVersion === CURRENT_SCHEMA_VERSION
    && Array.isArray(envelope.facts)
    && typeof envelope.source === 'string'
    && typeof envelope.sourceHash === 'string';
}

/** A stored `evidence.line` reported as-is only when it's a real 1-based line number; otherwise line 1 (same fallback `makeFinding` needs everywhere else). */
function evidenceLineOf(fact) {
  const raw = fact?.evidence?.line;
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/**
 * Every in-scope doc whose content hash matches `envelope.sourceHash`,
 * except one that already has its own committed fact file (already
 * re-ingested under its new name, not still a candidate). The one "which
 * docs could this orphaned envelope have been renamed from" set
 * `verifyEvidence` (P15) and `findPruneCandidates` ("rename-candidate")
 * both need, instead of two copies.
 * @param {{sourceHash: string}} envelope
 * @param {object[]} docs `parsed.docs`, or an equivalent list of `{path, hash}`.
 * @param {Set<string>} committedSources source paths that already have their own committed fact file.
 * @returns {object[]}
 */
export function renameCandidates(envelope, docs, committedSources) {
  return docs.filter((d) => d.hash === envelope.sourceHash && !committedSources.has(d.path));
}

/**
 * Check every committed fact envelope against the live parse.
 * @param {object} params
 * @param {{docs: object[], texts: Map<string, string>}} params.parsed `parseAll()`'s output.
 * @param {Map<string, object>} params.facts `loadFacts()`'s output.
 * @param {(path: string) => boolean} [params.exists] true when `path` (a fact
 *   file's own key) is a file on disk; defaults to "never". A doc out of
 *   scope but still on disk is a P14 warning (its facts are kept, same as
 *   `findPruneCandidates`), not an error.
 * @returns {object[]} findings, sorted.
 */
export function verifyEvidence({ parsed, facts, exists = () => false }) {
  const ownerOf = makeFactKeyOwner(parsed.docs, facts);
  const entries = [...facts];
  // Every source path that already has its own committed fact file --
  // a doc in this set is never itself a rename candidate.
  const committedSources = new Set(entries.map(([key]) => key));

  const findings = [];

  for (const [key, envelope] of entries) {
    const factFile = `_lumina/facts/${key}.json`;

    if (!isV1Envelope(envelope)) {
      const reason = envelope && envelope.error ? envelope.error : 'not a v1 fact envelope';
      findings.push(makeFinding('P14', key, 1, `malformed fact file ${factFile}: ${reason}`));
      continue;
    }
    if (!sameSourcePath(envelope.source, key)) {
      findings.push(makeFinding('P14', key, 1, `fact file ${factFile}: source "${envelope.source}" does not match its own path "${key}"`));
      continue;
    }

    const source = envelope.source;
    // Same owner rule and order as `findPruneCandidates`: the key's own
    // doc, else out of scope but on disk, else a rename candidate, else gone.
    const doc = ownerOf(key);
    if (!doc) {
      const candidates = renameCandidates(envelope, parsed.docs, committedSources);
      if (exists(key)) {
        findings.push(makeFinding('P14', source, 1, `source out of scope: "${source}" is still on disk but no longer in scope; its facts are kept`, 'warning'));
      } else if (candidates.length > 0) {
        for (const candidate of candidates) {
          findings.push(makeFinding('P15', candidate.path, 1, `rename candidate: facts committed for "${source}" match this doc's content`));
        }
      } else {
        findings.push(makeFinding('P14', source, 1, `source gone: "${source}" is no longer in scope`));
      }
      continue;
    }

    const sourceText = parsed.texts.get(doc.path) ?? '';
    const matches = makeQuoteMatcher(sourceText);
    for (const fact of envelope.facts) {
      const quote = fact?.evidence?.quote;
      if (typeof quote !== 'string' || !matches(quote)) {
        findings.push(makeFinding('P14', doc.path, evidenceLineOf(fact), `broken evidence for fact ${fact?.id ?? '?'}: quote no longer found: ${JSON.stringify(quote)}`));
      }
    }
  }

  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// findPruneCandidates (AD-10, `facts-prune`): classifies every committed
// fact file by its own path-derived key -- never by `envelope.source`. A
// fact file that sits at an in-scope doc's own path is always that doc's
// slot (re-ingest overwrites it), no matter what a stale or mismatched
// envelope inside it claims; that is what keeps a live doc's facts safe
// even when its envelope names a gone or different source. Reuses
// `isV1Envelope` and the same rename-candidate detection as `verifyEvidence`
// above, instead of re-deriving it. Pure -- `project.mjs` supplies `exists`
// (filesystem access) and does the actual delete.
// ---------------------------------------------------------------------------

/**
 * Classify every committed fact file. Order matters: a newer schema is
 * never touched regardless of scope; a live doc's own slot is never even
 * reported; only then do "out of scope but still present" and
 * "rename candidate" apply; everything else means the doc is gone.
 * @param {object} params
 * @param {{docs: object[], warnings?: {message: string}[]}} params.parsed `parseAll()`'s output.
 * @param {Map<string, object>} params.facts `loadFacts()`'s output.
 * @param {(path: string) => boolean} params.exists true when `path` (the fact
 *   file's own repo-relative key) is a file on disk right now, in or out of
 *   scope -- `project.mjs`'s `existsUnderRoot(root)`.
 * @returns {{removed: string[], kept: {file: string, reason: string, candidate?: string}[], warnings: object[]}}
 *   `removed` is fact file paths (`_lumina/facts/<key>.json`); `removed` and
 *   `kept` are both sorted; `warnings` are P16 findings from `parsed.warnings`.
 */
export function findPruneCandidates({ parsed, facts, exists }) {
  const ownerOf = makeFactKeyOwner(parsed.docs, facts);
  const entries = [...facts];
  // Same rule as `verifyEvidence`: a source that already has its own
  // committed fact file is never itself a rename candidate.
  const committedSources = new Set(entries.map(([key]) => key));

  const removed = [];
  const kept = [];

  for (const [key, envelope] of entries) {
    const factFile = `_lumina/facts/${key}.json`;

    // 1. A newer schema than this engine understands: never delete it.
    const rawSchemaVersion = envelope && typeof envelope === 'object' && !envelope.error
      ? envelope.schemaVersion
      : undefined;
    if (isNewerSchema(rawSchemaVersion, CURRENT_SCHEMA_VERSION)) {
      kept.push({ file: factFile, reason: 'newer-schema' });
      continue;
    }

    // 2. The key (case-only rename aware, AD-10) is an in-scope doc's own
    // path: this is that doc's slot, not listed at all. A case-only leftover
    // beside the doc's own exact-key file belongs to no doc and falls through.
    if (ownerOf(key)) continue;

    // 3. The key's doc still exists on disk, just out of scope (a scope
    // edit or a typo): keep it -- pruning it would lose paid-for facts.
    if (exists(key)) {
      kept.push({ file: factFile, reason: 'out-of-scope' });
      continue;
    }

    // 4. A rename candidate (P15): a well-formed envelope whose content
    // hash matches an in-scope doc with no envelope of its own yet.
    const candidates = isV1Envelope(envelope)
      ? renameCandidates(envelope, parsed.docs, committedSources)
      : [];
    if (candidates.length > 0) {
      const candidate = candidates.map((d) => d.path).sort()[0];
      kept.push({ file: factFile, reason: 'rename-candidate', candidate });
      continue;
    }

    // 5. Otherwise the doc is gone.
    removed.push(factFile);
  }

  removed.sort();
  kept.sort((a, b) => cmp(a.file, b.file));

  const warnings = sortFindings(
    (parsed.warnings ?? []).map((w) => makeFinding('P16', '_lumina/config/project.yaml', 1, w.message)),
  );

  return { removed, kept, warnings };
}
