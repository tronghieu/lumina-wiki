/**
 * @file parse.mjs
 * @description The deterministic parse (CAP-5, AD-11, AD-18, AD-19 input
 * side): `parseDoc(path, text, config)` turns one document's frontmatter,
 * headings, links, ID mentions, concept mentions, and status into raw facts
 * -- pure, no I/O. `parseAll(root, config)` runs it over every in-scope file
 * (`selectScope`). Parse never resolves a reference, types a relation, or
 * inverts an edge (AD-11, AD-19): every fact keeps its raw relation name and
 * `ref`/`object` exactly as written; `buildGraph()` (lib/graph.mjs) owns
 * resolution, typing, merging, and P09/P10/P18. Parse owns only P12
 * (unmapped doc type), P17 (frontmatter does not parse), P19 (status sources
 * disagree), and P20 (Decision status outside its lifecycle).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentHash } from './hash.mjs';
import { splitFrontmatter } from './frontmatter.mjs';
import { scanBody, renderedText, slug, escapeRegex, matchAll } from './markdown.mjs';
import { findQuoteLine } from './evidence.mjs';
import { makeFact } from './fact.mjs';
import { selectScope, compilePatternMatcher, resolveIncludeRoot } from './scope.mjs';
import { RULES, META_TYPES, META_RELATIONS } from '../ontology.mjs';

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
for (const id of ['P12', 'P17', 'P19', 'P20']) {
  if (!RULE_BY_ID.has(id)) throw new Error(`ontology.mjs RULES is missing rule ${id}`);
}
function ruleFor(id) {
  return RULE_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Pattern cache (perf): ID patterns, concept terms, and type path matchers are
// derived once per `config` object; `matchAll` caches the compiled RegExps.
// ---------------------------------------------------------------------------

const PATTERN_CACHE = new WeakMap();

function compileMention(source, ignoreCase) {
  return { source, ignoreCase };
}

function runCompiled({ source, ignoreCase }, text) {
  return matchAll(source, text, { ignoreCase });
}

function getPatternCache(config) {
  let cache = PATTERN_CACHE.get(config);
  if (cache) return cache;

  const idPatterns = [];
  for (const t of Object.values(config.types ?? {})) {
    if (t.idPattern) idPatterns.push(t.idPattern);
  }
  for (const ext of config.externalIds ?? []) {
    idPatterns.push(ext.pattern);
  }
  const idMatchers = idPatterns.map((p) => compileMention(p, false));

  const concepts = (config.concepts ?? []).map((concept) => ({
    conceptSlug: slug(concept.name),
    matchers: [concept.name, ...(concept.aliases ?? [])]
      .map((term) => compileMention(escapeRegex(term.normalize('NFC')), true)),
  }));

  const typePathMatchers = new Map(); // type entry -> compiled path matcher functions
  for (const entry of Object.values(config.types ?? {})) {
    if (Array.isArray(entry.paths) && entry.paths.length > 0) {
      typePathMatchers.set(entry, entry.paths.map((p) => compilePatternMatcher(p)));
    }
  }

  cache = { idMatchers, concepts, typePathMatchers };
  PATTERN_CACHE.set(config, cache);
  return cache;
}

// ---------------------------------------------------------------------------
// Doc type resolution (I/O matrix row "Doc type").
// ---------------------------------------------------------------------------

function frontmatterFilterMatches(filter, frontmatterData) {
  for (const [key, expected] of Object.entries(filter)) {
    if (!frontmatterData || !Object.hasOwn(frontmatterData, key)) return false;
    if (JSON.stringify(frontmatterData[key]) !== JSON.stringify(expected)) return false;
  }
  return true;
}

function typeMatches(entry, docPath, frontmatterData, pathMatchers) {
  const hasPaths = Array.isArray(entry.paths) && entry.paths.length > 0;
  const hasFrontmatter = entry.frontmatter !== undefined;
  if (hasPaths && !pathMatchers.some((m) => m(docPath))) return false;
  if (hasFrontmatter && !frontmatterFilterMatches(entry.frontmatter, frontmatterData)) return false;
  return true;
}

function resolveType(types, docPath, frontmatterData, cache) {
  for (const [name, entry] of Object.entries(types ?? {})) {
    const pathMatchers = cache.typePathMatchers.get(entry) ?? [];
    if (typeMatches(entry, docPath, frontmatterData, pathMatchers)) {
      return { type: name, metaType: entry.metaType, entry };
    }
  }
  return { type: null, metaType: 'Document', entry: null };
}

// ---------------------------------------------------------------------------
// Frontmatter line lookup: the 1-based file line of a top-level `<key>:`,
// and of a value string searched only inside the frontmatter block starting
// at that key's own line (so a same-valued item under an earlier key, or in
// the body, can never be picked instead).
// ---------------------------------------------------------------------------

function frontmatterLines(text) {
  return String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
}

/**
 * The 1-based file line of a top-level `<key>:` in the frontmatter block.
 * Top-level only: a line must start at column 0 (no leading whitespace), so
 * a nested `  id:` under some other key is never mistaken for it.
 * ponytail: a plain line scan, not a YAML-position-tracking parse -- doesn't
 * handle a multi-line block scalar for `<key>`. Good enough for the `id`/
 * `type`/relation keys, which are always short scalars or flow/block
 * sequences in practice; upgrade to js-yaml's (unused-by-CORE_SCHEMA)
 * mark/position API if that ever stops holding.
 * @param {string} text the whole raw file (as read; may carry a leading BOM).
 * @param {number} bodyStartLine 1-based file line where the body starts
 *   (frontmatter, if any, is lines 2..bodyStartLine-1).
 * @param {string} key the frontmatter key to find.
 * @returns {number|null}
 */
