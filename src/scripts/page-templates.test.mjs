/**
 * @file page-templates.test.mjs
 * @description CI guard against drift between the single source of truth
 * (`schemas.mjs` REQUIRED_FRONTMATTER) and the page templates shipped to users
 * (`src/templates/_lumina/schema/page-templates.md`).
 *
 * This does NOT use a YAML parser (none is a dependency of this project, and
 * none should become one — see CLAUDE.md "no new deps"). It uses a simple
 * line scanner: a "top-level key" is a line with zero leading whitespace that
 * matches /^([a-z_]+):/. Nested keys (e.g. under `ranking:`) are indented and
 * are intentionally ignored — required-field enforcement only applies to
 * top-level frontmatter keys.
 *
 * Run with: node --test src/scripts/page-templates.test.mjs
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { REQUIRED_FRONTMATTER } from './schemas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_PATH = join(
  __dirname,
  '..',
  'templates',
  '_lumina',
  'schema',
  'page-templates.md',
);

// ---------------------------------------------------------------------------
// type: <value> (singular, as written in a page's own frontmatter) ->
// REQUIRED_FRONTMATTER key (the entity-dir key, mostly plural).
// We map on the block's own `type:` value rather than the surrounding
// markdown heading text, because heading prose is free-form and easy to
// reword without noticing it breaks a naming convention; the `type:` value
// is itself schema-checked data and is what lint.mjs actually keys off of at
// runtime, so anchoring the test to it catches the same drift the real
// engine would catch.
// ---------------------------------------------------------------------------
const TYPE_VALUE_TO_SCHEMA_KEY = {
  source: 'sources',
  concept: 'concepts',
  person: 'people',
  summary: 'summary',
  reading: 'readings',
  topic: 'topics',
  foundation: 'foundations',
  chapter: 'chapters',
  character: 'characters',
  theme: 'themes',
  plot: 'plot',
  reflection: 'reflections',
};

// ---------------------------------------------------------------------------
// ALLOWLIST — keys that are intentionally free-form and are NOT part of
// REQUIRED_FRONTMATTER for any type. Kept deliberately tiny; every entry
// must be justified.
//
// - `tags`      — free-form user tagging convention that predates the schema.
//                 Not read or validated by wiki.mjs/lint.mjs; purely a
//                 human-organizational field. Present on every top-level
//                 entity template (source/concept/person/summary/topic/
//                 foundation).
// - `source_type` — descriptive sub-classification of a source (paper |
//                 article | book | podcast | note | other), distinct from
//                 the schema-required `type` field (which always holds the
//                 entity type, "source"). Not read or validated by
//                 wiki.mjs/lint.mjs. Kept as a documentation convenience;
//                 flagged for the schema owner to decide whether it should
//                 be formalized in schemas.mjs.
// ---------------------------------------------------------------------------
const ALLOWLIST = new Set(['tags', 'source_type']);

/**
 * Extract every ```yaml ... ``` fenced block from the markdown source.
 * @param {string} markdown
 * @returns {string[]} raw block bodies (without the fence lines themselves)
 */
