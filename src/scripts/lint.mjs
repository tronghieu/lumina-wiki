/**
 * @module lint
 * @description LuminaWiki v0.1 wiki linter — 11 schema checks, optional --fix.
 *
 * CLI usage:
 *   node lint.mjs [path] [--fix] [--dry-run] [--suggest] [--json] [--summary]
 *
 * Exit codes:
 *   0  clean (no violations, or all violations fixed)
 *   1  violations found (none fixed, or some remain after fix)
 *   2  user error (bad args, no wiki/ dir found)
 *   3  internal error (unexpected exception)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Summary output schema (--summary flag):
 * {"errors":N,"warnings":N,"by_check":{"L01":n,...,"L11":n},"fixable":N}
 * Single-line JSON. Exit code follows default lint rules.
 * Compatible with --json --summary (--summary takes precedence over verbose shape).
 * ─────────────────────────────────────────────────────────────────────────────
 * JSON output schema (--json flag):
 * {
 *   "schema_version": "0.1.0",        // matches SCHEMA_VERSION from schemas.mjs
 *   "scanned_files": number,           // count of .md files inspected
 *   "checks_run": string[],            // e.g. ["L01","L02",...]
 *   "findings": [
 *     {
 *       "id": string,                  // e.g. "L06-missing-reverse-edge"
 *       "severity": "error"|"warning"|"info",
 *       "fixable": boolean,
 *       "file": string,                // wiki-root-relative path, e.g. "sources/lora.md"
 *       "line": number|null,           // 1-based line number if known
 *       "message": string,
 *       "fix_applied": boolean,        // true only when --fix ran and succeeded
 *       "proposed_fix"?: string        // present when --fix --dry-run; diff/preview text
 *     }
 *   ],
 *   "summary": {
 *     "errors": number,
 *     "warnings": number,
 *     "info": number,
 *     "fixes_applied": number
 *   }
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, rename, mkdir, readdir, stat, access, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, basename, dirname, relative, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  SCHEMA_VERSION,
  ENTITY_DIRS,
  EDGE_TYPES,
  REQUIRED_FRONTMATTER,
  ENUMS,
  EXEMPTION_GLOBS,
} from './schemas.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_MARKER_OPEN = '<!-- lumina:index -->';
const INDEX_MARKER_CLOSE = '<!-- /lumina:index -->';

/** All check IDs in run order. */
const ALL_CHECK_IDS = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12'];

/** Kebab-case pattern: lowercase letters, digits, hyphens; no leading/trailing hyphen. */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ISO date pattern YYYY-MM-DD. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Wikilink pattern [[slug]] or [[slug|alias]]. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect NO_COLOR / non-TTY; return whether to use ANSI codes.
 * @returns {boolean}
 */
