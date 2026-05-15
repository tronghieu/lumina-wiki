/**
 * @module external-ids
 * Pure helpers for external identifiers (DOI/arXiv/S2/URL). No I/O.
 * Mirrored in src/tools/id_utils.py — gated by tests/fixtures/id-cases.json.
 * Patterns: anchored, ASCII-only, bounded (ReDoS-safe).
 */

import { URL } from 'node:url';
import { EXTERNAL_ID_NAMESPACES } from './schemas.mjs';

export const CANONICAL_URL_V = 1;
// Re-exported for back-compat with consumers that import from this module.
// Source of truth lives in schemas.mjs (pure data, no I/O).
// Documented in docs/project-context.md §"external_ids namespace registry".
export { EXTERNAL_ID_NAMESPACES };

const NS_SET = new Set(EXTERNAL_ID_NAMESPACES);
const MAX_URL_LEN = 2048;

/** Bounded patterns. All anchored, ASCII, no named groups. */
export const EXTERNAL_ID_PATTERNS = Object.freeze({
  doi:        /^10\.[0-9]{4,9}\/[A-Za-z0-9._\-/()]{1,256}$/,
  arxiv_new:  /^[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?$/,
  arxiv_old:  /^[a-z\-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v[0-9]+)?$/,
  s2:         /^[a-f0-9]{40}$/,
  doi_arxiv:  /^10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)$/i,
  // OpenAlex Work ID only — reject Author (A), Institution (I), Publisher (P), Venue (V), Source (S) IDs.
  openalex:   /^W[0-9]{1,12}$/,
});

const ARXIV_VERSION_RE = /v([0-9]+)$/;
const TRACKING_PARAM_RE = /^(utm_|ref$|ref_)/i;

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

// Lowercase host, force https, strip fragment + utm_/ref params, no trailing /.
export function canonicalizeUrl(raw) {
  if (typeof raw !== 'string') throw new TypeError('canonicalizeUrl: expected string');
  if (raw.length > MAX_URL_LEN) throw new RangeError(`canonicalizeUrl: length > ${MAX_URL_LEN}`);
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) > 127) throw new RangeError('canonicalizeUrl: non-ASCII');
  }
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new RangeError(`canonicalizeUrl: unsupported protocol ${u.protocol}`);
  }
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const keep = [];
  for (const [k, v] of u.searchParams) {
    if (TRACKING_PARAM_RE.test(k)) continue;
    keep.push([k, v]);
  }
  const search = new URLSearchParams();
  for (const [k, v] of keep.sort(([a], [b]) => a.localeCompare(b))) search.append(k, v);
  u.search = search.toString();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/** Normalize raw value for a namespace → { id, valid, extras }. */
export function normalizeExternalId(kind, raw) {
  const extras = {};
  if (typeof raw !== 'string' || !raw || !NS_SET.has(kind)) {
    return { id: null, valid: false, extras };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { id: null, valid: false, extras };

  if (kind === 'doi') {
    let body = trimmed
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '');
    body = decodeURIComponentSafe(body).toLowerCase();
    // DOI body charset includes '/' and '.' — explicitly reject '..' so a
    // valid-shaped DOI like "10.0000/../../etc/passwd" cannot be persisted
    // and later trusted by a consumer that skips safeIdToken.
    if (body.includes('..')) return { id: null, valid: false, extras };
    if (!EXTERNAL_ID_PATTERNS.doi.test(body)) return { id: null, valid: false, extras };
    return { id: body, valid: true, extras };
  }

  if (kind === 'arxiv') {
    let body = trimmed
      .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '')
      .replace(/^arxiv:/i, '')
      .replace(/\.pdf$/i, '');
    const vMatch = ARXIV_VERSION_RE.exec(body);
    if (vMatch) extras.arxiv_version = parseInt(vMatch[1], 10);
    const baseId = body.replace(ARXIV_VERSION_RE, '');
    if (!EXTERNAL_ID_PATTERNS.arxiv_new.test(baseId) && !EXTERNAL_ID_PATTERNS.arxiv_old.test(baseId)) {
      return { id: null, valid: false, extras: {} };
    }
    return { id: baseId, valid: true, extras };
  }

  if (kind === 's2') {
    const body = trimmed.toLowerCase();
    if (!EXTERNAL_ID_PATTERNS.s2.test(body)) return { id: null, valid: false, extras };
    return { id: body, valid: true, extras };
  }

  if (kind === 'openalex') {
    // Strip optional URL prefixes (openalex.org, api.openalex.org/works/) and
    // any leading `openalex:` scheme tag. OpenAlex Work IDs are case-sensitive
    // with a leading capital `W`; do NOT lowercase the body before regex check.
    const body = trimmed
      .replace(/^https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?/i, '')
      .replace(/^openalex:/i, '');
    if (!EXTERNAL_ID_PATTERNS.openalex.test(body)) {
      return { id: null, valid: false, extras };
    }
    return { id: body, valid: true, extras };
  }

  if (kind === 'url') {
    try {
      const id = canonicalizeUrl(trimmed);
      return { id, valid: true, extras: { canonical_v: CANONICAL_URL_V } };
    } catch (_) {
      return { id: null, valid: false, extras };
    }
  }
  return { id: null, valid: false, extras };
}

