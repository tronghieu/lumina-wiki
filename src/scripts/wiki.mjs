#!/usr/bin/env node
/**
 * @module wiki
 * @description Lumina Wiki Knowledge Engine — CLI script for mutating and querying
 * a Lumina wiki workspace. Invoked via Bash + JSON by skills; never imported.
 *
 * Usage: node wiki.mjs <subcommand> [flags]
 *
 * Exit codes:
 *   0  success
 *   2  user error (bad args, missing file, path safety violation)
 *   3  internal error (bug, fs failure)
 *
 * All read commands emit JSON to stdout.
 * All mutation commands emit a JSON status object.
 * Errors emit {"error": "...", "code": 2|3} to stderr and set the exit code.
 */

// ---------------------------------------------------------------------------
// 1. Imports + schemas import
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { readFile, mkdir, access, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';

import {
  ENTITY_DIRS,
  SCHEMA_VERSION,
  REQUIRED_FRONTMATTER,
  EDGE_CONFIDENCE,
  LEGACY_ENUM_DEFAULTS,
} from './schemas.mjs';
import { sanitizeExternalIdsObject } from './external-ids.mjs';
import { atomicWrite } from './lib/fsx.mjs';
import { isExempt } from './lib/globs.mjs';
import {
  edgeTypeByName,
  skipReverseFor,
  reverseEdgeFor,
  edgeKey,
  normalizeEdge,
} from './lib/edges.mjs';

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

/** Minimum valid edge confidence values. */
const CONFIDENCE_VALUES = new Set(EDGE_CONFIDENCE);

/** Regex for a single frontmatter line: `key: value` */
const FM_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)/;

/** Regex for a YAML list item: `- value` */
const FM_LIST_ITEM_RE = /^(\s+)-\s+(.*)/;

/** Date format YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 3. Utils
// ---------------------------------------------------------------------------

/**
 * Convert a title string to a kebab-case slug.
 * Lowercase, hyphenate, strip punctuation, collapse whitespace.
 * Pure function, no I/O.
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    // Replace accented chars with ascii equivalents where possible
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Replace non-alphanumeric (except spaces and hyphens) with space
    .replace(/[^a-z0-9\s-]/g, ' ')
    // Collapse any whitespace and hyphens to a single hyphen
    .trim()
    .replace(/[\s-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse YAML frontmatter from a markdown file string.
 * Handles: simple key:value, list items (- value), 1-level nesting.
 * Supports quoted values (single or double).
 *
 * @param {string} content - Full markdown file content.
 * @returns {{ frontmatter: Record<string,any>, body: string, hasFrontmatter: boolean }}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  const lines = content.split('\n');
  // Find closing ---
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join('\n');

  const frontmatter = {};
  let currentKey = null;
  let currentListKey = null;
  let currentMapKey = null;

  // Indented `  key: value` — used for block-mapping values.
  const FM_INDENTED_KV_RE = /^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;

  function peekNextSignificantLine(startIdx) {
    for (let j = startIdx; j < fmLines.length; j++) {
      if (fmLines[j].trimEnd() !== '') return fmLines[j];
    }
    return null;
  }

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (line.trimEnd() === '') continue;

    // Indented mapping value — must come BEFORE list-item detection.
    if (currentMapKey !== null) {
      const mMatch = FM_INDENTED_KV_RE.exec(line);
      if (mMatch && !/^\s+-\s/.test(line)) {
        const subKey = mMatch[2];
        const subVal = mMatch[3].trim();
        frontmatter[currentMapKey][subKey] = parseScalar(subVal);
        continue;
      }
      // Fallthrough: a non-indented or non-kv line ends the mapping.
      currentMapKey = null;
    }

    // Detect indented list item
    const listMatch = FM_LIST_ITEM_RE.exec(line);
    if (listMatch && currentListKey !== null) {
      const rawItem = listMatch[2].trim();
      if (rawItem.startsWith('{') && rawItem.endsWith('}')) {
        frontmatter[currentListKey].push(_parseFlowMapping(rawItem));
      } else {
        frontmatter[currentListKey].push(unquoteValue(rawItem));
      }
      continue;
    }

    const kvMatch = FM_LINE_RE.exec(line);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (rawVal === '' || rawVal === null) {
        // Look ahead: indented `key: value` => block mapping; otherwise list.
        const next = peekNextSignificantLine(i + 1);
        if (next && FM_INDENTED_KV_RE.test(next) && !/^\s+-\s/.test(next)) {
          frontmatter[currentKey] = {};
          currentMapKey = currentKey;
          currentListKey = null;
        } else {
          frontmatter[currentKey] = [];
          currentListKey = currentKey;
          currentMapKey = null;
        }
      } else if (rawVal === '[]') {
        frontmatter[currentKey] = [];
        currentListKey = currentKey;
        currentMapKey = null;
      } else if (rawVal === '{}') {
        frontmatter[currentKey] = {};
        currentListKey = null;
        currentMapKey = null;
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        const inner = rawVal.slice(1, -1).trim();
        if (inner === '') {
          frontmatter[currentKey] = [];
        } else {
          frontmatter[currentKey] = inner.split(',').map(v => unquoteValue(v.trim()));
        }
        currentListKey = null;
        currentMapKey = null;
      } else {
        frontmatter[currentKey] = parseScalar(rawVal);
        currentListKey = null;
        currentMapKey = null;
      }
      continue;
    }
  }

  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Parse a YAML flow-style mapping string like `{id: 1, reviewer: grounding, class: patch}`.
 * Supports simple scalar values (strings, numbers). Nested maps are not supported.
 * String values may be double-quoted.
 * @param {string} raw - The raw `{...}` string (braces included).
 * @returns {Record<string, any>}
 */
function _parseFlowMapping(raw) {
  const inner = raw.slice(1, -1).trim();
  const result = {};
  if (!inner) return result;

  /**
   * Count consecutive backslashes immediately before position i.
   * Used to determine whether a quote is escaped (odd count) or not (even).
   * @param {string} s
   * @param {number} i
   * @returns {number}
   */
  function countPrecedingBackslashes(s, i) {
    let n = 0;
    let pos = i - 1;
    while (pos >= 0 && s[pos] === '\\') { n++; pos--; }
    return n;
  }

  // Split on ',' boundaries, respecting quoted values.
  const parts = [];
  let depth = 0;
  let inDQ = false;
  let inSQ = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && !inSQ && countPrecedingBackslashes(inner, i) % 2 === 0) inDQ = !inDQ;
    if (ch === "'" && !inDQ && countPrecedingBackslashes(inner, i) % 2 === 0) inSQ = !inSQ;
    if (!inDQ && !inSQ) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(inner.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  parts.push(inner.slice(start).trim());

  for (const part of parts) {
    // Find the first colon NOT inside a quoted segment.
    let pInDQ = false;
    let pInSQ = false;
    let colonIdx = -1;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (ch === '"' && !pInSQ && countPrecedingBackslashes(part, i) % 2 === 0) pInDQ = !pInDQ;
      if (ch === "'" && !pInDQ && countPrecedingBackslashes(part, i) % 2 === 0) pInSQ = !pInSQ;
      if (ch === ':' && !pInDQ && !pInSQ) { colonIdx = i; break; }
    }
    if (colonIdx === -1) continue;
    const k = part.slice(0, colonIdx).trim();
    const v = part.slice(colonIdx + 1).trim();
    result[k] = parseScalar(v);
  }
  return result;
}

/**
 * Unquote a YAML scalar value (single or double quotes).
 * @param {string} v
 * @returns {string}
 */
