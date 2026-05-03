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

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, rename, unlink, mkdir, access, stat, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve, relative, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';

import {
  ENTITY_DIRS,
  EDGE_TYPES,
  EXEMPTION_GLOBS,
  SCHEMA_VERSION,
  REQUIRED_FRONTMATTER,
} from './schemas.mjs';

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Minimum valid edge confidence values. */
const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);

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
 * Write content to path atomically: write to <path>.tmp, fsync fd, rename.
 * @param {string} filePath - Destination path.
 * @param {string} content - String content to write (UTF-8).
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp';
  let fd;
  try {
    fd = await open(tmpPath, 'w');
    await fd.writeFile(content, 'utf8');
    await fd.datasync();
    await fd.close();
    fd = null;
    await rename(tmpPath, filePath);
  } catch (err) {
    if (fd) {
      try { await fd.close(); } catch (_) { /* ignore */ }
    }
    // Best-effort cleanup of .tmp
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

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

  for (const line of fmLines) {
    if (line.trimEnd() === '') continue;

    // Detect indented list item
    const listMatch = FM_LIST_ITEM_RE.exec(line);
    if (listMatch && currentListKey !== null) {
      const val = unquoteValue(listMatch[2].trim());
      frontmatter[currentListKey].push(val);
      continue;
    }

    const kvMatch = FM_LINE_RE.exec(line);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (rawVal === '' || rawVal === null) {
        // Could be start of a block list
        frontmatter[currentKey] = [];
        currentListKey = currentKey;
      } else if (rawVal === '[]') {
        frontmatter[currentKey] = [];
        currentListKey = currentKey;
      } else {
        // Parse inline list [a, b, c]
        if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          const inner = rawVal.slice(1, -1).trim();
          if (inner === '') {
            frontmatter[currentKey] = [];
          } else {
            frontmatter[currentKey] = inner.split(',').map(v => unquoteValue(v.trim()));
          }
          currentListKey = null;
        } else {
          frontmatter[currentKey] = parseScalar(rawVal);
          currentListKey = null;
        }
      }
      continue;
    }

    // Indented list item without matching pattern (fallback)
    if (line.match(/^\s+-\s/) && currentListKey !== null) {
      const val = unquoteValue(line.replace(/^\s+-\s+/, '').trim());
      frontmatter[currentListKey].push(val);
    }
  }

  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Unquote a YAML scalar value (single or double quotes).
 * @param {string} v
 * @returns {string}
 */