function findFrontmatterKeyLine(text, bodyStartLine, key) {
  const lines = frontmatterLines(text);
  const re = new RegExp(`^${escapeRegex(key)}\\s*:`);
  for (let i = 1; i < bodyStartLine - 1 && i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

/**
 * The 1-based file line of `quote` inside the frontmatter block, searched
 * only from `keyLine` onward and never past the block, so it can't return
 * an earlier occurrence of the same value under a different key (or in the
 * body, which sits entirely outside the searched range).
 * @param {string} text the whole raw file.
 * @param {number} bodyStartLine see `findFrontmatterKeyLine`.
 * @param {number|null} keyLine the key's own line, from `findFrontmatterKeyLine`.
 * @param {string} quote the value to find.
 * @returns {number|null}
 */
function findFrontmatterValueLine(text, bodyStartLine, keyLine, quote) {
  if (keyLine === null) return null;
  const lines = frontmatterLines(text);
  const blockEndLine = bodyStartLine - 2; // last frontmatter line, 1-based
  const slice = lines.slice(keyLine - 1, blockEndLine).join('\n');
  const found = findQuoteLine(slice, quote);
  return found === null ? null : keyLine + found - 1;
}

// ---------------------------------------------------------------------------
// Declared ID (I/O matrix row "Declared ID").
// ---------------------------------------------------------------------------

/** @returns {{value: string|null, line: number|null}} */
function resolveDeclaredId(frontmatterData, headings, idPattern, text, bodyStartLine) {
  let raw = null;
  let line = null;
  let fromFrontmatter = false;
  const fmId = frontmatterData?.id;
  if (typeof fmId === 'string' && fmId.trim() !== '') {
    raw = fmId.trim();
    line = findFrontmatterKeyLine(text, bodyStartLine, 'id') ?? 1;
    fromFrontmatter = true;
  } else {
    const h1 = headings.find((h) => h.level === 1);
    if (h1) {
      const rendered = renderedText(h1.text).trim();
      if (rendered !== '') {
        raw = rendered;
        line = h1.line;
      }
    }
  }
  if (raw === null) return { value: null, line: null };
  if (idPattern) {
    try {
      const m = new RegExp(`^(?:${idPattern})(?![\\p{L}\\p{N}_])`, 'u').exec(raw);
      if (m && m[0] !== '') return { value: m[0], line };
    } catch {
      // Regex validity is checked by config.mjs; ignore here and fall through.
    }
  }
  // An H1 declares only through an idPattern match; the whole-value fallback is for frontmatter `id`.
  return fromFrontmatter ? { value: raw, line } : { value: null, line: null };
}

// ---------------------------------------------------------------------------
// Frontmatter relations (I/O matrix row "Frontmatter relation").
// ---------------------------------------------------------------------------

function isRelationKey(key, relations) {
  return key === 'related' || META_RELATIONS.includes(key) || Boolean(relations && Object.hasOwn(relations, key));
}

function frontmatterRelationFacts(path, frontmatterData, relations, text, bodyStartLine) {
  const facts = [];
  if (!frontmatterData) return facts;
  for (const [key, rawValue] of Object.entries(frontmatterData)) {
    if (!isRelationKey(key, relations)) continue;
    if (rawValue === null || rawValue === undefined) continue;
    const items = Array.isArray(rawValue) ? rawValue : [rawValue];
    const keyLine = findFrontmatterKeyLine(text, bodyStartLine, key);
    for (const item of items) {
      if (typeof item !== 'string' || item.length === 0) continue;
      const line = findFrontmatterValueLine(text, bodyStartLine, keyLine, item) ?? keyLine ?? 1;
      facts.push(makeFact({
        kind: 'edge',
        subject: `doc:${path}`,
        relation: key,
        object: item,
        ref: item,
        evidence: { line, quote: item },
        provenance: 'extracted',
      }));
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Links (I/O matrix row "Links").
// ---------------------------------------------------------------------------

function linkFacts(path, links) {
  return links.map((link) => makeFact({
    kind: 'edge',
    subject: `doc:${path}`,
    relation: 'link',
    object: link.target,
    ref: link.target,
    evidence: { line: link.line, quote: link.quote },
    provenance: 'extracted',
  }));
}

// ---------------------------------------------------------------------------
// Body ID mentions and concept mentions (I/O matrix rows "Body ID mention",
// "Concept mention"). Both scan only `lines` from `scanBody` -- fenced code,
// HTML comments, and `<!-- lumina:project -->` blocks are already gone;
// inline code stays. Both normalize each line to NFC before matching (a
// decomposed body form must still match a precomposed pattern/term).
// ---------------------------------------------------------------------------

function idMentionFacts(path, lines, idMatchers) {
  const facts = [];
  for (const { line, text } of lines) {
    const normalizedLine = text.normalize('NFC');
    for (const re of idMatchers) {
      for (const { match } of runCompiled(re, normalizedLine)) {
        if (match === '') continue;
        facts.push(makeFact({
          kind: 'edge',
          subject: `doc:${path}`,
          relation: 'mentions',
          object: match,
          ref: match,
          evidence: { line, quote: match },
          provenance: 'extracted',
        }));
      }
    }
  }
  return facts;
}

function conceptMentionFacts(path, lines, concepts) {
  const facts = [];
  for (const { conceptSlug, matchers } of concepts) {
    for (const { line, text } of lines) {
      const normalizedLine = text.normalize('NFC');
      for (const re of matchers) {
        for (const { match } of runCompiled(re, normalizedLine)) {
          if (match === '') continue;
          facts.push(makeFact({
            kind: 'edge',
            subject: `doc:${path}`,
            relation: 'mentions',
            object: `concept:${conceptSlug}`,
            ref: match,
            evidence: { line, quote: match },
            provenance: 'extracted',
          }));
        }
      }
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Status (I/O matrix rows "Status", "Heading source").
// ---------------------------------------------------------------------------

const LIST_MARKER_RE = /^(?:[-*+>]|\d+[.)])\s+/;

function findHeadingSection(headings, name) {
  const target = name.trim().toLowerCase();
  const idx = headings.findIndex((h) => renderedText(h.text).trim().toLowerCase() === target);
  if (idx === -1) return null;
  const heading = headings[idx];
  let endLine = Infinity;
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) {
      endLine = headings[i].line;
      break;
    }
  }
  return { startLine: heading.line, endLine };
}

/**
 * The first non-empty content line of a heading section: skips the section's
 * own subheadings (a deeper heading is section content per `findHeadingSection`,
 * but not itself a status value) and strips a leading list/blockquote/
 * ordered-list marker before checking for emptiness, so `- Accepted`,
 * `> Accepted`, and `1. Accepted` all yield `Accepted`, and a marker-only or
 * heading-only line is skipped rather than returned as `''`/`###...`.
 */
function firstNonEmptyLineInSection(lines, headings, startLine, endLine) {
  const headingLines = new Set(headings.map((h) => h.line));
  for (const { line, text } of lines) {
    if (line <= startLine) continue;
    if (line >= endLine) break;
    if (headingLines.has(line)) continue;
    const rendered = renderedText(text).replace(LIST_MARKER_RE, '').trim();
    if (rendered !== '') return rendered;
  }
  return null;
}

function findInlineStatusLine(lines, name) {
  const re = new RegExp(`^${escapeRegex(name.trim())}\\s*:\\s*(.*)$`, 'i');
  for (const { line, text } of lines) {
    const m = re.exec(renderedText(text).trim());
    if (m && m[1].trim() !== '') return { text: m[1].trim(), line };
  }
  return null;
}

/** @returns {{text: string, line: number}|null} */
function extractStatusSource(source, doc) {
  if (Object.hasOwn(source, 'frontmatter')) {
    const raw = doc.frontmatterData?.[source.frontmatter];
    if (raw === undefined || raw === null) return null;
    const text = renderedText(String(raw)).trim();
    if (text === '') return null;
    const line = findFrontmatterKeyLine(doc.text, doc.bodyStartLine, source.frontmatter) ?? 1;
    return { text, line };
  }
  const name = source.heading;
  const section = findHeadingSection(doc.headings, name);
  if (section) {
    const text = firstNonEmptyLineInSection(doc.lines, doc.headings, section.startLine, section.endLine);
    if (text !== null) return { text, line: section.startLine };
  }
  return findInlineStatusLine(doc.lines, name);
}

/** A prefix match requires a boundary after the key: not a letter, number, underscore, or hyphen (so `accepted` doesn't match `accepted-with-changes`). */
function resolveStatusValue(rawText, map) {
  const normalizedText = rawText.normalize('NFC');
  const lowerText = normalizedText.toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const key of Object.keys(map ?? {})) {
    const normalizedKey = key.normalize('NFC').toLowerCase();
    if (!lowerText.startsWith(normalizedKey)) continue;
    const next = lowerText[normalizedKey.length];
    if (next !== undefined && /[\p{L}\p{N}_-]/u.test(next)) continue;
    if (normalizedKey.length > bestLen) {
      best = key;
      bestLen = normalizedKey.length;
    }
  }
  if (best !== null) return map[best];
  const firstWord = normalizedText.trim().split(/\s+/)[0] ?? '';
  return firstWord.toLowerCase().replace(/[.,;:-]+$/, '');
}

/** @returns {{value: string|null, line: number|null, findings: object[]}} findings have no `file` yet. */
function computeStatus(statusConfig, doc) {
  if (!statusConfig) return { value: null, line: null, findings: [] };
  const resolved = [];
  for (const source of statusConfig.sources) {
    const extracted = extractStatusSource(source, doc);
    if (extracted !== null) {
      resolved.push({ value: resolveStatusValue(extracted.text, statusConfig.map), line: extracted.line });
    }
  }
  const value = resolved.length > 0 ? resolved[0].value : null;
  const line = resolved.length > 0 ? resolved[0].line : null;
  const findings = [];
  if (resolved.length > 1 && new Set(resolved.map((r) => r.value)).size > 1) {
    const rule = ruleFor('P19');
    findings.push({
      id: rule.id,
      severity: rule.severity,
      line: line ?? 1,
      message: `status sources disagree: ${resolved.map((r) => r.value).join(', ')}`,
    });
  }
  return { value, line, findings };
}

// ---------------------------------------------------------------------------
// parseDoc / parseAll
// ---------------------------------------------------------------------------

/**
 * Parse one document. Pure -- no I/O.
 * @param {string} path repo-relative path (forward slashes).
 * @param {string} text raw file content, decoded (`utf8`, may carry a BOM).
 * @param {object} config validated `project.yaml` (`lib/config.mjs#loadConfig`).
 * @param {string} [hash] precomputed `contentHash` (over the raw bytes); computed
 *   from `text` when omitted, for direct/standalone callers.
 * @returns {object} see the Design Notes "Parse-to-graph contract" in
 *   `docs/specs/spec-project-docs-overlay/stories/2-deterministic-parse-and-buildgraph.md`.
 */
export function parseDoc(path, text, config, hash) {
  const docHash = hash ?? contentHash(Buffer.from(text, 'utf8'));
  const { data: rawFrontmatterData, error: frontmatterError, body, bodyStartLine } = splitFrontmatter(text);
  const { headings, links, lines } = scanBody(body, bodyStartLine);
  const cache = getPatternCache(config);

  const findings = [];

  if (frontmatterError) {
    const rule = ruleFor('P17');
    findings.push({
      id: rule.id,
      severity: rule.severity,
      file: path,
      line: 1,
      message: `frontmatter does not parse: ${frontmatterError}`,
    });
  }
  // "Bad frontmatter ... doc parsed without frontmatter": on error, treat the
  // doc as if it never had a frontmatter block at all.
  const frontmatterData = frontmatterError ? null : rawFrontmatterData;

  const frontmatterType = typeof frontmatterData?.type === 'string' && frontmatterData.type.length > 0
    ? frontmatterData.type
    : null;

  const { type, metaType, entry } = resolveType(config.types, path, frontmatterData, cache);

  if (type === null && frontmatterType !== null) {
    const rule = ruleFor('P12');
    const keyLine = findFrontmatterKeyLine(text, bodyStartLine, 'type');
    const line = findFrontmatterValueLine(text, bodyStartLine, keyLine, frontmatterType) ?? keyLine ?? 1;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      file: path,
      line,
      message: `unmapped doc type: ${frontmatterType}`,
    });
  }

  const declaredId = resolveDeclaredId(frontmatterData, headings, entry?.idPattern, text, bodyStartLine);
  const declares = declaredId.value;
  const declaresLine = declaredId.line;
  const includeRoot = resolveIncludeRoot(config.sources.include, path);

  const facts = [
    ...frontmatterRelationFacts(path, frontmatterData, config.relations, text, bodyStartLine),
    ...linkFacts(path, links),
    ...idMentionFacts(path, lines, cache.idMatchers),
    ...conceptMentionFacts(path, lines, cache.concepts),
  ];

  const statusResult = computeStatus(entry?.status, { frontmatterData, headings, lines, text, bodyStartLine });
  for (const f of statusResult.findings) findings.push({ ...f, file: path });

  if (metaType === 'Decision' && statusResult.value !== null
    && !META_TYPES.Decision.lifecycle.includes(statusResult.value)) {
    const rule = ruleFor('P20');
    findings.push({
      id: rule.id,
      severity: rule.severity,
      file: path,
      line: statusResult.line ?? 1,
      message: `Decision status "${statusResult.value}" is outside its lifecycle`,
    });
  }

  return {
    path,
    hash: docHash,
    includeRoot,
    frontmatterType,
    type,
    metaType,
    declares,
    declaresLine,
    status: statusResult.value,
    headings,
    facts,
    findings,
  };
}

/**
 * Parse every in-scope document under `root`.
 * @param {string} root absolute repo root.
 * @param {object} config validated `project.yaml`.
 * @returns {Promise<{docs: object[], texts: Map<string, string>, warnings: object[]}>}
 *   `docs` sorted by `path`. `texts` maps each doc's `path` to its decoded
 *   source (not part of any JSON output -- callers such as `status` reuse it
 *   instead of re-reading files). `warnings` is `selectScope`'s own
 *   (P16, "include pattern matches no files") -- passed through unchanged so
 *   `lint` can fold them in.
 */
export async function parseAll(root, config) {
  const { files, warnings } = await selectScope(root, config.sources);
  const docs = [];
  const texts = new Map();
  for (const file of files) {
    const buf = await readFile(join(root, file));
    const hash = contentHash(buf);
    const text = buf.toString('utf8');
    texts.set(file, text);
    docs.push(parseDoc(file, text, config, hash));
  }
  docs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { docs, texts, warnings };
}
