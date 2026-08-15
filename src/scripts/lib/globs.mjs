/**
 * @file globs.mjs
 * @description The exemption-glob matcher behind the bidirectional-link
 * invariant. Pure — no I/O, no side effects.
 *
 * wiki.mjs decides whether to *write* a reverse edge and lint.mjs decides
 * whether to *report* a missing one. Both read EXEMPTION_GLOBS from
 * schemas.mjs, but each used to interpret it with its own matcher: wiki.mjs
 * compiled a general glob, lint.mjs special-cased exactly three shapes. They
 * agreed only on the four globs shipped today — adding a single-`*` glob to
 * schemas.mjs would have made wiki.mjs skip a reverse edge that lint.mjs then
 * wrote back on every `--fix`. One matcher, so that cannot happen.
 */

import { EXEMPTION_GLOBS } from '../schemas.mjs';

/** Matches the `*://*` pattern: any URL-shaped target. */
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

/**
 * Compile a glob supporting `*` (within one path segment) and `**` (any).
 * @param {string} pattern
 * @returns {RegExp}
 */
function compileGlob(pattern) {
  const body = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*');
  return new RegExp(`^${body}$`);
}

/** Compiled-glob cache, so a repeated pattern is compiled once per process. */
const _compiled = new Map();

/**
 * Simple glob matcher supporting `*` and `**`, plus the `*://*` URL pattern.
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
export function matchGlob(pattern, str) {
  const p = pattern.replace(/\\/g, '/');
  const s = str.replace(/\\/g, '/');
  if (p === '*://*') return URL_RE.test(s);
  let re = _compiled.get(p);
  if (!re) {
    re = compileGlob(p);
    _compiled.set(p, re);
  }
  return re.test(s);
}

/** EXEMPTION_GLOBS is static, so compile it once at module load. */
const EXEMPTION_MATCHERS = EXEMPTION_GLOBS.map(glob =>
  glob === '*://*' ? (s) => URL_RE.test(s) : ((re) => (s) => re.test(s))(compileGlob(glob)),
);

/**
 * Check whether a target slug/path matches any exemption glob — i.e. whether
 * a forward edge to it is allowed to exist without a reverse.
 * @param {string} target
 * @returns {boolean}
 */
export function isExempt(target) {
  const s = target.replace(/\\/g, '/');
  for (const match of EXEMPTION_MATCHERS) {
    if (match(s)) return true;
  }
  return false;
}