/** Inspect URL; emit namespaces it implies + canonical url. */
export function parseUrlToExternalIds(raw) {
  const out = {};
  if (typeof raw !== 'string' || raw.length > MAX_URL_LEN) return out;
  let canon;
  try { canon = canonicalizeUrl(raw); } catch (_) { return out; }
  out.url = canon;
  const doiMatch = /^https:\/\/doi\.org\/(.+)$/i.exec(canon);
  if (doiMatch) {
    const r = normalizeExternalId('doi', doiMatch[1]);
    if (r.valid) out.doi = r.id;
  }
  const axMatch = /^https:\/\/arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i.exec(canon);
  if (axMatch) {
    const r = normalizeExternalId('arxiv', axMatch[1]);
    if (r.valid) out.arxiv = r.id;
  }
  const oaMatch = /^https:\/\/(?:api\.)?openalex\.org\/(?:works\/)?(W[0-9]{1,12})$/i.exec(canon);
  if (oaMatch) {
    const r = normalizeExternalId('openalex', oaMatch[1]);
    if (r.valid) out.openalex = r.id;
  }
  return out;
}

/** Synthesize cross-namespace equivalents (arxiv↔arxiv-DOI). New object. */
export function expandExternalIds(ids) {
  const out = Object.create(null);
  if (!ids || typeof ids !== 'object') return out;
  for (const ns of EXTERNAL_ID_NAMESPACES) {
    const v = ids[ns];
    if (typeof v === 'string' && v) out[ns] = v;
  }
  if (out.arxiv && !out.doi) {
    out.doi = `10.48550/arxiv.${out.arxiv}`;
  } else if (out.doi && !out.arxiv) {
    const m = EXTERNAL_ID_PATTERNS.doi_arxiv.exec(out.doi);
    if (m) out.arxiv = m[1];
  }
  return out;
}

/** Best stable key for dedup: doi > arxiv > s2 > url > openalex. */
export function externalIdMatchKey(ids) {
  if (!ids || typeof ids !== 'object') return null;
  for (const ns of EXTERNAL_ID_NAMESPACES) {
    const v = ids[ns];
    if (typeof v === 'string' && v) return `${ns}:${v}`;
  }
  return null;
}

/** Re-validate before path/glob concatenation. Throws on traversal/meta chars. */
export function safeIdToken(kind, val) {
  if (typeof val !== 'string' || !val) throw new RangeError('safeIdToken: empty');
  if (val.length > MAX_URL_LEN) throw new RangeError('safeIdToken: too long');
  if (/[\x00-\x1f\\"'`*?<>|]/.test(val)) throw new RangeError('safeIdToken: control or meta char');
  if (val.includes('..')) throw new RangeError('safeIdToken: traversal');
  const r = normalizeExternalId(kind, val);
  if (!r.valid || r.id !== val) throw new RangeError(`safeIdToken: not a valid ${kind}`);
  return val;
}

// Provider slug for `sources` array entries. Kebab/snake lowercase, ≤32 chars.
const PROVIDER_SLUG_RE = /^[a-z][a-z0-9_-]{0,31}$/;

// Upper bound for `ns/value` payload — same cap as URL to avoid arbitrary growth.
const MAX_VALUE_LEN = 2048;

/**
 * Build one provenance entry for the `sources` frontmatter array.
 * Caller appends into existing array — this helper is pure (no I/O).
 *
 * `ns` + `value` (added 2026-05) record *which* external identifier this
 * provider resolved/returned. Both must be present together to persist; if
 * either is missing or invalid, both are dropped silently — same forgiveness
 * model as the existing `url` field.
 *
 * @param {string} provider - Fetcher slug (e.g. 'arxiv', 's2', 'openalex', 'pdf').
 * @param {{url?: string, fetched_at?: string, ns?: string, value?: string}} [opts]
 * @returns {{provider: string, fetched_at: string, url?: string, ns?: string, value?: string}}
 */
export function buildSourceEntry(provider, opts = {}) {
  if (typeof provider !== 'string' || !PROVIDER_SLUG_RE.test(provider)) {
    throw new RangeError(`buildSourceEntry: invalid provider: ${provider}`);
  }
  let fetched_at = opts.fetched_at;
  if (typeof fetched_at !== 'string' || !fetched_at) {
    fetched_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const entry = { provider, fetched_at };
  if (typeof opts.url === 'string' && opts.url && opts.url.length <= MAX_URL_LEN) {
    // Best-effort URL parse — drop on failure so junk like "not a url" is
    // never persisted into provenance. Canonicalization NOT applied: provenance
    // records the URL the user/skill saw, not a normalized form.
    try {
      // eslint-disable-next-line no-new
      new URL(opts.url);
      entry.url = opts.url;
    } catch (_) { /* drop silently */ }
  }
  if (
    typeof opts.ns === 'string' && NS_SET.has(opts.ns)
    && typeof opts.value === 'string' && opts.value
    && opts.value.length <= MAX_VALUE_LEN
  ) {
    entry.ns = opts.ns;
    entry.value = opts.value;
  }
  return entry;
}

/** Allowlist filter; rejects __proto__/constructor/etc. Returns Object.create(null). */
export function sanitizeExternalIdsObject(obj) {
  const out = Object.create(null);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const ns of EXTERNAL_ID_NAMESPACES) {
    if (!Object.prototype.hasOwnProperty.call(obj, ns)) continue;
    const v = obj[ns];
    if (typeof v !== 'string' || !v) continue;
    out[ns] = v;
  }
  return out;
}
