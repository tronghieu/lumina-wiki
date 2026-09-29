/**
 * @file scope.mjs
 * @description The one scope matcher (AD-9, `source-scope.md`). Compiles
 * `*` (one path segment) / `**` (any depth) glob patterns, mostly matching
 * classic `matchGlob` (reimplemented here, not imported, per AD-6 — checked by a parity test) except that a `**\/` segment
 * here matches zero or more directory levels, where classic `matchGlob`
 * requires at least one (a known bug there, out of scope to fix), applies
 * the always-excluded and default-excluded directories, and returns the
 * sorted, case-fold-checked in-scope file list.
 */

import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { assertSafeRelPath } from './fsx.mjs';

const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx']);

// Not overridable, matched at any depth.
const ALWAYS_EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
// Not overridable, root only.
const ALWAYS_EXCLUDED_ROOT_DIRS = new Set(['_lumina']);
// Excluded by default, root only, overridable when an include pattern's
// first segment names the dir.
const DEFAULT_EXCLUDED_ROOT_DIRS = new Set([
  '.agents', '.claude', '.agent', '.trae', '.codex', '.serena', 'graphify-out',
]);

/**
 * Compile a glob pattern into a RegExp matching repo-relative,
 * forward-slash paths. `*` matches within one path segment; a trailing or
 * bare `**` matches any depth (including zero); a `**\/` that is a whole
 * path segment matches zero or more directory levels, so `docs/**\/*.md` matches
 * `docs/a.md` as well as `docs/x/a.md`. Mirrors classic `matchGlob`'s
 * regex-building semantics except for that `**\/` zero-level case (classic
 * requires at least one directory level there — a known bug, out of scope
 * to fix); see `scope.test.mjs`'s parity test against it.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function compileGlob(pattern) {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/(?<=^|\/)\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\u0001/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
}

/** A bare directory name (or any non-recursive pattern) means everything under it. */
function normalizePattern(pattern) {
  return pattern === '**' || pattern.endsWith('/**') ? pattern : `${pattern}/**`;
}

/**
 * Strip a leading `./` and any trailing `/` so `docs/` and `./docs` behave
 * like `docs`; the repo root itself (`.`, `./`, `''`) means `**`. Exported:
 * `parse.mjs`'s include-root resolution shares this normalization instead of
 * keeping its own copy (AD-9).
 */
export function normalizeSlashes(pattern) {
  let p = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p === '' || p === '.' ? '**' : p;
}

function firstSegment(pattern) {
  const i = pattern.indexOf('/');
  return i === -1 ? pattern : pattern.slice(0, i);
}

/**
 * A pattern is in scope for a file when the file matches the pattern
 * itself (a file-level glob like `docs/*.md` or an exact path) OR the
 * pattern's directory form (bare-directory expansion, `pattern + '/**'`).
 * Exported: `parse.mjs`'s `types.<T>.paths` matching reuses this instead of
 * keeping its own copy (AD-9).
 */
export function compilePatternMatcher(pattern) {
  const clean = normalizeSlashes(pattern);
  const own = compileGlob(clean);
  const dirPattern = normalizePattern(clean);
  const dir = dirPattern === clean ? null : compileGlob(dirPattern);
  return (file) => own.test(file) || (dir !== null && dir.test(file));
}

/**
 * The pattern (own, or bare-dir-expanded) that actually matched `filePath`,
 * with each `*` segment replaced by the doc's own segment there and
 * everything from `**` on cut off -- e.g. pattern `packages` + `*` + `/docs`
 * against `packages/alpha/docs/guide.md` gives `packages/alpha/docs`. Shared by
 * `parse.mjs` (a doc's `includeRoot`) and `graph.mjs` (ordering "other
 * include roots" in config order): AD-9's "one scope matcher" covers
 * include-root derivation too, not just scope membership.
 * @param {string} pattern one `sources.include` entry.
 * @param {string} filePath repo-relative, forward-slash.
 * @returns {string|null} the resolved root, or null when `pattern` doesn't match `filePath`.
 */
export function resolveIncludeRootForPattern(pattern, filePath) {
  const clean = normalizeSlashes(pattern);
  let matched = null;
  let ownMatch = false;
  if (compileGlob(clean).test(filePath)) {
    matched = clean;
    ownMatch = true;
  } else {
    const dirPattern = normalizePattern(clean);
    if (dirPattern !== clean && compileGlob(dirPattern).test(filePath)) matched = dirPattern;
  }
  if (matched === null) return null;
  const patternSegs = matched.split('/');
  const fileSegs = filePath.split('/');
  // The pattern matched the file itself (a file-level glob or an exact
  // path, not the bare-dir-expanded `/**` form): its last segment names the
  // file, not a directory, so the root excludes it.
  const limit = ownMatch ? patternSegs.length - 1 : patternSegs.length;
  const resolved = [];
  for (let i = 0; i < limit; i++) {
    const seg = patternSegs[i];
    if (seg === '**') break;
    if (seg === '*') {
      resolved.push(fileSegs[i]);
      continue;
    }
    if (seg.includes('*')) break; // a mixed segment (e.g. `*.md`) is not a fixed root component
    resolved.push(seg);
  }
  return resolved.join('/');
}