function useColor() {
  if (process.env.NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Prefix helpers for human output.
 * @param {string} text
 * @returns {string}
 */
function ok(text) { return useColor() ? `\x1b[32m[OK]\x1b[0m ${text}` : `[OK] ${text}`; }
function warn(text) { return useColor() ? `\x1b[33m[WARN]\x1b[0m ${text}` : `[WARN] ${text}`; }
function err(text) { return useColor() ? `\x1b[31m[ERR]\x1b[0m ${text}` : `[ERR] ${text}`; }
function info(text) { return useColor() ? `\x1b[36m[INFO]\x1b[0m ${text}` : `[INFO] ${text}`; }

/**
 * Atomic write: write to a temp file, fsync via close, then rename into place.
 * @param {string} filePath  Absolute destination path.
 * @param {string} content   UTF-8 content to write.
 */
async function atomicWrite(filePath, content) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.lint-tmp-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(tmp, content, { encoding: 'utf8', flag: 'w' });
    await rename(tmp, filePath);
  } catch (e) {
    // Best-effort cleanup of tmp on failure.
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * Recursively walk a directory, yielding absolute paths of all .md files.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walkMd(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkMd(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Walk up from startDir until we find a directory containing wiki/.
 * @param {string} startDir
 * @returns {Promise<string|null>}
 */
async function findProjectRoot(startDir) {
  let current = resolve(startDir);
  while (true) {
    try {
      await access(join(current, 'wiki'), fsConstants.F_OK);
      return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Safe path join — rejects any component containing '..' after normalization.
 * @param {string} base
 * @param {...string} parts
 * @returns {string}
 */
function safejoin(base, ...parts) {
  const joined = normalize(join(base, ...parts));
  if (!joined.startsWith(normalize(base))) {
    throw new Error(`Path traversal rejected: ${parts.join('/')}`);
  }
  return joined;
}

/**
 * Minimal YAML frontmatter parser.
 * Returns { data: object, body: string, end: number } or null if no frontmatter.
 * Supports string, number, array (- item per line), and inline YAML arrays.
 * @param {string} content
 * @returns {{ data: Record<string,unknown>, body: string, fmLines: string[] }|null}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const rest = content.slice(3);
  const nlIdx = rest.indexOf('\n');
  if (nlIdx === -1) return null;
  // First line after --- must be empty/whitespace (blank separator) or a YAML key: value line
  const afterDash = rest.slice(0, nlIdx).trim();
  if (afterDash !== '' && !/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(afterDash)) return null;

  const bodyStart = rest.indexOf('\n---');
  if (bodyStart === -1) return null;

  // If afterDash is non-empty, the first line is already part of the frontmatter
  const fmText = afterDash !== ''
    ? rest.slice(0, bodyStart)
    : rest.slice(nlIdx + 1, bodyStart);
  const body = rest.slice(bodyStart + 4);

  const data = {};
  const lines = fmText.split('\n');
  const fmLines = lines;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
    if (!kvMatch) { i++; continue; }
    const key = kvMatch[1];
    const rawVal = kvMatch[2].trim();

    if (rawVal === '' || rawVal === null) {
      // Check for block list on next lines.
      const listItems = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s*-\s+(.+)/)) {
        listItems.push(lines[i].match(/^\s*-\s+(.*)/)[1].trim());
        i++;
      }
      data[key] = listItems.length > 0 ? listItems : null;
      continue;
    } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      // Inline array: [a, b, c]
      const inner = rawVal.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else {
      // Scalar — try number, then string.
      const asNum = Number(rawVal);
      if (!isNaN(asNum) && rawVal !== '') {
        data[key] = asNum;
      } else {
        data[key] = rawVal.replace(/^['"]|['"]$/g, '');
      }
    }
    i++;
  }

  return { data, body, fmLines };
}

/**
 * Parse edges.jsonl file.
 * @param {string} edgesPath  Absolute path to wiki/graph/edges.jsonl.
 * @returns {Promise<Array<{from:string,to:string,type:string,confidence?:string}>>}
 */
async function parseEdgesJsonl(edgesPath) {
  let raw;
  try {
    raw = await readFile(edgesPath, 'utf8');
  } catch {
    return [];
  }
  const edges = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      edges.push(JSON.parse(trimmed));
    } catch {}
  }
  return edges;
}

/**
 * Check whether a slug-path matches any exemption glob.
 * Globs supported: 'dir/**' (prefix match) and '*://*' (URL match).
 * @param {string} target
 * @returns {boolean}
 */
function isExempt(target) {
  for (const glob of EXEMPTION_GLOBS) {
    if (glob === '*://*') {
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(target)) return true;
    } else if (glob.endsWith('/**')) {
      const prefix = glob.slice(0, -3);
      if (target === prefix || target.startsWith(prefix + '/')) return true;
    } else if (target === glob) {
      return true;
    }
  }
  return false;
}

/**
 * Determine entity type dir for a wiki-relative file path.
 * e.g. "sources/lora.md" => "sources"
 * @param {string} wikiRelPath
 * @returns {string|null}
 */
function entityTypeForPath(wikiRelPath) {
  const parts = wikiRelPath.split('/');
  if (parts.length >= 2) {
    const dir = parts[0];
    if (ENTITY_DIRS[dir]) return dir;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {'error'|'warning'|'info'} severity
 * @property {boolean} fixable
 * @property {string} file          - wiki-root-relative path
 * @property {number|null} line
 * @property {string} message
 * @property {boolean} fix_applied
 * @property {string} [proposed_fix]
 */

/**
 * @param {string} id
 * @param {'error'|'warning'|'info'} severity
 * @param {boolean} fixable
 * @param {string} file
 * @param {number|null} line
 * @param {string} message
 * @returns {Finding}
 */
function finding(id, severity, fixable, file, line, message) {
  return { id, severity, fixable, file, line, message, fix_applied: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L01: Every entity file has all required frontmatter keys per entity type.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL01(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (!type) return [];
  const fields = REQUIRED_FRONTMATTER[type];
  if (!fields) return [];

  const findings = [];
  for (const field of fields) {
    if (!field.required) continue;
    if (!(field.key in fm) || fm[field.key] === null || fm[field.key] === undefined) {
      findings.push(finding(
        'L01-frontmatter-required', 'error', true,
        wikiRelPath, null,
        `Missing required frontmatter key: "${field.key}" (type: ${field.type})`
      ));
    }
  }
  return findings;
}

/**
 * L02: Values match expected types.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL02(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (!type) return [];
  const fields = REQUIRED_FRONTMATTER[type];
  if (!fields) return [];

  const findings = [];
  for (const field of fields) {
    const val = fm[field.key];
    if (val === null || val === undefined) continue; // L01 handles missing
    switch (field.type) {
      case 'string':
        if (typeof val !== 'string') {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be a string, got ${typeof val}`));
        }
        break;
      case 'number':
        if (typeof val !== 'number' || isNaN(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be a number, got ${JSON.stringify(val)}`));
        }
        break;
      case 'array':
        if (!Array.isArray(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be an array, got ${typeof val}`));
        }
        break;
      case 'iso-date':
        if (typeof val !== 'string' || !ISO_DATE_RE.test(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(val)}`));
        }
        break;
      case 'enum':
        if (field.values && !field.values.includes(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be one of [${field.values.join(', ')}], got ${JSON.stringify(val)}`));
        }
        break;
    }
  }
  return findings;
}

/**
 * L03: File basename matches kebab-case.
 * @param {string} wikiRelPath
 * @returns {Finding[]}
 */
function checkL03(wikiRelPath) {
  const base = basename(wikiRelPath, '.md');
  if (!KEBAB_RE.test(base)) {
    return [finding(
      'L03-slug-style', 'error', true,
      wikiRelPath, null,
      `File basename "${base}" is not kebab-case`
    )];
  }
  return [];
}

/**
 * L04: Entity has zero inbound AND zero outbound links (orphan).
 * @param {string} wikiRelPath
 * @param {Set<string>} outboundSlugs   - Set of slugs this file links to.
 * @param {Set<string>} inboundSet      - Set of slugs that link to this file.
 * @returns {Finding[]}
 */
function checkL04(wikiRelPath, outboundSlugs, inboundSet) {
  if (isExempt(wikiRelPath)) return [];
  if (!entityTypeForPath(wikiRelPath)) return [];
  if (outboundSlugs.size === 0 && !inboundSet.has(wikiRelPath)) {
    return [finding(
      'L04-orphan-page', 'warning', false,
      wikiRelPath, null,
      'Page has no inbound or outbound links (orphan)'
    )];
  }
  return [];
}

/**
 * L05: [[slug]] in body or frontmatter doesn't resolve to any known file.
 * @param {string} wikiRelPath
 * @param {string} rawContent
 * @param {Set<string>} knownSlugs  - Set of wiki-relative paths (without .md).
 * @returns {Finding[]}
 */
function checkL05(wikiRelPath, rawContent, knownSlugs) {
  const findings = [];
  let match;
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let line = 1;
  let lastNl = 0;
  for (let i = 0; i < rawContent.length; i++) {
    if (rawContent[i] === '\n') { line++; lastNl = i; }
  }
  // Reset and scan properly with line tracking.
  const lines = rawContent.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const lineRe = new RegExp(WIKILINK_RE.source, 'g');
    while ((match = lineRe.exec(lines[li])) !== null) {
      const slug = match[1].trim();
      if (!knownSlugs.has(slug)) {
        findings.push(finding(
          'L05-broken-wikilink', 'error', false,
          wikiRelPath, li + 1,
          `Broken wikilink: [[${slug}]] does not resolve to any wiki file`
        ));
      }
    }
  }
  return findings;
}

/**
 * L06: Forward edge exists but required reverse is missing.
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {Set<string>} edgeSet  - Set of "from|type|to" strings for fast lookup.
 * @returns {Finding[]}
 */
function checkL06(edges, edgeSet) {
  const findings = [];
  for (const edge of edges) {
    if (isExempt(edge.to)) continue;
    const edgeType = EDGE_TYPES.find(et => et.name === edge.type);
    if (!edgeType) continue;
    if (edgeType.terminal || edgeType.reverse === null) continue;
    if (edgeType.symmetric) continue; // L07 handles symmetric

    const reverseKey = `${edge.to}|${edgeType.reverse}|${edge.from}`;
    if (!edgeSet.has(reverseKey)) {
      findings.push(finding(
        'L06-missing-reverse-edge', 'error', true,
        edge.from, null,
        `Missing reverse edge: "${edge.to}" should have edge "${edgeType.reverse}" -> "${edge.from}"`
      ));
    }
  }
  return findings;
}

/**
 * L07: Symmetric edge stored both ways.
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {Set<string>} edgeSet
 * @returns {Finding[]}
 */
function checkL07(edges, edgeSet) {
  const findings = [];
  const seen = new Set();
  for (const edge of edges) {
    const edgeType = EDGE_TYPES.find(et => et.name === edge.type);
    if (!edgeType || !edgeType.symmetric) continue;

    const [a, b] = [edge.from, edge.to].sort();
    const canonical = `${a}|${edge.type}|${b}`;
    const reverse = `${edge.to}|${edge.type}|${edge.from}`;

    if (!seen.has(canonical)) {
      seen.add(canonical);
      // Check if both orderings appear in edgeSet (stored both ways)
      if (edgeSet.has(reverse) && edge.from !== edge.to) {
        findings.push(finding(
          'L07-symmetric-edge-duplicate', 'warning', true,
          edge.from, null,
          `Symmetric edge "${edge.type}" stored both ways between "${edge.from}" and "${edge.to}"; should be stored once with sorted endpoints`
        ));
      }
    } else {
      // Duplicate line (same canonical key seen again)
      findings.push(finding(
        'L07-symmetric-edge-duplicate', 'warning', true,
        edge.from, null,
        `Symmetric edge "${edge.type}" stored both ways between "${edge.from}" and "${edge.to}"; should be stored once with sorted endpoints`
      ));
    }
  }
  return findings;
}

/**
 * L08: Paper-paper and paper-concept semantic edges missing confidence field.
 * @param {Array<{from:string,to:string,type:string,confidence?:string}>} edges
 * @returns {Finding[]}
 */
function checkL08(edges) {
  const findings = [];
  for (const edge of edges) {
    const edgeType = EDGE_TYPES.find(et => et.name === edge.type);
    if (!edgeType || !edgeType.confidenceRequired) continue;

    const validConfidence = ['high', 'medium', 'low'];
    if (!edge.confidence || !validConfidence.includes(edge.confidence)) {
      findings.push(finding(
        'L08-edge-confidence-required', 'error', false,
        edge.from, null,
        `Edge "${edge.type}" from "${edge.from}" to "${edge.to}" requires confidence: high|medium|low`
      ));
    }
  }
  return findings;
}

/**
 * L09: wiki/index.md doesn't list every entity file.
 * @param {string} indexPath        Absolute path to wiki/index.md.
 * @param {string} indexContent     Raw content.
 * @param {string[]} entityFiles    wiki-relative paths of all entity .md files.
 * @returns {Finding[]}
 */
function checkL09(indexPath, indexContent, entityFiles) {
  const listed = new Set();
  const markerOpen = indexContent.indexOf(INDEX_MARKER_OPEN);
  const searchContent = markerOpen >= 0
    ? indexContent.slice(markerOpen)
    : indexContent;

  // Extract all wikilinks and plain slug references from index content.
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let m;
  while ((m = re.exec(searchContent)) !== null) {
    listed.add(m[1].trim());
  }
  // Also match bare markdown links [text](path).
  const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = mdLinkRe.exec(searchContent)) !== null) {
    listed.add(m[2].trim().replace(/^\.\//, '').replace(/\.md$/, ''));
  }

  const missing = [];
  for (const f of entityFiles) {
    const slug = f.replace(/\.md$/, '');
    const base = basename(f, '.md');
    if (!listed.has(slug) && !listed.has(base) && !listed.has(f)) {
      missing.push(f);
    }
  }

  if (missing.length > 0) {
    return [finding(
      'L09-index-stale', 'warning', true,
      'index.md', null,
      `index.md is missing ${missing.length} entity file(s): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`
    )];
  }
  return [];
}

/**
 * L10: Two foundations share an alias, or a foundation's alias collides with
 * another foundation's title. Foundations-only; no --fix mode.
 *
 * @param {Array<{wikiRelPath: string, fm: Record<string,unknown>}>} foundationEntries
 *   Each entry has the wiki-relative path and parsed frontmatter of one foundation file.
 * @returns {Finding[]}
 */
function checkL10(foundationEntries) {
  /** @type {Map<string, Array<{slug: string, source: 'title'|'alias', original: string}>>} */
  const index = new Map();

  for (const { wikiRelPath, fm } of foundationEntries) {
    const slug = wikiRelPath; // e.g. "foundations/transformer.md"

    // Collect title.
    if (typeof fm.title === 'string') {
      const norm = fm.title.trim().toLowerCase();
      if (!index.has(norm)) index.set(norm, []);
      index.get(norm).push({ slug, source: 'title', original: fm.title });
    }

    // Collect aliases (skip non-string entries defensively).
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : [];
    for (const alias of aliases) {
      if (typeof alias !== 'string') continue;
      const norm = alias.trim().toLowerCase();
      if (!index.has(norm)) index.set(norm, []);
      index.get(norm).push({ slug, source: 'alias', original: alias });
    }
  }

  const findings = [];
  for (const [, claimants] of index) {
    if (claimants.length < 2) continue;
    // Each claimant gets a finding mentioning the others.
    for (const claimant of claimants) {
      const others = claimants.filter(c => c !== claimant);
      const othersDesc = others
        .map(c => `${c.slug} (as ${c.source})`)
        .join(', ');
      findings.push(finding(
        'L10-alias-conflict', 'error', false,
        claimant.slug, null,
        `alias conflict on "${claimant.original}" — also claimed by ${othersDesc}`
      ));
    }
  }
  return findings;
}

/**
 * L12: `raw_paths` entries on a `sources` page point to a missing file, or to
 * `raw/tmp/*` (transient location — canonical sources should not live there).
 * Severity: warning. Not auto-fixable. Catches drift when the user moves or
 * renames a backing file, and flags the common mistake of pinning a wiki page
 * to a temp-zone artifact that may be cleaned at any time.
 *
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @param {string} projectRoot  Absolute path; used to resolve raw_paths entries.
 * @returns {Promise<Finding[]>}
 */
async function checkL12(wikiRelPath, fm, projectRoot) {
  const type = entityTypeForPath(wikiRelPath);
  if (type !== 'sources') return [];

  const rawPaths = fm.raw_paths;
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) return [];

  const findings = [];
  for (const entry of rawPaths) {
    if (typeof entry !== 'string' || entry === '') continue;

    // Reject paths inside raw/tmp/ — transient zone, not for canonical sources.
    if (entry.startsWith('raw/tmp/') || entry.startsWith('./raw/tmp/')) {
      findings.push(finding(
        'L12-raw-paths-transient', 'warning', false,
        wikiRelPath, null,
        `raw_paths entry "${entry}" lives in raw/tmp/ — transient. Move the file to raw/sources/ (human) or raw/download/<resource>/ (agent) and update raw_paths.`
      ));
      continue;
    }

    // Verify file exists on disk (relative to project root).
    const abs = resolve(projectRoot, entry);
    if (!abs.startsWith(resolve(projectRoot))) {
      findings.push(finding(
        'L12-raw-paths-unsafe', 'warning', false,
        wikiRelPath, null,
        `raw_paths entry "${entry}" escapes the project root`
      ));
      continue;
    }
    try {
      await access(abs, fsConstants.F_OK);
    } catch {
      findings.push(finding(
        'L12-raw-paths-missing', 'warning', false,
        wikiRelPath, null,
        `raw_paths entry "${entry}" does not exist on disk`
      ));
    }
  }
  return findings;
}

/**
 * L11: `confidence` field missing on a `sources` or `concepts` entity.
 * Severity: warning. Not auto-fixable. Sets an explicit trust signal that
 * downstream verification (Stage A/B/C of /lumi-verify, planned for v1.0)
 * relies on. Better to surface the absence now than silently defer it.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL11(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (type !== 'sources' && type !== 'concepts') return [];

  if (!('confidence' in fm) || fm.confidence === null || fm.confidence === undefined) {
    return [finding(
      'L11-confidence-missing', 'warning', false,
      wikiRelPath, null,
      `Missing optional-but-recommended frontmatter field "confidence" (sources and concepts); expected one of: high, medium, low, unverified`
    )];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixer for L01: insert missing frontmatter keys with TODO sentinel.
 * @param {string} filePath  Absolute path.
 * @param {string} content
 * @param {Finding[]} l01findings
 * @returns {{ newContent: string, preview: string }}
 */
function fixL01(filePath, content, l01findings) {
  if (!content.startsWith('---')) return { newContent: content, preview: '' };
  const rest = content.slice(3);
  const bodyStart = rest.indexOf('\n---');
  if (bodyStart === -1) return { newContent: content, preview: '' };

  const fmText = rest.slice(rest.indexOf('\n') + 1, bodyStart);
  const body = rest.slice(bodyStart);

  const missingKeys = l01findings
    .filter(f => f.id === 'L01-frontmatter-required')
    .map(f => {
      const m = f.message.match(/"([^"]+)"/);
      return m ? m[1] : null;
    })
    .filter(Boolean);

  const additions = missingKeys.map(k => `${k}: TODO`).join('\n');
  const newFm = fmText.trimEnd() + '\n' + additions;
  const newContent = `---\n${newFm}\n${body}`;
  const preview = missingKeys.map(k => `+ ${k}: TODO`).join('\n');
  return { newContent, preview };
}

/**
 * Fixer for L03: rename file to kebab-case + rewrite all wikilinks pointing to old slug.
 * Returns a list of { from, to, newContent } operations.
 * @param {string} wikiRelPath
 * @param {string} wikiRoot  Absolute wiki dir.
 * @param {string[]} allMdFiles  Absolute paths of all .md files.
 * @returns {Promise<Array<{absPath:string, newContent:string|null, newPath:string|null}>>}
 */
async function fixL03(wikiRelPath, wikiRoot, allMdFiles) {
  const base = basename(wikiRelPath, '.md');
  const kebab = base
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');

  const oldSlug = base;
  const newSlug = kebab;
  if (oldSlug === newSlug) return [];

  const ops = [];
  const absOld = safejoin(wikiRoot, wikiRelPath);
  const absNew = safejoin(wikiRoot, dirname(wikiRelPath), newSlug + '.md');
  ops.push({ absPath: absOld, newContent: null, newPath: absNew });

  // Rewrite wikilinks in all other files.
  for (const f of allMdFiles) {
    if (f === absOld) continue;
    const fc = await readFile(f, 'utf8');
    if (fc.includes(`[[${oldSlug}]]`) || fc.includes(`[[${oldSlug}|`)) {
      const updated = fc
        .replace(new RegExp(`\\[\\[${escapeRegex(oldSlug)}(\\|[^\\]]*)?\\]\\]`, 'g'),
          (_, alias) => `[[${newSlug}${alias || ''}]]`);
      ops.push({ absPath: f, newContent: updated, newPath: null });
    }
  }
  return ops;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fixer for L06: append missing reverse edges to edges.jsonl.
 * @param {string} edgesPath  Absolute path to edges.jsonl.
 * @param {string} edgesContent  Raw file content.
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {Set<string>} edgeSet
 * @returns {{ newContent: string, preview: string }}
 */
function fixL06(edgesPath, edgesContent, edges, edgeSet) {
  const toAdd = [];
  for (const edge of edges) {
    if (isExempt(edge.to)) continue;
    const edgeType = EDGE_TYPES.find(et => et.name === edge.type);
    if (!edgeType || edgeType.terminal || edgeType.reverse === null) continue;
    if (edgeType.symmetric) continue;

    const reverseKey = `${edge.to}|${edgeType.reverse}|${edge.from}`;
    if (!edgeSet.has(reverseKey)) {
      const revEdge = { from: edge.to, to: edge.from, type: edgeType.reverse };
      if (edge.confidence) revEdge.confidence = edge.confidence;
      toAdd.push(revEdge);
      edgeSet.add(reverseKey); // prevent duplicate adds in same run
    }
  }

  if (toAdd.length === 0) return { newContent: edgesContent, preview: '' };
  const additions = toAdd.map(e => JSON.stringify(e)).join('\n');
  const newContent = edgesContent.trimEnd() + '\n' + additions + '\n';
  const preview = toAdd.map(e => `+ ${JSON.stringify(e)}`).join('\n');
  return { newContent, preview };
}

/**
 * Fixer for L07: deduplicate symmetric edges to canonical sorted form.
 * @param {string} edgesContent
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @returns {{ newContent: string, preview: string }}
 */
function fixL07(edgesContent, edges) {
  const canonical = new Map(); // "a|b|type" -> edge object
  const removed = [];

  for (const edge of edges) {
    const edgeType = EDGE_TYPES.find(et => et.name === edge.type);
    if (!edgeType || !edgeType.symmetric) {
      const key = `${edge.from}|${edge.type}|${edge.to}`;
      canonical.set(key, edge);
      continue;
    }
    const [a, b] = [edge.from, edge.to].sort();
    const key = `${a}|${edge.type}|${b}`;
    if (!canonical.has(key)) {
      canonical.set(key, { ...edge, from: a, to: b });
    } else {
      removed.push(edge);
    }
  }

  const newContent = Array.from(canonical.values())
    .map(e => JSON.stringify(e))
    .join('\n') + '\n';
  const preview = removed.map(e => `- ${JSON.stringify(e)}`).join('\n');
  return { newContent, preview };
}

/**
 * Fixer for L09: rewrite index.md's auto-generated marker block.
 * @param {string} indexContent
 * @param {string[]} entityFiles  wiki-relative paths.
 * @returns {{ newContent: string, preview: string }}
 */
function fixL09(indexContent, entityFiles) {
  const autoBlock = entityFiles
    .map(f => `- [[${f.replace(/\.md$/, '')}]]`)
    .join('\n');

  const markerOpen = indexContent.indexOf(INDEX_MARKER_OPEN);
  const markerClose = indexContent.indexOf(INDEX_MARKER_CLOSE);

  let newContent;
  if (markerOpen >= 0 && markerClose >= 0 && markerClose > markerOpen) {
    const before = indexContent.slice(0, markerOpen + INDEX_MARKER_OPEN.length);
    const after = indexContent.slice(markerClose);
    newContent = `${before}\n${autoBlock}\n${after}`;
  } else {
    // Append marker block.
    newContent = indexContent.trimEnd()
      + `\n\n${INDEX_MARKER_OPEN}\n${autoBlock}\n${INDEX_MARKER_CLOSE}\n`;
  }

  const preview = `${INDEX_MARKER_OPEN}\n${autoBlock}\n${INDEX_MARKER_CLOSE}`;
  return { newContent, preview };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCAN FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LintOptions
 * @property {boolean} fix
 * @property {boolean} dryRun
 * @property {boolean} suggest
 * @property {boolean} json
 */

/**
 * Run all lint checks against a wiki directory.
 * @param {string} projectRoot  Absolute path to project root (contains wiki/).
 * @param {LintOptions} opts
 * @returns {Promise<{ findings: Finding[], scannedFiles: number }>}
 */
async function runLint(projectRoot, opts) {
  const wikiRoot = safejoin(projectRoot, 'wiki');
  const edgesPath = safejoin(wikiRoot, 'graph', 'edges.jsonl');
  const indexPath = safejoin(wikiRoot, 'index.md');

  // Collect all .md files under wiki/.
  const allAbsMd = await walkMd(wikiRoot);
  const allWikiRel = allAbsMd.map(f => relative(wikiRoot, f).replace(/\\/g, '/'));

  // Entity files only (under a known entity dir).
  const entityFiles = allWikiRel.filter(f => entityTypeForPath(f));

  // Build set of known slugs (wiki-relative without .md).
  const knownSlugs = new Set(allWikiRel.map(f => f.replace(/\.md$/, '')));

  // Build wikilink maps.
  const outboundMap = new Map(); // wikiRelPath -> Set<slug>
  const inboundSet = new Set();  // wikiRelPath values that have inbound links

  for (const wikiRelPath of allWikiRel) {
    const abs = safejoin(wikiRoot, wikiRelPath);
    const content = await readFile(abs, 'utf8');
    const slugs = new Set();
    const lines = content.split('\n');
    for (const line of lines) {
      const re = new RegExp(WIKILINK_RE.source, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        const slug = m[1].trim();
        slugs.add(slug);
        // Mark as having inbound link if slug resolves to a known file.
        const target = slug.endsWith('.md') ? slug.replace(/\.md$/, '') : slug;
        if (knownSlugs.has(target)) {
          inboundSet.add(target + '.md');
        }
      }
    }
    outboundMap.set(wikiRelPath, slugs);
  }

  // Parse edges.jsonl.
  const edges = await parseEdgesJsonl(edgesPath);
  const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));

  // Parse index.md.
  let indexContent = '';
  try { indexContent = await readFile(indexPath, 'utf8'); } catch {}

  // Run all checks.
  const allFindings = [];

  for (const wikiRelPath of allWikiRel) {
    const abs = safejoin(wikiRoot, wikiRelPath);
    const content = await readFile(abs, 'utf8');
    const parsed = parseFrontmatter(content);
    const fm = parsed ? parsed.data : {};

    allFindings.push(...checkL01(wikiRelPath, fm));
    allFindings.push(...checkL02(wikiRelPath, fm));
    allFindings.push(...checkL03(wikiRelPath));
    allFindings.push(...checkL04(wikiRelPath, outboundMap.get(wikiRelPath) || new Set(), inboundSet));
    allFindings.push(...checkL05(wikiRelPath, content, knownSlugs));
    allFindings.push(...checkL11(wikiRelPath, fm));
    allFindings.push(...await checkL12(wikiRelPath, fm, projectRoot));
  }

  allFindings.push(...checkL06(edges, new Set(edgeSet)));
  allFindings.push(...checkL07(edges, new Set(edgeSet)));
  allFindings.push(...checkL08(edges));

  if (indexContent !== undefined) {
    allFindings.push(...checkL09(indexPath, indexContent, entityFiles));
  }

  // L10: collect all foundation frontmatters in one pass, then check for alias conflicts.
  {
    const foundationEntries = [];
    for (const wikiRelPath of entityFiles) {
      if (!wikiRelPath.startsWith('foundations/')) continue;
      const abs = safejoin(wikiRoot, wikiRelPath);
      const content = await readFile(abs, 'utf8');
      const parsed = parseFrontmatter(content);
      foundationEntries.push({ wikiRelPath, fm: parsed ? parsed.data : {} });
    }
    allFindings.push(...checkL10(foundationEntries));
  }

  // Apply fixes if requested.
  if (opts.fix || opts.dryRun) {
    await applyFixes(allFindings, wikiRoot, edgesPath, indexPath, indexContent, entityFiles, allAbsMd, edges, edgeSet, opts);
  }

  return { findings: allFindings, scannedFiles: allWikiRel.length };
}

/**
 * Apply fixes for fixable findings.
 */
async function applyFixes(findings, wikiRoot, edgesPath, indexPath, indexContent, entityFiles, allAbsMd, edges, edgeSet, opts) {
  // Group L01 findings by file.
  const l01ByFile = new Map();
  for (const f of findings.filter(f => f.id === 'L01-frontmatter-required')) {
    if (!l01ByFile.has(f.file)) l01ByFile.set(f.file, []);
    l01ByFile.get(f.file).push(f);
  }

  // Fix L01.
  for (const [wikiRelPath, filefindings] of l01ByFile) {
    const abs = safejoin(wikiRoot, wikiRelPath);
    const content = await readFile(abs, 'utf8');
    const { newContent, preview } = fixL01(abs, content, filefindings);
    if (newContent !== content) {
      if (opts.dryRun) {
        for (const f of filefindings) { f.proposed_fix = preview; }
      } else {
        await atomicWrite(abs, newContent);
        for (const f of filefindings) { f.fix_applied = true; }
      }
    }
  }

  // Fix L03.
  const l03findings = findings.filter(f => f.id === 'L03-slug-style');
  for (const f of l03findings) {
    const ops = await fixL03(f.file, wikiRoot, allAbsMd);
    if (opts.dryRun) {
      f.proposed_fix = ops.map(op => op.newPath
        ? `rename: ${op.absPath} -> ${op.newPath}`
        : `rewrite wikilinks in: ${op.absPath}`
      ).join('\n');
    } else {
      for (const op of ops) {
        if (op.newPath) {
          await rename(op.absPath, op.newPath);
        } else if (op.newContent !== null) {
          await atomicWrite(op.absPath, op.newContent);
        }
      }
      f.fix_applied = true;
    }
  }

  // Fix L06.
  const l06findings = findings.filter(f => f.id === 'L06-missing-reverse-edge');
  if (l06findings.length > 0) {
    let edgesContent = '';
    try { edgesContent = await readFile(edgesPath, 'utf8'); } catch {}
    const { newContent, preview } = fixL06(edgesPath, edgesContent, edges, edgeSet);
    if (newContent !== edgesContent) {
      if (opts.dryRun) {
        for (const f of l06findings) { f.proposed_fix = preview; }
      } else {
        await atomicWrite(edgesPath, newContent);
        for (const f of l06findings) { f.fix_applied = true; }
      }
    }
  }

  // Fix L07.
  const l07findings = findings.filter(f => f.id === 'L07-symmetric-edge-duplicate');
  if (l07findings.length > 0) {
    let edgesContent = '';
    try { edgesContent = await readFile(edgesPath, 'utf8'); } catch {}
    const { newContent, preview } = fixL07(edgesContent, edges);
    if (newContent !== edgesContent) {
      if (opts.dryRun) {
        for (const f of l07findings) { f.proposed_fix = preview; }
      } else {
        await atomicWrite(edgesPath, newContent);
        for (const f of l07findings) { f.fix_applied = true; }
      }
    }
  }

  // Fix L09.
  const l09findings = findings.filter(f => f.id === 'L09-index-stale');
  if (l09findings.length > 0) {
    const { newContent, preview } = fixL09(indexContent, entityFiles);
    if (newContent !== indexContent) {
      if (opts.dryRun) {
        for (const f of l09findings) { f.proposed_fix = preview; }
      } else {
        await atomicWrite(indexPath, newContent);
        for (const f of l09findings) { f.fix_applied = true; }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format and print findings in human-readable mode.
 * @param {Finding[]} findings
 * @param {number} scannedFiles
 * @param {boolean} suggestMode
 */
function reportHuman(findings, scannedFiles) {
  if (findings.length === 0) {
    console.log(ok(`Scanned ${scannedFiles} file(s). No violations found.`));
    return;
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const infos = findings.filter(f => f.severity === 'info');

  for (const f of findings) {
    const loc = f.line ? `:${f.line}` : '';
    const fixed = f.fix_applied ? ' [FIXED]' : '';
    const proposed = f.proposed_fix ? `\n  proposed fix:\n  ${f.proposed_fix.split('\n').join('\n  ')}` : '';
    const prefix = f.severity === 'error' ? err : f.severity === 'warning' ? warn : info;
    console.log(prefix(`[${f.id}] ${f.file}${loc} — ${f.message}${fixed}${proposed}`));
  }

  const fixes = findings.filter(f => f.fix_applied).length;
  console.log('');
  console.log(`Scanned ${scannedFiles} file(s). Errors: ${errors.length}, Warnings: ${warnings.length}, Info: ${infos.length}, Fixes applied: ${fixes}.`);
}

/**
 * Build and print the compact --summary JSON line.
 * @param {Finding[]} findings
 */
function reportSummary(findings) {
  const FIXABLE_IDS = new Set(['L01', 'L03', 'L06', 'L07', 'L09']);

  let errors = 0;
  let warnings = 0;
  let fixable = 0;
  const by_check = {};
  for (const id of ALL_CHECK_IDS) by_check[id] = 0;

  for (const f of findings) {
    if (f.severity === 'error') errors++;
    else if (f.severity === 'warning') warnings++;

    // Extract the check prefix (e.g. "L01" from "L01-frontmatter-required").
    const prefix = f.id.match(/^(L\d+)/)?.[1];
    if (prefix && prefix in by_check) by_check[prefix]++;

    if (FIXABLE_IDS.has(prefix)) fixable++;
  }

  process.stdout.write(JSON.stringify({ errors, warnings, by_check, fixable }) + '\n');
}

/**
 * Format and print findings in JSON mode.
 * @param {Finding[]} findings
 * @param {number} scannedFiles
 */
function reportJson(findings, scannedFiles) {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  const fixes = findings.filter(f => f.fix_applied).length;

  const output = {
    schema_version: SCHEMA_VERSION,
    scanned_files: scannedFiles,
    checks_run: ALL_CHECK_IDS,
    findings,
    summary: { errors, warnings, info: infos, fixes_applied: fixes },
  };
  console.log(JSON.stringify(output, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI DISPATCH
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let path = null;
  let fix = false;
  let dryRun = false;
  let suggest = false;
  let json = false;
  let summary = false;

  for (const arg of args) {
    if (arg === '--fix') fix = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--suggest') suggest = true;
    else if (arg === '--json') json = true;
    else if (arg === '--summary') summary = true;
    else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else {
      path = arg;
    }
  }

  if (dryRun && !fix) {
    // --dry-run implies --fix intent but no writes.
    fix = true;
  }

  return { path, fix, dryRun, suggest, json, summary };
}

async function main() {
  const opts = parseArgs(process.argv);

  let projectRoot;
  if (opts.path) {
    projectRoot = resolve(opts.path);
    try {
      await access(join(projectRoot, 'wiki'), fsConstants.F_OK);
    } catch {
      console.error(`[ERR] No wiki/ directory found at: ${projectRoot}`);
      process.exit(2);
    }
  } else {
    projectRoot = await findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.error('[ERR] Could not find a project root containing wiki/. Pass a path explicitly.');
      process.exit(2);
    }
  }

  let findings, scannedFiles;
  try {
    ({ findings, scannedFiles } = await runLint(projectRoot, {
      fix: opts.fix && !opts.dryRun,
      dryRun: opts.dryRun,
      suggest: opts.suggest,
      json: opts.json,
    }));
  } catch (e) {
    console.error(`[ERR] Internal error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(3);
  }

  if (opts.summary) {
    reportSummary(findings);
  } else if (opts.json) {
    reportJson(findings, scannedFiles);
  } else {
    reportHuman(findings, scannedFiles);
  }

  const hasUnresolved = findings.some(f => !f.fix_applied && (f.severity === 'error' || f.severity === 'warning'));
  process.exit(hasUnresolved ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS (for testing)
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseFrontmatter,
  parseEdgesJsonl,
  walkMd,
  findProjectRoot,
  atomicWrite,
  isExempt,
  entityTypeForPath,
  checkL01, checkL02, checkL03, checkL04, checkL05,
  checkL06, checkL07, checkL08, checkL09, checkL10, checkL11, checkL12,
  fixL01, fixL03, fixL06, fixL07, fixL09,
  runLint,
  reportSummary,
  INDEX_MARKER_OPEN,
  INDEX_MARKER_CLOSE,
  ALL_CHECK_IDS,
};

// Run main only when invoked directly.
if (process.argv[1] && (process.argv[1].endsWith('lint.mjs') || process.argv[1].endsWith('lint'))) {
  main().catch(e => {
    console.error(`[ERR] Unhandled: ${e.message}`);
    process.exit(3);
  });
}
