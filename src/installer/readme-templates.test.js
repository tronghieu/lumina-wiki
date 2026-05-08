/**
 * @file readme-templates.test.js
 * @description Structural sync tests for README template variants (en/vi/zh).
 *
 * Asserts:
 * - All 3 templates have identical sets of {{var}} tokens.
 * - All 3 templates have identical sets of {{#if var}} conditional tokens.
 * - All 3 templates contain byte-exact schema marker lines (no trim).
 * - All 3 templates have the same H1 heading count and H2 heading count (sanity).
 * - ZH template contains the translation_status: ai-draft HTML comment.
 * - No emoji (Unicode ranges U+1F300-U+1FAFF and common supplemental ranges) in any template.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const SCHEMA_OPEN_MARKER  = '<!-- lumina:schema -->';
const SCHEMA_CLOSE_MARKER = '<!-- /lumina:schema -->';

// Emoji regex: covers Emoticons, Misc Symbols & Pictographs, Transport & Map,
// Supplemental Symbols, Dingbats, and Enclosed Alphanumeric Supplement ranges.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/u;

/**
 * Extract all {{varName}} (non-conditional) tokens from template text.
 * @param {string} content
 * @returns {Set<string>}
 */
function extractVarTokens(content) {
  const tokens = new Set();
  // Match {{word}} but NOT {{#if ...}} or {{/if}}
  for (const match of content.matchAll(/\{\{(?!#|\/)([\w]+)\}\}/g)) {
    tokens.add(match[1]);
  }
  return tokens;
}

/**
 * Extract all {{#if varName}} conditional tokens from template text.
 * @param {string} content
 * @returns {Set<string>}
 */
function extractConditionalTokens(content) {
  const tokens = new Set();
  for (const match of content.matchAll(/\{\{#if\s+([\w]+)\}\}/g)) {
    tokens.add(match[1]);
  }
  return tokens;
}

/**
 * Count occurrences of a heading prefix (e.g., '# ', '## ') at the start of lines.
 * @param {string[]} lines
 * @param {string} prefix
 * @returns {number}
 */
function countHeadings(lines, prefix) {
  return lines.filter(line => line.startsWith(prefix)).length;
}

// Load all three templates upfront.
const templates = {};

test('load all three README templates', async () => {
  for (const locale of ['en', 'vi', 'zh']) {
    const suffix = locale === 'en' ? '' : '.' + locale;
    const filePath = join(TEMPLATES_DIR, `README${suffix}.md`);
    const raw = await readFile(filePath, 'utf8');
    assert.ok(raw.length > 0, `README${suffix}.md must not be empty`);
    templates[locale] = raw.replace(/\r\n/g, '\n');
  }
});

test('all templates have identical {{var}} token sets', () => {
  const sets = {};
  for (const locale of ['en', 'vi', 'zh']) {
    sets[locale] = extractVarTokens(templates[locale]);
  }

  const enTokens = [...sets['en']].sort();
  const viTokens = [...sets['vi']].sort();
  const zhTokens = [...sets['zh']].sort();

  assert.deepEqual(
    viTokens,
    enTokens,
    `VI template var tokens differ from EN.\nEN: ${enTokens.join(', ')}\nVI: ${viTokens.join(', ')}`,
  );
  assert.deepEqual(
    zhTokens,
    enTokens,
    `ZH template var tokens differ from EN.\nEN: ${enTokens.join(', ')}\nZH: ${zhTokens.join(', ')}`,
  );
});

test('all templates have identical {{#if ...}} conditional token sets', () => {
  const sets = {};
  for (const locale of ['en', 'vi', 'zh']) {
    sets[locale] = extractConditionalTokens(templates[locale]);
  }

  const enConds = [...sets['en']].sort();
  const viConds = [...sets['vi']].sort();
  const zhConds = [...sets['zh']].sort();

  assert.deepEqual(
    viConds,
    enConds,
    `VI template conditional tokens differ from EN.\nEN: ${enConds.join(', ')}\nVI: ${viConds.join(', ')}`,
  );
  assert.deepEqual(
    zhConds,
    enConds,
    `ZH template conditional tokens differ from EN.\nEN: ${enConds.join(', ')}\nZH: ${zhConds.join(', ')}`,
  );
});

test('all templates contain byte-exact schema open marker on its own line', () => {
  for (const locale of ['en', 'vi', 'zh']) {
    const lines = templates[locale].split('\n');
    assert.ok(
      lines.includes(SCHEMA_OPEN_MARKER),
      `README${locale === 'en' ? '' : '.' + locale}.md missing byte-exact line: ${SCHEMA_OPEN_MARKER}`,
    );
  }
});

test('all templates contain byte-exact schema close marker on its own line', () => {
  for (const locale of ['en', 'vi', 'zh']) {
    const lines = templates[locale].split('\n');
    assert.ok(
      lines.includes(SCHEMA_CLOSE_MARKER),
      `README${locale === 'en' ? '' : '.' + locale}.md missing byte-exact line: ${SCHEMA_CLOSE_MARKER}`,
    );
  }
});

test('all templates have matching H1 heading count', () => {
  const counts = {};
  for (const locale of ['en', 'vi', 'zh']) {
    counts[locale] = countHeadings(templates[locale].split('\n'), '# ');
  }
  assert.equal(counts['vi'], counts['en'], `VI H1 count (${counts['vi']}) !== EN H1 count (${counts['en']})`);
  assert.equal(counts['zh'], counts['en'], `ZH H1 count (${counts['zh']}) !== EN H1 count (${counts['en']})`);
});

test('all templates have matching H2 heading count', () => {
  const counts = {};
  for (const locale of ['en', 'vi', 'zh']) {
    counts[locale] = countHeadings(templates[locale].split('\n'), '## ');
  }
  assert.equal(counts['vi'], counts['en'], `VI H2 count (${counts['vi']}) !== EN H2 count (${counts['en']})`);
  assert.equal(counts['zh'], counts['en'], `ZH H2 count (${counts['zh']}) !== EN H2 count (${counts['en']})`);
});

test('ZH template contains translation_status: ai-draft HTML comment', () => {
  assert.ok(
    templates['zh'].includes('translation_status: ai-draft'),
    'README.zh.md missing "translation_status: ai-draft" HTML comment',
  );
});

test('no emoji in EN template', () => {
  assert.ok(
    !EMOJI_RE.test(templates['en']),
    'README.md (EN) contains emoji — remove them',
  );
});

test('no emoji in VI template', () => {
  assert.ok(
    !EMOJI_RE.test(templates['vi']),
    'README.vi.md contains emoji — remove them',
  );
});

test('no emoji in ZH template', () => {
  assert.ok(
    !EMOJI_RE.test(templates['zh']),
    'README.zh.md contains emoji — remove them',
  );
});
