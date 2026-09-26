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
import { quoteMatches, findQuoteLine } from './evidence.mjs';
import { slug } from './markdown.mjs';
import { CURRENT_SCHEMA_VERSION } from './config.mjs';
import { RULES } from '../ontology.mjs';
import { PREFIXED_ID_RE, sortFindings, makeFinding } from './graph.mjs';

for (const id of ['P14', 'P15']) {
  if (!RULES.some((r) => r.id === id)) throw new Error(`ontology.mjs RULES is missing rule ${id}`);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
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
// P09); a prefixed doc:/frag:/concept: object that fails to resolve ->
// rejected (`id:` never rejects: `resolve` always reports it as resolved).
// ---------------------------------------------------------------------------

function canonicalizeObject(raw, citingDoc, resolve) {
  const already = PREFIXED_ID_RE.test(raw);
  const result = resolve(raw, citingDoc);
  if (result.kind === 'resolved') {
    // An anchor an in-scope target lacks falls back to the whole doc; for a fact that is a silent widening, so reject it.
    // An out-of-scope target is never parsed, so its anchors can't be checked; it stays a doc: reference.
    if (raw.includes('#') && result.targetId.startsWith('doc:') && result.inScope !== false) throw new Error(`object "${raw}" names an anchor the target doc does not have`);
    return result.targetId;
  }
  if (result.kind === 'ignored') return raw;
  // 'dangling'
  if (already) throw new Error(`object "${raw}" does not resolve`);
  return raw;
}

// ---------------------------------------------------------------------------
// One fact: validate, canonicalize, build through `makeFact` (AD-18).
// ---------------------------------------------------------------------------

function prepareOneFact(raw, { source, doc, sourceText, resolve }) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('fact must be an object');
  }
  const {
    kind, subject, relation, object, value, ref: inputRef, scope, evidence, provenance,
  } = raw;

  if (kind !== 'edge' && kind !== 'attr') {
    throw new Error(`kind must be "edge" or "attr", got ${JSON.stringify(kind)}`);
  }
  if (typeof relation !== 'string' || relation.length === 0) {
    throw new Error('relation must be a non-empty string');
  }
  if (provenance !== 'extracted' && provenance !== 'inferred') {
    throw new Error(`provenance must be "extracted" or "inferred", got ${JSON.stringify(provenance)}`);
  }
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

  // `findQuoteLine` already fails (returns null) on exactly the same
  // no-match condition `quoteMatches` would -- one call, one error branch.
  const line = findQuoteLine(sourceText, evidence.quote);
  if (line === null) {
    throw new Error(`evidence.quote not found in ${source}: ${JSON.stringify(evidence.quote)}`);
  }

  const hasObject = object !== undefined;
  const hasValue = value !== undefined;
  if (hasObject && hasValue) throw new Error('fact cannot have both object and value');
  if (kind === 'edge' && !hasObject) throw new Error('edge fact requires object');
  if (kind === 'attr' && !hasValue) throw new Error('attr fact requires value');

  let canonicalObject;
  if (kind === 'edge') {
    if (typeof object !== 'string' || object.length === 0) {
      throw new Error('object must be a non-empty string');
    }
    canonicalObject = canonicalizeObject(object, doc, resolve);
  }

  let ref;
  if (inputRef !== undefined && inputRef !== null) {
    if (typeof inputRef !== 'string' || inputRef.length === 0) {
      throw new Error('ref must be a non-empty string');
    }
    ref = inputRef;
  } else {
    ref = kind === 'edge' ? object : subject;
  }

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
 * @param {{docs: object[]}} deps.parsed `parseAll()`'s output.
 * @param {Map<string, string>} deps.texts `parsed.texts` (source path -> current decoded text).
 * @param {(raw: string, citingDoc: object) => object} deps.resolve the shared
 *   resolver (`lib/graph.mjs#resolveFactRef`, closed over a
 *   `makeResolverContext` context) -- injected so this module stays pure.
 * @param {string} deps.ontologyVersion the engine's current `ontologyVersion(config)`.
 * @returns {{schemaVersion: number, source: string, sourceHash: string, ontologyVersion: string, facts: object[]}}
 * @throws {Error & {errors: {index: number, message: string}[]}} when any fact is invalid.
 */
export function prepareEnvelope(input, {
  parsed, texts, resolve, ontologyVersion,
}) {
  const source = input.source;
  const doc = parsed.docs.find((d) => d.path === source);
  const sourceText = texts.get(source) ?? '';

  const errors = [];
  const byId = new Map(); // id -> record, first write wins (dedup)
  const order = [];

  (input.facts ?? []).forEach((raw, index) => {
    try {
      const record = prepareOneFact(raw, {
        source, doc, sourceText, resolve,
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

function isV1Envelope(envelope) {
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
 * Check every committed fact envelope against the live parse.
 * @param {object} params
 * @param {{docs: object[]}} params.parsed `parseAll()`'s output.
 * @param {Map<string, string>} params.texts `parsed.texts`.
 * @param {Map<string, object>|Record<string, object>} params.facts `loadFacts()`'s output.
 * @returns {object[]} findings, sorted.
 */
export function verifyEvidence({ parsed, texts, facts }) {
  const docsMap = new Map(parsed.docs.map((d) => [d.path, d]));
  const entries = facts instanceof Map ? [...facts.entries()] : Object.entries(facts ?? {});
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
    if (envelope.source !== key) {
      findings.push(makeFinding('P14', key, 1, `fact file ${factFile}: source "${envelope.source}" does not match its own path "${key}"`));
      continue;
    }

    const source = envelope.source;
    const doc = docsMap.get(source);
    if (!doc) {
      // A rename candidate for every in-scope doc whose content hash
      // matches -- except one that already has its own committed envelope
      // (already re-ingested under its new name, not still a candidate).
      const renameCandidates = parsed.docs.filter(
        (d) => d.hash === envelope.sourceHash && !committedSources.has(d.path),
      );
      if (renameCandidates.length > 0) {
        for (const candidate of renameCandidates) {
          findings.push(makeFinding('P15', candidate.path, 1, `rename candidate: facts committed for "${source}" match this doc's content`));
        }
      } else {
        findings.push(makeFinding('P14', source, 1, `source gone: "${source}" is no longer in scope`));
      }
      continue;
    }

    const sourceText = texts.get(source) ?? '';
    for (const fact of envelope.facts) {
      const quote = fact?.evidence?.quote;
      if (typeof quote !== 'string' || !quoteMatches(sourceText, quote)) {
        findings.push(makeFinding('P14', source, evidenceLineOf(fact), `broken evidence for fact ${fact?.id ?? '?'}: quote no longer found: ${JSON.stringify(quote)}`));
      }
    }
  }

  return sortFindings(findings);
}
