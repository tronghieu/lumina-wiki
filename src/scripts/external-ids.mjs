/**
 * @module external-ids
 * Pure helpers for external identifiers (DOI/arXiv/S2/URL). No I/O.
 * Mirrored in src/tools/id_utils.py — gated by tests/fixtures/id-cases.json.
 * Patterns: anchored, ASCII-only, bounded (ReDoS-safe).
 */

import { URL } from 'node:url';

export const CANONICAL_URL_V = 1;
// Single source of truth for namespace registry.
// Documented in docs/project-context.md §"external_ids namespace registry".
// Adding a namespace here without updating docs/project-context.md is a bug.
export const EXTERNAL_ID_NAMESPACES = Object.freeze(['doi', 'arxiv', 's2', 'url']);

const NS_SET = new Set(EXTERNAL_ID_NAMESPACES);
const MAX_URL_LEN = 2048;

/** Bounded patterns. All anchored, ASCII, no named groups. */
export const EXTERNAL_ID_PATTERNS = Object.freeze({
  doi:        /^10\.[0-9]{4,9}\/[A-Za-z0-9._\-/()]{1,256}$/,
  arxiv_new:  /^[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?$/,
  arxiv_old:  /^[a-z\-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v[0-9]+)?$/,
  s2:         /^[a-f0-9]{40}$/,
  doi_arxiv:  /^10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)$/i,
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

/** Best stable key for dedup: doi > arxiv > s2 > url. */
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