function extractYamlBlocks(markdown) {
  const blocks = [];
  const re = /```yaml\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/**
 * Scan a yaml block body for top-level keys only (zero indentation).
 * @param {string} block
 * @returns {string[]} top-level keys, in file order
 */
function topLevelKeys(block) {
  const keys = [];
  for (const line of block.split('\n')) {
    const match = /^([a-z_]+):/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Read the `type:` value from a yaml block (top-level only).
 * @param {string} block
 * @returns {string|null}
 */
function readTypeValue(block) {
  for (const line of block.split('\n')) {
    const match = /^type:\s*(\S+)/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

describe('page-templates.md matches schemas.mjs REQUIRED_FRONTMATTER', () => {
  /** @type {Map<string, string>} schemaKey -> raw yaml block body */
  let bySchemaKey;
  /** @type {string[]} */
  let rawBlocks;

  before(async () => {
    const markdown = await readFile(TEMPLATES_PATH, 'utf8');
    rawBlocks = extractYamlBlocks(markdown);
    bySchemaKey = new Map();
    for (const block of rawBlocks) {
      const typeValue = readTypeValue(block);
      if (!typeValue) continue; // not an entity frontmatter block (shouldn't happen)
      const schemaKey = TYPE_VALUE_TO_SCHEMA_KEY[typeValue];
      if (!schemaKey) continue; // surfaced as a failure by the dedicated test below
      bySchemaKey.set(schemaKey, block);
    }
  });

  test('every REQUIRED_FRONTMATTER entity type maps to a known template type value', () => {
    const schemaKeys = Object.keys(REQUIRED_FRONTMATTER).filter((k) => k !== '_base');
    const mappedKeys = new Set(Object.values(TYPE_VALUE_TO_SCHEMA_KEY));
    for (const key of schemaKeys) {
      assert.ok(
        mappedKeys.has(key),
        `TYPE_VALUE_TO_SCHEMA_KEY in this test has no entry mapping to schema key "${key}" ` +
          `— add one so the guard can find its template block`,
      );
    }
  });

  test('every yaml block has a type: value known to TYPE_VALUE_TO_SCHEMA_KEY', () => {
    assert.ok(rawBlocks.length > 0, 'no ```yaml fenced blocks found in page-templates.md');
    for (const block of rawBlocks) {
      const typeValue = readTypeValue(block);
      assert.ok(typeValue, 'a template yaml block is missing a top-level type: field');
      assert.ok(
        TYPE_VALUE_TO_SCHEMA_KEY[typeValue],
        `template block has type: ${typeValue}, which is not in TYPE_VALUE_TO_SCHEMA_KEY`,
      );
    }
  });

  test('every entity type has exactly one template block', () => {
    const schemaKeys = Object.keys(REQUIRED_FRONTMATTER).filter((k) => k !== '_base');
    for (const key of schemaKeys) {
      assert.ok(
        bySchemaKey.has(key),
        `no template block found for entity type "${key}" — page-templates.md is missing ` +
          `its frontmatter template`,
      );
    }
    // Duplicate-detection: count blocks per schema key across the raw list.
    const counts = new Map();
    for (const block of rawBlocks) {
      const typeValue = readTypeValue(block);
      const schemaKey = TYPE_VALUE_TO_SCHEMA_KEY[typeValue];
      if (!schemaKey) continue;
      counts.set(schemaKey, (counts.get(schemaKey) ?? 0) + 1);
    }
    for (const [schemaKey, count] of counts) {
      assert.equal(count, 1, `entity type "${schemaKey}" has ${count} template blocks, expected 1`);
    }
  });

  test('every required:true field appears as a top-level key in its template block', () => {
    for (const [schemaKey, fields] of Object.entries(REQUIRED_FRONTMATTER)) {
      if (schemaKey === '_base') continue;
      const block = bySchemaKey.get(schemaKey);
      assert.ok(block, `no template block for entity type "${schemaKey}"`);
      const keys = new Set(topLevelKeys(block));
      for (const field of fields) {
        if (!field.required) continue;
        assert.ok(
          keys.has(field.key),
          `entity type "${schemaKey}" is missing required frontmatter field "${field.key}" ` +
            `in its page-templates.md template block`,
        );
      }
    }
  });

  test("no template block contains a key absent from its type's schema field list (minus allowlist)", () => {
    for (const [schemaKey, fields] of Object.entries(REQUIRED_FRONTMATTER)) {
      if (schemaKey === '_base') continue;
      const block = bySchemaKey.get(schemaKey);
      assert.ok(block, `no template block for entity type "${schemaKey}"`);
      const schemaFieldKeys = new Set(fields.map((f) => f.key));
      for (const key of topLevelKeys(block)) {
        const allowed = schemaFieldKeys.has(key) || ALLOWLIST.has(key);
        assert.ok(
          allowed,
          `entity type "${schemaKey}" template block has key "${key}", which is neither a ` +
            `schemas.mjs REQUIRED_FRONTMATTER field for "${schemaKey}" nor in the test's ALLOWLIST`,
        );
      }
    }
  });

  test('no template block contains the literal string TODO as a value', () => {
    for (const block of rawBlocks) {
      const typeValue = readTypeValue(block) ?? '(unknown type)';
      assert.ok(
        !/\bTODO\b/.test(block),
        `entity type "${typeValue}" template block contains the literal string TODO — ` +
          `use a type-valid placeholder instead`,
      );
    }
  });
});
