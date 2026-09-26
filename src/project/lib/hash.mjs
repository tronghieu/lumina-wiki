/**
 * @file hash.mjs
 * @description Hashing primitives shared by the project engine: hex sha256,
 * a canonical (sorted-key) JSON serializer for stable hash inputs, and the
 * content hash used for freshness (AD-12). Pure — no I/O.
 */

import { createHash } from 'node:crypto';

/**
 * Hex sha256 digest of a string or Buffer.
 * @param {string|Buffer} input
 * @returns {string} lowercase hex digest
 */
export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic JSON serialization: object keys sorted recursively, arrays
 * keep their order. Used so hash inputs never depend on key insertion order.
 * @param {*} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Content hash for freshness (AD-12): sha256 of the file bytes after
 * stripping a leading UTF-8 BOM and normalizing CRLF and lone CR to LF.
 * Operates on raw bytes via latin1 so multi-byte UTF-8 sequences (whose
 * continuation bytes never equal 0x0D/0x0A) are left untouched.
 * @param {Buffer} buf
 * @returns {string} lowercase hex digest
 */
export function contentHash(buf) {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3;
  }
  const raw = buf.toString('latin1', start);
  const normalized = raw.replace(/\r\n?/g, '\n');
  return sha256Hex(Buffer.from(normalized, 'latin1'));
}