function unquoteValue(v) {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    // Decode double-quoted string: unescape \\ → \ and \" → "
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse a YAML scalar: number, boolean, or string.
 * @param {string} v
 * @returns {string|number|boolean}
 */
function parseScalar(v) {
  const unq = unquoteValue(v);
  if (v !== unq) return unq; // was quoted — keep as string
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  const num = Number(v);
  if (!isNaN(num) && v.trim() !== '') return num;
  return v;
}

/**
 * Serialize frontmatter object back to YAML-ish block for frontmatter insertion.
 * Handles strings, numbers, booleans, and arrays (block style).
 * @param {Record<string,any>} fm
 * @returns {string} YAML lines (no --- delimiters)
 */
function stringifyFrontmatter(fm) {
  const lines = [];
  for (const [key, val] of Object.entries(fm)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of val) {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            // Serialize nested object as YAML flow mapping.
            const pairs = Object.entries(item).map(([k, v]) => {
              if (v === null || v === undefined) {
                return `${k}: null`;
              }
              if (typeof v === 'string') {
                // Quote if needed for flow context (contains special chars).
                const needsQuote = v.includes('"') || v.includes("'") || v.includes(':')
                  || v.includes('#') || v.includes('\n') || v.includes('\t') || v.includes('\r')
                  || v.includes(',') || v.includes('{') || v.includes('}')
                  || v.includes('[') || v.includes(']')
                  || v.trim() === ''
                  || /^(true|false|null|~|\d[\d.eE+-]*)$/i.test(v);
                return needsQuote
                  ? `${k}: "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
                  : `${k}: ${v}`;
              }
              // boolean, finite number — these round-trip through parseScalar fine
              return `${k}: ${v}`;
            });
            lines.push(`  - {${pairs.join(', ')}}`);
          } else {
            lines.push(`  - ${quoteIfNeeded(item)}`);
          }
        }
      }
    } else if (val === null) {
      lines.push(`${key}: null`);
    } else if (typeof val === 'object') {
      // Block-mapping for plain objects. Keys sorted for deterministic round-trip.
      const subKeys = Object.keys(val).sort();
      if (subKeys.length === 0) {
        lines.push(`${key}: {}`);
      } else {
        lines.push(`${key}:`);
        for (const k of subKeys) {
          const v = val[k];
          if (v === null || v === undefined) {
            lines.push(`  ${k}: null`);
          } else if (typeof v === 'string') {
            lines.push(`  ${k}: ${quoteIfNeeded(v)}`);
          } else {
            lines.push(`  ${k}: ${v}`);
          }
        }
      }
    } else if (typeof val === 'string') {
      lines.push(`${key}: ${quoteIfNeeded(val)}`);
    } else {
      // number or boolean
      lines.push(`${key}: ${val}`);
    }
  }
  return lines.join('\n');
}

/**
 * Quote a string value if it contains special YAML characters or looks like
 * a scalar that would be misinterpreted (true/false/null/number).
 * @param {any} val
 * @returns {string}
 */
function quoteIfNeeded(val) {
  if (typeof val !== 'string') return String(val);
  const special = ['true', 'false', 'null', '~'];
  if (special.includes(val.toLowerCase())) return `"${val}"`;
  if (!isNaN(Number(val)) && val.trim() !== '') return `"${val}"`;
  if (val.includes(':') || val.includes('#') || val.startsWith('*') || val.includes('\n')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

/**
 * Reassemble a markdown file from parsed frontmatter + body.
 * @param {Record<string,any>} fm
 * @param {string} body
 * @returns {string}
 */
function assembleMd(fm, body) {
  const yamlBlock = stringifyFrontmatter(fm);
  return `---\n${yamlBlock}\n---\n${body}`;
}

/**
 * Walk up from cwd looking for a directory that contains a `wiki/` subdir.
 * Returns the project root path, or null if not found.
 * @param {string} [startDir]
 * @returns {Promise<string|null>}
 */
async function findProjectRoot(startDir) {
  let dir = startDir || process.cwd();
  const root = resolve('/');
  while (true) {
    try {
      await access(join(dir, 'wiki'), fsConstants.F_OK);
      return dir;
    } catch (_) {
      const parent = dirname(dir);
      if (parent === dir || dir === root) return null;
      dir = parent;
    }
  }
}

/**
 * Verify a user-supplied path segment is safe:
 * - Does not contain `..`
 * - Is not absolute
 * - Does not resolve outside projectRoot when joined with projectRoot
 * @param {string} segment
 * @param {string} projectRoot
 * @returns {boolean} true if safe
 */
function pathSafe(segment, projectRoot) {
  if (!segment) return false;
  // Reject absolute paths
  if (resolve(segment) === segment) return false;
  // Reject segments containing ..
  const parts = segment.replace(/\\/g, '/').split('/');
  if (parts.some(p => p === '..')) return false;
  // Check resolved path stays inside projectRoot
  const resolved = resolve(join(projectRoot, segment));
  const rootResolved = resolve(projectRoot);
  // rootResolved already ends with `sep` when it IS a filesystem root (POSIX
  // "/" or a Windows drive root like "C:\\") -- resolve() only leaves a
  // trailing separator in that one case. Appending another `sep`
  // unconditionally would double it ("//" / "C:\\\\"), a prefix no real
  // resolved path ever has, so every path inside a root-level workspace was
  // rejected as unsafe. Only add the separator when it isn't already there.
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (!resolved.startsWith(rootWithSep) && resolved !== rootResolved) return false;
  return true;
}

/**
 * Get today's date as YYYY-MM-DD (local time).
 * @returns {string}
 */
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Ensure directory exists (mkdir -p).
 * @param {string} dir
 */
async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

function stripMdSuffix(value) {
  return value.endsWith('.md') ? value.slice(0, -3) : value;
}

function isTypedEntitySlug(slug) {
  const normalizedSlug = stripMdSuffix(toPosixPath(slug));
  const [first] = normalizedSlug.split('/');
  return Boolean(first && ENTITY_DIRS[first]);
}

function safeWikiRelativePath(projectRoot, relPath) {
  const normalizedRel = toPosixPath(relPath);
  if (!pathSafe(normalizedRel, projectRoot)) {
    const err = new Error(`Unsafe wiki path: ${relPath}`);
    err.code = 2;
    throw err;
  }
  return normalizedRel;
}

// ---------------------------------------------------------------------------
// 4. Entity ops
// ---------------------------------------------------------------------------

/**
 * Search all entity directories for a file matching `<slug>.md`.
 * Returns the absolute path if found, or null.
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
async function findEntityFile(projectRoot, slug) {
  const wikiDir = join(projectRoot, 'wiki');

  if (isTypedEntitySlug(slug)) {
    const normalizedSlug = stripMdSuffix(safeWikiRelativePath(projectRoot, slug));
    const candidate = join(wikiDir, `${normalizedSlug}.md`);
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch (_) {
      return null;
    }
  }

  for (const entry of Object.values(ENTITY_DIRS)) {
    const candidate = join(wikiDir, entry.dir, `${slug}.md`);
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch (_) {
      // not found in this dir
    }
  }
  return null;
}

/**
 * Read frontmatter from an entity file identified by slug.
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<{frontmatter: Record<string,any>, filePath: string}>}
 * @throws if file not found (exit-2 class)
 */
async function readMeta(projectRoot, slug) {
  const filePath = await findEntityFile(projectRoot, slug);
  if (!filePath) {
    const err = new Error(`Entity not found for slug: ${slug}`);
    err.code = 2;
    throw err;
  }
  const content = await readFile(filePath, 'utf8');
  const { frontmatter } = parseFrontmatter(content);
  return { frontmatter, filePath };
}

/**
 * Determine the entity type for a file path by matching its parent
 * directory (relative to wiki/) against ENTITY_DIRS.
 * @param {string} projectRoot
 * @param {string} filePath - Absolute path to a file under wiki/.
 * @returns {string|null} Entity type key, or null if not under a known dir.
 */
function _entityTypeForFilePath(projectRoot, filePath) {
  const wikiDir = join(projectRoot, 'wiki');
  const relPath = relative(wikiDir, filePath);
  const dirParts = relPath.split(sep);
  const entityDirName = dirParts[0] + '/';
  return Object.entries(ENTITY_DIRS).find(
    ([, v]) => v.dir === entityDirName,
  )?.[0] ?? null;
}

/**
 * Set a frontmatter key in an entity file.
 *
 * Schema gate: if the entity's type declares a field definition for `key`
 * in REQUIRED_FRONTMATTER, the supplied `value` must satisfy that field's
 * declared type or the write is rejected outright (no --force escape
 * hatch — see _checkFieldType). Only the single key being set is checked;
 * the rest of the document (including fields not yet present) is left
 * alone, so mid-draft pages can still set fields one at a time. Keys with
 * no declared type for this entity type (free-form keys like `tags`) are
 * always writable.
 *
 * @param {string} projectRoot
 * @param {string} slug
 * @param {string} key
 * @param {any} value - Already parsed (string|number|boolean|array)
 * @returns {Promise<{filePath: string}>}
 */
async function setMeta(projectRoot, slug, key, value) {
  const filePath = await findEntityFile(projectRoot, slug);
  if (!filePath) {
    const err = new Error(`Entity not found for slug: ${slug}`);
    err.code = 2;
    throw err;
  }
  const content = await readFile(filePath, 'utf8');
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  const entityType = _entityTypeForFilePath(projectRoot, filePath);
  if (entityType) {
    const fields = REQUIRED_FRONTMATTER[entityType] ?? null;
    const field = fields ? fields.find((f) => f.key === key) : null;
    // Clearing an OPTIONAL declared field stays allowed. The gate exists to stop
    // wrong-typed values, and `null` on a field the schema marks `required:
    // false` is not a wrong value — it is the absence the schema already
    // permits. Type-checking it would leave no way at all to undo an optional
    // field once set. A required field still cannot be cleared: that just
    // trades this error for an L01 one.
    const clearingOptional = (value === null || value === undefined) && field && field.required === false;
    if (field && !clearingOptional) {
      const violation = _checkFieldType(field, value);
      if (violation) {
        // The TODO sentinel gets its own hint: --json-value re-encodes the
        // same string ("TODO" stays "TODO" whether it arrives via parseScalar
        // or JSON.parse), so pointing the user at --json-value here would be
        // actively wrong — it cannot make this value acceptable. Every other
        // violation is a real type/shape mismatch, where --json-value (or
        // quoting the value) genuinely can fix it. Detected off the
        // violation text itself (not the raw value) so a "TODO" rejected by
        // a DIFFERENT branch — e.g. an iso-date field, which keeps its own
        // "must be an ISO date" message — still gets that branch's own hint
        // (none, today) rather than this one.
        const isTodoPlaceholder = /is set to the placeholder "TODO"/.test(violation);
        let hint;
        if (isTodoPlaceholder) {
          hint = ' — supply a real value; this is not a quoting issue, so --json-value will not help';
        } else {
          // Scalars arrive already coerced by parseScalar, so a value the user
          // typed as text can reach us as a number or a bare string where the
          // schema wants a list. That is exactly what --json-value is for, and an
          // error that does not say so reads as "this value is forbidden" rather
          // than "quote it".
          const coercible = field.type === 'string' || field.type === 'array' || field.type === 'object';
          hint = coercible
            ? ' — if this is the value you meant, pass it with --json-value (e.g. --json-value \'"1706.03762"\' or \'["a","b"]\')'
            : '';
        }
        const err = new Error(`Schema violation: ${violation}${hint}`);
        err.code = 2;
        throw err;
      }
    }
  }

  // external_ids is the only object-typed frontmatter today; sanitize untrusted
  // input (CLI / JSON.parse / fetcher output) against the namespace allowlist.
  // Note: `sources` array entries are validated at write time by buildSourceEntry
  // / build_source_entry (provider slug, URL parse, length bounds), so no
  // sanitization gate is needed here. Other typed fields are checked above and
  // by lint.
  if (key === 'external_ids') {
    frontmatter[key] = sanitizeExternalIdsObject(value);
  } else {
    frontmatter[key] = value;
  }
  const newContent = assembleMd(frontmatter, body);
  await atomicWrite(filePath, newContent);
  return { filePath };
}

/**
 * Defaults applied by `migrate --add-defaults` to legacy entries
 * created before v0.6 introduced provenance/confidence fields.
 *
 * Values are conservative: `missing` provenance and `unverified` confidence
 * make legacy state explicit so verify/lint can flag what still needs review,
 * rather than silently asserting trust.
 */

/**
 * Backfill missing frontmatter fields on legacy entities (sources/concepts).
 * Only writes a field when absent — present values, including empty strings,
 * are preserved. Idempotent: running twice produces no new changes.
 *
 * @param {string}  projectRoot
 * @param {boolean} dryRun
 * @returns {Promise<{updated: Array, skipped: number, dryRun: boolean}>}
 */
async function migrateLegacyDefaults(projectRoot, dryRun) {
  const entities = await listEntities(projectRoot);
  const updated = [];
  let skipped = 0;

  for (const entity of entities) {
    const defaults = LEGACY_ENUM_DEFAULTS[entity.type];
    if (!defaults) { skipped++; continue; }

    const content = await readFile(entity.filePath, 'utf8');
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

    const added = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in frontmatter)) {
        frontmatter[key] = value;
        added[key] = value;
      }
    }

    if (Object.keys(added).length === 0) { skipped++; continue; }

    if (!dryRun) {
      const newContent = assembleMd(frontmatter, body);
      await atomicWrite(entity.filePath, newContent);
    }
    updated.push({ slug: entity.slug, type: entity.type, added });
  }

  return { updated, skipped, dryRun };
}

/**
 * List all entity files in all entity directories.
 * @param {string} projectRoot
 * @returns {Promise<Array<{slug: string, dir: string, type: string, filePath: string}>>}
 */
async function listEntities(projectRoot, prefix = null) {
  const wikiDir = join(projectRoot, 'wiki');
  const results = [];

  async function walk(dir) {
    const files = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (_) {
      return files;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  for (const [typeName, entry] of Object.entries(ENTITY_DIRS)) {
    const baseDir = join(wikiDir, entry.dir);
    let scanDir = baseDir;

    if (prefix) {
      const normalizedPrefix = stripMdSuffix(safeWikiRelativePath(projectRoot, prefix));
      if (normalizedPrefix !== entry.dir.slice(0, -1) && !normalizedPrefix.startsWith(entry.dir)) {
        continue;
      }
      scanDir = join(wikiDir, normalizedPrefix);
    }

    const files = await walk(scanDir);
    for (const filePath of files) {
      const relUnderWiki = toPosixPath(relative(wikiDir, filePath));
      const relUnderEntityDir = toPosixPath(relative(baseDir, filePath));
      const slugUnderEntityDir = stripMdSuffix(relUnderEntityDir);
      const canonicalSlug = stripMdSuffix(relUnderWiki);
      results.push({
        slug: slugUnderEntityDir.includes('/') ? canonicalSlug : slugUnderEntityDir,
        path: canonicalSlug,
        dir: entry.dir,
        type: typeName,
        filePath,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 5. Edge ops
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL file into an array of objects.
 * Returns [] if file doesn't exist.
 * @param {string} filePath
 * @returns {Promise<object[]>}
 */
async function readJsonl(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(l => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Write an array of objects as JSONL.
 * @param {string} filePath
 * @param {object[]} records
 */
async function writeJsonl(filePath, records) {
  const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  await atomicWrite(filePath, content);
}

/**
 * Add an edge (and its reverse unless target is exempt or edge is terminal).
 * Idempotent: re-running same add-edge produces byte-identical files.
 *
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} edgeType
 * @param {string} toSlug
 * @param {object} [opts]
 * @param {string} [opts.confidence]
 * @returns {Promise<{added: boolean, reason: string}>}
 */
async function addEdge(projectRoot, fromSlug, edgeType, toSlug, opts = {}) {
  const typeDef = edgeTypeByName(edgeType);
  if (!typeDef) {
    const err = new Error(`Unknown edge type: ${edgeType}`);
    err.code = 2;
    throw err;
  }

  if (opts.confidence && !CONFIDENCE_VALUES.has(opts.confidence)) {
    const err = new Error(`Invalid confidence: ${opts.confidence}. Must be high|medium|low`);
    err.code = 2;
    throw err;
  }

  const graphDir = join(projectRoot, 'wiki', 'graph');
  await ensureDir(graphDir);
  const edgesFile = join(graphDir, 'edges.jsonl');

  const existing = await readJsonl(edgesFile);
  const existingKeys = new Set(existing.map(edgeKey));

  const forwardEdge = normalizeEdge({
    from: fromSlug,
    type: edgeType,
    to: toSlug,
    ...(opts.confidence ? { confidence: opts.confidence } : {}),
  });
  const fwdKey = edgeKey(forwardEdge);

  // Check if forward edge already exists
  if (existingKeys.has(fwdKey)) {
    return { added: false, reason: 'edge already exists' };
  }

  const toAdd = [forwardEdge];

  const reverseEdge = reverseEdgeFor(typeDef, fromSlug, toSlug, opts.confidence);
  if (reverseEdge && !existingKeys.has(edgeKey(reverseEdge))) {
    toAdd.push(reverseEdge);
  }

  const newEdges = [...existing, ...toAdd];
  await writeJsonl(edgesFile, newEdges);

  return { added: true, reason: `added ${toAdd.length} edge(s)` };
}

/**
 * Add a citation edge (cites) to wiki/graph/citations.jsonl.
 * Idempotent.
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} toSlug
 * @returns {Promise<{added: boolean, reason: string}>}
 */
async function addCitation(projectRoot, fromSlug, toSlug) {
  const graphDir = join(projectRoot, 'wiki', 'graph');
  await ensureDir(graphDir);
  const citationsFile = join(graphDir, 'citations.jsonl');

  const existing = await readJsonl(citationsFile);

  // Deduplicate: same from+to
  const isDup = existing.some(e => e.from === fromSlug && e.to === toSlug);
  if (isDup) {
    return { added: false, reason: 'citation already exists' };
  }

  const newEdge = { from: fromSlug, type: 'cites', to: toSlug };
  const newEdges = [...existing, newEdge];
  await writeJsonl(citationsFile, newEdges);

  return { added: true, reason: 'citation added' };
}

/**
 * Remove a citation edge (cites) from wiki/graph/citations.jsonl.
 * Idempotent.
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} toSlug
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<{removed: number, before: number, after?: number, dryRun?: boolean, matched?: object[]}>}
 */
async function removeCitation(projectRoot, fromSlug, toSlug, opts = {}) {
  const graphDir = join(projectRoot, 'wiki', 'graph');
  const citationsFile = join(graphDir, 'citations.jsonl');

  const existing = await readJsonl(citationsFile);
  const before = existing.length;

  const matched = existing.filter(e => e.from === fromSlug && e.to === toSlug);
  const remaining = existing.filter(e => !(e.from === fromSlug && e.to === toSlug));

  if (opts.dryRun) {
    return { dryRun: true, removed: matched.length, before, matched };
  }

  if (matched.length > 0) {
    await writeJsonl(citationsFile, remaining);
  }

  return { removed: matched.length, before, after: remaining.length };
}

/**
 * Batch-add edges from a JSON file.
 * Reads [{from, type, to, confidence?}, ...], validates all, then writes in one pass.
 * @param {string} projectRoot
 * @param {string} jsonFilePath
 * @returns {Promise<{processed: number, added: number, skipped: number, errors: string[]}>}
 */
async function batchEdges(projectRoot, jsonFilePath) {
  let rawContent;
  try {
    rawContent = await readFile(jsonFilePath, 'utf8');
  } catch (err) {
    const e = new Error(`Cannot read batch file: ${jsonFilePath} — ${err.message}`);
    e.code = 2;
    throw e;
  }

  let records;
  try {
    records = JSON.parse(rawContent);
  } catch (err) {
    const e = new Error(`Invalid JSON in batch file: ${err.message}`);
    e.code = 2;
    throw e;
  }

  if (!Array.isArray(records)) {
    const e = new Error('Batch file must contain a JSON array');
    e.code = 2;
    throw e;
  }

  // Validate all records before writing
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec.from || !rec.type || !rec.to) {
      errors.push(`Record ${i}: missing from, type, or to`);
      continue;
    }
    const typeDef = edgeTypeByName(rec.type);
    if (!typeDef) {
      errors.push(`Record ${i}: unknown edge type '${rec.type}'`);
    }
    if (rec.confidence && !CONFIDENCE_VALUES.has(rec.confidence)) {
      errors.push(`Record ${i}: invalid confidence '${rec.confidence}'`);
    }
  }

  if (errors.length > 0) {
    const e = new Error(`Batch validation failed: ${errors.join('; ')}`);
    e.code = 2;
    throw e;
  }

  const graphDir = join(projectRoot, 'wiki', 'graph');
  await ensureDir(graphDir);
  const edgesFile = join(graphDir, 'edges.jsonl');

  const existing = await readJsonl(edgesFile);
  const existingKeys = new Set(existing.map(edgeKey));

  let added = 0;
  let skipped = 0;
  const toAdd = [];

  for (const rec of records) {
    const typeDef = edgeTypeByName(rec.type);
    const forwardEdge = normalizeEdge({
      from: rec.from,
      type: rec.type,
      to: rec.to,
      ...(rec.confidence ? { confidence: rec.confidence } : {}),
    });
    const fwdKey = edgeKey(forwardEdge);

    if (existingKeys.has(fwdKey)) {
      skipped++;
      continue;
    }

    toAdd.push(forwardEdge);
    existingKeys.add(fwdKey);
    added++;

    const reverseEdge = reverseEdgeFor(typeDef, rec.from, rec.to, rec.confidence);
    if (reverseEdge) {
      const revKey = edgeKey(reverseEdge);
      if (!existingKeys.has(revKey)) {
        toAdd.push(reverseEdge);
        existingKeys.add(revKey);
      }
    }
  }

  if (toAdd.length > 0) {
    const newEdges = [...existing, ...toAdd];
    await writeJsonl(edgesFile, newEdges);
  }

  return { processed: records.length, added, skipped, errors: [] };
}

/**
 * Deduplicate edges.jsonl, removing duplicate edges (same forward+reverse pair,
 * or symmetric duplicates). Rewrites atomically.
 * @param {string} projectRoot
 * @returns {Promise<{before: number, after: number, removed: number}>}
 */
async function dedupEdges(projectRoot) {
  const edgesFile = join(projectRoot, 'wiki', 'graph', 'edges.jsonl');
  const existing = await readJsonl(edgesFile);
  const before = existing.length;

  const seen = new Set();
  const unique = [];

  for (const edge of existing) {
    const normalized = normalizeEdge(edge);
    const key = edgeKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }

  await writeJsonl(edgesFile, unique);

  const after = unique.length;
  return { before, after, removed: before - after };
}

/**
 * Partition an edge list into the edges matching a from/type/to relationship
 * (forward + its reverse, per the same gate addEdge uses) versus the rest.
 * Confidence is ignored when matching (edgeKey already ignores it).
 *
 * @param {object[]} edges
 * @param {string} fromSlug
 * @param {object} typeDef - EDGE_TYPES entry for the relationship's type.
 * @param {string} toSlug
 * @returns {{
 *   remaining: object[],
 *   matched: object[],
 *   forwardRemoved: number,
 *   reverseRemoved: number,
 *   forwardMatch: object|null,
 *   reverseMatch: object|null,
 * }}
 */
function partitionEdgesForRemoval(edges, fromSlug, typeDef, toSlug) {
  const fwdKey = edgeKey(normalizeEdge({ from: fromSlug, type: typeDef.name, to: toSlug }));

  let revKey = null;
  if (!skipReverseFor(typeDef, toSlug)) {
    revKey = edgeKey(normalizeEdge({ from: toSlug, type: typeDef.reverse, to: fromSlug }));
  }

  const remaining = [];
  const matched = [];
  let forwardMatch = null;
  let reverseMatch = null;

  for (const edge of edges) {
    const key = edgeKey(edge);
    if (key === fwdKey) {
      matched.push(edge);
      forwardMatch = edge;
    } else if (revKey && key === revKey) {
      matched.push(edge);
      reverseMatch = edge;
    } else {
      remaining.push(edge);
    }
  }

  return {
    remaining,
    matched,
    forwardRemoved: forwardMatch ? 1 : 0,
    reverseRemoved: reverseMatch ? 1 : 0,
    forwardMatch,
    reverseMatch,
  };
}

/**
 * Best-effort advisory scan: for from/to slugs that resolve to a wiki page,
 * check whether the page's markdown still contains a `[[other-slug]]`
 * wikilink after the edge that justified it was removed. Never throws —
 * missing pages or read errors are skipped silently.
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} toSlug
 * @returns {Promise<string[]>}
 */
async function collectRemovalAdvisories(projectRoot, fromSlug, toSlug) {
  const advisories = [];

  async function checkWikilink(pageSlug, linkedSlug) {
    if (isExempt(pageSlug)) return; // e.g. external URL slug — no page to read
    try {
      const filePath = await findEntityFile(projectRoot, pageSlug);
      if (!filePath) return;
      const content = await readFile(filePath, 'utf8');
      if (content.includes(`[[${linkedSlug}]]`)) {
        advisories.push(
          `Page ${pageSlug} still contains wikilink [[${linkedSlug}]]; review whether the mention should stay.`,
        );
      }
    } catch (_) {
      // best-effort — ignore fs errors
    }
  }

  await checkWikilink(fromSlug, toSlug);
  await checkWikilink(toSlug, fromSlug);

  return advisories;
}

/**
 * Remove a from/type/to relationship (forward + reverse, per the same gate
 * addEdge uses) from edges.jsonl. Idempotent: matching ignores confidence,
 * and removing an edge that isn't there exits 0 with removed:0.
 *
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} edgeType
 * @param {string} toSlug
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<object>}
 */
async function removeEdge(projectRoot, fromSlug, edgeType, toSlug, opts = {}) {
  const typeDef = edgeTypeByName(edgeType);
  if (!typeDef) {
    const err = new Error(`Unknown edge type: ${edgeType}`);
    err.code = 2;
    throw err;
  }

  const edgesFile = join(projectRoot, 'wiki', 'graph', 'edges.jsonl');
  const existing = await readJsonl(edgesFile);
  const before = existing.length;

  const { remaining, matched, forwardRemoved, reverseRemoved } =
    partitionEdgesForRemoval(existing, fromSlug, typeDef, toSlug);

  if (opts.dryRun) {
    return {
      dryRun: true,
      removed: matched.length,
      forwardRemoved,
      reverseRemoved,
      before,
      matched,
    };
  }

  if (matched.length > 0) {
    await writeJsonl(edgesFile, remaining);
  }

  const advisories = await collectRemovalAdvisories(projectRoot, fromSlug, toSlug);

  return {
    removed: matched.length,
    forwardRemoved,
    reverseRemoved,
    before,
    after: remaining.length,
    advisories,
  };
}

/**
 * Replace a from/old-type/to relationship with from/new-type/to: removes the
 * old edge (forward + reverse, per the same gate addEdge uses for oldType)
 * and adds the new edge (forward + reverse, per the same gate for newType),
 * deduping by edgeKey, in a single read + single write.
 *
 * Confidence: an explicit opts.confidence wins; otherwise the confidence of
 * the existing forward old edge (if any) is carried over; otherwise none.
 *
 * @param {string} projectRoot
 * @param {string} fromSlug
 * @param {string} oldType
 * @param {string} toSlug
 * @param {string} newType
 * @param {object} [opts]
 * @param {string} [opts.confidence]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<object>}
 */
async function replaceEdge(projectRoot, fromSlug, oldType, toSlug, newType, opts = {}) {
  const oldTypeDef = edgeTypeByName(oldType);
  if (!oldTypeDef) {
    const err = new Error(`Unknown edge type: ${oldType}`);
    err.code = 2;
    throw err;
  }
  const newTypeDef = edgeTypeByName(newType);
  if (!newTypeDef) {
    const err = new Error(`Unknown edge type: ${newType}`);
    err.code = 2;
    throw err;
  }
  if (opts.confidence && !CONFIDENCE_VALUES.has(opts.confidence)) {
    const err = new Error(`Invalid confidence: ${opts.confidence}. Must be high|medium|low`);
    err.code = 2;
    throw err;
  }

  const edgesFile = join(projectRoot, 'wiki', 'graph', 'edges.jsonl');
  const existing = await readJsonl(edgesFile);
  const before = existing.length;

  const { remaining, matched, forwardMatch } =
    partitionEdgesForRemoval(existing, fromSlug, oldTypeDef, toSlug);
  const removed = matched.length;

  let confidence = opts.confidence;
  if (!confidence && forwardMatch && forwardMatch.confidence) {
    confidence = forwardMatch.confidence;
  }

  const workingSet = remaining.slice();
  const workingKeys = new Set(workingSet.map(edgeKey));

  const forwardEdge = normalizeEdge({
    from: fromSlug,
    type: newType,
    to: toSlug,
    ...(confidence ? { confidence } : {}),
  });
  const fwdKey = edgeKey(forwardEdge);

  let added = false;
  if (!workingKeys.has(fwdKey)) {
    workingSet.push(forwardEdge);
    workingKeys.add(fwdKey);
    added = true;
  }

  let reverseEdge = null;
  if (!skipReverseFor(newTypeDef, toSlug)) {
    reverseEdge = { from: toSlug, type: newTypeDef.reverse, to: fromSlug };
    const candidate = { ...reverseEdge, ...(confidence ? { confidence } : {}) };
    const revKey = edgeKey(candidate);
    if (!workingKeys.has(revKey)) {
      workingSet.push(candidate);
      workingKeys.add(revKey);
      added = true;
    }
  }

  const plan = {
    oldType,
    newType,
    forward: { from: fromSlug, type: newType, to: toSlug },
    reverse: reverseEdge,
    confidence: confidence || null,
  };

  if (opts.dryRun) {
    return {
      dryRun: true,
      willRemove: removed,
      willAdd: { forward: plan.forward, reverse: plan.reverse },
      confidence: plan.confidence,
    };
  }

  // Convergent: old edge already gone and new edge already present — no-op.
  if (removed === 0 && !added) {
    return { removed: 0, added: false, ...plan, before, after: before };
  }

  await writeJsonl(edgesFile, workingSet);

  return { removed, added, ...plan, before, after: workingSet.length };
}

// ---------------------------------------------------------------------------
// 6. Checkpoint ops
// ---------------------------------------------------------------------------

/**
 * Resolve a checkpoint file's path, rejecting any skill/phase that would put it
 * somewhere other than _lumina/_state.
 *
 * These two are identifiers, not paths, and were previously interpolated into a
 * filename with no validation at all -- the only wiki.mjs arguments reaching a
 * constructed path without even a `..` check. `phase` in particular carries the
 * basename of a user's raw file (`checkpoint-read ingest <file-basename>`), so
 * it is attacker-influenced and cannot be assumed clean. A separator in either
 * value escaped the state dir, and the read side turned that into an arbitrary
 * file read printed to stdout.
 *
 * Only separators are rejected. Characters that are merely awkward in a
 * filename -- spaces, dots, parentheses -- stay legal, because real basenames
 * contain them, they cannot traverse, and refusing them would break resuming an
 * ingest of `Paper (2017).pdf`. The pathSafe call is a backstop on the composed
 * path so the guarantee is asserted rather than only argued.
 * @param {string} projectRoot
 * @param {string} skill
 * @param {string} phase
 * @returns {string} absolute path to the checkpoint file
 */
function checkpointPath(projectRoot, skill, phase) {
  for (const [label, value] of [['skill', skill], ['phase', phase]]) {
    if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
      const err = new Error(
        `Invalid checkpoint ${label}: ${JSON.stringify(value)} may not contain a path separator`,
      );
      err.code = 2;
      throw err;
    }
  }
  const rel = join('_lumina', '_state', `${skill}-${phase}.json`);
  if (!pathSafe(rel, projectRoot)) {
    const err = new Error(`Unsafe checkpoint path for skill ${JSON.stringify(skill)} phase ${JSON.stringify(phase)}`);
    err.code = 2;
    throw err;
  }
  return join(projectRoot, rel);
}

/**
 * Read a checkpoint file. Returns {} if missing.
 * @param {string} projectRoot
 * @param {string} skill
 * @param {string} phase
 * @returns {Promise<object>}
 */
async function checkpointRead(projectRoot, skill, phase) {
  const cpFile = checkpointPath(projectRoot, skill, phase);
  try {
    const content = await readFile(cpFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Write a checkpoint file atomically.
 * @param {string} projectRoot
 * @param {string} skill
 * @param {string} phase
 * @param {object} data
 */
async function checkpointWrite(projectRoot, skill, phase, data) {
  const cpFile = checkpointPath(projectRoot, skill, phase);
  await ensureDir(join(projectRoot, '_lumina', '_state'));
  await atomicWrite(cpFile, JSON.stringify(data, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// 7. Log + index ops
// ---------------------------------------------------------------------------

/**
 * Resolve the session ID for a log entry.
 * Uses LUMINA_SESSION_ID env var if set and valid (8 lowercase hex chars),
 * otherwise generates a fresh random ID via crypto.randomUUID().slice(0, 8).
 * @returns {string} 8-char hex session ID
 */
function resolveSessionId() {
  const env = process.env.LUMINA_SESSION_ID;
  if (env && /^[0-9a-f]{8}$/.test(env)) return env;
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Append a log entry to wiki/log.md.
 * Format: `## [YYYY-MM-DD] <skill> | session:<8hex> | <details>`
 * Uses atomic read-append-write pattern.
 * @param {string} projectRoot
 * @param {string} skill
 * @param {string} details
 */
async function appendLog(projectRoot, skill, details) {
  const logFile = join(projectRoot, 'wiki', 'log.md');
  let existing = '';
  try {
    existing = await readFile(logFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const sessionId = resolveSessionId();
  const entry = `## [${today()}] ${skill} | session:${sessionId} | ${details}`;
  const newContent = existing
    ? (existing.endsWith('\n') ? existing + entry + '\n' : existing + '\n' + entry + '\n')
    : entry + '\n';

  await atomicWrite(logFile, newContent);
}

// ---------------------------------------------------------------------------
// 8. Init op
// ---------------------------------------------------------------------------

/**
 * Core wiki directories to create (always).
 */
const CORE_WIKI_DIRS = [
  'wiki/sources',
  'wiki/concepts',
  'wiki/people',
  'wiki/summary',
  'wiki/outputs',
  'wiki/graph',
];

/**
 * Installable (non-core) pack names, derived from ENTITY_DIRS so a new pack
 * added to schemas.mjs becomes selectable via `init --pack` without touching
 * this file.
 * @type {string[]}
 */
const INSTALLABLE_PACKS = [...new Set(Object.values(ENTITY_DIRS).map(e => e.pack))]
  .filter(pack => pack !== 'core');

/**
 * Additional wiki dirs owned by a given pack, derived from ENTITY_DIRS.
 * Preserves ENTITY_DIRS declaration order.
 * @param {string} pack
 * @returns {string[]}
 */
function wikiDirsForPack(pack) {
  return Object.values(ENTITY_DIRS)
    .filter(e => e.pack === pack)
    .map(e => `wiki/${e.dir}`.replace(/\/$/, ''));
}

/**
 * Initialize a workspace skeleton.
 * Idempotent: re-running on an existing workspace is a no-op.
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {string} [opts.pack] - one of INSTALLABLE_PACKS | undefined
 * @returns {Promise<{created: string[], skipped: string[]}>}
 */
async function initWorkspace(projectRoot, opts = {}) {
  const created = [];
  const skipped = [];

  let dirs = [...CORE_WIKI_DIRS];
  if (opts.pack && INSTALLABLE_PACKS.includes(opts.pack)) {
    dirs = [...dirs, ...wikiDirsForPack(opts.pack)];
  }

  // Add _lumina/_state dir
  dirs.push('_lumina/_state');

  for (const relDir of dirs) {
    const absDir = join(projectRoot, relDir);
    try {
      await access(absDir, fsConstants.F_OK);
      skipped.push(relDir);
    } catch (_) {
      await ensureDir(absDir);
      created.push(relDir);
    }
  }

  // Create wiki/index.md if not exists
  const indexFile = join(projectRoot, 'wiki', 'index.md');
  try {
    await access(indexFile, fsConstants.F_OK);
    skipped.push('wiki/index.md');
  } catch (_) {
    await atomicWrite(indexFile, '');
    created.push('wiki/index.md');
  }

  // Create wiki/log.md if not exists
  const logFile = join(projectRoot, 'wiki', 'log.md');
  try {
    await access(logFile, fsConstants.F_OK);
    skipped.push('wiki/log.md');
  } catch (_) {
    await atomicWrite(logFile, '');
    created.push('wiki/log.md');
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// 9. Additional entity + graph query helpers
// ---------------------------------------------------------------------------

/**
 * Read all edges from wiki/graph/edges.jsonl that involve a given slug.
 * Returns forward edges (where slug is `from`) and reverse edges (where slug is `to`).
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<{outbound: object[], inbound: object[]}>}
 */
async function readEdgesForSlug(projectRoot, slug, opts = {}) {
  const edgesFile = join(projectRoot, 'wiki', 'graph', 'edges.jsonl');
  const all = await readJsonl(edgesFile);
  const typeFilter = opts.type;
  const direction = opts.direction || 'both';
  const matchesType = (edge) => !typeFilter || edge.type === typeFilter;
  const outbound = direction === 'inbound' ? [] : all.filter(e => e.from === slug && matchesType(e));
  const inbound = direction === 'outbound' ? [] : all.filter(e => e.to === slug && matchesType(e));
  return { outbound, inbound };
}

/**
 * Read all citations from wiki/graph/citations.jsonl that involve a given slug.
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<{citing: object[], citedBy: object[]}>}
 */
async function readCitationsForSlug(projectRoot, slug) {
  const citationsFile = join(projectRoot, 'wiki', 'graph', 'citations.jsonl');
  const all = await readJsonl(citationsFile);
  const citing = all.filter(e => e.from === slug);
  const citedBy = all.filter(e => e.to === slug);
  return { citing, citedBy };
}

/**
 * Check a single frontmatter value against its declared field type.
 * Mirrors lint.mjs's L02 check word-for-word so the two can never diverge —
 * this is the single source of truth for frontmatter type semantics, used
 * both by whole-document validation (_validateFrontmatter, read-only) and
 * by the setMeta write-path gate (single-key, hard reject, no --force). That
 * includes L02's TODO-placeholder rule, which lives in checkL02's 'string'
 * branch only (not a blanket pre-switch guard): the literal "TODO" (trimmed,
 * case-sensitive) is never a real value for a declared string field, so
 * setMeta can no longer be used to write the exact defect L02 flags on read.
 * Other types keep their own natural mismatch message for a "TODO" value
 * (e.g. iso-date still says "must be an ISO date... got \"TODO\""), exactly
 * as checkL02 does — only the 'string' branch's outcome changes.
 *
 * @param {import('./schemas.mjs').FrontmatterField} field
 * @param {any} val - Already-present value (never undefined/null; callers
 *   handle missing-field logic themselves before calling this).
 * @returns {string|null} Human-readable violation (unprefixed), or null if valid.
 */
function _checkFieldType(field, val) {
  switch (field.type) {
    case 'string':
      if (typeof val !== 'string') {
        return `"${field.key}" must be a string, got ${typeof val}`;
      } else if (val.trim() === 'TODO') {
        // Task 2 sentinel rule (mirrors checkL02 in lint.mjs word-for-word):
        // the exact literal "TODO" (trimmed, case-sensitive) is never a real
        // value for a DECLARED schema field — it is the placeholder a prior
        // Lumina version could write for a missing string field. It satisfies
        // `typeof val === 'string'` above, so without this check the write
        // path would happily persist it — precisely the defect this gate
        // exists to close.
        return `"${field.key}" is set to the placeholder "TODO", which is not a real value`;
      }
      break;
    case 'number':
      if (typeof val !== 'number' || Number.isNaN(val)) {
        return `"${field.key}" must be a number, got ${JSON.stringify(val)}`;
      }
      break;
    case 'array':
      if (!Array.isArray(val)) {
        return `"${field.key}" must be an array, got ${typeof val}`;
      }
      break;
    case 'iso-date':
      if (typeof val !== 'string' || !DATE_RE.test(val)) {
        return `"${field.key}" must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(val)}`;
      }
      break;
    case 'enum':
      if (field.values && !field.values.includes(val)) {
        return `"${field.key}" must be one of [${field.values.join(', ')}], got ${JSON.stringify(val)}`;
      }
      break;
    case 'object':
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        return `"${field.key}" must be an object, got ${Array.isArray(val) ? 'array' : typeof val}`;
      }
      break;
  }
  return null;
}

/**
 * Validate frontmatter fields against REQUIRED_FRONTMATTER schema.
 * Returns a list of validation errors (empty if valid).
 * @param {Record<string,any>} frontmatter
 * @param {string} entityType
 * @returns {string[]}
 */
function _validateFrontmatter(frontmatter, entityType) {
  const fields = REQUIRED_FRONTMATTER[entityType] ?? null;
  if (!fields) return [`Unknown entity type: ${entityType}`];

  const errors = [];
  for (const field of fields) {
    const val = frontmatter[field.key];
    if (val === undefined || val === null) {
      if (field.required) {
        errors.push(`Missing required field: ${field.key}`);
      }
      continue;
    }
    const violation = _checkFieldType(field, val);
    if (violation) errors.push(violation);
  }
  return errors;
}

/**
 * Validate the shape of each item in a findings array.
 * Returns an array of error strings; empty array means valid.
 * Called by verify-frontmatter when findings is present and non-empty.
 * @param {unknown[]} findings
 * @returns {string[]}
 */
function _validateFindingsItems(findings) {
  const VALID_REVIEWER = ['blind', 'grounding', 'external'];
  const VALID_CLASS = ['decision_needed', 'patch', 'defer', 'dismiss'];
  const errors = [];
  findings.forEach((item, idx) => {
    const prefix = `findings[${idx}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`${prefix}: must be an object`);
      return;
    }
    if (typeof item.id !== 'number') {
      errors.push(`${prefix}.id: must be a number, got ${typeof item.id}`);
    }
    if (!VALID_REVIEWER.includes(item.reviewer)) {
      errors.push(`${prefix}.reviewer: must be one of [${VALID_REVIEWER.join(', ')}], got ${item.reviewer}`);
    }
    if (!VALID_CLASS.includes(item.class)) {
      errors.push(`${prefix}.class: must be one of [${VALID_CLASS.join(', ')}], got ${item.class}`);
    }
    if (typeof item.claim !== 'string') {
      errors.push(`${prefix}.claim: must be a string, got ${typeof item.claim}`);
    }
    if (typeof item.evidence !== 'string') {
      errors.push(`${prefix}.evidence: must be a string, got ${typeof item.evidence}`);
    }
    if (typeof item.action !== 'string') {
      errors.push(`${prefix}.action: must be a string, got ${typeof item.action}`);
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// 10. Output helpers
// ---------------------------------------------------------------------------

/**
 * Emit JSON to stdout.
 * @param {any} data
 */
function emitJson(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * Emit an error to stderr and set exit code.
 * @param {string} message
 * @param {number} code - 2 or 3
 */
function emitError(message, code) {
  process.stderr.write(JSON.stringify({ error: message, code }) + '\n');
  process.exitCode = code;
}

/**
 * Emit the error envelope and exit with that same code. Never returns — the
 * CLI dispatch paired `emitError(msg, N); process.exit(N);` at every one of
 * these call sites.
 * @param {string} message
 * @param {number} code
 * @returns {never}
 */
function fail(message, code) {
  emitError(message, code);
  process.exit(code);
}

/**
 * Reject an edge command's endpoint pair: a path-shaped slug must resolve
 * inside the project, and neither endpoint may contain `..`. Extracted from
 * three verbatim copies in the dispatch. Never returns on rejection.
 *
 * Note the citation subcommands deliberately still carry their own, narrower
 * checks: they run before requireProjectRoot(), so they have no projectRoot to
 * validate against, and widening them here would change which error a user sees
 * outside a project. That reasoning once named the checkpoint subcommands too,
 * which was simply wrong -- they call requireProjectRoot() before doing any
 * work, and they now validate in checkpointPath().
 * @param {string} fromSlug
 * @param {string} toSlug
 * @param {string} projectRoot
 */
function requireSafeEdgeSlugs(fromSlug, toSlug, projectRoot) {
  if (fromSlug.includes('/') && !pathSafe(fromSlug, projectRoot)) {
    fail(`Unsafe from-slug: ${fromSlug}`, 2);
  }
  if (toSlug.includes('/') && !pathSafe(toSlug, projectRoot)) {
    fail(`Unsafe to-slug: ${toSlug}`, 2);
  }
  if (fromSlug.includes('..') || toSlug.includes('..')) {
    fail('Slug may not contain ..', 2);
  }
}

// ---------------------------------------------------------------------------
// 10. CLI dispatch
// ---------------------------------------------------------------------------

/**
 * Parse argv flags into an options object.
 * @param {string[]} args - raw argv slice after subcommand
 * @returns {{ flags: Record<string, string|boolean>, positional: string[] }}
 */
function parseArgs(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { flags, positional };
}

/**
 * Require project root, exit 2 if not found.
 * @param {string} [startDir]
 * @returns {Promise<string>}
 */
async function requireProjectRoot(startDir) {
  const root = await findProjectRoot(startDir);
  if (!root) {
    fail('No Lumina workspace found (wiki/ directory not found in current directory or ancestors). Run `node wiki.mjs init` first.', 2);
  }
  return root;
}

/**
 * Read JSON data from stdin until EOF.
 * @returns {Promise<any>}
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid JSON from stdin: ${err.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Main CLI dispatch function.
 * @param {string[]} argv - process.argv
 */
async function main(argv) {
  const [, , subcommand, ...rest] = argv;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stderr.write([
      'Usage: node wiki.mjs <subcommand> [flags]',
      '',
      'Subcommands:',
      `  init [--pack ${INSTALLABLE_PACKS.join('|')}]  Create workspace skeleton`,
      '  slug <title>                    Emit kebab-case slug',
      '  log <skill> <details...>        Append to wiki/log.md',
      '  read-meta <slug>                Read entity frontmatter as JSON',
      '  set-meta <slug> <key> <value> [--json-value]  Set frontmatter key',
      '  add-edge <from> <type> <to> [--confidence high|medium|low]',
      '  add-citation <from> <to>        Append cites edge to citations.jsonl',
      '  remove-citation <from> <to> [--dry-run]  Remove cites edge from citations.jsonl',
      '  batch-edges <json-file>         Apply array of edges from JSON file',
      '  dedup-edges                     Deduplicate edges.jsonl',
      '  remove-edge <from> <type> <to> [--dry-run]',
      '  replace-edge <from> <old-type> <to> <new-type> [--confidence high|medium|low] [--dry-run]',
      '  list-entities [path-prefix] [--type <type>]  List entity slugs as JSON',
      '  resolve-alias <text>            Map free-text query to a foundations/* slug',
      '  read-edges <slug>|--from <slug> [--type <type>] [--direction outbound|inbound|both]',
      '  read-citations <slug>           Read all citations for a slug',
      '  verify-frontmatter <slug>       Validate frontmatter fields',
      '  migrate --add-defaults [--dry-run]  Backfill provenance/confidence on legacy entries',
      '  checkpoint-read <skill> <phase>',
      '  checkpoint-write <skill> <phase> <json-file|-|stdin>',
      '',
      'Exit codes: 0 success, 2 user error, 3 internal error',
    ].join('\n') + '\n');
    process.exit(0);
  }

  const { flags, positional } = parseArgs(rest);

  try {
    switch (subcommand) {

      // -----------------------------------------------------------------------
      case 'init': {
        // init does not require an existing workspace; it creates one
        const projectRoot = process.cwd();
        const pack = flags.pack && typeof flags.pack === 'string' ? flags.pack : undefined;
        if (pack && !INSTALLABLE_PACKS.includes(pack)) {
          fail(`Invalid --pack value: ${pack}. Must be one of: ${INSTALLABLE_PACKS.join(', ')}.`, 2);
        }
        const result = await initWorkspace(projectRoot, { pack });
        emitJson({ ok: true, created: result.created, skipped: result.skipped });
        break;
      }

      // -----------------------------------------------------------------------
      case 'slug': {
        const title = positional.join(' ');
        if (!title) {
          fail('slug requires a title argument', 2);
        }
        emitJson({ slug: slugify(title) });
        break;
      }

      // -----------------------------------------------------------------------
      case 'log': {
        const skill = positional[0];
        const details = positional.slice(1).join(' ');
        if (!skill) {
          fail('log requires <skill> argument', 2);
        }
        if (!details) {
          fail('log requires <details> argument', 2);
        }
        const projectRoot = await requireProjectRoot();
        await appendLog(projectRoot, skill, details);
        emitJson({ ok: true, date: today(), skill, details });
        break;
      }

      // -----------------------------------------------------------------------
      case 'read-meta': {
        const slug = positional[0];
        if (!slug) {
          fail('read-meta requires <slug> argument', 2);
        }
        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          fail(`Unsafe slug: ${slug}`, 2);
        }
        const { frontmatter, filePath } = await readMeta(projectRoot, slug);
        emitJson({ slug, filePath: relative(projectRoot, filePath), frontmatter });
        break;
      }

      // -----------------------------------------------------------------------
      case 'set-meta': {
        const slug = positional[0];
        const key = positional[1];
        const rawValue = positional[2];

        if (!slug || !key || rawValue === undefined) {
          fail('set-meta requires <slug> <key> <value>', 2);
        }

        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          fail(`Unsafe slug: ${slug}`, 2);
        }

        let value;
        if (flags['json-value']) {
          try {
            value = JSON.parse(rawValue);
          } catch (err) {
            fail(`Invalid JSON value: ${err.message}`, 2);
          }
        } else {
          // Auto-coerce scalar types (number, boolean) — mirrors YAML parsing behavior.
          // Callers that need explicit strings should quote them or use --json-value.
          value = parseScalar(rawValue);
        }

        const { filePath } = await setMeta(projectRoot, slug, key, value);
        emitJson({ ok: true, slug, key, value, filePath: relative(projectRoot, filePath) });
        break;
      }

      // -----------------------------------------------------------------------
      case 'add-edge': {
        const fromSlug = positional[0];
        const edgeType = positional[1];
        const toSlug = positional[2];

        if (!fromSlug || !edgeType || !toSlug) {
          fail('add-edge requires <from-slug> <edge-type> <to-slug>', 2);
        }

        const projectRoot = await requireProjectRoot();

        // Path safety for slugs (only if they look like paths)
        requireSafeEdgeSlugs(fromSlug, toSlug, projectRoot);

        const confidence = flags.confidence && typeof flags.confidence === 'string'
          ? flags.confidence
          : undefined;

        const result = await addEdge(projectRoot, fromSlug, edgeType, toSlug, { confidence });
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'add-citation': {
        const fromSlug = positional[0];
        const toSlug = positional[1];

        if (!fromSlug || !toSlug) {
          fail('add-citation requires <from-slug> <to-slug>', 2);
        }
        if (fromSlug.includes('..') || toSlug.includes('..')) {
          fail('Slug may not contain ..', 2);
        }

        const projectRoot = await requireProjectRoot();
        const result = await addCitation(projectRoot, fromSlug, toSlug);
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'remove-citation': {
        const fromSlug = positional[0];
        const toSlug = positional[1];

        if (!fromSlug || !toSlug) {
          fail('remove-citation requires <from-slug> <to-slug>', 2);
        }
        if (fromSlug.includes('..') || toSlug.includes('..')) {
          fail('Slug may not contain ..', 2);
        }

        const projectRoot = await requireProjectRoot();
        const dryRun = Boolean(flags['dry-run']);
        const result = await removeCitation(projectRoot, fromSlug, toSlug, { dryRun });
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'batch-edges': {
        const jsonFile = positional[0];
        if (!jsonFile) {
          fail('batch-edges requires <json-file>', 2);
        }
        const projectRoot = await requireProjectRoot();
        const resolvedFile = resolve(jsonFile);
        const result = await batchEdges(projectRoot, resolvedFile);
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'dedup-edges': {
        const projectRoot = await requireProjectRoot();
        const result = await dedupEdges(projectRoot);
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'remove-edge': {
        const fromSlug = positional[0];
        const edgeType = positional[1];
        const toSlug = positional[2];

        if (!fromSlug || !edgeType || !toSlug) {
          fail('remove-edge requires <from-slug> <edge-type> <to-slug>', 2);
        }

        if (edgeType === 'cites' || edgeType === 'cited_by') {
          emitError(
            'Citations live in wiki/graph/citations.jsonl, not edges.jsonl; use `remove-citation <citing> <cited>` (for a cited_by relation, the citing source is the <cited> argument).',
            2,
          );
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();

        requireSafeEdgeSlugs(fromSlug, toSlug, projectRoot);

        const dryRun = Boolean(flags['dry-run']);
        const result = await removeEdge(projectRoot, fromSlug, edgeType, toSlug, { dryRun });
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'replace-edge': {
        const fromSlug = positional[0];
        const oldType = positional[1];
        const toSlug = positional[2];
        const newType = positional[3];

        if (!fromSlug || !oldType || !toSlug || !newType) {
          fail('replace-edge requires <from-slug> <old-type> <to-slug> <new-type>', 2);
        }

        if ([oldType, newType].includes('cites') || [oldType, newType].includes('cited_by')) {
          emitError(
            'Citations live in wiki/graph/citations.jsonl, not edges.jsonl; replace-edge cannot retype cites/cited_by edges. Use add-citation / remove-citation to manage citations.',
            2,
          );
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();

        requireSafeEdgeSlugs(fromSlug, toSlug, projectRoot);

        const confidence = flags.confidence && typeof flags.confidence === 'string'
          ? flags.confidence
          : undefined;
        const dryRun = Boolean(flags['dry-run']);

        const result = await replaceEdge(projectRoot, fromSlug, oldType, toSlug, newType, { confidence, dryRun });
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'checkpoint-read': {
        const skill = positional[0];
        const phase = positional[1];
        if (!skill || !phase) {
          fail('checkpoint-read requires <skill> <phase>', 2);
        }
        const projectRoot = await requireProjectRoot();
        const data = await checkpointRead(projectRoot, skill, phase);
        emitJson(data);
        break;
      }

      // -----------------------------------------------------------------------
      case 'checkpoint-write': {
        const skill = positional[0];
        const phase = positional[1];
        const source = positional[2]; // json-file path, '-', or undefined (stdin)

        if (!skill || !phase) {
          fail('checkpoint-write requires <skill> <phase> [<json-file>|-]', 2);
        }

        const projectRoot = await requireProjectRoot();

        let data;
        if (!source || source === '-') {
          try {
            data = await readStdin();
          } catch (err) {
            fail(err.message, 2);
          }
        } else {
          const absSource = resolve(source);
          try {
            const content = await readFile(absSource, 'utf8');
            data = JSON.parse(content);
          } catch (err) {
            const msg = err.code === 'ENOENT'
              ? `File not found: ${source}`
              : `Error reading ${source}: ${err.message}`;
            fail(msg, 2);
          }
        }

        await checkpointWrite(projectRoot, skill, phase, data);
        emitJson({ ok: true, skill, phase });
        break;
      }

      // -----------------------------------------------------------------------
      case 'list-entities': {
        const projectRoot = await requireProjectRoot();
        const typeFilter = flags.type && typeof flags.type === 'string' ? flags.type : null;
        const prefix = positional[0] || null;
        if (typeFilter && !ENTITY_DIRS[typeFilter]) {
          fail(`Unknown entity type: ${typeFilter}. Valid types: ${Object.keys(ENTITY_DIRS).join(', ')}`, 2);
        }
        if (prefix && !pathSafe(prefix, projectRoot)) {
          fail(`Unsafe prefix: ${prefix}`, 2);
        }
        const entities = await listEntities(projectRoot, prefix);
        const filtered = typeFilter ? entities.filter(e => e.type === typeFilter) : entities;
        emitJson({
          count: filtered.length,
          entities: filtered.map(e => ({
            slug: e.slug,
            path: e.path,
            type: e.type,
            dir: e.dir,
            filePath: relative(projectRoot, e.filePath),
          })),
        });
        break;
      }

      // -----------------------------------------------------------------------
      case 'read-edges': {
        const slug = (flags.from && typeof flags.from === 'string') ? flags.from : positional[0];
        if (!slug) {
          fail('read-edges requires <slug> or --from <slug>', 2);
        }
        if (slug.includes('..')) {
          fail('Slug may not contain ..', 2);
        }
        const typeFilter = flags.type && typeof flags.type === 'string' ? flags.type : null;
        const direction = flags.direction && typeof flags.direction === 'string' ? flags.direction : 'both';
        if (typeFilter && !edgeTypeByName(typeFilter)) {
          fail(`Unknown edge type: ${typeFilter}`, 2);
        }
        if (!['outbound', 'inbound', 'both'].includes(direction)) {
          fail(`Invalid --direction: ${direction}. Must be outbound, inbound, or both.`, 2);
        }
        const projectRoot = await requireProjectRoot();
        const { outbound, inbound } = await readEdgesForSlug(projectRoot, slug, { type: typeFilter, direction });
        emitJson({ slug, type: typeFilter, direction, outbound, inbound });
        break;
      }

      // -----------------------------------------------------------------------
      case 'read-citations': {
        const slug = positional[0];
        if (!slug) {
          fail('read-citations requires <slug>', 2);
        }
        if (slug.includes('..')) {
          fail('Slug may not contain ..', 2);
        }
        const projectRoot = await requireProjectRoot();
        const { citing, citedBy } = await readCitationsForSlug(projectRoot, slug);
        emitJson({ slug, citing, citedBy });
        break;
      }

      // -----------------------------------------------------------------------
      case 'verify-frontmatter': {
        const slug = positional[0];
        if (!slug) {
          fail('verify-frontmatter requires <slug>', 2);
        }
        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          fail(`Unsafe slug: ${slug}`, 2);
        }
        const { frontmatter, filePath } = await readMeta(projectRoot, slug);

        // Determine entity type from directory
        const entityType = _entityTypeForFilePath(projectRoot, filePath);

        if (!entityType) {
          const relPath = relative(join(projectRoot, 'wiki'), filePath);
          emitJson({ slug, valid: false, errors: [`Cannot determine entity type from path: ${relPath}`] });
          break;
        }

        const errors = _validateFrontmatter(frontmatter, entityType);

        // Validate findings item shapes when present and non-empty.
        // Malformed items are a hard error (code 2) per the exit-code contract.
        const findingsVal = frontmatter.findings;
        if (findingsVal !== undefined && findingsVal !== null) {
          if (!Array.isArray(findingsVal)) {
            emitError(
              `findings must be an array, got ${typeof findingsVal}`,
              2,
            );
            process.exit(2);
          }
          if (findingsVal.length > 0) {
            const findingsErrors = _validateFindingsItems(findingsVal);
            if (findingsErrors.length > 0) {
              emitError(
                `findings items malformed: ${findingsErrors.join('; ')}`,
                2,
              );
              process.exit(2);
            }
          }
        }

        emitJson({
          slug,
          entityType,
          valid: errors.length === 0,
          errors,
          filePath: relative(projectRoot, filePath),
        });
        break;
      }

      // -----------------------------------------------------------------------
      case 'migrate': {
        if (!flags['add-defaults']) {
          fail('migrate requires --add-defaults (no other migration modes are defined)', 2);
        }
        const projectRoot = await requireProjectRoot();
        const dryRun = Boolean(flags['dry-run']);
        const result = await migrateLegacyDefaults(projectRoot, dryRun);
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'resolve-alias': {
        const text = positional.join(' ').trim();
        if (!text) {
          fail('resolve-alias requires <text>', 2);
        }
        const projectRoot = await requireProjectRoot();
        // Scoped scan: listEntities walks all 13 entity dirs without a prefix,
        // and every result but foundations/ was discarded a line later.
        const foundations = await listEntities(projectRoot, 'foundations');

        const needle = text.toLowerCase();
        const matches = [];

        for (const entity of foundations) {
          const content = await readFile(entity.filePath, 'utf8');
          const { frontmatter } = parseFrontmatter(content);

          // Build candidate set with priority: slug > title > alias
          const slugNorm = entity.slug.toLowerCase().trim();
          const titleNorm = typeof frontmatter.title === 'string'
            ? frontmatter.title.toLowerCase().trim()
            : null;

          let matchSource = null;

          if (slugNorm === needle) {
            matchSource = 'slug';
          } else if (titleNorm !== null && titleNorm === needle) {
            matchSource = 'title';
          } else {
            // Check aliases defensively
            const aliases = frontmatter.aliases;
            if (Array.isArray(aliases)) {
              for (const alias of aliases) {
                if (typeof alias !== 'string') continue;
                if (alias.toLowerCase().trim() === needle) {
                  matchSource = 'alias';
                  break;
                }
              }
            }
          }

          if (matchSource !== null) {
            matches.push({ slug: entity.slug, path: entity.path, source: matchSource });
          }
        }

        if (matches.length === 0) {
          fail(`no match for query: ${text}`, 2);
        }

        // Sort ascending by slug for deterministic output
        matches.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

        emitJson({
          query: text,
          matches,
          ambiguous: matches.length >= 2,
        });
        break;
      }

      // -----------------------------------------------------------------------
      default: {
        fail(`Unknown subcommand: ${subcommand}. Run node wiki.mjs --help for usage.`, 2);
      }
    }
  } catch (err) {
    const code = (err && err.code === 2) ? 2 : 3;
    emitError(err.message || String(err), code);
    if (code === 3) {
      // Internal error — print stack to stderr for debugging
      process.stderr.write((err.stack || '') + '\n');
    }
    process.exit(code);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main(process.argv);
