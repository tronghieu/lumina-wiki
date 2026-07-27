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
import {
  EXTERNAL_ID_NAMESPACES,
  normalizeExternalId,
  parseUrlToExternalIds,
} from './external-ids.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_MARKER_OPEN = '<!-- lumina:index -->';
const INDEX_MARKER_CLOSE = '<!-- /lumina:index -->';

// Entity dirs whose pages are not required in wiki/index.md (L09): reflections
// are a personal overlay; readings are subsidiary notes reached from their
// source page via annotated_by edges (a long book can produce dozens).
const INDEX_EXEMPT_PREFIXES = ['reflections/', 'readings/'];
const isIndexExempt = (f) => INDEX_EXEMPT_PREFIXES.some(p => f.startsWith(p));

/** All check IDs in run order.
 *  L15 is intentionally absent — collision check was deferred as premature
 *  for typical wiki size. Adding L15 later is the natural next slot. */
const ALL_CHECK_IDS = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12', 'L13', 'L14', 'L16', 'L17'];

/**
 * Legacy frontmatter fields that have been renamed across versions.
 * Detected by L02 as warnings so upgrade banners surface them and
 * users know to run /lumi-migrate-legacy. Severity is warning (not
 * error) to keep upgrades non-breaking — the legacy field is ignored,
 * not invalid.
 *
 * `--fix` MAY now delete the old key (see `isLegacyTargetValid` /
 * `isLegacyValueEquivalent`, consulted by both checkL02 — to decide the
 * finding's `fixable` flag — and fixL02's removal pass), but only when
 * ALL of these hold:
 *   1. the new key is present, and
 *   2. the new key's value is schema-valid for its declared type, and
 *   3. the old value carries no information the new value lacks (a
 *      conservative equivalence check documented on
 *      `isLegacyValueEquivalent`).
 * If the new key is absent, `--fix` never removes the old key — the old
 * value is the only copy of the data and fixL01's own derivation is what's
 * supposed to populate the new key first. If the two values genuinely
 * disagree, `--fix` never removes the old key either — that is a real
 * conflict for a human to resolve, not something automatic repair should
 * paper over. Either way the warning is left standing (`fixable: false`)
 * so it keeps surfacing until a person looks at it.
 *
 *   { entityType: { oldKey: { newKey, since } } }
 *
 * `_all` applies to every entity type — `slug`/`date_added` are the
 * pre-v0.1 field names used across every page template (see
 * page-templates.md), not just sources.
 */
const LEGACY_RENAMED_FIELDS = {
  _all: {
    slug: { newKey: 'id', since: 'v0.1' },
    date_added: { newKey: 'created', since: 'v0.1' },
  },
  sources: {
    url: { newKey: 'urls', since: 'v0.8' },
  },
};

/**
 * Defaults for enum fields that have a known-safe fallback value.
 * Mirrors `LEGACY_DEFAULTS` in wiki.mjs (see wiki.mjs's `migrateLegacyDefaults`
 * for the canonical original) — duplicated here, not imported, so lint.mjs
 * stays decoupled from wiki.mjs. Keep the two in sync by hand if either
 * changes.
 */
const LINT_LEGACY_DEFAULTS = {
  sources: { provenance: 'missing', confidence: 'unverified' },
  concepts: { confidence: 'unverified' },
};

/**
 * Entity dirs whose `id` is the FULL wiki-relative path (dir included),
 * not the bare basename — these dirs nest pages under a parent slug
 * (e.g. readings/<source-slug>/<unit-slug>) so the basename alone is
 * ambiguous across parents.
 */
const NESTED_ID_ENTITY_DIRS = new Set(['readings', 'chapters', 'characters', 'themes', 'plot']);

/**
 * Declared string-type frontmatter keys that `fixL01`/`fixL02` can actually
 * derive a real value for (see `deriveIdFromPath`/`deriveTypeFromPath`/
 * `deriveTitleFromContent`). Shared by:
 *   - `isL01Fixable` — deciding whether a MISSING string field is fixable.
 *   - `checkL02`'s `TODO` sentinel branch — deciding whether a string field
 *     PRESENT with the literal placeholder value is fixable (Task 2).
 *   - `fixL02`'s own repair of that same sentinel.
 * Any other string key (`source` on readings, `book` on chapters/characters/
 * themes/plot) has no derivation rule in either direction and is always left
 * for a human — same "no safe default" treatment as a `number` field.
 */
const DERIVABLE_STRING_KEYS = new Set(['id', 'type', 'title']);

/** Singular `type:` label per entity dir, used to derive a missing `type` field. */
const ENTITY_TYPE_LABEL = {
  sources: 'source',
  concepts: 'concept',
  people: 'person',
  summary: 'summary',
  outputs: 'output',
  readings: 'reading',
  foundations: 'foundation',
  topics: 'topic',
  chapters: 'chapter',
  characters: 'character',
  themes: 'theme',
  plot: 'plot',
  reflections: 'reflection',
};

/** Kebab-case pattern: lowercase letters, digits, hyphens; no leading/trailing hyphen. */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ISO date pattern YYYY-MM-DD. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Wikilink pattern [[slug]] or [[slug|alias]]. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// ─────────────────────────────────────────────────────────────────────────────
// FRONTMATTER-VALUE DERIVATION
// Pure helpers shared by fixL01 and fixL02 for deriving a safe, type-correct
// value for a missing/broken required field. Every function here either
// returns a value that is guaranteed to satisfy checkL02 for its declared
// type, or signals "not derivable" so the caller leaves the field untouched.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the `id` value for a page missing it.
 * Legacy `slug:` (pre-v0.1 template field) wins if present and non-empty;
 * otherwise derived from the file's own wiki-relative path per entity-type
 * convention (see NESTED_ID_ENTITY_DIRS / ENTITY_TYPE_LABEL above).
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {string}
 */
function deriveIdFromPath(wikiRelPath, fm) {
  const noExt = wikiRelPath.replace(/\.md$/, '');
  const dir = noExt.split('/')[0];
  if (dir === 'reflections') {
    return `reflection-${basename(noExt)}`;
  }
  if (NESTED_ID_ENTITY_DIRS.has(dir)) {
    return noExt; // full wiki-relative path, e.g. readings/deep-work/01-focus
  }
  // Legacy `slug` is consulted only for FLAT entity dirs, where the id is the
  // bare basename and `slug` can express it exactly. In a nested dir the id
  // carries a parent qualifier a bare `slug` cannot represent, so trusting it
  // there would write an ambiguous id (`01-focus` instead of
  // `readings/deep-work/01-focus`) — and the legacy-removal pass would then see
  // the two as equal and delete `slug`, losing the parent for good. The path is
  // always authoritative and always available, so it wins in those dirs.
  if (fm && typeof fm.slug === 'string' && fm.slug.trim() !== '') {
    return fm.slug.trim();
  }
  return basename(noExt);
}

/**
 * Derive the `type` value from the entity directory a file lives in.
 * @param {string} wikiRelPath
 * @returns {string}
 */
function deriveTypeFromPath(wikiRelPath) {
  const dir = wikiRelPath.split('/')[0];
  return ENTITY_TYPE_LABEL[dir] || dir;
}

/**
 * Derive the `title` value: first `# ` H1 heading in the body if present,
 * else the basename de-kebabed to Title Case.
 * @param {string} wikiRelPath
 * @param {string} body  Markdown body (content after the frontmatter block).
 * @returns {string}
 */