/**
 * The `includeRoot` for `filePath`: the root resolved from the first
 * `include` pattern (config order) that matches it.
 * @param {string[]} include `sources.include` (already defaulted by the caller).
 * @param {string} filePath
 * @returns {string|null}
 */
export function resolveIncludeRoot(include, filePath) {
  for (const pattern of include) {
    const root = resolveIncludeRootForPattern(pattern, filePath);
    if (root !== null) return root;
  }
  return null;
}

/** Thrown when two in-scope paths collide after case-folding. `code: 2`. */
export class ScopeCollisionError extends Error {
  constructor(pairs) {
    super(`case-fold collision: ${pairs.map(([a, b]) => `${a} vs ${b}`).join(', ')}`);
    this.name = 'ScopeCollisionError';
    this.code = 2;
    this.pairs = pairs;
  }
}

/**
 * Find pairs of paths that collide once case-folded (e.g. `docs/A.md` and
 * `docs/a.md`). Pure — no filesystem access — so it can be tested without a
 * real case-sensitive directory (this project's own checkout may sit on a
 * case-insensitive filesystem where such a pair cannot coexist on disk).
 * @param {string[]} paths
 * @returns {Array<[string, string]>} sorted pairs, stable for a stable input order.
 */
export function findCaseFoldCollisions(paths) {
  const byFold = new Map();
  for (const p of paths) {
    const key = p.normalize('NFC').toLowerCase();
    if (!byFold.has(key)) byFold.set(key, []);
    byFold.get(key).push(p);
  }
  const pairs = [];
  for (const group of byFold.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) pairs.push([group[i], group[j]]);
    }
  }
  return pairs;
}

async function walk(root, dir, overriddenRootDirs, out, warnings) {
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch (e) {
    // An unreadable dir below the root (e.g. a root-owned bind mount) is
    // skipped with a warning instead of failing every subcommand.
    if (dir === '' || (e.code !== 'EACCES' && e.code !== 'EPERM')) throw e;
    warnings.push({ rule: 'P16', pattern: dir, message: `directory not readable, skipped: ${dir}` });
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // ponytail: skip symlinks, follow if a pilot needs vaulted docs
    const relPath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const atRoot = dir === '';
      if (atRoot && (ALWAYS_EXCLUDED_DIRS.has(entry.name) || ALWAYS_EXCLUDED_ROOT_DIRS.has(entry.name))) continue;
      if (atRoot && DEFAULT_EXCLUDED_ROOT_DIRS.has(entry.name) && !overriddenRootDirs.has(entry.name)) continue;
      if (!atRoot && ALWAYS_EXCLUDED_DIRS.has(entry.name)) continue;
      await walk(root, relPath, overriddenRootDirs, out, warnings);
    } else if (entry.isFile()) {
      if (MARKDOWN_EXT.has(extname(entry.name).toLowerCase())) out.push(relPath);
    }
  }
}

/**
 * Select in-scope markdown files under `root` given already-parsed
 * `{include, exclude}` glob sources.
 * @param {string} root absolute repo root
 * @param {{include?: string[], exclude?: string[]}} sources
 * @returns {Promise<{files: string[], warnings: Array<{rule: string, pattern: string, message: string}>}>}
 * @throws {RangeError} an include/exclude pattern is unsafe.
 * @throws {ScopeCollisionError} two in-scope paths collide after case-folding.
 */
export async function selectScope(root, sources) {
  const rawInclude = sources?.include?.length ? sources.include : ['docs'];
  const rawExclude = sources?.exclude ?? [];

  for (const p of [...rawInclude, ...rawExclude]) assertSafeRelPath(p);

  const overriddenRootDirs = new Set(
    rawInclude.map((p) => firstSegment(normalizeSlashes(p))).filter((s) => DEFAULT_EXCLUDED_ROOT_DIRS.has(s)),
  );

  const includeRes = rawInclude.map((pattern) => ({ pattern, match: compilePatternMatcher(pattern) }));
  const excludeRes = rawExclude.map((pattern) => compilePatternMatcher(pattern));

  const allFiles = [];
  const warnings = [];
  await walk(root, '', overriddenRootDirs, allFiles, warnings);
  warnings.sort((a, b) => (a.pattern < b.pattern ? -1 : 1)); // readdir order is not stable across filesystems

  const matchedPatterns = new Set();
  const files = [];
  for (const file of allFiles) {
    let included = false;
    for (const { pattern, match } of includeRes) {
      if (match(file)) {
        included = true;
        matchedPatterns.add(pattern);
      }
    }
    if (!included) continue;
    if (excludeRes.some((match) => match(file))) continue;
    files.push(file);
  }
  files.sort();

  for (const pattern of rawInclude) {
    if (!matchedPatterns.has(pattern)) {
      warnings.push({ rule: 'P16', pattern, message: `include pattern matches no files: ${pattern}` });
    }
  }

  const pairs = findCaseFoldCollisions(files);
  if (pairs.length) throw new ScopeCollisionError(pairs);

  return { files, warnings };
}