function unquoteValue(v) {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
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
          lines.push(`  - ${quoteIfNeeded(item)}`);
        }
      }
    } else if (val === null) {
      lines.push(`${key}: null`);
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
 * @param {boolean} hasFrontmatter
 * @returns {string}
 */
function assembleMd(fm, body, hasFrontmatter) {
  if (!hasFrontmatter && Object.keys(fm).length === 0) return body;
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
  if (!resolved.startsWith(rootResolved + sep) && resolved !== rootResolved) return false;
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
 * Check whether a target slug/path matches any of the exemption globs.
 * Supported glob patterns: `**` anywhere, `*` (single segment).
 * @param {string} target
 * @returns {boolean}
 */
function isExempt(target) {
  for (const glob of EXEMPTION_GLOBS) {
    if (matchGlob(glob, target)) return true;
  }
  return false;
}

/**
 * Simple glob matcher supporting `*` and `**`.
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
function matchGlob(pattern, str) {
  // Normalize separators
  const p = pattern.replace(/\\/g, '/');
  const s = str.replace(/\\/g, '/');

  // Special pattern: *://* matches URLs
  if (p === '*://*') {
    return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(s);
  }

  // Convert glob to regex
  const regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*');

  const re = new RegExp(`^${regexStr}$`);
  return re.test(s);
}

/**
 * Compute SHA-256 hash of a string.
 * @param {string} content
 * @returns {string} hex digest
 */
function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
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
 * Set a frontmatter key in an entity file.
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
  frontmatter[key] = value;
  const newContent = assembleMd(frontmatter, body, hasFrontmatter || true);
  await atomicWrite(filePath, newContent);
  return { filePath };
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
 * Create a canonical edge key for deduplication.
 * For symmetric edges: sorted endpoints joined with `|`.
 * For asymmetric edges: `from|type|to`.
 * @param {object} edge
 * @returns {string}
 */
function edgeKey(edge) {
  const typeDef = EDGE_TYPES.find(t => t.name === edge.type);
  if (typeDef && typeDef.symmetric) {
    const endpoints = [edge.from, edge.to].sort();
    return `${endpoints[0]}|${edge.type}|${endpoints[1]}`;
  }
  return `${edge.from}|${edge.type}|${edge.to}`;
}

/**
 * Normalize a symmetric edge so endpoints are sorted.
 * @param {object} edge
 * @returns {object}
 */
function normalizeEdge(edge) {
  const typeDef = EDGE_TYPES.find(t => t.name === edge.type);
  if (typeDef && typeDef.symmetric) {
    const [a, b] = [edge.from, edge.to].sort();
    return { ...edge, from: a, to: b };
  }
  return edge;
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
  const typeDef = EDGE_TYPES.find(t => t.name === edgeType);
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

  // Add reverse unless:
  // 1. edge is terminal
  // 2. target matches EXEMPTION_GLOBS
  // 3. edge is symmetric (already covered by sorted endpoints)
  const skipReverse =
    typeDef.terminal ||
    isExempt(toSlug) ||
    typeDef.symmetric;

  if (!skipReverse && typeDef.reverse) {
    const reverseEdge = {
      from: toSlug,
      type: typeDef.reverse,
      to: fromSlug,
      ...(opts.confidence ? { confidence: opts.confidence } : {}),
    };
    const revKey = edgeKey(reverseEdge);
    if (!existingKeys.has(revKey)) {
      toAdd.push(reverseEdge);
    }
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
    const typeDef = EDGE_TYPES.find(t => t.name === rec.type);
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
    const typeDef = EDGE_TYPES.find(t => t.name === rec.type);
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

    const skipReverse =
      typeDef.terminal ||
      isExempt(rec.to) ||
      typeDef.symmetric;

    if (!skipReverse && typeDef.reverse) {
      const reverseEdge = {
        from: rec.to,
        type: typeDef.reverse,
        to: rec.from,
        ...(rec.confidence ? { confidence: rec.confidence } : {}),
      };
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

// ---------------------------------------------------------------------------
// 6. Checkpoint ops
// ---------------------------------------------------------------------------

/**
 * Read a checkpoint file. Returns {} if missing.
 * @param {string} projectRoot
 * @param {string} skill
 * @param {string} phase
 * @returns {Promise<object>}
 */
async function checkpointRead(projectRoot, skill, phase) {
  const stateDir = join(projectRoot, '_lumina', '_state');
  const cpFile = join(stateDir, `${skill}-${phase}.json`);
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
  const stateDir = join(projectRoot, '_lumina', '_state');
  await ensureDir(stateDir);
  const cpFile = join(stateDir, `${skill}-${phase}.json`);
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

/** Research pack additional wiki dirs */
const RESEARCH_WIKI_DIRS = [
  'wiki/foundations',
  'wiki/topics',
];

/** Reading pack additional wiki dirs */
const READING_WIKI_DIRS = [
  'wiki/chapters',
  'wiki/characters',
  'wiki/themes',
  'wiki/plot',
];

/**
 * Initialize a workspace skeleton.
 * Idempotent: re-running on an existing workspace is a no-op.
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {string} [opts.pack] - 'research' | 'reading' | undefined
 * @returns {Promise<{created: string[], skipped: string[]}>}
 */
async function initWorkspace(projectRoot, opts = {}) {
  const created = [];
  const skipped = [];

  let dirs = [...CORE_WIKI_DIRS];
  if (opts.pack === 'research') {
    dirs = [...dirs, ...RESEARCH_WIKI_DIRS];
  } else if (opts.pack === 'reading') {
    dirs = [...dirs, ...READING_WIKI_DIRS];
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
 * Validate frontmatter fields against REQUIRED_FRONTMATTER schema.
 * Returns a list of validation errors (empty if valid).
 * @param {Record<string,any>} frontmatter
 * @param {string} entityType
 * @returns {string[]}
 */
function _validateFrontmatter(frontmatter, entityType) {
  // Import REQUIRED_FRONTMATTER from the already-imported schemas module.
  // Because schemas.mjs is pure data, this import is a no-op (already cached).
  // We use a dynamic import workaround via a re-export alias loaded at startup.
  const fields = _getRequiredFrontmatterFields(entityType);
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
    // Type checks
    switch (field.type) {
      case 'string':
        if (typeof val !== 'string') {
          errors.push(`Field '${field.key}' must be a string, got ${typeof val}`);
        }
        break;
      case 'number':
        if (typeof val !== 'number') {
          errors.push(`Field '${field.key}' must be a number, got ${typeof val}`);
        }
        break;
      case 'array':
        if (!Array.isArray(val)) {
          errors.push(`Field '${field.key}' must be an array, got ${typeof val}`);
        }
        break;
      case 'enum':
        if (field.values && !field.values.includes(val)) {
          errors.push(`Field '${field.key}' must be one of [${field.values.join(', ')}], got ${val}`);
        }
        break;
      case 'iso-date':
        if (typeof val !== 'string' || !DATE_RE.test(val)) {
          errors.push(`Field '${field.key}' must be a YYYY-MM-DD date, got '${val}'`);
        }
        break;
    }
  }
  return errors;
}

/**
 * Lookup required frontmatter fields for an entity type.
 * Merges _base fields with type-specific fields.
 * @param {string} entityType
 * @returns {import('./schemas.mjs').FrontmatterField[]|null}
 */
function _getRequiredFrontmatterFields(entityType) {
  // REQUIRED_FRONTMATTER is imported at module level from schemas.mjs.
  // We access it through the module-scoped import binding.
  const typeFields = _REQUIRED_FRONTMATTER[entityType];
  if (!typeFields) return null;
  return typeFields;
}

// Module-level alias to the imported REQUIRED_FRONTMATTER for use by
// _getRequiredFrontmatterFields without a dynamic import inside the function.
const _REQUIRED_FRONTMATTER = REQUIRED_FRONTMATTER;

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
 * Print info/status to stderr (non-JSON, non-blocking).
 * @param {string} message
 */
function info(message) {
  process.stderr.write(`[wiki] ${message}\n`);
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
    emitError('No Lumina workspace found (wiki/ directory not found in current directory or ancestors). Run `node wiki.mjs init` first.', 2);
    process.exit(2);
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
      '  init [--pack research|reading]  Create workspace skeleton',
      '  slug <title>                    Emit kebab-case slug',
      '  log <skill> <details...>        Append to wiki/log.md',
      '  read-meta <slug>                Read entity frontmatter as JSON',
      '  set-meta <slug> <key> <value> [--json-value]  Set frontmatter key',
      '  add-edge <from> <type> <to> [--confidence high|medium|low]',
      '  add-citation <from> <to>        Append cites edge to citations.jsonl',
      '  batch-edges <json-file>         Apply array of edges from JSON file',
      '  dedup-edges                     Deduplicate edges.jsonl',
      '  list-entities [path-prefix] [--type <type>]  List entity slugs as JSON',
      '  resolve-alias <text>            Map free-text query to a foundations/* slug',
      '  read-edges <slug>|--from <slug> [--type <type>] [--direction outbound|inbound|both]',
      '  read-citations <slug>           Read all citations for a slug',
      '  verify-frontmatter <slug>       Validate frontmatter fields',
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
        if (pack && pack !== 'research' && pack !== 'reading') {
          emitError(`Invalid --pack value: ${pack}. Must be research or reading.`, 2);
          process.exit(2);
        }
        const result = await initWorkspace(projectRoot, { pack });
        emitJson({ ok: true, created: result.created, skipped: result.skipped });
        break;
      }

      // -----------------------------------------------------------------------
      case 'slug': {
        const title = positional.join(' ');
        if (!title) {
          emitError('slug requires a title argument', 2);
          process.exit(2);
        }
        emitJson({ slug: slugify(title) });
        break;
      }

      // -----------------------------------------------------------------------
      case 'log': {
        const skill = positional[0];
        const details = positional.slice(1).join(' ');
        if (!skill) {
          emitError('log requires <skill> argument', 2);
          process.exit(2);
        }
        if (!details) {
          emitError('log requires <details> argument', 2);
          process.exit(2);
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
          emitError('read-meta requires <slug> argument', 2);
          process.exit(2);
        }
        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          emitError(`Unsafe slug: ${slug}`, 2);
          process.exit(2);
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
          emitError('set-meta requires <slug> <key> <value>', 2);
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          emitError(`Unsafe slug: ${slug}`, 2);
          process.exit(2);
        }

        let value;
        if (flags['json-value']) {
          try {
            value = JSON.parse(rawValue);
          } catch (err) {
            emitError(`Invalid JSON value: ${err.message}`, 2);
            process.exit(2);
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
          emitError('add-edge requires <from-slug> <edge-type> <to-slug>', 2);
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();

        // Path safety for slugs (only if they look like paths)
        if (fromSlug.includes('/') && !pathSafe(fromSlug, projectRoot)) {
          emitError(`Unsafe from-slug: ${fromSlug}`, 2);
          process.exit(2);
        }
        if (toSlug.includes('/') && !pathSafe(toSlug, projectRoot)) {
          emitError(`Unsafe to-slug: ${toSlug}`, 2);
          process.exit(2);
        }
        if (fromSlug.includes('..') || toSlug.includes('..')) {
          emitError('Slug may not contain ..', 2);
          process.exit(2);
        }

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
          emitError('add-citation requires <from-slug> <to-slug>', 2);
          process.exit(2);
        }
        if (fromSlug.includes('..') || toSlug.includes('..')) {
          emitError('Slug may not contain ..', 2);
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();
        const result = await addCitation(projectRoot, fromSlug, toSlug);
        emitJson(result);
        break;
      }

      // -----------------------------------------------------------------------
      case 'batch-edges': {
        const jsonFile = positional[0];
        if (!jsonFile) {
          emitError('batch-edges requires <json-file>', 2);
          process.exit(2);
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
      case 'checkpoint-read': {
        const skill = positional[0];
        const phase = positional[1];
        if (!skill || !phase) {
          emitError('checkpoint-read requires <skill> <phase>', 2);
          process.exit(2);
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
          emitError('checkpoint-write requires <skill> <phase> [<json-file>|-]', 2);
          process.exit(2);
        }

        const projectRoot = await requireProjectRoot();

        let data;
        if (!source || source === '-') {
          try {
            data = await readStdin();
          } catch (err) {
            emitError(err.message, 2);
            process.exit(2);
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
            emitError(msg, 2);
            process.exit(2);
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
          emitError(`Unknown entity type: ${typeFilter}. Valid types: ${Object.keys(ENTITY_DIRS).join(', ')}`, 2);
          process.exit(2);
        }
        if (prefix && !pathSafe(prefix, projectRoot)) {
          emitError(`Unsafe prefix: ${prefix}`, 2);
          process.exit(2);
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
          emitError('read-edges requires <slug> or --from <slug>', 2);
          process.exit(2);
        }
        if (slug.includes('..')) {
          emitError('Slug may not contain ..', 2);
          process.exit(2);
        }
        const typeFilter = flags.type && typeof flags.type === 'string' ? flags.type : null;
        const direction = flags.direction && typeof flags.direction === 'string' ? flags.direction : 'both';
        if (typeFilter && !EDGE_TYPES.some(t => t.name === typeFilter)) {
          emitError(`Unknown edge type: ${typeFilter}`, 2);
          process.exit(2);
        }
        if (!['outbound', 'inbound', 'both'].includes(direction)) {
          emitError(`Invalid --direction: ${direction}. Must be outbound, inbound, or both.`, 2);
          process.exit(2);
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
          emitError('read-citations requires <slug>', 2);
          process.exit(2);
        }
        if (slug.includes('..')) {
          emitError('Slug may not contain ..', 2);
          process.exit(2);
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
          emitError('verify-frontmatter requires <slug>', 2);
          process.exit(2);
        }
        const projectRoot = await requireProjectRoot();
        if (!pathSafe(slug, projectRoot)) {
          emitError(`Unsafe slug: ${slug}`, 2);
          process.exit(2);
        }
        const { frontmatter, filePath } = await readMeta(projectRoot, slug);

        // Determine entity type from directory
        const wikiDir = join(projectRoot, 'wiki');
        const relPath = relative(wikiDir, filePath);
        const dirParts = relPath.split(sep);
        const entityDirName = dirParts[0] + '/';
        const entityType = Object.entries(ENTITY_DIRS).find(
          ([, v]) => v.dir === entityDirName,
        )?.[0] ?? null;

        if (!entityType) {
          emitJson({ slug, valid: false, errors: [`Cannot determine entity type from path: ${relPath}`] });
          break;
        }

        const errors = _validateFrontmatter(frontmatter, entityType);
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
      case 'resolve-alias': {
        const text = positional.join(' ').trim();
        if (!text) {
          emitError('resolve-alias requires <text>', 2);
          process.exit(2);
        }
        const projectRoot = await requireProjectRoot();
        const allEntities = await listEntities(projectRoot);
        const foundations = allEntities.filter(e => e.type === 'foundations');

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
          emitError(`no match for query: ${text}`, 2);
          process.exit(2);
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
        emitError(`Unknown subcommand: ${subcommand}. Run node wiki.mjs --help for usage.`, 2);
        process.exit(2);
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