function deriveTitleFromContent(wikiRelPath, body) {
  // Scan line by line rather than with a multiline regex: `\s` matches a
  // newline, so `/^#\s+(.+)$/m` treats a bare `#` as a heading whose text is
  // the next paragraph. Fenced blocks are skipped because a shell comment
  // (`# install deps`) is not this page's title.
  const lines = (body || '').split('\n');
  const inFence = fencedCodeLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(/^#[^\S\n]+(\S.*)$/);
    if (m) return m[1].trim();
  }
  const base = basename(wikiRelPath.replace(/\.md$/, ''));
  return base
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Format a Date as YYYY-MM-DD (local time — matches ISO_DATE_RE, no
 * timezone conversion so it lines up with the file's own mtime).
 * @param {Date} d
 * @returns {string}
 */
function formatDateYmd(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Derive an iso-date value (`created`/`updated`) for a page: legacy
 * `date_added:` (pre-v0.1 template field) if present and a valid
 * YYYY-MM-DD string; otherwise the file's own mtime. Never shells out to
 * git — lint.mjs stays dependency-free and must work in non-git wikis.
 * @param {Record<string,unknown>} fm
 * @param {string} absPath
 * @returns {Promise<string>}
 */
async function deriveIsoDateValue(fm, absPath) {
  if (fm && typeof fm.date_added === 'string' && ISO_DATE_RE.test(fm.date_added)) {
    return fm.date_added;
  }
  try {
    const st = await stat(absPath);
    return formatDateYmd(st.mtime);
  } catch {
    return formatDateYmd(new Date());
  }
}

/**
 * Quote a scalar string for frontmatter output only when required —
 * mirrors wiki.mjs's `quoteIfNeeded` (not imported; see LINT_LEGACY_DEFAULTS
 * comment for why the modules stay decoupled). Only used for top-level
 * scalar lines; block-list items are never quoted because lint.mjs's own
 * `parseFrontmatter` does not strip quotes from list items (see its
 * `listM` branch), so a quoted list item would round-trip as a literal
 * quoted string instead of the bare value.
 * @param {string} val
 * @returns {string}
 */
function quoteIfNeededLint(val) {
  if (typeof val !== 'string') return String(val);
  const special = ['true', 'false', 'null', '~'];
  if (special.includes(val.toLowerCase())) return `"${val}"`;
  if (val.trim() !== '' && !isNaN(Number(val))) return `"${val}"`;
  if (val === '' || val.includes(':') || val.includes('#') || val.startsWith('*') || val.includes('\n')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

/**
 * Render a single `key: value` frontmatter line (or multi-line block for
 * arrays/objects) for a derived value. Only ever called with values this
 * module derived itself (empty array/object, a wrapped/reconstructed array,
 * or a plain scalar string) — never with a `number`, so no numeric branch
 * is needed here.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
function renderYamlLine(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n` + value.map(v => `  - ${typeof v === 'string' ? v : String(v)}`).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const subKeys = Object.keys(value);
    if (subKeys.length === 0) return `${key}: {}`;
    return `${key}:\n` + subKeys.map(k => `  ${k}: ${value[k]}`).join('\n');
  }
  if (typeof value === 'string') return `${key}: ${quoteIfNeededLint(value)}`;
  return `${key}: ${value}`;
}

/**
 * Whether a derived value survives being written and read back unchanged.
 *
 * lint.mjs's own frontmatter parser is deliberately minimal: it reads
 * `[a, b]` as a list, `{}` as a mapping, coerces bare numerics, and strips one
 * leading and one trailing quote character. Several perfectly ordinary strings
 * therefore have no representation it reads back intact — a title beginning
 * with `[`, or one containing a double quote. Writing such a value anyway
 * either corrupts it silently (`"Attention" Revisited` comes back as
 * `Attention" Revisited`, passing every check) or manufactures a type error no
 * fixer can ever clear (`title: [Draft]` re-reads as a list, so L02 reports a
 * permanent "must be a string"). Both outcomes are worse than leaving the field
 * alone, so every derived value is checked here before it is written.
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
function roundTripsAsFrontmatter(key, value) {
  const parsed = parseFrontmatter(`---\n${renderYamlLine(key, value)}\n---\n`);
  if (!parsed) return false;
  const got = parsed.data[key];
  if (Array.isArray(value)) {
    return Array.isArray(got)
      && got.length === value.length
      && got.every((v, i) => String(v) === String(value[i]));
  }
  if (value !== null && typeof value === 'object') {
    return got !== null && typeof got === 'object' && !Array.isArray(got);
  }
  return got === value;
}

/**
 * Split raw file content into the frontmatter text (no `---` delimiters)
 * and the tail (starting with the newline before the closing `---`,
 * through end of file). Returns null when there is no parseable
 * frontmatter block. Shared by fixL01 and fixL02 so both fixers rewrite
 * the frontmatter block the same way.
 * @param {string} content
 * @returns {{ fmText: string, tail: string }|null}
 */
function splitRawFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const rest = content.slice(3);
  const nlIdx = rest.indexOf('\n');
  if (nlIdx === -1) return null;
  // Mirror parseFrontmatter's rule for where the block starts, exactly. It
  // treats a non-empty first line as part of the frontmatter when it is a YAML
  // key line, and rejects the block outright otherwise. Diverging here makes
  // the two disagree about which keys exist: unconditionally skipping the first
  // line drops `---id: x` on rewrite, and accepting a block parseFrontmatter
  // rejects leaves fixL01 with an empty view of the frontmatter, so it appends
  // a second copy of every key that was already there.
  const afterDash = rest.slice(0, nlIdx).trim();
  if (afterDash !== '' && !/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(afterDash)) return null;
  const bodyStart = rest.indexOf('\n---');
  if (bodyStart === -1) return null;
  const fmText = afterDash !== ''
    ? rest.slice(0, bodyStart)
    : rest.slice(nlIdx + 1, bodyStart);
  const tail = rest.slice(bodyStart); // "\n---\n<body>"
  return { fmText, tail };
}

/**
 * Replace the line(s) for an existing top-level frontmatter key (the key's
 * own line plus any indented continuation lines it owns — a block list or
 * block mapping) with new rendered line(s). Used by fixL02 to repair a
 * key's value in place without disturbing any other key.
 * @param {string} fmText
 * @param {string} key
 * @param {string} newLines
 * @returns {string}
 */
function replaceFrontmatterKeyLines(fmText, key, newLines) {
  const lines = fmText.split('\n');
  const out = [];
  let i = 0;
  let replaced = false;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (m && m[1] === key) {
      i++;
      while (i < lines.length && /^[ \t]+\S/.test(lines[i])) i++;
      out.push(...newLines.split('\n'));
      replaced = true;
      continue;
    }
    out.push(line);
    i++;
  }
  if (!replaced) out.push(...newLines.split('\n'));
  return out.join('\n');
}

/**
 * Delete an existing top-level frontmatter key's line(s) — its own line plus
 * any indented continuation it owns (a block list or block mapping) —
 * entirely, leaving no blank line behind. This is the one place in
 * lint.mjs's frontmatter editing that removes a key rather than inserting
 * or replacing one; used by fixL02's legacy-field removal (see
 * `isLegacyValueEquivalent` for the safety rule that gates every call).
 * @param {string} fmText
 * @param {string} key
 * @returns {string}
 */
function removeFrontmatterKeyLines(fmText, key) {
  const lines = fmText.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (m && m[1] === key) {
      i++;
      while (i < lines.length && /^[ \t]+\S/.test(lines[i])) i++;
      continue; // drop the key's own line + any indented continuation.
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

/**
 * Whether a legacy-renamed field's REPLACEMENT (`newKey`) value is
 * schema-valid for its declared type — mirrors checkL02's own per-type
 * switch exactly, but restricted to the three types any
 * `LEGACY_RENAMED_FIELDS` target currently declares (`string`, `iso-date`,
 * `array`). This is condition (2) of the legacy-removal safety rule: a
 * present-but-invalid target (e.g. `created` still holding a non-ISO
 * string) must never trigger deletion of the old key, since the old key
 * may be the only recoverable value. Not a general-purpose type validator —
 * do not extend for types outside what `LEGACY_RENAMED_FIELDS` produces
 * without re-reading this comment.
 * @param {string} fieldType
 * @param {unknown} val
 * @returns {boolean}
 */
function isLegacyTargetValid(fieldType, val) {
  // The TODO sentinel (Task 2) is never a valid value for ANY declared
  // field, of any type — a target still holding the placeholder must be
  // treated exactly like "target absent": the legacy key is the only real
  // copy of the data and must not be removed. `ISO_DATE_RE`/`Array.isArray`
  // already reject the literal "TODO" for their branches; this guard only
  // changes outcome for the 'string' branch below, which would otherwise
  // treat "TODO" as "any string" and call it valid.
  if (typeof val === 'string' && val.trim() === 'TODO') return false;
  switch (fieldType) {
    case 'string': return typeof val === 'string';
    case 'iso-date': return typeof val === 'string' && ISO_DATE_RE.test(val);
    case 'array': return Array.isArray(val);
    default: return false; // no current LEGACY_RENAMED_FIELDS target declares any other type.
  }
}

/**
 * Whether a legacy field's value carries no information its already-valid
 * replacement lacks — condition (3) of the legacy-removal safety rule
 * (`--fix` may only delete a legacy key when this AND `isLegacyTargetValid`
 * both hold). Deliberately conservative: a false negative just leaves the
 * warning standing for a human to look at; a false positive would delete
 * data, so every branch requires an exact (trimmed) match rather than any
 * kind of fuzzy/normalized comparison.
 *
 * Three shapes, one per type `LEGACY_RENAMED_FIELDS` currently targets:
 *   - `string`   (`slug` -> `id`):          trimmed string equality, OR
 *     prefix-qualified equality — see the "Task 1" note inside the
 *     `string` branch below.
 *   - `iso-date` (`date_added` -> `created`): trimmed string equality — by
 *     the time this runs the target is already known ISO-valid
 *     (`isLegacyTargetValid` gates it), so this only needs to rule out the
 *     legacy value naming a DIFFERENT date, not re-validate either side.
 *   - `array`    (`url` -> `urls`, string -> array): the array must
 *     already contain the legacy string verbatim (trimmed) — the
 *     replacement is allowed to hold MORE than the legacy value (other
 *     URLs added since), just never LESS. This is why `url` -> `urls` is
 *     handled explicitly here instead of being excluded: "equivalent"
 *     for a singular-to-plural rename means "already represented", not
 *     "identical shape".
 * Any other combination returns false — nothing in `LEGACY_RENAMED_FIELDS`
 * exercises a fourth shape today, and a future entry that adds one should
 * fail closed (warning survives, nothing deleted) until this function is
 * taught the new shape on purpose.
 * @param {string} targetFieldType
 * @param {unknown} legacyVal
 * @param {unknown} targetVal
 * @returns {boolean}
 */
function isLegacyValueEquivalent(targetFieldType, legacyVal, targetVal) {
  // An empty legacy value (`slug:` with nothing after it) holds no information
  // at all, so once the replacement is present and valid — the caller has
  // already checked both — there is nothing that removing it could lose. This
  // case has to be handled explicitly because every branch below demands a
  // string on both sides and would otherwise report a permanent conflict,
  // pinning the exit code at 1 with no action available to the user beyond
  // deleting the line by hand.
  if (legacyVal === null || legacyVal === undefined
    || (typeof legacyVal === 'string' && legacyVal.trim() === '')) return true;
  if (targetFieldType === 'array') {
    if (typeof legacyVal !== 'string') return false;
    const legacyTrimmed = legacyVal.trim();
    return Array.isArray(targetVal) && targetVal.some(v => typeof v === 'string' && v.trim() === legacyTrimmed);
  }
  if (targetFieldType === 'string') {
    if (typeof legacyVal !== 'string' || typeof targetVal !== 'string') return false;
    const legacyTrimmed = legacyVal.trim();
    const targetTrimmed = targetVal.trim();
    if (legacyTrimmed === targetTrimmed) return true;

    // Task 1 — prefix-aware equivalence for `slug` -> `id` (the only
    // LEGACY_RENAMED_FIELDS target whose type is 'string'). A real 813-file
    // wiki showed 179 pages shaped like `id: concepts/ab-testing` next to
    // `slug: ab-testing` — the strict trimmed-equality check above treats
    // these as disagreeing, even though `id` carries strictly MORE
    // information (the entity-dir qualifier) than `slug`, not less.
    //
    // LOSSLESSNESS ARGUMENT: this branch only returns true when
    // `targetTrimmed === "<dirPrefix>/" + legacyTrimmed` for some
    // `dirPrefix`. That means legacyTrimmed is, by construction, an exact
    // trailing substring of targetTrimmed — every character the legacy
    // value carries is still present, verbatim, inside the target value,
    // recoverable by splitting the target on its first "/". Deleting the
    // legacy key therefore discards no information; it deletes a redundant
    // (shorter) copy of data the target already contains in full.
    //
    // Guarded to a REAL entity directory (`ENTITY_DIRS`, imported from
    // schemas.mjs) rather than "any string containing a slash" — this is
    // what keeps a genuine mismatch surviving instead of being silently
    // equated: an arXiv id (`id: "1706.03762"`, no slash at all) never
    // matches, and an arbitrary `foo/ab-testing` where "foo" is not a known
    // entity dir is rejected too, since that slash could mean something
    // else entirely and isn't a shape Lumina itself is known to produce.
    const slashIdx = targetTrimmed.indexOf('/');
    if (slashIdx > 0) {
      const dirPrefix = targetTrimmed.slice(0, slashIdx);
      const rest = targetTrimmed.slice(slashIdx + 1);
      if (rest === legacyTrimmed && Object.prototype.hasOwnProperty.call(ENTITY_DIRS, dirPrefix)) {
        return true;
      }
    }
    return false;
  }
  if (targetFieldType === 'iso-date') {
    if (typeof legacyVal !== 'string' || typeof targetVal !== 'string') return false;
    return legacyVal.trim() === targetVal.trim();
  }
  return false;
}

/**
 * Reconstruct an array-typed field's value from wiki/graph/edges.jsonl.
 * Endpoint format matches wiki.mjs's own writers and the repo's valid test
 * fixtures: `<entity-dir>/<slug>` — no `.md` suffix (e.g. `sources/attn`,
 * `concepts/softmax`). Returns wikilink strings (`[[<slug>]]`) matching the
 * convention used for these fields elsewhere. Returns [] for any
 * entity-type/field combination with no known graph mapping — this
 * includes `reflections.related_concepts`/`related_sources`, which are
 * intentionally frontmatter-only (no edges are ever written for them).
 * @param {string} entityType
 * @param {string} field
 * @param {string} selfSlug  wiki-relative path without `.md`.
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @returns {string[]}
 */
function reconstructArrayFromGraph(entityType, field, selfSlug, edges, knownSlugs) {
  const results = new Set();
  const add = (slug) => {
    // The graph can outlive the pages it describes: an edge whose target was
    // deleted, or a self-referential edge, is still sitting in edges.jsonl.
    // Writing either into frontmatter turns stale graph state into a fresh
    // page-level defect — a self-link, or a broken wikilink that only shows up
    // as an L05 error on the NEXT run, after this one reported success.
    if (slug === selfSlug) return;
    // An absent OR empty set carries no membership information, so it disables
    // the existence filter rather than rejecting everything — the same
    // convention fixL02 already documents for its tier-2 knownSlugs argument.
    // A real run always passes the full set, so the filter is live where it
    // matters and inert only where the caller supplied nothing to check against.
    if (knownSlugs && knownSlugs.size > 0 && !knownSlugs.has(slug)) return;
    results.add(`[[${slug}]]`);
  };

  if (entityType === 'concepts' && field === 'key_sources') {
    const outboundTypes = ['introduced_in', 'used_in', 'extended_in', 'critiqued_in'];
    const inboundTypes = ['introduces_concept', 'uses_concept', 'extends_concept', 'critiques_concept'];
    for (const e of edges) {
      if (e.from === selfSlug && outboundTypes.includes(e.type)) add(e.to);
      if (e.to === selfSlug && inboundTypes.includes(e.type)) add(e.from);
    }
  } else if (entityType === 'concepts' && field === 'related_concepts') {
    for (const e of edges) {
      if (e.type !== 'related_to') continue;
      if (e.from === selfSlug) add(e.to);
      else if (e.to === selfSlug) add(e.from);
    }
  } else if (entityType === 'people' && field === 'key_sources') {
    for (const e of edges) {
      if (e.from === selfSlug && e.type === 'authored') add(e.to);
      if (e.to === selfSlug && e.type === 'authored_by') add(e.from);
    }
  } else if (entityType === 'topics' && field === 'key_sources') {
    for (const e of edges) {
      if (e.from === selfSlug && e.type === 'includes_source') add(e.to);
      if (e.to === selfSlug && e.type === 'included_in_topic') add(e.from);
    }
  }
  // Any other entity-type/field combination (including
  // reflections.related_concepts/related_sources) has no graph mapping —
  // falls through to the empty result below.

  return Array.from(results);
}

/**
 * Map of array-typed frontmatter field name -> the entity-dir prefix a
 * resolved BODY wikilink must have to count as that field's kind of
 * relationship. Consulted only by the tier-2 body-wikilink fallback
 * (`reconstructArrayFromBody`) — the tier-1 graph reconstruction
 * (`reconstructArrayFromGraph`) has its own per-entity-type edge mapping
 * and does not consult this table.
 * @type {Record<string,string>}
 */
const ARRAY_FIELD_TARGET_DIR = {
  key_sources: 'sources',
  related_sources: 'sources',
  related_concepts: 'concepts',
};

/**
 * Build a basename -> [full wiki-relative slugs] index from a set of known
 * slugs. Shared by checkL05/fixL05's "missing directory prefix" heuristic
 * and by `reconstructArrayFromBody`'s body-wikilink resolution, so both
 * consult the exact same notion of "resolves uniquely by basename".
 * @param {Set<string>} knownSlugs
 * @returns {Map<string,string[]>}
 */
function buildBasenameIndex(knownSlugs) {
  const index = new Map();
  for (const slug of knownSlugs) {
    const base = basename(slug);
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(slug);
  }
  return index;
}

/**
 * Resolve a raw `[[...]]` wikilink target (alias already stripped by
 * WIKILINK_RE's capture group) to a known wiki-relative slug: exact match
 * first, then — if the raw target isn't itself a known slug — the same
 * unique-basename heuristic fixL05 uses to repair a broken link with a
 * missing directory prefix. Returns null when neither resolves (unknown,
 * or ambiguous across 2+ candidates — no guessing).
 * @param {string} raw
 * @param {Set<string>} knownSlugs
 * @param {Map<string,string[]>} basenameIndex
 * @returns {string|null}
 */
function resolveWikilinkTarget(raw, knownSlugs, basenameIndex) {
  let slug = raw.trim();
  if (slug.endsWith('.md')) slug = slug.slice(0, -3);
  if (knownSlugs.has(slug)) return slug;
  const candidates = basenameIndex.get(basename(slug)) || [];
  if (candidates.length === 1) return candidates[0];
  return null;
}

/**
 * Mark which lines fall inside a fenced code block (``` or ~~~), fence lines
 * themselves included. A `[[...]]` inside a fence is sample text — Lumina's
 * own page templates and user-written docs show wikilink syntax that way — so
 * it is neither a real link (checkL05 must not report it broken) nor a real
 * relationship (reconstructArrayFromBody must not harvest it into frontmatter).
 * A closing fence must use the same character as the opener and be at least as
 * long, per CommonMark; an unterminated fence swallows the rest of the file,
 * which is also what a Markdown renderer does.
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function fencedCodeLines(lines) {
  const inFence = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (open === null) {
      if (m) { open = m[1]; inFence[i] = true; }
    } else {
      inFence[i] = true;
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
    }
  }
  return inFence;
}

/**
 * Tier-2 fallback for reconstructing an array-typed field: scan the page
 * BODY for `[[wikilinks]]` and keep only the ones that resolve — via exact
 * match or unique-basename match, see `resolveWikilinkTarget` — to a page
 * of the entity type the field expects (`ARRAY_FIELD_TARGET_DIR`). This
 * tier is deliberately order-independent of L05: a bare basename like
 * `[[tool-using-agents]]` resolves the same way whether or not its missing
 * directory prefix has already been rewritten on disk, so it does not
 * matter whether fixL05 has run yet.
 *
 * Excludes a self-link and de-duplicates. Returns [] when `field` has no
 * entry in `ARRAY_FIELD_TARGET_DIR`, or when the body is empty/absent.
 * Callers are responsible for excluding `reflections` (frontmatter-only by
 * design — see `repairArrayValue`).
 * @param {string} field
 * @param {string} selfSlug   wiki-relative path without `.md`.
 * @param {string} body       Markdown body (content after frontmatter).
 * @param {Set<string>} knownSlugs
 * @returns {string[]}
 */
function reconstructArrayFromBody(field, selfSlug, body, knownSlugs) {
  const targetDir = ARRAY_FIELD_TARGET_DIR[field];
  if (!targetDir || !body) return [];

  const basenameIndex = buildBasenameIndex(knownSlugs);
  const results = new Set();
  const lines = body.split('\n');
  const inFence = fencedCodeLines(lines);
  for (let li = 0; li < lines.length; li++) {
    if (inFence[li]) continue; // sample syntax in a code block is not a relationship.
    const re = new RegExp(WIKILINK_RE.source, 'g');
    let m;
    while ((m = re.exec(lines[li])) !== null) {
      const resolved = resolveWikilinkTarget(m[1], knownSlugs, basenameIndex);
      if (!resolved || resolved === selfSlug) continue;
      if (!resolved.startsWith(`${targetDir}/`)) continue;
      results.add(`[[${resolved}]]`);
    }
  }
  return Array.from(results);
}

/**
 * Repair an array-typed field's value. A non-empty, non-"TODO" string is
 * real content that just needs wrapping (lossless). Anything else — the
 * `TODO` sentinel written by the pre-fix version of fixL01, an empty
 * string, or a stray non-string scalar — has no recoverable content
 * in-place, so we attempt a two-tier reconstruction:
 *   1. Graph edges (`reconstructArrayFromGraph`) — the architectural
 *      source of truth; wins whenever it finds anything.
 *   2. Body wikilinks (`reconstructArrayFromBody`) — only consulted when
 *      tier 1 is empty; skipped entirely for `reflections`, which are
 *      frontmatter-only by design (no wikilinks, no edges, ever).
 *   3. `[]` — when both tiers are empty.
 * @param {string} entityType
 * @param {string} key
 * @param {string} wikiRelPath
 * @param {unknown} val
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {string} [body]           Markdown body; only read by tier 2.
 * @param {Set<string>} [knownSlugs] Only read by tier 2.
 * @returns {string[]}
 */
function repairArrayValue(entityType, key, wikiRelPath, val, edges, body, knownSlugs) {
  if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
    // A mapping sitting in an array-typed field holds structured data this
    // fixer cannot express as list items — renderYamlLine would flatten it to
    // "[object Object]" and the original would be gone. An EMPTY mapping holds
    // nothing, so reconstruction may proceed over it; anything else is left
    // exactly as written and reported unfixable for a human to resolve.
    if (Object.keys(val).length > 0) return null;
  } else if (val !== null && val !== undefined) {
    const isSentinel = typeof val === 'string' && (val.trim() === '' || val.trim() === 'TODO');
    // Any other non-empty scalar is real content and is wrapped losslessly.
    // This covers numbers and booleans, not just strings: `authors: 2024` is a
    // mistyped value, and --fix replacing it with [] would destroy the only
    // copy of it — reconstruction has no mapping for `authors` to recover from.
    if (!isSentinel) return [val];
  }
  const selfSlug = wikiRelPath.replace(/\.md$/, '');
  const fromGraph = reconstructArrayFromGraph(entityType, key, selfSlug, edges, knownSlugs);
  if (fromGraph.length > 0) return fromGraph;
  if (entityType === 'reflections') return []; // frontmatter-only; never graph- or body-backed.
  return reconstructArrayFromBody(key, selfSlug, body || '', knownSlugs || new Set());
}

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
      // Empty scalar value → look ahead for indented block content.
      // Three shapes produced by wiki.mjs stringifyFrontmatter:
      //   key:
      //     - item        (list)
      //   key:
      //     subkey: val   (block mapping — e.g. external_ids)
      //   key:            (no follow-up — actual null)
      i++;
      const listItems = [];
      const mapEntries = {};
      while (i < lines.length) {
        const ln = lines[i];
        const listM = ln.match(/^\s+-\s+(.*)$/);
        if (listM) { listItems.push(listM[1].trim()); i++; continue; }
        const mapM = ln.match(/^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (mapM) {
          // Block-mapping values are kept as strings — external_ids namespaces
          // (arxiv IDs like 1706.03762) round-trip as strings, never numbers.
          const v = mapM[3].trim().replace(/^['"]|['"]$/g, '');
          mapEntries[mapM[2]] = v;
          i++;
          continue;
        }
        break;
      }
      if (listItems.length > 0) data[key] = listItems;
      else if (Object.keys(mapEntries).length > 0) data[key] = mapEntries;
      else data[key] = null;
      continue;
    } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      // Inline array: [a, b, c]
      const inner = rawVal.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else if (rawVal === '{}') {
      // Inline empty object (flow mapping) — matches wiki.mjs's stringifyFrontmatter
      // output for an object-typed field with no keys.
      data[key] = {};
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
 * Whether a missing required field can be safely auto-derived by fixL01,
 * given only its declared type/key and entity type (no file I/O needed —
 * this must stay a pure, check-time decision):
 *   - array / object / iso-date: always derivable ([]/{}/mtime-or-legacy-date).
 *   - string: only `id`, `type`, `title` have a defined derivation rule.
 *   - enum: only if LINT_LEGACY_DEFAULTS has a safe default for this key.
 *   - number, and any other case: never — a wrong guess is worse than a
 *     loud "missing" finding.
 * @param {string} entityType
 * @param {{key:string, type:string}} field
 * @returns {boolean}
 */
function isL01Fixable(entityType, field) {
  switch (field.type) {
    case 'array':
    case 'object':
    case 'iso-date':
      return true;
    case 'string':
      return DERIVABLE_STRING_KEYS.has(field.key);
    case 'enum':
      return Boolean(LINT_LEGACY_DEFAULTS[entityType] && field.key in LINT_LEGACY_DEFAULTS[entityType]);
    case 'number':
    default:
      return false;
  }
}

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
        'L01-frontmatter-required', 'error', isL01Fixable(type, field),
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
        } else if (val.trim() === 'TODO') {
          // Task 2 sentinel rule: the exact literal "TODO" (trimmed,
          // case-sensitive) is never a real value for a DECLARED schema
          // field — it is the placeholder Lumina's own former `fixL01`
          // used to write for a missing string field before this version.
          // It satisfies `typeof val === 'string'` above so the branch
          // above never caught it; a real 813-file wiki had 64 pages
          // carrying `id: TODO` this way, invisible to every prior check.
          // Scoped to fields declared in REQUIRED_FRONTMATTER for this
          // entity type (we're inside that loop) — a free-form key a user
          // set to "TODO" as their own note is a different key entirely
          // and is never inspected here.
          findings.push(finding('L02-frontmatter-types', 'error', DERIVABLE_STRING_KEYS.has(field.key), wikiRelPath, null,
            `"${field.key}" is set to the placeholder "TODO", which is not a real value`));
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
          // Fixable in every shape fixL02 can represent: a scalar is wrapped
          // losslessly, and a TODO sentinel / empty string / empty mapping is
          // reconstructed from the graph or body, else []. A NON-EMPTY mapping
          // is the one exception — it holds structured data that cannot be
          // rendered as list items, so it is reported for a human instead.
          const isNonEmptyMapping = val !== null && typeof val === 'object'
            && !Array.isArray(val) && Object.keys(val).length > 0;
          findings.push(finding('L02-frontmatter-types', 'error', !isNonEmptyMapping, wikiRelPath, null,
            `"${field.key}" must be an array, got ${typeof val}`));
        }
        break;
      case 'iso-date':
        if (typeof val !== 'string' || !ISO_DATE_RE.test(val)) {
          // Only the TODO sentinel (written by the pre-fix fixL01) has a safe
          // derivation; any other malformed date is left for a human to fix.
          const fixableIsoDate = typeof val === 'string' && val.trim() === 'TODO';
          findings.push(finding('L02-frontmatter-types', 'error', fixableIsoDate, wikiRelPath, null,
            `"${field.key}" must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(val)}`));
        }
        break;
      case 'enum':
        if (field.values && !field.values.includes(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be one of [${field.values.join(', ')}], got ${JSON.stringify(val)}`));
        }
        break;
      case 'object':
        if (typeof val !== 'object' || val === null || Array.isArray(val)) {
          findings.push(finding('L02-frontmatter-types', 'error', false, wikiRelPath, null,
            `"${field.key}" must be an object, got ${Array.isArray(val) ? 'array' : typeof val}`));
        }
        break;
    }
  }

  // Legacy renamed fields — warn if the old key is still present, so upgrade
  // banners can surface a migration hint. The old key is ignored at runtime;
  // the new key (if present) is what counts. `_all` (slug/date_added) applies
  // to every entity type; type-specific entries (e.g. sources.url) layer on top.
  //
  // `fixable` here (and thus whether fixL02's removal pass will delete the
  // old key) is decided by the same three-part rule documented on
  // `isLegacyValueEquivalent`: new key present, new key schema-valid, and
  // old/new values equivalent. A present-but-DISAGREEING pair is a real
  // conflict — left `fixable: false` on purpose so the warning keeps
  // surfacing for a human, never silently resolved either direction.
  const legacy = { ...(LEGACY_RENAMED_FIELDS._all || {}), ...(LEGACY_RENAMED_FIELDS[type] || {}) };
  for (const [oldKey, info] of Object.entries(legacy)) {
    if (oldKey in fm) {
      const targetFieldDef = fields.find(fd => fd.key === info.newKey);
      const targetVal = fm[info.newKey];
      const targetPresent = targetVal !== null && targetVal !== undefined;
      const targetValid = targetPresent && Boolean(targetFieldDef) && isLegacyTargetValid(targetFieldDef.type, targetVal);
      const removable = targetValid && isLegacyValueEquivalent(targetFieldDef.type, fm[oldKey], targetVal);
      findings.push(finding('L02-frontmatter-types', 'warning', removable, wikiRelPath, null,
        `Legacy frontmatter field "${oldKey}" was renamed to "${info.newKey}" in ${info.since}. Run /lumi-migrate-legacy to upgrade.`));
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

  // Basename -> [full wiki-relative slugs] index, used to detect the common
  // "missing directory prefix" mistake (e.g. [[agent-taxonomy]] where the
  // page actually lives at concepts/agent-taxonomy). Built once per file scan.
  const basenameIndex = buildBasenameIndex(knownSlugs);

  const lines = rawContent.split('\n');
  const inFence = fencedCodeLines(lines);
  for (let li = 0; li < lines.length; li++) {
    // A `[[...]]` inside a fenced code block is sample syntax, not a link.
    // Reporting it would also be unfixable-by-design: rewriting it corrupts
    // the very example the author wrote, so the finding could never clear.
    if (inFence[li]) continue;
    const lineRe = new RegExp(WIKILINK_RE.source, 'g');
    while ((match = lineRe.exec(lines[li])) !== null) {
      const slug = match[1].trim();
      if (!knownSlugs.has(slug)) {
        // The basename heuristic exists for ONE mistake: a bare slug missing
        // its directory prefix. Two shapes must never be "repaired" by it.
        //   - A target that already names a real entity dir (`[[sources/lora]]`)
        //     is an explicit claim about WHICH page is meant; resolving it to
        //     `concepts/lora` by basename would silently change the entity type
        //     the link asserts, and edge types such as `annotates` are only
        //     valid against a sources target.
        //   - A URL-shaped target (`[[https://x.dev/lora]]`) is not an internal
        //     page reference at all, and its last path segment matching some
        //     page's basename is a coincidence, not an intent.
        // Both are still reported broken — just never auto-rewritten.
        const firstSeg = slug.split('/')[0];
        const explicitEntityDir = slug.includes('/')
          && Object.prototype.hasOwnProperty.call(ENTITY_DIRS, firstSeg);
        const looksLikeUrl = slug.includes('://');
        // A trailing `.md` is a spelling of the same target, not a different
        // one: resolveWikilinkTarget already strips it, so without stripping it
        // here too the link is reported broken and never offered a repair.
        const lookupSlug = slug.endsWith('.md') ? slug.slice(0, -3) : slug;
        const byBasename = basenameIndex.get(basename(lookupSlug)) || [];
        let candidates;
        let suppressed = null;
        if (lookupSlug !== slug && knownSlugs.has(lookupSlug)) {
          // Only the suffix was wrong — an exact resolution, not a basename guess,
          // so it is safe even for an explicitly-qualified target.
          candidates = [lookupSlug];
        } else if (explicitEntityDir || looksLikeUrl) {
          candidates = [];
          // Remember what the basename WOULD have matched. Not a repair
          // candidate — deliberately withheld — but the suggestion must name it
          // rather than claim no such page exists, which is both false and
          // unactionable when `[[sources/lora]]` fails only because the page
          // lives at `concepts/lora`.
          suppressed = { reason: looksLikeUrl ? 'url' : 'explicit-dir', nearMatches: byBasename };
        } else {
          candidates = byBasename;
        }
        const f = finding(
          'L05-broken-wikilink', 'error', candidates.length === 1,
          wikiRelPath, li + 1,
          `Broken wikilink: [[${slug}]] does not resolve to any wiki file`
        );
        // Non-standard fields, consumed by fixL05 and --suggest only; not
        // part of the documented Finding shape and stripped from --json
        // output when not requested (see reportJson).
        f.brokenSlug = slug;
        f.candidates = candidates;
        if (suppressed) f.suppressedRepair = suppressed;
        findings.push(f);
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

/**
 * L13 — `external_ids` namespace coverage. WARNING when a non-`url` namespace
 * derived from `urls[]` is missing or empty in `external_ids`.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL13(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (type !== 'sources') return [];
  const urls = Array.isArray(fm.urls) ? fm.urls.filter(u => typeof u === 'string') : [];
  if (urls.length === 0) return [];
  const ext = (fm.external_ids && typeof fm.external_ids === 'object' && !Array.isArray(fm.external_ids))
    ? fm.external_ids
    : {};

  // Collect derived non-url namespaces across all urls; dedupe by namespace.
  const derived = {};
  for (const url of urls) {
    const ids = parseUrlToExternalIds(url);
    for (const ns of Object.keys(ids)) {
      if (ns === 'url') continue;
      if (!(ns in derived)) derived[ns] = ids[ns];
    }
  }
  const findings = [];
  for (const [ns, val] of Object.entries(derived)) {
    const cur = ext[ns];
    if (!cur) {
      findings.push(finding(
        'L13-external-ids-coverage', 'warning', false, wikiRelPath, null,
        `external_ids missing ${ns}=${val} derivable from urls[]. Run /lumi-migrate-legacy --backfill-ids to populate.`
      ));
    }
  }
  return findings;
}

/**
 * L14 — `external_ids` value validity. ERROR when a value fails
 * `normalizeExternalId(ns, value).valid`.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL14(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (type !== 'sources') return [];
  const ext = fm.external_ids;
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return [];
  const findings = [];
  for (const ns of EXTERNAL_ID_NAMESPACES) {
    const v = ext[ns];
    if (typeof v !== 'string' || !v) continue;
    const r = normalizeExternalId(ns, v);
    if (!r.valid) {
      findings.push(finding(
        'L14-external-ids-invalid', 'error', false, wikiRelPath, null,
        `external_ids.${ns}=${JSON.stringify(v)} is not a valid ${ns} identifier.`
      ));
    }
  }
  return findings;
}

/**
 * L16 — mismatch between `external_ids[ns]` and the value derived from `urls[]`.
 * Both sides go through the same helpers so canonicalizer drift cannot trigger
 * a false positive.
 * @param {string} wikiRelPath
 * @param {Record<string,unknown>} fm
 * @returns {Finding[]}
 */
function checkL16(wikiRelPath, fm) {
  const type = entityTypeForPath(wikiRelPath);
  if (type !== 'sources') return [];
  const urls = Array.isArray(fm.urls) ? fm.urls.filter(u => typeof u === 'string') : [];
  const ext = (fm.external_ids && typeof fm.external_ids === 'object' && !Array.isArray(fm.external_ids))
    ? fm.external_ids
    : {};
  if (urls.length === 0) return [];

  const derived = {};
  for (const url of urls) {
    const ids = parseUrlToExternalIds(url);
    for (const ns of Object.keys(ids)) {
      if (ns === 'url') continue;
      if (!(ns in derived)) derived[ns] = ids[ns];
    }
  }
  const findings = [];
  for (const [ns, urlVal] of Object.entries(derived)) {
    const cur = ext[ns];
    if (typeof cur !== 'string' || !cur) continue;
    const curNorm = normalizeExternalId(ns, cur);
    if (!curNorm.valid) continue; // L14 owns this case.
    if (curNorm.id !== urlVal) {
      findings.push(finding(
        'L16-external-ids-mismatch', 'warning', false, wikiRelPath, null,
        `external_ids.${ns}=${curNorm.id} disagrees with value ${urlVal} derived from urls[]. Run /lumi-migrate-legacy --backfill-ids to reconcile.`
      ));
    }
  }
  return findings;
}

/**
 * L17: Edge endpoint (from or to) is an internal wiki slug that does not
 * resolve to any existing wiki file. Catches edges left dangling after an
 * entity is deleted or renamed (e.g. a future remove-edge/rename operation)
 * — something no other check currently detects, since L06/L07 only reason
 * about edge-pair symmetry and never check that either endpoint's file
 * actually exists.
 *
 * Resolution mirrors L05 exactly: an endpoint is "internal" unless it
 * contains '://' (an external URL, e.g. a see_also_url target), and an
 * internal endpoint resolves iff it is a member of knownSlugs — the same
 * set L05 checks wikilinks against. No extra exemption is applied for
 * foundations/**, outputs/**, or reflections/**: those dirs hold real
 * entity files that land in knownSlugs like any other, so a genuine file
 * there resolves fine and a missing one is correctly flagged.
 *
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {Set<string>} knownSlugs  - Set of wiki-relative paths (without .md), same as passed to checkL05.
 * @returns {Finding[]}
 */
function checkL17(edges, knownSlugs) {
  const findings = [];
  for (const edge of edges) {
    for (const key of ['from', 'to']) {
      const target = edge[key];
      if (typeof target !== 'string' || target.includes('://')) continue; // external URL, not a slug
      if (!knownSlugs.has(target)) {
        findings.push(finding(
          'L17-dangling-edge', 'error', false,
          edge.from, null,
          `Dangling edge endpoint: ${target} in edge ${edge.from} --${edge.type}--> ${edge.to} does not resolve to any wiki file`
        ));
      }
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixer for L01: insert missing frontmatter keys with a type-aware, safe
 * value — never the type-blind `TODO` sentinel. Per missing key:
 *   - array -> []
 *   - object -> {}
 *   - iso-date (`created`/`updated`) -> legacy `date_added` if valid, else mtime
 *   - string `id` -> legacy `slug` if present, else derived from path
 *   - string `type` -> derived from the entity directory
 *   - string `title` -> first H1 in the body, else Title-Cased basename
 *   - enum -> only if LINT_LEGACY_DEFAULTS has a safe default
 *   - number, and any other case -> NOT written; the finding stays unfixed
 *     (see isL01Fixable, which decided `finding.fixable` at check time —
 *     this fixer's per-key decision mirrors it exactly).
 * @param {string} absPath  Absolute path (used to stat mtime for iso-date fallback).
 * @param {string} wikiRelPath
 * @param {string} content
 * @param {Finding[]} l01findings
 * @returns {Promise<{ newContent: string, preview: string }>}
 */
async function fixL01(absPath, wikiRelPath, content, l01findings) {
  const split = splitRawFrontmatter(content);
  const parsed = parseFrontmatter(content);
  // Both parsers must agree the block is readable. If parseFrontmatter cannot
  // read it, we have no reliable view of which keys already exist, and
  // appending would duplicate them.
  if (!split || !parsed) return { newContent: content, preview: '', fixedKeys: [] };
  const { fmText, tail } = split;

  const fm = parsed.data;
  const body = parsed ? parsed.body : '';
  const entityType = entityTypeForPath(wikiRelPath);
  const fieldDefs = (entityType && REQUIRED_FRONTMATTER[entityType]) || [];

  const additions = [];
  for (const f of l01findings) {
    if (f.id !== 'L01-frontmatter-required') continue;
    const m = f.message.match(/"([^"]+)"\s*\(type:\s*([^)]+)\)/);
    if (!m) continue;
    const key = m[1];
    const fieldType = m[2].trim();
    if (!isL01Fixable(entityType, { key, type: fieldType })) continue;

    let value;
    switch (fieldType) {
      case 'array': value = []; break;
      case 'object': value = {}; break;
      case 'iso-date': value = await deriveIsoDateValue(fm, absPath); break;
      case 'string':
        if (key === 'id') value = deriveIdFromPath(wikiRelPath, fm);
        else if (key === 'type') value = deriveTypeFromPath(wikiRelPath);
        else if (key === 'title') value = deriveTitleFromContent(wikiRelPath, body);
        break;
      case 'enum': {
        const defaults = LINT_LEGACY_DEFAULTS[entityType];
        value = defaults ? defaults[key] : undefined;
        break;
      }
    }
    if (value === undefined) continue;
    if (!roundTripsAsFrontmatter(key, value)) continue; // unrepresentable — leave the field missing.
    additions.push({ key, value });
  }

  if (additions.length === 0) return { newContent: content, preview: '', fixedKeys: [] };

  const addLines = additions.map(({ key, value }) => renderYamlLine(key, value)).join('\n');
  const newFm = fmText.trimEnd() + '\n' + addLines;
  const newContent = `---\n${newFm}\n${tail}`;
  const preview = additions.map(({ key, value }) => `+ ${renderYamlLine(key, value)}`).join('\n');
  return { newContent, preview, fixedKeys: additions.map(a => a.key) };
}

/**
 * Fixer for L02: repair a value that fails its declared type — never a
 * blind rewrite. Three cases are safely repairable:
 *   - array-typed field holding a non-array: a real (non-"TODO") string is
 *     wrapped losslessly; a "TODO" sentinel or other stray scalar is
 *     reconstructed from the graph, falling back to [].
 *   - iso-date field holding the literal "TODO" sentinel: same derivation
 *     as fixL01 (legacy `date_added` or mtime).
 *   - string field holding the literal "TODO" sentinel, when the key is one
 *     `DERIVABLE_STRING_KEYS` knows how to derive (`id`/`type`/`title`):
 *     same derivation `fixL01` uses for a MISSING string field — including
 *     `id`'s own check of a legacy `slug` value first (Task 2).
 * number/enum/object mismatches, any iso-date value that isn't exactly
 * "TODO", and a string field's TODO on any OTHER key (e.g. "source"/"book",
 * which have no derivation rule) are left untouched — the finding stays
 * unfixed.
 * @param {string} absPath  Absolute path (used to stat mtime for iso-date fallback).
 * @param {string} wikiRelPath
 * @param {string} content
 * @param {Finding[]} l02findings
 * @param {Array<{from:string,to:string,type:string}>} edges
 * @param {Set<string>} [knownSlugs]  Wiki-relative slugs (no `.md`), for the
 *   tier-2 body-wikilink fallback in `repairArrayValue`. Optional — an
 *   absent/empty set simply disables tier 2 (graph tier + [] only).
 * @returns {Promise<{ newContent: string, preview: string }>}
 */
async function fixL02(absPath, wikiRelPath, content, l02findings, edges, knownSlugs) {
  const split = splitRawFrontmatter(content);
  const parsed = parseFrontmatter(content);
  // Same agreement requirement as fixL01 — see the comment there.
  if (!split || !parsed) return { newContent: content, preview: '', fixedKeys: [] };

  const fm = parsed.data;
  const body = parsed ? parsed.body : '';
  const entityType = entityTypeForPath(wikiRelPath);
  const fieldDefs = (entityType && REQUIRED_FRONTMATTER[entityType]) || [];
  const slugs = knownSlugs || new Set();
  const LEGACY_MSG_RE = /^Legacy frontmatter field "([^"]+)" was renamed to "([^"]+)"/;

  const changes = [];   // { key, value } — repaired type-mismatch / TODO-iso-date fixes.
  const removals = [];  // { oldKey, newKey } — legacy fields safe to delete (Task 1).

  for (const f of l02findings) {
    if (f.id !== 'L02-frontmatter-types') continue;
    if (LEGACY_MSG_RE.test(f.message)) continue; // handled in the removal pass below.

    const m = f.message.match(/^"([^"]+)"/);
    if (!m) continue;
    const key = m[1];
    const fieldDef = fieldDefs.find(fd => fd.key === key);
    if (!fieldDef) continue;
    const val = fm[key];
    if (val === null || val === undefined) continue;

    if (fieldDef.type === 'array' && !Array.isArray(val)) {
      const newVal = repairArrayValue(entityType, key, wikiRelPath, val, edges, body, slugs);
      if (newVal === null) continue; // no representable repair — leave the value untouched.
      if (!roundTripsAsFrontmatter(key, newVal)) continue;
      changes.push({ key, value: newVal });
    } else if (fieldDef.type === 'iso-date' && typeof val === 'string' && val.trim() === 'TODO') {
      const newVal = await deriveIsoDateValue(fm, absPath);
      if (!roundTripsAsFrontmatter(key, newVal)) continue;
      changes.push({ key, value: newVal });
    } else if (fieldDef.type === 'string' && typeof val === 'string' && val.trim() === 'TODO' && DERIVABLE_STRING_KEYS.has(key)) {
      // Task 2 repair: same derivation `fixL01` uses for a MISSING id/type/
      // title, reused here for a PRESENT-but-sentinel value. `deriveIdFromPath`
      // itself checks `fm.slug` first, so `id: TODO` next to `slug: real-value`
      // recovers "real-value" — and, on the SAME pass, the legacy-removal
      // loop below sees this freshly-derived value (via `effectiveValue`)
      // and — per Task 1's prefix-aware equivalence — can drop "slug" too.
      let newVal;
      if (key === 'id') newVal = deriveIdFromPath(wikiRelPath, fm);
      else if (key === 'type') newVal = deriveTypeFromPath(wikiRelPath);
      else if (key === 'title') newVal = deriveTitleFromContent(wikiRelPath, body);
      if (newVal === undefined || !roundTripsAsFrontmatter(key, newVal)) continue;
      changes.push({ key, value: newVal });
    }
    // number/enum/object mismatches, and non-derivable string keys
    // (e.g. "source"/"book") holding TODO: not repairable, left as-is.
  }

  // Legacy-field removal (Task 1) — see isLegacyValueEquivalent for the full
  // safety rule. Runs as a second pass, after `changes` is final, so it reads
  // the EFFECTIVE post-fix value of the target key: one this same fixL02
  // call just repaired (e.g. a "created" TODO sentinel resolved from
  // "date_added" moments ago), not the stale pre-fix value from `fm`. This
  // makes a single --fix pass sufficient even when the target field needed
  // its own repair first, and keeps the whole operation idempotent.
  const effectiveValue = (key) => {
    const queued = changes.find(c => c.key === key);
    return queued ? queued.value : fm[key];
  };
  for (const f of l02findings) {
    if (f.id !== 'L02-frontmatter-types') continue;
    const m = f.message.match(LEGACY_MSG_RE);
    if (!m) continue;
    const [, oldKey, newKey] = m;
    const targetFieldDef = fieldDefs.find(fd => fd.key === newKey);
    if (!targetFieldDef) continue;
    const targetVal = effectiveValue(newKey);
    if (targetVal === null || targetVal === undefined) continue; // target absent: legacy value is the only copy — never remove.
    if (!isLegacyTargetValid(targetFieldDef.type, targetVal)) continue; // target itself invalid — leave both keys for a human.
    if (!isLegacyValueEquivalent(targetFieldDef.type, fm[oldKey], targetVal)) continue; // real conflict — surfaced, not removed.
    removals.push({ oldKey });
  }

  if (changes.length === 0 && removals.length === 0) return { newContent: content, preview: '', fixedKeys: [] };

  let fmText = split.fmText;
  for (const { key, value } of changes) {
    fmText = replaceFrontmatterKeyLines(fmText, key, renderYamlLine(key, value));
  }
  for (const { oldKey } of removals) {
    fmText = removeFrontmatterKeyLines(fmText, oldKey);
  }
  const newContent = `---\n${fmText}${split.tail}`;
  const preview = [
    ...changes.map(({ key, value }) => `~ ${renderYamlLine(key, value)}`),
    ...removals.map(({ oldKey }) => `- ${oldKey} (redundant with its already-valid replacement)`),
  ].join('\n');
  return { newContent, preview, fixedKeys: [...changes.map(c => c.key), ...removals.map(r => r.oldKey)] };
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
 * Fixer for L05: rewrite a broken `[[slug]]` wikilink to the unique known
 * page whose basename matches — the common "missing directory prefix"
 * mistake (e.g. [[agent-taxonomy]] where the page is concepts/agent-taxonomy).
 * Only fires when checkL05 already recorded exactly one candidate on the
 * finding (`f.candidates`); ambiguous (2+) or unmatched (0) cases are left
 * untouched — no guessing.
 * @param {string} wikiRelPath
 * @param {string} wikiRoot  Absolute wiki dir.
 * @param {Finding[]} l05findings  L05 findings for this one file.
 * @returns {Promise<{ newContent: string, preview: string, fixedFindings: Finding[] }>}
 */
async function fixL05(wikiRelPath, wikiRoot, l05findings, pendingRenames = new Set()) {
  const abs = safejoin(wikiRoot, wikiRelPath);
  const original = await readFile(abs, 'utf8');
  const lines = original.split('\n');
  const inFence = fencedCodeLines(lines);
  const fixedFindings = [];
  const previewLines = [];

  // Group by broken slug, NOT by line number. checkL05 emits one finding per
  // OCCURRENCE, so a slug repeated in a page yields several findings that a
  // single rewrite resolves together, and marking only whichever finding
  // happened to trigger the write leaves the rest looking unresolved, which
  // `/lumi-migrate-legacy` (it filters on `!fix_applied`), the ingest gate, and
  // the process exit code all read as outstanding work on an already-clean page.
  //
  // Line numbers cannot be used for that grouping: fixL01/fixL02 rewrite this
  // same file's frontmatter block earlier in applyFixes, so by the time we run,
  // `f.line` may be off by however many lines that rewrite added or removed.
  // Slug-keyed repair over the current lines is immune to the shift.
  const groups = new Map();
  for (const f of l05findings) {
    if (!f.candidates || f.candidates.length !== 1) continue;
    if (!f.brokenSlug) continue;
    // Leave links to a file fixL03 is about to rename for fixL03 itself.
    if (pendingRenames.has(f.candidates[0])) continue;
    if (!groups.has(f.brokenSlug)) groups.set(f.brokenSlug, []);
    groups.get(f.brokenSlug).push(f);
  }

  for (const [brokenSlug, members] of groups) {
    const candidate = members[0].candidates[0];
    // checkL05 records the TRIMMED target, so the pattern must tolerate the
    // padding the page actually contains (`[[ alpha | A ]]`). Without `\s*`
    // the finding is reported fixable and then silently never rewritten, on
    // every run forever.
    const re = new RegExp(`\\[\\[\\s*${escapeRegex(brokenSlug)}\\s*(\\|[^\\]]*)?\\]\\]`, 'g');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (inFence[i]) continue; // sample syntax stays exactly as the author wrote it.
      const before = lines[i];
      lines[i] = before.replace(re, (_, alias) => `[[${candidate}${alias || ''}]]`);
      if (lines[i] !== before) changed = true;
    }
    if (!changed) continue;
    fixedFindings.push(...members);
    previewLines.push(`~ [[${brokenSlug}]] -> [[${candidate}]]`);
  }

  if (fixedFindings.length === 0) return { newContent: original, preview: '', fixedFindings: [] };
  return { newContent: lines.join('\n'), preview: previewLines.join('\n'), fixedFindings };
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
    allFindings.push(...checkL13(wikiRelPath, fm));
    allFindings.push(...checkL14(wikiRelPath, fm));
    allFindings.push(...checkL16(wikiRelPath, fm));
  }

  allFindings.push(...checkL06(edges, new Set(edgeSet)));
  allFindings.push(...checkL07(edges, new Set(edgeSet)));
  allFindings.push(...checkL08(edges));
  allFindings.push(...checkL17(edges, knownSlugs));

  if (indexContent !== undefined) {
    const indexEntityFiles = entityFiles.filter(f => !isIndexExempt(f));
    allFindings.push(...checkL09(indexPath, indexContent, indexEntityFiles));
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

  // Apply fixes if requested. `--suggest` on its own runs them in dry-run mode
  // (no writes) purely to learn which findings a fixer would actually resolve:
  // `fixable` is only a check-time prediction, and without exercising the
  // fixers, --suggest defers to --fix for every finding still flagged fixable
  // and so says nothing about the ones --fix would silently fail to repair.
  if (opts.fix || opts.dryRun || opts.suggest) {
    const fixOpts = (opts.fix || opts.dryRun) ? opts : { ...opts, dryRun: true };
    await applyFixes(allFindings, wikiRoot, edgesPath, indexPath, indexContent, entityFiles, allAbsMd, edges, edgeSet, knownSlugs, fixOpts);
  }

  return { findings: allFindings, scannedFiles: allWikiRel.length };
}

/**
 * Apply fixes for fixable findings.
 * @param {Set<string>} knownSlugs  Wiki-relative slugs (no `.md`) of every
 *   known file — threaded into fixL02 for its tier-2 body-wikilink fallback.
 */
async function applyFixes(findings, wikiRoot, edgesPath, indexPath, indexContent, entityFiles, allAbsMd, edges, edgeSet, knownSlugs, opts) {
  // Fix L01 + L02 together, per file: both are frontmatter-block repairs, and
  // L02's fixer needs to see L01's just-added keys (and vice versa is
  // harmless) before either write hits disk. Grouping avoids a stale re-read
  // clobbering the other fixer's in-memory change, and matters in --dry-run
  // too (no disk write happens, so the second fixer must see the first
  // fixer's in-memory result to report an accurate preview).
  const l01ByFile = new Map();
  for (const f of findings.filter(f => f.id === 'L01-frontmatter-required')) {
    if (!l01ByFile.has(f.file)) l01ByFile.set(f.file, []);
    l01ByFile.get(f.file).push(f);
  }
  const l02ByFile = new Map();
  for (const f of findings.filter(f => f.id === 'L02-frontmatter-types')) {
    if (!l02ByFile.has(f.file)) l02ByFile.set(f.file, []);
    l02ByFile.get(f.file).push(f);
  }
  const frontmatterFiles = new Set([...l01ByFile.keys(), ...l02ByFile.keys()]);

  for (const wikiRelPath of frontmatterFiles) {
    const abs = safejoin(wikiRoot, wikiRelPath);
    let content = await readFile(abs, 'utf8');
    const original = content;

    const l01findings = l01ByFile.get(wikiRelPath) || [];
    if (l01findings.length > 0) {
      const { newContent, preview, fixedKeys } = await fixL01(abs, wikiRelPath, content, l01findings);
      if (newContent !== content) {
        content = newContent;
        const fixedSet = new Set(fixedKeys);
        for (const f of l01findings) {
          const km = f.message.match(/"([^"]+)"/);
          if (!km || !fixedSet.has(km[1])) continue;
          if (opts.dryRun) f.proposed_fix = preview;
          else f.fix_applied = true;
        }
      }
    }

    const l02findings = l02ByFile.get(wikiRelPath) || [];
    if (l02findings.length > 0) {
      const { newContent, preview, fixedKeys } = await fixL02(abs, wikiRelPath, content, l02findings, edges, knownSlugs);
      if (newContent !== content) {
        content = newContent;
        const fixedSet = new Set(fixedKeys);
        for (const f of l02findings) {
          const km = f.message.match(/^"([^"]+)"/) || f.message.match(/^Legacy frontmatter field "([^"]+)"/);
          if (!km || !fixedSet.has(km[1])) continue;
          if (opts.dryRun) f.proposed_fix = preview;
          else f.fix_applied = true;
        }
      }
    }

    if (!opts.dryRun && content !== original) {
      await atomicWrite(abs, content);
    }
  }

  // Fix L05 — rewrite [[slug]] wikilinks that broke only because of a
  // missing/wrong directory prefix, when the basename resolves uniquely.
  //
  // L05 runs BEFORE L03 (which renames non-kebab files) so that fixL05 never
  // reads a path L03 has already renamed out from under it. The cost is that a
  // link pointing at a file L03 is about to rename must be left alone here:
  // qualifying `[[Foo_Bar]]` to `[[concepts/Foo_Bar]]` would hide it from
  // fixL03's own rewrite, which only matches the bare form — and once the file
  // becomes `foo-bar.md`, the qualified link is dead with no basename left to
  // resolve it, so a later run cannot repair what this run broke. Skipping lets
  // fixL03 rewrite the bare link correctly in this same run; whatever prefix is
  // still missing afterwards is picked up by the next run, with no page left
  // pointing at a file that never existed.
  const pendingRenames = new Set(
    findings.filter(f => f.id === 'L03-slug-style').map(f => f.file.replace(/\.md$/, ''))
  );
  const l05ByFile = new Map();
  for (const f of findings.filter(f => f.id === 'L05-broken-wikilink')) {
    if (!l05ByFile.has(f.file)) l05ByFile.set(f.file, []);
    l05ByFile.get(f.file).push(f);
  }
  for (const [wikiRelPath, filefindings] of l05ByFile) {
    let result;
    try {
      result = await fixL05(wikiRelPath, wikiRoot, filefindings, pendingRenames);
    } catch {
      continue; // file unreadable (e.g. renamed by another fixer) — skip gracefully.
    }
    const { newContent, preview, fixedFindings } = result;
    if (fixedFindings.length === 0) continue;
    if (opts.dryRun) {
      for (const f of fixedFindings) f.proposed_fix = `~ [[${f.brokenSlug}]] -> [[${f.candidates[0]}]]`;
    } else {
      const abs = safejoin(wikiRoot, wikiRelPath);
      await atomicWrite(abs, newContent);
      for (const f of fixedFindings) f.fix_applied = true;
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
    const { newContent, preview } = fixL09(indexContent, entityFiles.filter(f => !isIndexExempt(f)));
    if (newContent !== indexContent) {
      if (opts.dryRun) {
        for (const f of l09findings) { f.proposed_fix = preview; }
      } else {
        await atomicWrite(indexPath, newContent);
        for (const f of l09findings) { f.fix_applied = true; }
      }
    }
  }

  // Truth pass. `fixable` is decided at check time from the finding's shape
  // alone, before any fixer has looked at the file, so it is a prediction. Some
  // predictions do not survive contact: a page with no readable frontmatter
  // block has nothing to append to, a derived value may be unrepresentable in
  // this parser's dialect, a legacy key may carry no value to compare, and a
  // wikilink may not match the text on the page. Leaving `fixable: true` on a
  // finding this run did not fix makes every downstream consumer wrong in the
  // same direction: `/lumi-migrate-legacy` skips it as already handled, the
  // upgrade banner reports work that will never happen, and `--suggest` stays
  // silent (it defers to --fix for anything flagged fixable), so the user is
  // told a problem is solved while it quietly persists. Correcting the flag
  // here is what makes the run self-consistent and lets --suggest speak.
  for (const f of findings) {
    const resolved = opts.dryRun ? Boolean(f.proposed_fix) : Boolean(f.fix_applied);
    if (f.fixable && !resolved) f.fixable = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For a finding that --fix cannot (or did not) resolve, compute a concrete,
 * human-readable suggestion — what a human (or /lumi-migrate-legacy) should
 * do about it. Returns null when there is nothing more specific to say than
 * the finding's own message (e.g. most L04/L08/L10-L17 findings are already
 * self-describing).
 * @param {Finding} f
 * @returns {string|null}
 */
function computeSuggestion(f) {
  if (f.fix_applied) return null;

  if (f.id === 'L01-frontmatter-required') {
    if (f.fixable) return null; // --fix already handles this one.
    const m = f.message.match(/"([^"]+)"\s*\(type:\s*([^)]+)\)/);
    if (m) return `${m[1]}: ${m[2].trim()}, cannot be inferred — provide a value manually.`;
  }

  if (f.id === 'L02-frontmatter-types') {
    if (f.fixable) return null; // --fix already handles this one (including a safe legacy-field removal).
    const legacyMatch = f.message.match(/^Legacy frontmatter field "([^"]+)" was renamed to "([^"]+)"/);
    if (legacyMatch) {
      const [, oldKey, newKey] = legacyMatch;
      return `"${oldKey}" survives because "${newKey}" is missing, invalid, or disagrees with it — resolve "${newKey}" by hand, then re-run --fix to drop "${oldKey}".`;
    }
    const todoMatch = f.message.match(/^"([^"]+)" is set to the placeholder "TODO"/);
    if (todoMatch) return `${todoMatch[1]}: currently "TODO" — no automatic derivation exists for this field; provide a real value manually.`;
    const m = f.message.match(/^"([^"]+)"\s+must be ([^,]+),/);
    if (m) return `${m[1]}: expected ${m[2].trim()}, cannot be safely inferred — provide a value manually.`;
  }

  if (f.id === 'L05-broken-wikilink') {
    if (f.fixable) return null; // --fix already handles the unique-match case.
    const candidates = f.candidates || [];
    if (candidates.length > 1) {
      return `Ambiguous target for [[${f.brokenSlug}]] — candidates: ${candidates.join(', ')}. Pick one and update the link manually.`;
    }
    // A repair withheld on purpose is a different situation from "nothing
    // matches", and saying the latter would be plainly false when the near
    // match is what the author almost certainly meant.
    const sup = f.suppressedRepair;
    if (sup && sup.nearMatches && sup.nearMatches.length > 0) {
      const near = sup.nearMatches.join(', ');
      return sup.reason === 'url'
        ? `[[${f.brokenSlug}]] looks like a URL, so it is never rewritten to an internal page. Did you mean ${near}, or should this be a plain Markdown link?`
        : `[[${f.brokenSlug}]] names an entity directory that has no such page; ${near} exists but points at a different kind of page, so this is not rewritten automatically. Confirm which one you mean and update the link.`;
    }
    return `No page found with basename "${basename(f.brokenSlug || '')}" for [[${f.brokenSlug}]] — create the page or fix the link manually.`;
  }

  return null;
}

/**
 * Format and print findings in human-readable mode.
 * @param {Finding[]} findings
 * @param {number} scannedFiles
 * @param {LintOptions} [opts]
 */
function reportHuman(findings, scannedFiles, opts = {}) {
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
    let suggestionText = '';
    if (opts.suggest) {
      const suggestion = computeSuggestion(f);
      if (suggestion) suggestionText = `\n  suggestion: ${suggestion}`;
    }
    const prefix = f.severity === 'error' ? err : f.severity === 'warning' ? warn : info;
    console.log(prefix(`[${f.id}] ${f.file}${loc} — ${f.message}${fixed}${proposed}${suggestionText}`));
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
  // Check IDs whose `--fix` can repair at least SOME of their findings.
  // Not every finding under one of these IDs is itself fixable (e.g. a
  // missing `number` field under L01, or an ambiguous L05 wikilink) — the
  // per-finding `f.fixable` flag below is the authoritative signal; this set
  // exists for documentation / introspection of which checks have a fixer.
  const FIXABLE_IDS = new Set(['L01', 'L02', 'L03', 'L05', 'L06', 'L07', 'L09']);

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

    if (FIXABLE_IDS.has(prefix) && f.fixable && !f.fix_applied) fixable++;
  }

  process.stdout.write(JSON.stringify({ errors, warnings, by_check, fixable }) + '\n');
}

/**
 * Format and print findings in JSON mode.
 * @param {Finding[]} findings
 * @param {number} scannedFiles
 * @param {LintOptions} [opts]
 */
function reportJson(findings, scannedFiles, opts = {}) {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  const fixes = findings.filter(f => f.fix_applied).length;

  // Strip internal-only fields (candidates/brokenSlug/suppressedRepair — set by
  // checkL05 for fixL05's and computeSuggestion's own use) from the public
  // shape; re-add `candidates` and the new `suggestion` key only when
  // --suggest was requested.
  const outputFindings = findings.map(f => {
    const { candidates, brokenSlug, suppressedRepair, ...rest } = f;
    if (opts.suggest) {
      const suggestion = computeSuggestion(f);
      if (suggestion) rest.suggestion = suggestion;
      if (f.id === 'L05-broken-wikilink' && candidates && candidates.length > 0) {
        rest.candidates = candidates;
      }
    }
    return rest;
  });

  const output = {
    schema_version: SCHEMA_VERSION,
    scanned_files: scannedFiles,
    checks_run: ALL_CHECK_IDS,
    findings: outputFindings,
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
    reportJson(findings, scannedFiles, opts);
  } else {
    reportHuman(findings, scannedFiles, opts);
  }

  const hasUnresolved = findings.some(f => !f.fix_applied && (f.severity === 'error' || f.severity === 'warning'));
  // Set exitCode and let the event loop drain instead of calling
  // process.exit() here. On POSIX, process.stdout writes to a pipe (as
  // opposed to a TTY or a file) are asynchronous; a large --json/--summary
  // payload from reportJson/reportSummary above can still be queued when
  // process.exit() would tear the process down immediately, silently
  // truncating stdout (observed: truncated to exactly 8192 bytes,
  // regardless of payload size, with no error surfaced to the caller —
  // e.g. a parent process reading via spawnSync sees a clean exit code but
  // unparsable JSON). Letting main() return normally allows the queued
  // write to flush before Node exits on its own.
  process.exitCode = hasUnresolved ? 1 : 0;
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
  checkL13, checkL14, checkL16, checkL17,
  fixL01, fixL02, fixL03, fixL05, fixL06, fixL07, fixL09,
  runLint,
  reportSummary,
  reportHuman,
  reportJson,
  computeSuggestion,
  deriveIdFromPath,
  deriveTypeFromPath,
  deriveTitleFromContent,
  deriveIsoDateValue,
  reconstructArrayFromGraph,
  reconstructArrayFromBody,
  resolveWikilinkTarget,
  buildBasenameIndex,
  repairArrayValue,
  isLegacyTargetValid,
  isLegacyValueEquivalent,
  removeFrontmatterKeyLines,
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
