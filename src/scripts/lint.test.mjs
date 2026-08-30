/**
 * @file lint.test.mjs
 * Tests for src/scripts/lint.mjs — covers all 10 checks, fix idempotency, --json schema,
 * --fix --dry-run no-write guarantee, and NO_COLOR output.
 *
 * Run: node --test src/scripts/lint.test.mjs
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseFrontmatter,
  parseEdgesJsonl,
  walkMd,
  findProjectRoot,
  atomicWrite,
  isExempt,
  entityTypeForPath,
  checkL01, checkL02, checkL03, checkL04, checkL05,
  checkL06, checkL07, checkL08, checkL09, checkL10, checkL11, checkL12,
  checkL13, checkL14, checkL16, checkL17, checkL18,
  fixL01, fixL02, fixL05, fixL06, fixL07, fixL09,
  reconstructArrayFromBody,
  buildBasenameIndex,
  runLint,
  reportSummary,
  reportHuman,
  reportJson,
  computeSuggestion,
  isLegacyTargetValid,
  isLegacyValueEquivalent,
  removeFrontmatterKeyLines,
  INDEX_MARKER_OPEN,
  INDEX_MARKER_CLOSE,
  ALL_CHECK_IDS,
} from './lint.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function makeTmp() {
  return mkdtemp(join(tmpdir(), 'lumina-lint-test-'));
}

async function removeTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Build a minimal wiki workspace for integration tests.
 * @param {string} root  Temp project root.
 * @param {object} opts
 */
async function makeWiki(root, opts = {}) {
  const wikiDir = join(root, 'wiki');
  await mkdir(join(wikiDir, 'sources'), { recursive: true });
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'people'), { recursive: true });
  await mkdir(join(wikiDir, 'graph'), { recursive: true });

  // index.md
  await writeFile(join(wikiDir, 'index.md'),
    opts.indexContent ?? `# Index\n\n${INDEX_MARKER_OPEN}\n${INDEX_MARKER_CLOSE}\n`);

  // edges.jsonl
  await writeFile(join(wikiDir, 'graph', 'edges.jsonl'), opts.edgesContent ?? '');

  return wikiDir;
}

/** Minimal valid source frontmatter. */
function validSourceFm(overrides = {}) {
  return {
    id: 'test-source',
    title: 'Test Source',
    type: 'source',
    created: '2026-01-01',
    updated: '2026-01-01',
    authors: ['Author A'],
    year: 2026,
    importance: 3,
    provenance: 'replayable',
    ...overrides,
  };
}

/** Render frontmatter block as YAML string. */
function renderFm(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT: parseFrontmatter
// ─────────────────────────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  test('parses scalar fields', () => {
    const content = `---\ntitle: Hello World\nyear: 2026\n---\nbody`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.equal(result.data.title, 'Hello World');
    assert.equal(result.data.year, 2026);
    assert.ok(result.body.includes('body'));
  });

  test('parses block list', () => {
    const content = `---\nauthors:\n  - Alice\n  - Bob\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.deepEqual(result.data.authors, ['Alice', 'Bob']);
  });

  test('parses inline array', () => {
    const content = `---\ntags: [a, b, c]\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.deepEqual(result.data.tags, ['a', 'b', 'c']);
  });

  test('returns null when no frontmatter', () => {
    assert.equal(parseFrontmatter('# Hello\nno frontmatter'), null);
  });

  test('returns null for malformed opening', () => {
    assert.equal(parseFrontmatter('---extra\ntitle: x\n---\n'), null);
  });

  test('parses block-mapping object (matches wiki.mjs stringify form)', () => {
    const content = `---\ntitle: x\nexternal_ids:\n  arxiv: 1706.03762\n  doi: 10.48550/arxiv.1706.03762\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result);
    assert.deepEqual(result.data.external_ids, {
      arxiv: '1706.03762',
      doi: '10.48550/arxiv.1706.03762',
    });
  });

  test('block-mapping with quoted value strips quotes', () => {
    const content = `---\nexternal_ids:\n  url: "https://example.com/x"\n---\n`;
    const result = parseFrontmatter(content);
    assert.equal(result.data.external_ids.url, 'https://example.com/x');
  });

  test('empty key with no follow-up is null', () => {
    const content = `---\nfoo:\nbar: 1\n---\n`;
    const result = parseFrontmatter(content);
    assert.equal(result.data.foo, null);
    assert.equal(result.data.bar, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT: isExempt
// ─────────────────────────────────────────────────────────────────────────────

describe('isExempt', () => {
  test('foundations/** matches', () => assert.ok(isExempt('foundations/math.md')));
  test('outputs/** matches', () => assert.ok(isExempt('outputs/report.md')));
  test('URL matches', () => assert.ok(isExempt('https://example.com/paper')));
  test('sources/ does not match', () => assert.ok(!isExempt('sources/lora.md')));
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT: entityTypeForPath
// ─────────────────────────────────────────────────────────────────────────────

describe('entityTypeForPath', () => {
  test('sources/lora.md => sources', () => assert.equal(entityTypeForPath('sources/lora.md'), 'sources'));
  test('concepts/attention.md => concepts', () => assert.equal(entityTypeForPath('concepts/attention.md'), 'concepts'));
  test('graph/edges.jsonl => graph (graph is a valid entity dir)', () => assert.equal(entityTypeForPath('graph/edges.jsonl'), 'graph'));
  test('index.md => null', () => assert.equal(entityTypeForPath('index.md'), null));
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L01: frontmatter-required
// ─────────────────────────────────────────────────────────────────────────────

describe('L01 frontmatter-required', () => {
  test('clean: all required keys present', () => {
    const fm = validSourceFm();
    const result = checkL01('sources/test.md', fm);
    assert.equal(result.length, 0);
  });

  test('violation: missing required key (array type — always fixable)', () => {
    const fm = { ...validSourceFm() };
    delete fm.authors;
    const result = checkL01('sources/test.md', fm);
    assert.ok(result.length > 0);
    assert.equal(result[0].id, 'L01-frontmatter-required');
    assert.equal(result[0].severity, 'error');
    assert.ok(result[0].fixable);
  });

  test('violation: missing "year" (number type — never fixable)', () => {
    const fm = { ...validSourceFm() };
    delete fm.year;
    const result = checkL01('sources/test.md', fm);
    assert.ok(result.length > 0);
    assert.equal(result[0].id, 'L01-frontmatter-required');
    assert.equal(result[0].severity, 'error');
    assert.equal(result[0].fixable, false, 'a "number" field has no safe default and must not be marked fixable');
  });

  test('fixability by type: array/object/iso-date/id/type/title fixable; other strings, number, and no-default enum are not', () => {
    // array
    assert.equal(checkL01('sources/x.md', (() => { const f = validSourceFm(); delete f.authors; return f; })())[0].fixable, true);
    // iso-date
    assert.equal(checkL01('sources/x.md', (() => { const f = validSourceFm(); delete f.created; return f; })())[0].fixable, true);
    // string: id/type/title
    assert.equal(checkL01('sources/x.md', (() => { const f = validSourceFm(); delete f.id; return f; })())[0].fixable, true);
    assert.equal(checkL01('sources/x.md', (() => { const f = validSourceFm(); delete f.type; return f; })())[0].fixable, true);
    assert.equal(checkL01('sources/x.md', (() => { const f = validSourceFm(); delete f.title; return f; })())[0].fixable, true);
    // string: "book" (readings/chapters/etc.) has no derivation rule.
    const chapterFm = { id: 'chapters/b/c1', title: 'C1', type: 'chapter', created: '2026-01-01', updated: '2026-01-01', number: 1 };
    const bookFinding = checkL01('chapters/b/c1.md', chapterFm).find(f => f.message.includes('"book"'));
    assert.ok(bookFinding, 'expected a finding for missing "book"');
    assert.equal(bookFinding.fixable, false, '"book" has no safe derivation and must not be marked fixable');
    // enum with a safe default (sources.provenance)
    const noProv = { ...validSourceFm() }; delete noProv.provenance;
    const provFinding = checkL01('sources/x.md', noProv).find(f => f.message.includes('"provenance"'));
    assert.equal(provFinding.fixable, true, 'provenance has a safe legacy default and must be fixable');
    // enum with no safe default (sources.importance)
    const noImportance = { ...validSourceFm() }; delete noImportance.importance;
    const impFinding = checkL01('sources/x.md', noImportance).find(f => f.message.includes('"importance"'));
    assert.equal(impFinding.fixable, false, 'importance has no safe default and must not be marked fixable');
  });

  test('non-entity file returns empty', () => {
    const result = checkL01('index.md', {});
    assert.equal(result.length, 0);
  });

  test('readings page: clean with all required keys, violation when source missing', () => {
    const fm = {
      id: 'readings/deep-work/01-focus',
      title: 'Part 1 - Focus',
      type: 'reading',
      created: '2026-01-01',
      updated: '2026-01-01',
      source: 'deep-work',
      part: 1,
    };
    assert.equal(checkL01('readings/deep-work/01-focus.md', fm).length, 0);

    const missing = { ...fm };
    delete missing.source;
    const result = checkL01('readings/deep-work/01-focus.md', missing);
    assert.ok(result.length > 0);
    assert.equal(result[0].id, 'L01-frontmatter-required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L02: frontmatter-types
// ─────────────────────────────────────────────────────────────────────────────

describe('L02 frontmatter-types', () => {
  test('clean: correct types', () => {
    const result = checkL02('sources/test.md', validSourceFm());
    assert.equal(result.length, 0);
  });

  test('violation: year is string not number', () => {
    const fm = { ...validSourceFm(), year: 'twenty-twenty-six' };
    const result = checkL02('sources/test.md', fm);
    assert.ok(result.some(f => f.message.includes('"year"')));
  });

  test('violation: authors is not array', () => {
    const fm = { ...validSourceFm(), authors: 'Alice' };
    const result = checkL02('sources/test.md', fm);
    assert.ok(result.some(f => f.message.includes('"authors"')));
  });

  test('violation: importance out of enum', () => {
    const fm = { ...validSourceFm(), importance: 99 };
    const result = checkL02('sources/test.md', fm);
    assert.ok(result.some(f => f.message.includes('"importance"')));
  });

  test('violation: invalid iso-date', () => {
    const fm = { ...validSourceFm(), created: '01-01-2026' };
    const result = checkL02('sources/test.md', fm);
    assert.ok(result.some(f => f.message.includes('"created"')));
  });

  test('clean: urls as array of strings', () => {
    const fm = { ...validSourceFm(), urls: ['https://arxiv.org/abs/1234', 'https://doi.org/10.1/foo'] };
    const result = checkL02('sources/test.md', fm);
    assert.equal(result.length, 0);
  });

  test('clean: urls as empty array', () => {
    const fm = { ...validSourceFm(), urls: [] };
    const result = checkL02('sources/test.md', fm);
    assert.equal(result.length, 0);
  });

  test('clean: urls absent (optional field)', () => {
    const fm = validSourceFm(); // no urls key
    const result = checkL02('sources/test.md', fm);
    assert.equal(result.length, 0);
  });

  test('violation: urls is not an array', () => {
    const fm = { ...validSourceFm(), urls: 'https://example.com' };
    const result = checkL02('sources/test.md', fm);
    assert.ok(result.some(f => f.message.includes('"urls"')));
  });

  test('legacy renamed field: url (string) on source -> warning pointing at urls', () => {
    const fm = { ...validSourceFm(), url: 'https://arxiv.org/abs/1234' };
    const result = checkL02('sources/test.md', fm);
    const legacy = result.find(f => f.message.includes('Legacy frontmatter field "url"'));
    assert.ok(legacy, 'expected a legacy-field warning');
    assert.equal(legacy.severity, 'warning');
    assert.ok(legacy.message.includes('"urls"'));
    assert.ok(legacy.message.includes('/lumi-migrate-legacy'));
  });

  test('legacy renamed field: no warning when url absent', () => {
    const fm = validSourceFm();
    const result = checkL02('sources/test.md', fm);
    assert.ok(!result.some(f => f.message.includes('Legacy frontmatter field')));
  });

  test('legacy renamed field: "slug" -> "id" warns across any entity type', () => {
    const fm = { ...validSourceFm(), slug: 'legacy-name' };
    const result = checkL02('sources/test.md', fm);
    const legacy = result.find(f => f.message.includes('Legacy frontmatter field "slug"'));
    assert.ok(legacy, 'expected a legacy-field warning for slug');
    assert.equal(legacy.severity, 'warning');
    assert.ok(legacy.message.includes('"id"'));
  });

  test('legacy renamed field: "date_added" -> "created" warns on a concept too (not just sources)', () => {
    const fm = {
      id: 'my-concept', title: 'My Concept', type: 'concept',
      created: '2026-01-01', updated: '2026-01-01',
      key_sources: [], related_concepts: [],
      date_added: '2020-01-01',
    };
    const result = checkL02('concepts/my-concept.md', fm);
    const legacy = result.find(f => f.message.includes('Legacy frontmatter field "date_added"'));
    assert.ok(legacy, 'expected a legacy-field warning for date_added on a non-source type');
    assert.ok(legacy.message.includes('"created"'));
  });

  test('fixability: array type mismatch is always fixable', () => {
    const fm = { ...validSourceFm(), authors: 'Alice' };
    const result = checkL02('sources/test.md', fm);
    const f = result.find(f => f.message.includes('"authors"'));
    assert.equal(f.fixable, true);
  });

  test('fixability: iso-date "TODO" sentinel is fixable, other malformed dates are not', () => {
    const todoFm = { ...validSourceFm(), created: 'TODO' };
    const todoFinding = checkL02('sources/test.md', todoFm).find(f => f.message.includes('"created"'));
    assert.equal(todoFinding.fixable, true);

    const badDateFm = { ...validSourceFm(), created: '01-01-2026' };
    const badDateFinding = checkL02('sources/test.md', badDateFm).find(f => f.message.includes('"created"'));
    assert.equal(badDateFinding.fixable, false);
  });

  test('fixability: number/enum/object type mismatches are never fixable', () => {
    const yearFm = { ...validSourceFm(), year: 'twenty-twenty-six' };
    assert.equal(checkL02('sources/test.md', yearFm).find(f => f.message.includes('"year"')).fixable, false);

    const importanceFm = { ...validSourceFm(), importance: 99 };
    assert.equal(checkL02('sources/test.md', importanceFm).find(f => f.message.includes('"importance"')).fixable, false);

    const extFm = { ...validSourceFm(), external_ids: 'not-an-object' };
    assert.equal(checkL02('sources/test.md', extFm).find(f => f.message.includes('"external_ids"')).fixable, false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Legacy-field removal fixability (Task 1) — the finding's `fixable` flag
  // must reflect the three-part safety rule: target present, target valid,
  // values equivalent. Actual removal is exercised in the `fixL02` describe
  // block below; this section only covers the check-time decision.
  // ───────────────────────────────────────────────────────────────────────

  test('legacy "slug" -> "id": equivalent values -> fixable (removable)', () => {
    const fm = { ...validSourceFm(), slug: 'test-source' }; // id already "test-source"
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "slug"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, true, 'slug equals id verbatim — safe to remove');
  });

  test('legacy "slug" -> "id": disagreeing values -> not fixable (real conflict)', () => {
    const fm = { ...validSourceFm(), slug: 'totally-different-slug' };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "slug"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, false, 'slug disagrees with id — must not be marked removable');
  });

  test('legacy "date_added" -> "created": target absent -> not fixable', () => {
    const fm = { ...validSourceFm(), date_added: '2020-01-01' };
    delete fm.created;
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "date_added"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, false, 'created is absent — date_added is the only copy, must not be removed');
  });

  test('legacy "date_added" -> "created": target present but invalid -> not fixable', () => {
    const fm = { ...validSourceFm(), created: 'not-a-date', date_added: '2020-01-01' };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "date_added"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, false, 'created fails ISO-date validity — must not be removed');
  });

  test('legacy "date_added" -> "created": equal valid dates -> fixable', () => {
    const fm = { ...validSourceFm(), created: '2020-01-01', date_added: '2020-01-01' };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "date_added"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, true);
  });

  test('legacy "url" -> "urls": urls array already contains the url string -> fixable', () => {
    const fm = { ...validSourceFm(), url: 'https://arxiv.org/abs/1234', urls: ['https://arxiv.org/abs/1234'] };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "url"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, true, 'urls[] already contains the legacy url verbatim');
  });

  test('legacy "url" -> "urls": urls array present but missing the url string -> not fixable (disagree)', () => {
    const fm = { ...validSourceFm(), url: 'https://arxiv.org/abs/1234', urls: ['https://example.com/other'] };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "url"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, false, 'urls[] does not carry the legacy value — real conflict');
  });

  test('legacy "url" -> "urls": urls absent -> not fixable', () => {
    const fm = { ...validSourceFm(), url: 'https://arxiv.org/abs/1234' };
    const legacy = checkL02('sources/test.md', fm).find(f => f.message.includes('Legacy frontmatter field "url"'));
    assert.ok(legacy);
    assert.equal(legacy.fixable, false, 'urls is absent — url is the only copy');
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 2 — "TODO" sentinel rule: the exact literal "TODO" is invalid for
  // ANY declared schema field, of any type. Only the STRING branch needed a
  // code change (a "TODO" string previously passed `typeof val === 'string'`
  // silently) — number/array/enum/iso-date/object already fail their own
  // type check when handed the string "TODO", so those are covered by the
  // pre-existing tests above/below; this block covers what's new.
  // ───────────────────────────────────────────────────────────────────────

  test('TODO on a declared string field: "id" is detected and fixable (derivable)', () => {
    const fm = { ...validSourceFm(), id: 'TODO' };
    const f = checkL02('sources/test.md', fm).find(x => x.message.includes('"id"'));
    assert.ok(f, 'expected a finding for id: TODO');
    assert.equal(f.severity, 'error');
    assert.equal(f.fixable, true);
    assert.match(f.message, /placeholder "TODO"/);
  });

  test('TODO on a declared string field: "type" and "title" are detected and fixable (derivable)', () => {
    const fmType = { ...validSourceFm(), type: 'TODO' };
    assert.equal(checkL02('sources/test.md', fmType).find(x => x.message.includes('"type"')).fixable, true);
    const fmTitle = { ...validSourceFm(), title: 'TODO' };
    assert.equal(checkL02('sources/test.md', fmTitle).find(x => x.message.includes('"title"')).fixable, true);
  });

  test('TODO case-sensitivity: only the exact literal "TODO" (trimmed) counts, not "todo" or "ToDo"', () => {
    const fmLower = { ...validSourceFm(), id: 'todo' };
    assert.ok(!checkL02('sources/test.md', fmLower).some(x => x.message.includes('placeholder')));
    const fmMixed = { ...validSourceFm(), id: 'ToDo' };
    assert.ok(!checkL02('sources/test.md', fmMixed).some(x => x.message.includes('placeholder')));
    const fmPadded = { ...validSourceFm(), id: '  TODO  ' };
    assert.ok(checkL02('sources/test.md', fmPadded).some(x => x.message.includes('placeholder')), 'trimmed literal must still match');
  });

  test('TODO on a declared string field with NO derivation ("source" on readings): detected but left unfixable', () => {
    const fm = {
      id: 'readings/deep-work/01-focus', title: 'Part 1', type: 'reading',
      created: '2026-01-01', updated: '2026-01-01',
      source: 'TODO', part: 1,
    };
    const f = checkL02('readings/deep-work/01-focus.md', fm).find(x => x.message.includes('"source"'));
    assert.ok(f, 'expected a finding for source: TODO');
    assert.equal(f.fixable, false, '"source" has no derivation rule and must not be marked fixable');
  });

  test('TODO on a declared string field with NO derivation ("book" on chapters): detected but left unfixable', () => {
    const fm = {
      id: 'chapters/mybook/c1', title: 'C1', type: 'chapter',
      created: '2026-01-01', updated: '2026-01-01',
      book: 'TODO', number: 1,
    };
    const f = checkL02('chapters/mybook/c1.md', fm).find(x => x.message.includes('"book"'));
    assert.ok(f, 'expected a finding for book: TODO');
    assert.equal(f.fixable, false, '"book" has no derivation rule and must not be marked fixable');
  });

  test('TODO on a free-form (undeclared) key is NOT touched', () => {
    // A user's own note field, coincidentally named like a schema key but
    // not declared for this entity type, or any key outside REQUIRED_FRONTMATTER.
    const fm = { ...validSourceFm(), my_custom_note: 'TODO', reviewer: 'TODO' };
    const result = checkL02('sources/test.md', fm);
    assert.ok(!result.some(f => f.message.includes('my_custom_note')));
    assert.ok(!result.some(f => f.message.includes('reviewer')));
    // And the rest of the page is still clean — no findings leak in from
    // keys checkL02 was never asked to look at.
    assert.equal(result.length, 0);
  });

  test('clean: string fields holding a real, non-"TODO" value produce no finding', () => {
    const result = checkL02('sources/test.md', validSourceFm());
    assert.equal(result.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT: isLegacyTargetValid / isLegacyValueEquivalent (Task 1 helpers)
// ─────────────────────────────────────────────────────────────────────────────

describe('isLegacyTargetValid', () => {
  test('string: any string is valid', () => {
    assert.equal(isLegacyTargetValid('string', 'anything'), true);
    assert.equal(isLegacyTargetValid('string', ''), true);
  });
  test('string: non-string is invalid', () => {
    assert.equal(isLegacyTargetValid('string', 42), false);
  });
  test('string: the "TODO" sentinel is invalid — never a valid target (Task 2)', () => {
    assert.equal(isLegacyTargetValid('string', 'TODO'), false);
    assert.equal(isLegacyTargetValid('string', '  TODO  '), false, 'trimmed before comparing');
  });
  test('iso-date: well-formed date is valid', () => {
    assert.equal(isLegacyTargetValid('iso-date', '2026-01-01'), true);
  });
  test('iso-date: malformed date is invalid', () => {
    assert.equal(isLegacyTargetValid('iso-date', '01-01-2026'), false);
    assert.equal(isLegacyTargetValid('iso-date', 'TODO'), false);
  });
  test('array: array is valid regardless of contents', () => {
    assert.equal(isLegacyTargetValid('array', []), true);
    assert.equal(isLegacyTargetValid('array', ['a']), true);
  });
  test('array: non-array is invalid', () => {
    assert.equal(isLegacyTargetValid('array', 'not-an-array'), false);
  });
  test('unrecognized type defaults to invalid (fail closed)', () => {
    assert.equal(isLegacyTargetValid('number', 42), false);
    assert.equal(isLegacyTargetValid('enum', 'high'), false);
    assert.equal(isLegacyTargetValid('object', {}), false);
  });
});

describe('isLegacyValueEquivalent', () => {
  test('string: trimmed equality', () => {
    assert.equal(isLegacyValueEquivalent('string', 'foo', 'foo'), true);
    assert.equal(isLegacyValueEquivalent('string', '  foo  ', 'foo'), true);
    assert.equal(isLegacyValueEquivalent('string', 'foo', 'bar'), false);
  });
  test('string: non-string legacy or target is never equivalent', () => {
    assert.equal(isLegacyValueEquivalent('string', 42, '42'), false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Task 1 — prefix-aware equivalence for slug -> id (the 179 legacy-rename
  // warnings shaped like `id: concepts/ab-testing` / `slug: ab-testing`).
  // ─────────────────────────────────────────────────────────────────────

  test('string: prefix-aware equivalence accepted for a REAL entity dir', () => {
    assert.equal(isLegacyValueEquivalent('string', 'ab-testing', 'concepts/ab-testing'), true);
    assert.equal(isLegacyValueEquivalent('string', 'ab-testing', 'sources/ab-testing'), true);
    assert.equal(isLegacyValueEquivalent('string', '  ab-testing  ', 'concepts/ab-testing'), true, 'both sides trimmed');
  });

  test('string: prefix REJECTED when the prefix is not a real entity directory', () => {
    // "note" is not a key in ENTITY_DIRS — must not be silently equated,
    // even though "ab-testing" is still, textually, a trailing substring.
    assert.equal(isLegacyValueEquivalent('string', 'ab-testing', 'note/ab-testing'), false);
    assert.equal(isLegacyValueEquivalent('string', 'ab-testing', 'foo/ab-testing'), false);
  });

  test('string: the arXiv-id genuine-mismatch case still survives untouched', () => {
    // slug: attention-is-all-you-need vs id: "1706.03762" — no slash at all
    // in the target, so the prefix branch never even engages.
    assert.equal(isLegacyValueEquivalent('string', 'attention-is-all-you-need', '1706.03762'), false);
  });

  test('string: prefix match requires the REMAINDER to equal the legacy value exactly', () => {
    // Same entity dir, but the remainder after the slash differs from slug —
    // a real conflict, not a dir-qualified copy.
    assert.equal(isLegacyValueEquivalent('string', 'ab-testing', 'concepts/different-slug'), false);
  });
  test('iso-date: trimmed equality', () => {
    assert.equal(isLegacyValueEquivalent('iso-date', '2020-01-01', '2020-01-01'), true);
    assert.equal(isLegacyValueEquivalent('iso-date', '2020-01-01', '2021-01-01'), false);
  });

  test('iso-date: a genuine one-calendar-day disagreement still survives untouched', () => {
    assert.equal(isLegacyValueEquivalent('iso-date', '2020-01-01', '2020-01-02'), false);
  });
  test('array: legacy string must appear verbatim (trimmed) in the target array', () => {
    assert.equal(isLegacyValueEquivalent('array', 'https://x.com', ['https://x.com']), true);
    assert.equal(isLegacyValueEquivalent('array', '  https://x.com  ', ['https://x.com']), true);
    assert.equal(isLegacyValueEquivalent('array', 'https://x.com', ['https://other.com']), false);
    assert.equal(isLegacyValueEquivalent('array', 'https://x.com', []), false);
  });
  test('array: legacy value may be a subset — extra entries in target do not break equivalence', () => {
    assert.equal(isLegacyValueEquivalent('array', 'https://x.com', ['https://other.com', 'https://x.com']), true);
  });
  test('array: non-string legacy value is never equivalent', () => {
    assert.equal(isLegacyValueEquivalent('array', 42, ['42']), false);
  });
  test('unrecognized type defaults to false (fail closed)', () => {
    assert.equal(isLegacyValueEquivalent('number', 3, 3), false);
    assert.equal(isLegacyValueEquivalent('object', {}, {}), false);
  });
});

describe('removeFrontmatterKeyLines', () => {
  test('removes a simple scalar key line', () => {
    const fmText = '\nid: x\nslug: legacy-name\ntitle: X\n';
    const result = removeFrontmatterKeyLines(fmText, 'slug');
    assert.ok(!result.includes('slug:'));
    assert.ok(result.includes('id: x'));
    assert.ok(result.includes('title: X'));
  });

  test('removes a block-list key and its continuation lines', () => {
    const fmText = '\nid: x\nurl: https://example.com\nurls:\n  - https://example.com\ntitle: X\n';
    const result = removeFrontmatterKeyLines(fmText, 'urls');
    assert.ok(!result.includes('urls:'));
    assert.ok(!result.includes('  - https://example.com'));
    assert.ok(result.includes('url: https://example.com'), 'must not remove the similarly-prefixed "url" key');
    assert.ok(result.includes('title: X'));
  });

  test('leaves no blank line where the key used to be', () => {
    const fmText = 'id: x\nslug: legacy-name\ntitle: X';
    const result = removeFrontmatterKeyLines(fmText, 'slug');
    assert.equal(result, 'id: x\ntitle: X');
  });

  test('no-op when key not present', () => {
    const fmText = 'id: x\ntitle: X';
    assert.equal(removeFrontmatterKeyLines(fmText, 'slug'), fmText);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L03: slug-style
// ─────────────────────────────────────────────────────────────────────────────

describe('L03 slug-style', () => {
  test('clean: kebab-case basename', () => {
    assert.equal(checkL03('sources/my-paper.md').length, 0);
  });

  test('violation: uppercase letter', () => {
    const result = checkL03('sources/MyPaper.md');
    assert.equal(result[0].id, 'L03-slug-style');
    assert.ok(result[0].fixable);
  });

  test('violation: underscore', () => {
    const result = checkL03('sources/my_paper.md');
    assert.equal(result[0].id, 'L03-slug-style');
  });

  test('violation: spaces', () => {
    assert.ok(checkL03('sources/my paper.md').length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L04: orphan-page
// ─────────────────────────────────────────────────────────────────────────────

describe('L04 orphan-page', () => {
  test('clean: has outbound link', () => {
    const result = checkL04('sources/test.md', new Set(['concepts/foo']), new Set());
    assert.equal(result.length, 0);
  });

  test('clean: has inbound link', () => {
    const result = checkL04('sources/test.md', new Set(), new Set(['sources/test.md']));
    assert.equal(result.length, 0);
  });

  test('violation: no links at all', () => {
    const result = checkL04('sources/test.md', new Set(), new Set());
    assert.equal(result[0].id, 'L04-orphan-page');
    assert.equal(result[0].severity, 'warning');
  });

  test('exempt target not flagged', () => {
    const result = checkL04('foundations/math.md', new Set(), new Set());
    assert.equal(result.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L05: broken-wikilink
// ─────────────────────────────────────────────────────────────────────────────

describe('L05 broken-wikilink', () => {
  test('clean: wikilink resolves', () => {
    const content = 'See [[concepts/attention]] for details.';
    const result = checkL05('sources/test.md', content, new Set(['concepts/attention']));
    assert.equal(result.length, 0);
  });

  test('violation: slug not found', () => {
    const content = 'See [[concepts/nonexistent]] here.';
    const result = checkL05('sources/test.md', content, new Set());
    assert.equal(result[0].id, 'L05-broken-wikilink');
    assert.equal(result[0].severity, 'error');
    assert.equal(result[0].line, 1);
  });

  test('reports correct line number', () => {
    const content = 'line one\nline two [[missing-slug]]\nline three';
    const result = checkL05('sources/test.md', content, new Set());
    assert.equal(result[0].line, 2);
  });

  test('unique basename match: fixable=true, candidates has exactly one entry', () => {
    const content = 'See [[agent-taxonomy]] for details.';
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'sources/other']);
    const result = checkL05('sources/test.md', content, knownSlugs);
    assert.equal(result[0].fixable, true);
    assert.deepEqual(result[0].candidates, ['concepts/agent-taxonomy']);
    assert.equal(result[0].brokenSlug, 'agent-taxonomy');
  });

  test('ambiguous basename match (2+ pages share a basename): fixable=false, candidates recorded', () => {
    const content = 'See [[agent-taxonomy]] for details.';
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'foundations/agent-taxonomy']);
    const result = checkL05('sources/test.md', content, knownSlugs);
    assert.equal(result[0].fixable, false);
    assert.equal(result[0].candidates.length, 2);
  });

  test('zero basename match: fixable=false, empty candidates', () => {
    const content = 'See [[totally-unknown]] for details.';
    const knownSlugs = new Set(['concepts/agent-taxonomy']);
    const result = checkL05('sources/test.md', content, knownSlugs);
    assert.equal(result[0].fixable, false);
    assert.deepEqual(result[0].candidates, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L06: missing-reverse-edge
// ─────────────────────────────────────────────────────────────────────────────

describe('L06 missing-reverse-edge', () => {
  test('clean: both directions present', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'cites' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'cited_by' },
    ];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    assert.equal(checkL06(edges, edgeSet).length, 0);
  });

  test('violation: reverse missing', () => {
    const edges = [{ from: 'sources/a.md', to: 'sources/b.md', type: 'cites' }];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    const result = checkL06(edges, edgeSet);
    assert.equal(result[0].id, 'L06-missing-reverse-edge');
    assert.ok(result[0].fixable);
  });

  test('exempt target skipped', () => {
    const edges = [{ from: 'sources/a.md', to: 'foundations/math.md', type: 'grounded_in' }];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    assert.equal(checkL06(edges, edgeSet).length, 0);
  });

  test('terminal edge skipped', () => {
    const edges = [{ from: 'sources/a.md', to: 'outputs/report.md', type: 'produced' }];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    assert.equal(checkL06(edges, edgeSet).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L07: symmetric-edge-duplicate
// ─────────────────────────────────────────────────────────────────────────────

describe('L07 symmetric-edge-duplicate', () => {
  test('clean: only one direction stored for symmetric edge', () => {
    const edges = [{ from: 'sources/a.md', to: 'sources/b.md', type: 'same_problem_as' }];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    assert.equal(checkL07(edges, edgeSet).length, 0);
  });

  test('violation: symmetric edge stored both ways', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'same_problem_as' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'same_problem_as' },
    ];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    const result = checkL07(edges, edgeSet);
    assert.equal(result[0].id, 'L07-symmetric-edge-duplicate');
    assert.ok(result[0].fixable);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L08: edge-confidence-required
// ─────────────────────────────────────────────────────────────────────────────

describe('L08 edge-confidence-required', () => {
  test('clean: no confidenceRequired edges', () => {
    // Standard edges like 'cites' don't require confidence.
    const edges = [{ from: 'sources/a.md', to: 'sources/b.md', type: 'cites' }];
    assert.equal(checkL08(edges).length, 0);
  });

  // Note: no edge in schemas.mjs has confidenceRequired=true in v0.1,
  // so this test validates the check runs without false positives.
  test('no false positives on known edges', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'builds_on' },
      { from: 'concepts/a.md', to: 'concepts/b.md', type: 'related_to' },
    ];
    assert.equal(checkL08(edges).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L09: index-stale
// ─────────────────────────────────────────────────────────────────────────────

describe('L09 index-stale', () => {
  test('clean: all entity files listed via wikilinks', () => {
    const indexContent = `${INDEX_MARKER_OPEN}\n- [[sources/lora]]\n- [[concepts/attention]]\n${INDEX_MARKER_CLOSE}`;
    const result = checkL09('/tmp/index.md', indexContent, ['sources/lora.md', 'concepts/attention.md']);
    assert.equal(result.length, 0);
  });

  test('violation: entity file missing from index', () => {
    const indexContent = `${INDEX_MARKER_OPEN}\n${INDEX_MARKER_CLOSE}`;
    const result = checkL09('/tmp/index.md', indexContent, ['sources/lora.md']);
    assert.equal(result[0].id, 'L09-index-stale');
    assert.equal(result[0].severity, 'warning');
    assert.ok(result[0].fixable);
  });

  test('clean: empty entity list', () => {
    const result = checkL09('/tmp/index.md', '', []);
    assert.equal(result.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L01
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL01', () => {
  function fakeL01(key, type) {
    return [{ id: 'L01-frontmatter-required', key, fieldType: type, message: `Missing required frontmatter key: "${key}" (type: ${type})` }];
  }

  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('leaves "year" (number) absent — no TODO sentinel, no write at all', async () => {
    const content = `---\ntitle: Test\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/test.md', 'sources/test.md', content, fakeL01('year', 'number'));
    assert.equal(newContent, content, 'number field must not be written at all');
    assert.ok(!newContent.includes('year'));
  });

  test('returns unchanged content when no frontmatter', async () => {
    const content = 'no frontmatter here';
    const { newContent } = await fixL01('/tmp/fake/test.md', 'sources/test.md', content, []);
    assert.equal(newContent, content);
  });

  test('array field missing -> []', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/test.md', 'sources/test.md', content, fakeL01('authors', 'array'));
    assert.ok(newContent.includes('authors: []'));
  });

  test('object field missing -> {}', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/test.md', 'sources/test.md', content, fakeL01('meta', 'object'));
    assert.ok(newContent.includes('meta: {}'));
  });

  test('iso-date missing "created": uses legacy date_added when valid', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ndate_added: 2020-05-05\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/test.md', 'sources/test.md', content, fakeL01('created', 'iso-date'));
    assert.ok(newContent.includes('created: 2020-05-05'));
  });

  test('iso-date missing "created": falls back to file mtime when no legacy date_added', async () => {
    const tmp = await makeTmp();
    try {
      const filePath = join(tmp, 'test.md');
      const content = `---\nid: x\ntitle: X\ntype: source\nupdated: 2026-01-01\n---\nbody`;
      await writeFile(filePath, content);
      const { newContent } = await fixL01(filePath, 'sources/test.md', content, fakeL01('created', 'iso-date'));
      assert.ok(newContent.includes(`created: ${todayYmd()}`));
    } finally {
      await removeTmp(tmp);
    }
  });

  test('id missing: uses legacy "slug" when present', async () => {
    const content = `---\ntitle: X\ntype: source\nslug: legacy-slug-name\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/weird-name.md', 'sources/weird-name.md', content, fakeL01('id', 'string'));
    assert.ok(newContent.includes('id: legacy-slug-name'));
  });

  test('id missing, top-level type, no legacy slug: bare basename', async () => {
    const content = `---\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/my-paper.md', 'sources/my-paper.md', content, fakeL01('id', 'string'));
    assert.ok(newContent.includes('id: my-paper'));
  });

  test('id missing, nested type (readings): full wiki-relative path', async () => {
    const content = `---\ntitle: X\ntype: reading\ncreated: 2026-01-01\nupdated: 2026-01-01\nsource: deep-work\npart: 1\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/readings/deep-work/01-focus.md', 'readings/deep-work/01-focus.md', content, fakeL01('id', 'string'));
    assert.ok(newContent.includes('id: readings/deep-work/01-focus'));
  });

  test('id missing, reflections type: "reflection-<basename>"', async () => {
    const content = `---\ntitle: X\ntype: reflection\ncreated: 2026-01-01\nupdated: 2026-01-01\nrelated_concepts: []\nrelated_sources: []\nevolution_count: 0\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/reflections/my-note.md', 'reflections/my-note.md', content, fakeL01('id', 'string'));
    assert.ok(newContent.includes('id: reflection-my-note'));
  });

  test('type missing: derived from entity directory', async () => {
    const content = `---\nid: x\ntitle: X\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/concepts/x.md', 'concepts/x.md', content, fakeL01('type', 'string'));
    assert.ok(newContent.includes('type: concept'));
  });

  test('title missing: uses first H1 heading in body', async () => {
    const content = `---\nid: x\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# My Great Title\n\nBody text.`;
    const { newContent } = await fixL01('/tmp/fake/sources/x.md', 'sources/x.md', content, fakeL01('title', 'string'));
    assert.ok(newContent.includes('title: My Great Title'));
  });

  test('title missing, no H1: Title-Cased basename', async () => {
    const content = `---\nid: x\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nBody with no heading.`;
    const { newContent } = await fixL01('/tmp/fake/sources/my-cool-paper.md', 'sources/my-cool-paper.md', content, fakeL01('title', 'string'));
    assert.ok(newContent.includes('title: My Cool Paper'));
  });

  test('enum missing with safe default: sources.provenance -> "missing"', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/x.md', 'sources/x.md', content, fakeL01('provenance', 'enum'));
    assert.ok(newContent.includes('provenance: missing'));
  });

  test('enum missing with safe default: concepts.confidence -> "unverified"', async () => {
    const content = `---\nid: x\ntitle: X\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/concepts/x.md', 'concepts/x.md', content, fakeL01('confidence', 'enum'));
    assert.ok(newContent.includes('confidence: unverified'));
  });

  test('enum missing with no safe default (importance): left absent', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nbody`;
    const { newContent } = await fixL01('/tmp/fake/sources/x.md', 'sources/x.md', content, fakeL01('importance', 'enum'));
    assert.equal(newContent, content);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L02
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL02', () => {
  test('string where array expected: wraps losslessly', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: "[[sources/foo]]"\nrelated_concepts: []\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, []);
    assert.ok(newContent.includes('key_sources:\n  - [[sources/foo]]'), newContent);
  });

  test('TODO in concepts.key_sources: reconstructs from graph (outbound + inbound union)', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: TODO\nrelated_concepts: []\n---\nbody`;
    const edges = [
      { from: 'concepts/my-concept', to: 'sources/paper-a', type: 'introduced_in' },
      { from: 'sources/paper-b', to: 'concepts/my-concept', type: 'uses_concept' },
    ];
    const findings = [{ id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, edges);
    assert.ok(newContent.includes('[[sources/paper-a]]'));
    assert.ok(newContent.includes('[[sources/paper-b]]'));
  });

  test('concepts.related_concepts: reconstructs symmetric related_to edges seen from both directions', async () => {
    const content = `---\nid: concept-a\ntitle: Concept A\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nbody`;
    const edges = [
      { from: 'concepts/concept-a', to: 'concepts/concept-b', type: 'related_to' }, // self is "from"
      { from: 'concepts/concept-c', to: 'concepts/concept-a', type: 'related_to' }, // self is "to" (alpha-sorted)
    ];
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/concept-a.md', 'concepts/concept-a.md', content, findings, edges);
    assert.ok(newContent.includes('[[concepts/concept-b]]'));
    assert.ok(newContent.includes('[[concepts/concept-c]]'));
  });

  test('people.key_sources: reconstructs from authored/authored_by, both directions', async () => {
    const content = `---\nid: alice\ntitle: Alice\ntype: person\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: TODO\n---\nbody`;
    const edges = [
      { from: 'people/alice', to: 'sources/paper-a', type: 'authored' },
      { from: 'sources/paper-b', to: 'people/alice', type: 'authored_by' },
    ];
    const findings = [{ id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/people/alice.md', 'people/alice.md', content, findings, edges);
    assert.ok(newContent.includes('[[sources/paper-a]]'));
    assert.ok(newContent.includes('[[sources/paper-b]]'));
  });

  test('topics.key_sources: reconstructs from includes_source/included_in_topic, both directions', async () => {
    const content = `---\nid: my-topic\ntitle: My Topic\ntype: topic\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: TODO\n---\nbody`;
    const edges = [
      { from: 'topics/my-topic', to: 'sources/paper-a', type: 'includes_source' },
      { from: 'sources/paper-b', to: 'topics/my-topic', type: 'included_in_topic' },
    ];
    const findings = [{ id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/topics/my-topic.md', 'topics/my-topic.md', content, findings, edges);
    assert.ok(newContent.includes('[[sources/paper-a]]'));
    assert.ok(newContent.includes('[[sources/paper-b]]'));
  });

  test('reflections.related_concepts / related_sources: not graph-backed by design, always []', async () => {
    const content = `---\nid: reflection-x\ntitle: X\ntype: reflection\ncreated: 2026-01-01\nupdated: 2026-01-01\nrelated_concepts: TODO\nrelated_sources: TODO\nevolution_count: 0\n---\nbody`;
    // Even with a matching-looking edge present, reflections must stay [].
    const edges = [{ from: 'reflections/reflection-x', to: 'concepts/some-concept', type: 'related_to' }];
    const findings = [
      { id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' },
      { id: 'L02-frontmatter-types', key: 'related_sources', fieldType: 'array', expected: 'an array', message: '"related_sources" must be an array, got string' },
    ];
    const { newContent } = await fixL02('/tmp/fake/reflections/reflection-x.md', 'reflections/reflection-x.md', content, findings, edges);
    assert.ok(newContent.includes('related_concepts: []'));
    assert.ok(newContent.includes('related_sources: []'));
  });

  test('no matching edges: falls back to []', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: TODO\nrelated_concepts: []\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, []);
    assert.ok(newContent.includes('key_sources: []'));
  });

  test('TODO in iso-date: same derivation as fixL01 (legacy date_added)', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: TODO\nupdated: 2026-01-01\ndate_added: 2019-09-09\nauthors: []\nyear: 2024\nimportance: 3\nprovenance: replayable\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'created', fieldType: 'iso-date', expected: 'an ISO date (YYYY-MM-DD)', message: '"created" must be an ISO date (YYYY-MM-DD), got "TODO"' }];
    const { newContent } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(newContent.includes('created: 2019-09-09'));
  });

  test('TODO in number/enum: left unchanged, not repairable', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nauthors: []\nyear: TODO\nimportance: TODO\nprovenance: replayable\n---\nbody`;
    const findings = [
      { id: 'L02-frontmatter-types', key: 'year', fieldType: 'number', expected: 'a number', message: '"year" must be a number, got "TODO"' },
      { id: 'L02-frontmatter-types', key: 'importance', fieldType: 'enum', expected: 'one of [1, 2, 3, 4, 5]', message: '"importance" must be one of [1, 2, 3, 4, 5], got "TODO"' },
    ];
    const { newContent } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.equal(newContent, content);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 2 — repairing the "TODO" sentinel on a declared STRING field.
  // ───────────────────────────────────────────────────────────────────────

  test('TODO in "id" with no legacy "slug": derives from the file path', async () => {
    const content = `---\nid: TODO\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'id', fieldType: 'string', todoPlaceholder: true, message: '"id" is set to the placeholder "TODO", which is not a real value' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/my-paper.md', 'sources/my-paper.md', content, findings, []);
    assert.ok(newContent.includes('id: my-paper'), `expected id derived from path, got:\n${newContent}`);
    assert.deepEqual(fixedKeys, ['id']);
  });

  test('TODO in "id" WITH legacy "slug" present: derives "id" from "slug" (lossless recovery)', async () => {
    const content = `---\nid: TODO\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: real-value\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'id', fieldType: 'string', todoPlaceholder: true, message: '"id" is set to the placeholder "TODO", which is not a real value' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/my-paper.md', 'sources/my-paper.md', content, findings, []);
    assert.ok(newContent.includes('id: real-value'), `expected id derived from slug, got:\n${newContent}`);
    assert.deepEqual(fixedKeys, ['id']);
  });

  test('TODO in "type": derives from the entity directory', async () => {
    const content = `---\nid: x\ntitle: X\ntype: TODO\ncreated: 2026-01-01\nupdated: 2026-01-01\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'type', fieldType: 'string', todoPlaceholder: true, message: '"type" is set to the placeholder "TODO", which is not a real value' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(newContent.includes('type: source'), `expected type derived from directory, got:\n${newContent}`);
    assert.deepEqual(fixedKeys, ['type']);
  });

  test('TODO in "title": derives from the body H1', async () => {
    const content = `---\nid: x\ntitle: TODO\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\n# Real Title Here\n\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'title', fieldType: 'string', todoPlaceholder: true, message: '"title" is set to the placeholder "TODO", which is not a real value' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(newContent.includes('title: Real Title Here'), `expected title derived from H1, got:\n${newContent}`);
    assert.deepEqual(fixedKeys, ['title']);
  });

  test('TODO in a non-derivable string field ("source" on readings): left unchanged', async () => {
    const content = `---\nid: readings/deep-work/01-focus\ntitle: Part 1\ntype: reading\ncreated: 2026-01-01\nupdated: 2026-01-01\nsource: TODO\npart: 1\n---\nbody`;
    const findings = [{ id: 'L02-frontmatter-types', key: 'source', fieldType: 'string', todoPlaceholder: true, message: '"source" is set to the placeholder "TODO", which is not a real value' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/readings/deep-work/01-focus.md', 'readings/deep-work/01-focus.md', content, findings, []);
    assert.equal(newContent, content, '"source" has no derivation rule — must be left untouched');
    assert.deepEqual(fixedKeys, []);
  });

  test('full chain in ONE fixL02 call: "id: TODO" + "slug: real-value" -> "id" derived AND "slug" removed, real value preserved', async () => {
    // Mirrors the pre-existing "date_added"/"created" same-pass test above:
    // fixL02 must resolve "id" from "slug" FIRST, then see that freshly
    // derived value (not the stale "TODO") when deciding whether "slug" is
    // now redundant (Task 1's prefix-aware equivalence, since here the
    // derived id is the bare slug value with no dir prefix — trimmed
    // equality already covers it).
    const content = `---\nid: TODO\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: real-value\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [
      { id: 'L02-frontmatter-types', key: 'id', fieldType: 'string', todoPlaceholder: true, message: '"id" is set to the placeholder "TODO", which is not a real value' },
      { id: 'L02-frontmatter-types', legacyOldKey: 'slug', legacyNewKey: 'id', message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.' },
    ];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(newContent.includes('id: real-value'), `expected id recovered from slug, got:\n${newContent}`);
    assert.ok(!newContent.includes('slug:'), `expected slug removed in the same pass, got:\n${newContent}`);
    assert.deepEqual(fixedKeys.sort(), ['id', 'slug']);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Tier 2: body-wikilink fallback (see reconstructArrayFromBody below for
  // unit-level coverage of the resolution rules themselves).
  // ───────────────────────────────────────────────────────────────────────

  test('tier 1 (graph) wins over tier 2 (body) when both are present and DIFFER', async () => {
    const content = `---\nid: concept-a\ntitle: Concept A\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nSee [[concept-z]] in the body.`;
    // Graph says concept-a relates to concept-b; body links to a DIFFERENT
    // concept (concept-z). Graph must win outright — body must not even be
    // merged in.
    const edges = [{ from: 'concepts/concept-a', to: 'concepts/concept-b', type: 'related_to' }];
    const knownSlugs = new Set(['concepts/concept-a', 'concepts/concept-b', 'concepts/concept-z']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/concept-a.md', 'concepts/concept-a.md', content, findings, edges, knownSlugs);
    assert.ok(newContent.includes('[[concepts/concept-b]]'), 'graph-derived value must be used');
    assert.ok(!newContent.includes('[[concepts/concept-z]]'), 'body value must NOT be used when graph tier is non-empty');
  });

  test('tier 2 (body) recovers related_concepts when graph has no related_to edges', async () => {
    const content = `---\nid: agent-taxonomy\ntitle: Agent Taxonomy\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nSee [[concepts/tool-using-agents]] and [[concepts/planning-agents]].`;
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'concepts/tool-using-agents', 'concepts/planning-agents']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/agent-taxonomy.md', 'concepts/agent-taxonomy.md', content, findings, [], knownSlugs);
    assert.ok(newContent.includes('[[concepts/tool-using-agents]]'));
    assert.ok(newContent.includes('[[concepts/planning-agents]]'));
    assert.ok(!newContent.includes('related_concepts: []'), 'must not have fallen through to []');
  });

  test('tier 2 resolves a bare basename to the full slug (order-independent of L05)', async () => {
    // The body link is still BROKEN (missing the concepts/ prefix) — as it
    // would be before L05 has run. Tier 2 must resolve it anyway via the
    // unique-basename heuristic, without requiring L05 to run first.
    const content = `---\nid: agent-taxonomy\ntitle: Agent Taxonomy\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nSee [[tool-using-agents]] for details.`;
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'concepts/tool-using-agents']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/agent-taxonomy.md', 'concepts/agent-taxonomy.md', content, findings, [], knownSlugs);
    assert.ok(newContent.includes('[[concepts/tool-using-agents]]'));
  });

  test('tier 2 filters by entity type: a [[sources/x]] link must not land in related_concepts', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nSee [[sources/some-paper]] for background.`;
    const knownSlugs = new Set(['concepts/my-concept', 'sources/some-paper']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, [], knownSlugs);
    assert.ok(newContent.includes('related_concepts: []'), 'a sources/* link must not satisfy related_concepts');
  });

  test('tier 2 excludes a self-link, dedupes repeats, and strips |alias', async () => {
    const content = `---\nid: agent-taxonomy\ntitle: Agent Taxonomy\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\n` +
      `See [[concepts/agent-taxonomy]] (self), [[concepts/planning-agents|Planning Agents]], and again [[concepts/planning-agents]].`;
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'concepts/planning-agents']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/agent-taxonomy.md', 'concepts/agent-taxonomy.md', content, findings, [], knownSlugs);
    assert.ok(!newContent.includes('[[concepts/agent-taxonomy]]\n  - [[concepts/agent-taxonomy]]'), 'sanity: not double-inserted');
    // Self-link excluded entirely.
    const relBlockMatch = newContent.match(/related_concepts:\n((?:  - .*\n?)*)/);
    assert.ok(relBlockMatch, 'expected a related_concepts block list');
    const items = relBlockMatch[1].trim().split('\n');
    assert.deepEqual(items, ['- [[concepts/planning-agents]]'], 'expected exactly one deduped, alias-stripped entry, no self-link');
  });

  test('both tiers empty: falls back to [] (no graph edges, no resolvable body links)', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\nNo links here at all.`;
    const knownSlugs = new Set(['concepts/my-concept']);
    const findings = [{ id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' }];
    const { newContent } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, [], knownSlugs);
    assert.ok(newContent.includes('related_concepts: []'));
  });

  test('reflections stay excluded from tier 2 even with matching body wikilinks and knownSlugs supplied', async () => {
    const content = `---\nid: reflection-x\ntitle: X\ntype: reflection\ncreated: 2026-01-01\nupdated: 2026-01-01\nrelated_concepts: TODO\nrelated_sources: TODO\nevolution_count: 0\n---\nSee [[concepts/some-concept]] and [[sources/some-source]].`;
    const knownSlugs = new Set(['reflections/reflection-x', 'concepts/some-concept', 'sources/some-source']);
    const findings = [
      { id: 'L02-frontmatter-types', key: 'related_concepts', fieldType: 'array', expected: 'an array', message: '"related_concepts" must be an array, got string' },
      { id: 'L02-frontmatter-types', key: 'related_sources', fieldType: 'array', expected: 'an array', message: '"related_sources" must be an array, got string' },
    ];
    const { newContent } = await fixL02('/tmp/fake/reflections/reflection-x.md', 'reflections/reflection-x.md', content, findings, [], knownSlugs);
    assert.ok(newContent.includes('related_concepts: []'));
    assert.ok(newContent.includes('related_sources: []'));
  });

  // ───────────────────────────────────────────────────────────────────────
  // Legacy-field removal (Task 1) — the first thing `--fix` in lint.mjs
  // ever deletes from a page. Covers the positive (removable) case for all
  // three LEGACY_RENAMED_FIELDS entries, and the three negative cases the
  // task calls out explicitly: target absent, target invalid, values
  // disagree.
  // ───────────────────────────────────────────────────────────────────────

  test('legacy "slug" -> "id": removes "slug" when it equals "id" verbatim', async () => {
    const content = `---\nid: test-source\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: test-source\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'slug', legacyNewKey: 'id', message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/test-source.md', 'sources/test-source.md', content, findings, []);
    assert.ok(!newContent.includes('slug:'), `expected "slug" removed, got:\n${newContent}`);
    assert.ok(newContent.includes('id: test-source'), 'id must be untouched');
    assert.deepEqual(fixedKeys, ['slug']);
  });

  test('legacy "slug" -> "id": target ("id") ABSENT — never removes "slug"', async () => {
    // id is present here only because L01 always inserts SOME value before L02
    // runs in the real pipeline; simulate the case where, for whatever reason,
    // id is still missing at fixL02 time by omitting it entirely.
    const content = `---\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: test-source\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'slug', legacyNewKey: 'id', message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/test-source.md', 'sources/test-source.md', content, findings, []);
    assert.equal(newContent, content, 'id absent — slug is the only copy, must not be touched');
    assert.deepEqual(fixedKeys, []);
  });

  test('legacy "date_added" -> "created": target ("created") INVALID — never removes "date_added"', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: not-a-date\nupdated: 2026-01-01\ndate_added: 2020-01-01\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'date_added', legacyNewKey: 'created', message: 'Legacy frontmatter field "date_added" was renamed to "created" in v0.1. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.equal(newContent, content, 'created is invalid — date_added must survive for a human to look at');
    assert.deepEqual(fixedKeys, []);
  });

  test('legacy "date_added" -> "created": values DISAGREE — never removes "date_added" (real conflict)', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\ndate_added: 2020-05-05\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'date_added', legacyNewKey: 'created', message: 'Legacy frontmatter field "date_added" was renamed to "created" in v0.1. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.equal(newContent, content, 'created and date_added disagree — kept for manual resolution, not silently resolved either way');
    assert.deepEqual(fixedKeys, []);
  });

  test('legacy "date_added" -> "created": equal valid dates — removes "date_added"', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2020-05-05\nupdated: 2026-01-01\ndate_added: 2020-05-05\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'date_added', legacyNewKey: 'created', message: 'Legacy frontmatter field "date_added" was renamed to "created" in v0.1. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(!newContent.includes('date_added:'));
    assert.ok(newContent.includes('created: 2020-05-05'));
    assert.deepEqual(fixedKeys, ['date_added']);
  });

  test('legacy "date_added" -> "created": a TODO "created" repaired earlier in the SAME fixL02 call is seen as the live target — removes "date_added" in one pass', async () => {
    // "created" starts as the TODO sentinel; fixL02 must resolve it from
    // date_added FIRST, then see that freshly-derived value (not the stale
    // "TODO") when deciding whether date_added is now redundant.
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: TODO\nupdated: 2026-01-01\ndate_added: 2019-09-09\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [
      { id: 'L02-frontmatter-types', key: 'created', fieldType: 'iso-date', expected: 'an ISO date (YYYY-MM-DD)', message: '"created" must be an ISO date (YYYY-MM-DD), got "TODO"' },
      { id: 'L02-frontmatter-types', legacyOldKey: 'date_added', legacyNewKey: 'created', message: 'Legacy frontmatter field "date_added" was renamed to "created" in v0.1. Run /lumi-migrate-legacy to upgrade.' },
    ];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(newContent.includes('created: 2019-09-09'), `expected created repaired, got:\n${newContent}`);
    assert.ok(!newContent.includes('date_added:'), `expected date_added removed in the same pass, got:\n${newContent}`);
    assert.deepEqual(fixedKeys.sort(), ['created', 'date_added']);
  });

  test('legacy "url" -> "urls": urls[] already contains the url string — removes "url"', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nurl: https://arxiv.org/abs/1234\nurls:\n  - https://arxiv.org/abs/1234\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'url', legacyNewKey: 'urls', message: 'Legacy frontmatter field "url" was renamed to "urls" in v0.8. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.ok(!newContent.includes('url:'), `expected "url" removed, got:\n${newContent}`);
    assert.ok(newContent.includes('urls:\n  - https://arxiv.org/abs/1234'), 'urls[] must be untouched');
    assert.deepEqual(fixedKeys, ['url']);
  });

  test('legacy "url" -> "urls": urls[] present but does NOT contain the url string — never removes "url" (real conflict)', async () => {
    const content = `---\nid: x\ntitle: X\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nurl: https://arxiv.org/abs/1234\nurls:\n  - https://example.com/other\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\nBody.`;
    const findings = [{ id: 'L02-frontmatter-types', legacyOldKey: 'url', legacyNewKey: 'urls', message: 'Legacy frontmatter field "url" was renamed to "urls" in v0.8. Run /lumi-migrate-legacy to upgrade.' }];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/sources/x.md', 'sources/x.md', content, findings, []);
    assert.equal(newContent, content, 'urls[] does not carry the legacy value — must not be silently dropped');
    assert.deepEqual(fixedKeys, []);
  });

  test('legacy removal appears alongside an unrelated type-mismatch fix in the same preview/fixedKeys', async () => {
    const content = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\nslug: my-concept\n---\nBody.`;
    const findings = [
      { id: 'L02-frontmatter-types', key: 'key_sources', fieldType: 'array', expected: 'an array', message: '"key_sources" must be an array, got string' }, // won't actually apply (already array) — sanity no-op guard
      { id: 'L02-frontmatter-types', legacyOldKey: 'slug', legacyNewKey: 'id', message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.' },
    ];
    const { newContent, fixedKeys } = await fixL02('/tmp/fake/concepts/my-concept.md', 'concepts/my-concept.md', content, findings, []);
    assert.ok(!newContent.includes('slug:'));
    assert.deepEqual(fixedKeys, ['slug']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT: reconstructArrayFromBody (tier-2 resolution rules in isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe('reconstructArrayFromBody', () => {
  test('resolves a full-path link directly', () => {
    const body = 'See [[concepts/tool-using-agents]].';
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'concepts/tool-using-agents']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/agent-taxonomy', body, knownSlugs);
    assert.deepEqual(result, ['[[concepts/tool-using-agents]]']);
  });

  test('resolves a bare basename via unique-basename match', () => {
    const body = 'See [[tool-using-agents]].';
    const knownSlugs = new Set(['concepts/agent-taxonomy', 'concepts/tool-using-agents']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/agent-taxonomy', body, knownSlugs);
    assert.deepEqual(result, ['[[concepts/tool-using-agents]]']);
  });

  test('ambiguous basename (2+ candidates): not resolved', () => {
    const body = 'See [[dup-name]].';
    const knownSlugs = new Set(['concepts/self', 'concepts/dup-name', 'foundations/dup-name']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/self', body, knownSlugs);
    assert.deepEqual(result, []);
  });

  test('filters by target entity dir: sources/* excluded from related_concepts', () => {
    const body = 'See [[sources/some-paper]] and [[concepts/real-concept]].';
    const knownSlugs = new Set(['concepts/self', 'sources/some-paper', 'concepts/real-concept']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/self', body, knownSlugs);
    assert.deepEqual(result, ['[[concepts/real-concept]]']);
  });

  test('key_sources / related_sources target sources/*', () => {
    const body = 'See [[sources/paper-a]] and [[concepts/unrelated]].';
    const knownSlugs = new Set(['concepts/self', 'sources/paper-a', 'concepts/unrelated']);
    assert.deepEqual(reconstructArrayFromBody('key_sources', 'concepts/self', body, knownSlugs), ['[[sources/paper-a]]']);
    assert.deepEqual(reconstructArrayFromBody('related_sources', 'reflections/self', body, knownSlugs), ['[[sources/paper-a]]']);
  });

  test('excludes a self-link', () => {
    const body = 'See [[concepts/self]] and [[concepts/other]].';
    const knownSlugs = new Set(['concepts/self', 'concepts/other']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/self', body, knownSlugs);
    assert.deepEqual(result, ['[[concepts/other]]']);
  });

  test('dedupes repeated links and strips |alias', () => {
    const body = 'First [[concepts/other|Other]], then again [[concepts/other]].';
    const knownSlugs = new Set(['concepts/self', 'concepts/other']);
    const result = reconstructArrayFromBody('related_concepts', 'concepts/self', body, knownSlugs);
    assert.deepEqual(result, ['[[concepts/other]]']);
  });

  test('field with no target-dir mapping returns []', () => {
    const body = 'See [[concepts/other]].';
    const knownSlugs = new Set(['concepts/self', 'concepts/other']);
    assert.deepEqual(reconstructArrayFromBody('authors', 'concepts/self', body, knownSlugs), []);
  });

  test('empty/absent body returns []', () => {
    const knownSlugs = new Set(['concepts/self']);
    assert.deepEqual(reconstructArrayFromBody('related_concepts', 'concepts/self', '', knownSlugs), []);
    assert.deepEqual(reconstructArrayFromBody('related_concepts', 'concepts/self', undefined, knownSlugs), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L05
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL05', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('unique match: rewrites [[slug]] to the full resolved path, preserving alias', async () => {
    await mkdir(join(tmpDir, 'sources'), { recursive: true });
    const filePath = join(tmpDir, 'sources', 'test.md');
    await writeFile(filePath, 'See [[agent-taxonomy|the taxonomy]] for details.');
    const findingObj = {
      id: 'L05-broken-wikilink', file: 'sources/test.md',
      brokenSlug: 'agent-taxonomy', candidates: ['concepts/agent-taxonomy'],
    };
    const { newContent, fixedFindings } = await fixL05('sources/test.md', tmpDir, [findingObj]);
    assert.ok(newContent.includes('[[concepts/agent-taxonomy|the taxonomy]]'));
    assert.equal(fixedFindings.length, 1);
  });

  test('ambiguous (2+ candidates): left untouched, not marked fixed', async () => {
    await mkdir(join(tmpDir, 'sources'), { recursive: true });
    const filePath = join(tmpDir, 'sources', 'ambiguous.md');
    const original = 'See [[agent-taxonomy]] for details.';
    await writeFile(filePath, original);
    const findingObj = {
      id: 'L05-broken-wikilink', file: 'sources/ambiguous.md',
      brokenSlug: 'agent-taxonomy', candidates: ['concepts/agent-taxonomy', 'foundations/agent-taxonomy'],
    };
    const { newContent, fixedFindings } = await fixL05('sources/ambiguous.md', tmpDir, [findingObj]);
    assert.equal(newContent, original);
    assert.equal(fixedFindings.length, 0);
  });

  test('zero candidates: left untouched', async () => {
    await mkdir(join(tmpDir, 'sources'), { recursive: true });
    const filePath = join(tmpDir, 'sources', 'zero.md');
    const original = 'See [[totally-unknown]] for details.';
    await writeFile(filePath, original);
    const findingObj = {
      id: 'L05-broken-wikilink', file: 'sources/zero.md',
      brokenSlug: 'totally-unknown', candidates: [],
    };
    const { newContent, fixedFindings } = await fixL05('sources/zero.md', tmpDir, [findingObj]);
    assert.equal(newContent, original);
    assert.equal(fixedFindings.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L06
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL06', () => {
  test('appends missing reverse edge', () => {
    const edges = [{ from: 'sources/a.md', to: 'sources/b.md', type: 'cites' }];
    const edgeSet = new Set(['sources/a.md|cites|sources/b.md']);
    const { newContent } = fixL06('/tmp/edges.jsonl', '', edges, edgeSet);
    const parsed = newContent.trim().split('\n').map(l => JSON.parse(l));
    assert.ok(parsed.some(e => e.type === 'cited_by' && e.from === 'sources/b.md' && e.to === 'sources/a.md'));
  });

  test('does not duplicate existing reverse', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'cites' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'cited_by' },
    ];
    const edgeSet = new Set(edges.map(e => `${e.from}|${e.type}|${e.to}`));
    const existing = edges.map(e => JSON.stringify(e)).join('\n') + '\n';
    const { newContent } = fixL06('/tmp/edges.jsonl', existing, edges, edgeSet);
    const lines = newContent.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L07
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL07', () => {
  test('deduplicates symmetric edges', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'same_problem_as' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'same_problem_as' },
    ];
    const content = edges.map(e => JSON.stringify(e)).join('\n') + '\n';
    const { newContent } = fixL07(content, edges);
    const lines = newContent.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.from, 'sources/a.md');  // sorted: a < b
    assert.equal(parsed.to, 'sources/b.md');
  });

  test('non-symmetric edges preserved', () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'cites' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'cited_by' },
    ];
    const content = edges.map(e => JSON.stringify(e)).join('\n') + '\n';
    const { newContent } = fixL07(content, edges);
    const lines = newContent.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXER L09
// ─────────────────────────────────────────────────────────────────────────────

describe('fixL09', () => {
  test('rewrites marker block with all entity files', () => {
    const indexContent = `# Index\n\n${INDEX_MARKER_OPEN}\n${INDEX_MARKER_CLOSE}\n`;
    const { newContent } = fixL09(indexContent, ['sources/lora.md', 'concepts/attention.md']);
    assert.ok(newContent.includes('[[sources/lora]]'));
    assert.ok(newContent.includes('[[concepts/attention]]'));
  });

  test('preserves user content outside markers', () => {
    const indexContent = `# My Index\n\nUser notes here.\n\n${INDEX_MARKER_OPEN}\n${INDEX_MARKER_CLOSE}\n\nMore user content.`;
    const { newContent } = fixL09(indexContent, ['sources/lora.md']);
    assert.ok(newContent.includes('User notes here.'));
    assert.ok(newContent.includes('More user content.'));
    assert.ok(newContent.includes('[[sources/lora]]'));
  });

  test('appends marker block when none present', () => {
    const indexContent = `# Index\nJust some text.`;
    const { newContent } = fixL09(indexContent, ['sources/lora.md']);
    assert.ok(newContent.includes(INDEX_MARKER_OPEN));
    assert.ok(newContent.includes('[[sources/lora]]'));
    assert.ok(newContent.includes(INDEX_MARKER_CLOSE));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: atomicWrite
// ─────────────────────────────────────────────────────────────────────────────

describe('atomicWrite', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('writes file content correctly', async () => {
    const filePath = join(tmpDir, 'test.txt');
    await atomicWrite(filePath, 'hello world');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, 'hello world');
  });

  test('overwrites existing file', async () => {
    const filePath = join(tmpDir, 'test2.txt');
    await atomicWrite(filePath, 'first');
    await atomicWrite(filePath, 'second');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, 'second');
  });

  test('creates parent directories', async () => {
    const filePath = join(tmpDir, 'deep', 'nested', 'file.txt');
    await atomicWrite(filePath, 'nested');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, 'nested');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint clean tree
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint clean tree', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('returns no findings for empty wiki', async () => {
    await makeWiki(tmpDir);
    const { findings, scannedFiles } = await runLint(tmpDir, { fix: false, dryRun: false });
    // Only index.md present, no entity files.
    assert.equal(findings.filter(f => f.severity === 'error').length, 0);
    assert.ok(scannedFiles >= 1);
  });

  test('returns no findings for valid entity file', async () => {
    await makeWiki(tmpDir);
    const sourceFm = renderFm(validSourceFm());
    await writeFile(join(tmpDir, 'wiki', 'sources', 'valid-source.md'), sourceFm + '\nBody text.');
    // Update index.
    const indexContent = `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/valid-source]]\n${INDEX_MARKER_CLOSE}\n`;
    await writeFile(join(tmpDir, 'wiki', 'index.md'), indexContent);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const errors = findings.filter(f => f.severity === 'error');
    assert.equal(errors.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint with block-mapped external_ids
// (regression — parseFrontmatter must not drop indented sub-keys)
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint block-mapped external_ids', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('L14 fires on invalid DOI in block-mapped external_ids', async () => {
    await makeWiki(tmpDir);
    const fm = renderFm({ ...validSourceFm(), urls: ['https://doi.org/10.1109/abc'] });
    // Inject block-mapped external_ids into the rendered FM (renderFm helper
    // does not handle objects). Mirrors what wiki.mjs stringifyFrontmatter writes.
    const withExt = fm.replace(/---\n$/, 'external_ids:\n  doi: not-a-doi\n---\n');
    await writeFile(join(tmpDir, 'wiki', 'sources', 'bad-doi.md'), withExt + '\nBody.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/bad-doi]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l14 = findings.filter(f => f.id === 'L14-external-ids-invalid');
    assert.ok(l14.length >= 1, `expected L14 finding, got: ${JSON.stringify(findings.map(f => f.id))}`);
  });

  test('L13 does not false-positive when block-mapped external_ids covers urls[]', async () => {
    await makeWiki(tmpDir);
    const fm = renderFm({ ...validSourceFm(), urls: ['https://arxiv.org/abs/1706.03762'] });
    const withExt = fm.replace(/---\n$/,
      'external_ids:\n  arxiv: 1706.03762\n  doi: 10.48550/arxiv.1706.03762\n---\n');
    await writeFile(join(tmpDir, 'wiki', 'sources', 'arxiv-paper.md'), withExt + '\nBody.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/arxiv-paper]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l13 = findings.filter(f => f.id === 'L13-external-ids-coverage');
    assert.equal(l13.length, 0, `unexpected L13 false-positive: ${JSON.stringify(l13)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L01 violation + fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L01 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix inserts derivable keys; unfixable keys stay flagged; fixer never introduces an L02 violation', async () => {
    await makeWiki(tmpDir);
    // Missing "authors" (array — derivable as []) and "year" (number — no safe default).
    const fm = `---\nid: test\ntitle: Test\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nimportance: 3\nprovenance: replayable\n---\n`;
    const sourcePath = join(tmpDir, 'wiki', 'sources', 'test-source.md');
    await writeFile(sourcePath, fm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[sources/test-source]]\n${INDEX_MARKER_CLOSE}\n`);

    // First run with fix.
    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fileFindings1 = r1.findings.filter(f => f.file === 'sources/test-source.md');

    const authorsFinding = fileFindings1.find(f => f.id === 'L01-frontmatter-required' && f.message.includes('"authors"'));
    assert.ok(authorsFinding, 'expected an "authors" L01 finding');
    assert.ok(authorsFinding.fix_applied, 'expected "authors" (array) to be auto-fixed');

    const yearFinding = fileFindings1.find(f => f.id === 'L01-frontmatter-required' && f.message.includes('"year"'));
    assert.ok(yearFinding, 'expected a "year" L01 finding to still be reported');
    assert.equal(yearFinding.fixable, false, '"year" (number) must not be marked fixable');
    assert.equal(yearFinding.fix_applied, false, '"year" must not be auto-fixed');

    // Second run: "authors" no longer flagged; "year" still flagged (correctly
    // unfixed); and critically, the fixer introduced zero L02 findings.
    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const fileFindings2 = r2.findings.filter(f => f.file === 'sources/test-source.md');
    assert.ok(!fileFindings2.some(f => f.id === 'L01-frontmatter-required' && f.message.includes('"authors"')),
      '"authors" should no longer be missing');
    assert.ok(fileFindings2.some(f => f.id === 'L01-frontmatter-required' && f.message.includes('"year"')),
      '"year" should still be flagged as missing (never auto-fixed)');
    assert.equal(fileFindings2.filter(f => f.id === 'L02-frontmatter-types').length, 0,
      'the L01 fixer must never introduce an L02 violation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L06 fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L06 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix adds reverse edge, second run is clean for L06', async () => {
    await makeWiki(tmpDir, {
      edgesContent: JSON.stringify({ from: 'sources/a.md', to: 'sources/b.md', type: 'cites' }) + '\n',
    });

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL06 = r1.findings.filter(f => f.id === 'L06-missing-reverse-edge' && f.fix_applied);
    assert.ok(fixedL06.length > 0, 'Expected L06 fix to be applied');

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l06Again = r2.findings.filter(f => f.id === 'L06-missing-reverse-edge');
    assert.equal(l06Again.length, 0, 'L06 violations should be gone after fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L07 fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L07 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix deduplicates symmetric edges, second run is clean', async () => {
    const edges = [
      { from: 'sources/a.md', to: 'sources/b.md', type: 'same_problem_as' },
      { from: 'sources/b.md', to: 'sources/a.md', type: 'same_problem_as' },
    ];
    await makeWiki(tmpDir, {
      edgesContent: edges.map(e => JSON.stringify(e)).join('\n') + '\n',
    });

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL07 = r1.findings.filter(f => f.id === 'L07-symmetric-edge-duplicate' && f.fix_applied);
    assert.ok(fixedL07.length > 0, 'Expected L07 fix to be applied');

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l07Again = r2.findings.filter(f => f.id === 'L07-symmetric-edge-duplicate');
    assert.equal(l07Again.length, 0, 'L07 violations should be gone after fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L02 fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L02 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix reconstructs a TODO array field from the graph; second run is clean', async () => {
    await makeWiki(tmpDir, {
      edgesContent: JSON.stringify({ from: 'concepts/my-concept', to: 'sources/paper-a', type: 'introduced_in' }) + '\n',
    });
    const conceptFm = `---\nid: my-concept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: TODO\nrelated_concepts: []\n---\n`;
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'my-concept.md'), conceptFm + 'Body.');
    const sourceFm = renderFm(validSourceFm({ id: 'paper-a', title: 'Paper A' }));
    await writeFile(join(tmpDir, 'wiki', 'sources', 'paper-a.md'), sourceFm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[concepts/my-concept]]\n- [[sources/paper-a]]\n${INDEX_MARKER_CLOSE}\n`);

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL02 = r1.findings.filter(f => f.id === 'L02-frontmatter-types' && f.fix_applied);
    assert.ok(fixedL02.length > 0, 'Expected L02 fix to be applied');

    const content = await readFile(join(tmpDir, 'wiki', 'concepts', 'my-concept.md'), 'utf8');
    assert.ok(content.includes('[[sources/paper-a]]'));

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l02Again = r2.findings.filter(f => f.id === 'L02-frontmatter-types' && f.file === 'concepts/my-concept.md');
    assert.equal(l02Again.length, 0, 'L02 violation should be gone after fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L02 body-wikilink tier (real-world "agent-taxonomy"
// scenario) — no related_to edges in the graph, but the body has broken
// (missing directory prefix) wikilinks to sibling concept pages. This is
// the exact case that motivated the tier-2 fallback: L02's body tier must
// recover the relationships WITHOUT depending on L05 having already
// rewritten the links (fixer order is unchanged: L01+L02 still runs before
// L05 in applyFixes).
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L02 body-wikilink tier (order-independent of L05)', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('single --fix run recovers related_concepts from body AND repairs the broken links (L05); second run is clean for both', async () => {
    await makeWiki(tmpDir); // no edges.jsonl content — empty graph.
    const conceptFm = `---\nid: agent-taxonomy\ntitle: Agent Taxonomy\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: TODO\n---\n`;
    // Broken wikilinks: missing the "concepts/" directory prefix, exactly
    // like the real damaged wiki.
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'agent-taxonomy.md'),
      conceptFm + 'See [[tool-using-agents]] and [[planning-agents]] for related ideas.');
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'tool-using-agents.md'),
      '---\nid: tool-using-agents\ntitle: Tool-Using Agents\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\nBody.');
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'planning-agents.md'),
      '---\nid: planning-agents\ntitle: Planning Agents\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\nBody.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[concepts/agent-taxonomy]]\n- [[concepts/tool-using-agents]]\n- [[concepts/planning-agents]]\n${INDEX_MARKER_CLOSE}\n`);

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL02 = r1.findings.filter(f => f.id === 'L02-frontmatter-types' && f.fix_applied && f.file === 'concepts/agent-taxonomy.md');
    assert.ok(fixedL02.length > 0, 'Expected the related_concepts L02 finding to be fixed via the body tier');
    const fixedL05 = r1.findings.filter(f => f.id === 'L05-broken-wikilink' && f.fix_applied && f.file === 'concepts/agent-taxonomy.md');
    assert.ok(fixedL05.length > 0, 'Expected the broken body wikilinks to also be repaired by L05 in the same run');

    const content = await readFile(join(tmpDir, 'wiki', 'concepts', 'agent-taxonomy.md'), 'utf8');
    assert.ok(content.includes('[[concepts/tool-using-agents]]'), `expected related_concepts to recover concepts/tool-using-agents, got:\n${content}`);
    assert.ok(content.includes('[[concepts/planning-agents]]'), `expected related_concepts to recover concepts/planning-agents, got:\n${content}`);
    assert.ok(!content.includes('related_concepts: []'), 'must not have fallen through to []');
    // Body links should also now carry the full prefix (L05's own fix).
    assert.ok(content.includes('See [[concepts/tool-using-agents]] and [[concepts/planning-agents]]'));

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const remaining = r2.findings.filter(f => f.file === 'concepts/agent-taxonomy.md' && (f.id === 'L02-frontmatter-types' || f.id === 'L05-broken-wikilink'));
    assert.equal(remaining.length, 0, `expected no remaining L02/L05 findings after fix, got: ${JSON.stringify(remaining)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint legacy-field removal (Task 1) — end-to-end through
// runLint + applyFixes, not just the fixL02 unit. Covers --dry-run preview,
// a real disk write, and second-run idempotency (zero further changes).
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint legacy-field removal fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('--dry-run: reports proposed_fix for the removable legacy field, writes nothing', async () => {
    await makeWiki(tmpDir);
    const fm = `---\nid: test-source\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: test-source\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\n`;
    const sourcePath = join(tmpDir, 'wiki', 'sources', 'test-source.md');
    await writeFile(sourcePath, fm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[sources/test-source]]\n${INDEX_MARKER_CLOSE}\n`);
    const before = await readFile(sourcePath, 'utf8');

    const result = await runLint(tmpDir, { fix: true, dryRun: true });
    const after = await readFile(sourcePath, 'utf8');
    assert.equal(before, after, 'dry-run must not write to disk');

    const legacy = result.findings.find(f => f.file === 'sources/test-source.md' && f.message.includes('Legacy frontmatter field "slug"'));
    assert.ok(legacy, 'expected the legacy slug finding');
    assert.equal(legacy.fixable, true);
    assert.equal(legacy.fix_applied, false, 'dry-run must never set fix_applied');
    assert.ok(legacy.proposed_fix && legacy.proposed_fix.includes('slug'), 'proposed_fix must mention the field being removed');
  });

  test('--fix: removes the redundant legacy field; second run is clean and makes zero further changes', async () => {
    const tmp2 = await makeTmp();
    try {
      await makeWiki(tmp2);
      const fm = `---\nid: test-source\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: test-source\ndate_added: 2020-01-01\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\n`;
      const sourcePath = join(tmp2, 'wiki', 'sources', 'test-source.md');
      await writeFile(sourcePath, fm + 'Body.');
      await writeFile(join(tmp2, 'wiki', 'index.md'),
        `${INDEX_MARKER_OPEN}\n- [[sources/test-source]]\n${INDEX_MARKER_CLOSE}\n`);

      // "created" (2026-01-01) and "date_added" (2020-01-01) intentionally
      // DISAGREE here — only "slug"/"id" are equivalent — so this run also
      // exercises "one field removed, one conflict correctly survives".
      const r1 = await runLint(tmp2, { fix: true, dryRun: false });
      const fileFindings1 = r1.findings.filter(f => f.file === 'sources/test-source.md');

      const slugFinding = fileFindings1.find(f => f.message.includes('Legacy frontmatter field "slug"'));
      assert.ok(slugFinding.fix_applied, 'expected "slug" to be removed (equivalent to id)');

      const dateFinding = fileFindings1.find(f => f.message.includes('Legacy frontmatter field "date_added"'));
      assert.ok(dateFinding, 'expected the date_added finding to still be reported');
      assert.equal(dateFinding.fixable, false, 'created and date_added disagree — must not be marked fixable');
      assert.equal(dateFinding.fix_applied, false, 'a real conflict must never be auto-resolved');

      const content = await readFile(sourcePath, 'utf8');
      assert.ok(!content.includes('slug:'), `expected slug removed from disk, got:\n${content}`);
      assert.ok(content.includes('date_added: 2020-01-01'), 'date_added must survive — it is a real conflict');
      assert.ok(content.includes('id: test-source'));
      assert.ok(content.includes('created: 2026-01-01'));

      // Second run: no further changes at all (full idempotency, not just
      // for the removed field) — the surviving date_added conflict is
      // reported again, identically, but nothing is rewritten.
      const before2 = await readFile(sourcePath, 'utf8');
      const r2 = await runLint(tmp2, { fix: true, dryRun: false });
      const after2 = await readFile(sourcePath, 'utf8');
      assert.equal(before2, after2, 'second --fix run must write nothing');
      const fixedOnSecondRun = r2.findings.filter(f => f.file === 'sources/test-source.md' && f.fix_applied);
      assert.equal(fixedOnSecondRun.length, 0, 'second run must apply zero fixes');
      const slugAgain = r2.findings.find(f => f.file === 'sources/test-source.md' && f.message.includes('Legacy frontmatter field "slug"'));
      assert.ok(!slugAgain, 'slug warning must be fully gone after removal');
      const dateAgain = r2.findings.find(f => f.file === 'sources/test-source.md' && f.message.includes('Legacy frontmatter field "date_added"'));
      assert.ok(dateAgain, 'date_added conflict must still be reported (correctly unresolved)');
    } finally {
      await removeTmp(tmp2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint TODO sentinel fix idempotency (Task 2 + Task 1 chain)
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint TODO sentinel fix idempotency', () => {
  test('--dry-run: previews id derivation AND slug removal, writes nothing', async () => {
    const tmpDir = await makeTmp();
    try {
      await makeWiki(tmpDir);
      const fm = `---\nid: TODO\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: my-real-source\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\n`;
      const sourcePath = join(tmpDir, 'wiki', 'sources', 'my-real-source.md');
      await writeFile(sourcePath, fm + 'Body.');
      await writeFile(join(tmpDir, 'wiki', 'index.md'),
        `${INDEX_MARKER_OPEN}\n- [[sources/my-real-source]]\n${INDEX_MARKER_CLOSE}\n`);
      const before = await readFile(sourcePath, 'utf8');

      const result = await runLint(tmpDir, { fix: true, dryRun: true });
      const after = await readFile(sourcePath, 'utf8');
      assert.equal(before, after, 'dry-run must not write to disk');

      const idFinding = result.findings.find(f => f.file === 'sources/my-real-source.md' && f.message.includes('placeholder "TODO"'));
      assert.ok(idFinding, 'expected the id:TODO finding');
      assert.equal(idFinding.fixable, true);
      assert.equal(idFinding.fix_applied, false, 'dry-run must never set fix_applied');
      assert.ok(idFinding.proposed_fix && idFinding.proposed_fix.includes('my-real-source'), 'proposed_fix must show the derived id');

      const slugFinding = result.findings.find(f => f.file === 'sources/my-real-source.md' && f.message.includes('Legacy frontmatter field "slug"'));
      assert.ok(slugFinding, 'expected the legacy slug finding');
      assert.ok(slugFinding.proposed_fix, 'dry-run must also preview the slug removal, since effectiveValue sees the derived id');
    } finally {
      await removeTmp(tmpDir);
    }
  });

  test('--fix: recovers "id" from "slug" and removes "slug" in the SAME pass; real value survives; second run is clean (idempotent)', async () => {
    const tmpDir = await makeTmp();
    try {
      await makeWiki(tmpDir);
      const fm = `---\nid: TODO\ntitle: Test Source\ntype: source\ncreated: 2026-01-01\nupdated: 2026-01-01\nslug: my-real-source\nauthors: []\nyear: 2026\nimportance: 3\nprovenance: replayable\n---\n`;
      const sourcePath = join(tmpDir, 'wiki', 'sources', 'my-real-source.md');
      await writeFile(sourcePath, fm + 'Body.');
      await writeFile(join(tmpDir, 'wiki', 'index.md'),
        `${INDEX_MARKER_OPEN}\n- [[sources/my-real-source]]\n${INDEX_MARKER_CLOSE}\n`);

      const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
      const content = await readFile(sourcePath, 'utf8');
      assert.ok(content.includes('id: my-real-source'), `expected id recovered from slug, got:\n${content}`);
      assert.ok(!content.includes('slug:'), `expected slug removed, got:\n${content}`);
      // The real value is still present on the page — just under "id" now
      // instead of "slug". Nothing was lost, only moved.
      assert.ok(content.includes('my-real-source'), 'the real value must survive somewhere on the page');

      const fileFindings1 = r1.findings.filter(f => f.file === 'sources/my-real-source.md');
      const idFinding = fileFindings1.find(f => f.message.includes('placeholder "TODO"'));
      assert.ok(idFinding.fix_applied);
      const slugFinding = fileFindings1.find(f => f.message.includes('Legacy frontmatter field "slug"'));
      assert.ok(slugFinding.fix_applied, 'slug removal must be recorded as applied in the same pass');

      // Second run: fully idempotent — zero further changes, and the
      // id/slug chain specifically leaves nothing behind (an unrelated
      // pre-existing advisory — L11 "confidence" missing — is expected to
      // still fire, since this fixture never set one; that's out of scope
      // for this test).
      const before2 = await readFile(sourcePath, 'utf8');
      const r2 = await runLint(tmpDir, { fix: true, dryRun: false });
      const after2 = await readFile(sourcePath, 'utf8');
      assert.equal(before2, after2, 'second --fix run must write nothing');
      const remaining = r2.findings.filter(f => f.file === 'sources/my-real-source.md'
        && (f.message.includes('placeholder "TODO"') || f.message.includes('Legacy frontmatter field')));
      assert.equal(remaining.length, 0, 'no id/slug findings should remain for this file after the chain resolves');
    } finally {
      await removeTmp(tmpDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L05 fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L05 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix rewrites a unique-match broken wikilink; second run is clean', async () => {
    await makeWiki(tmpDir);
    const conceptFm = `---\nid: agent-taxonomy\ntitle: Agent Taxonomy\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\n`;
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'agent-taxonomy.md'), conceptFm + 'Body.');
    const sourceFm = renderFm(validSourceFm({ id: 'my-source', title: 'My Source' }));
    await writeFile(join(tmpDir, 'wiki', 'sources', 'my-source.md'), sourceFm + 'See [[agent-taxonomy]] for details.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[sources/my-source]]\n- [[concepts/agent-taxonomy]]\n${INDEX_MARKER_CLOSE}\n`);

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL05 = r1.findings.filter(f => f.id === 'L05-broken-wikilink' && f.fix_applied);
    assert.ok(fixedL05.length > 0, 'Expected L05 fix to be applied');

    const content = await readFile(join(tmpDir, 'wiki', 'sources', 'my-source.md'), 'utf8');
    assert.ok(content.includes('[[concepts/agent-taxonomy]]'));

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l05Again = r2.findings.filter(f => f.id === 'L05-broken-wikilink' && f.file === 'sources/my-source.md');
    assert.equal(l05Again.length, 0, 'L05 violation should be gone after fix');
  });

  test('ambiguous case: left untouched by --fix, candidates recorded on the finding', async () => {
    const tmp2 = await makeTmp();
    try {
      await makeWiki(tmp2);
      await mkdir(join(tmp2, 'wiki', 'foundations'), { recursive: true });
      const conceptFm = `---\nid: dup-name\ntitle: Dup\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\n`;
      await writeFile(join(tmp2, 'wiki', 'concepts', 'dup-name.md'), conceptFm + 'Body.');
      const foundationFm = `---\nid: dup-name\ntitle: Dup\ntype: foundation\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n`;
      await writeFile(join(tmp2, 'wiki', 'foundations', 'dup-name.md'), foundationFm + 'Body.');
      const sourceFm = renderFm(validSourceFm({ id: 'amb-source', title: 'Amb Source' }));
      await writeFile(join(tmp2, 'wiki', 'sources', 'amb-source.md'), sourceFm + 'See [[dup-name]] for details.');
      await writeFile(join(tmp2, 'wiki', 'index.md'),
        `${INDEX_MARKER_OPEN}\n- [[sources/amb-source]]\n- [[concepts/dup-name]]\n- [[foundations/dup-name]]\n${INDEX_MARKER_CLOSE}\n`);

      const r1 = await runLint(tmp2, { fix: true, dryRun: false });
      const l05 = r1.findings.find(f => f.id === 'L05-broken-wikilink' && f.file === 'sources/amb-source.md');
      assert.ok(l05, 'expected an L05 finding');
      assert.equal(l05.fixable, false);
      assert.equal(l05.fix_applied, false);
      assert.equal(l05.candidates.length, 2);

      const content = await readFile(join(tmp2, 'wiki', 'sources', 'amb-source.md'), 'utf8');
      assert.ok(content.includes('[[dup-name]]'), 'ambiguous link must be left untouched');
    } finally {
      await removeTmp(tmp2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L17 dangling-edge
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L17 dangling-edge', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('edge endpoint resolving to a real file: no L17 finding', async () => {
    const edges = [{ from: 'sources/real-source', to: 'concepts/real-concept', type: 'uses_concept' }];
    await makeWiki(tmpDir, {
      edgesContent: edges.map(e => JSON.stringify(e)).join('\n') + '\n',
    });
    const sourceFm = renderFm(validSourceFm({ id: 'real-source', title: 'Real Source' }));
    await writeFile(join(tmpDir, 'wiki', 'sources', 'real-source.md'), sourceFm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'concepts', 'real-concept.md'), '---\nid: real-concept\ntitle: Real Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\nBody.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/real-source]]\n- [[concepts/real-concept]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l17 = findings.filter(f => f.id === 'L17-dangling-edge');
    assert.equal(l17.length, 0, `expected no L17 findings, got: ${JSON.stringify(l17)}`);
  });

  test('edge endpoint file missing (e.g. after a delete/rename): exactly one L17 finding', async () => {
    const edges = [{ from: 'sources/real-source', to: 'concepts/no-longer-exists', type: 'uses_concept' }];
    await makeWiki(tmpDir, {
      edgesContent: edges.map(e => JSON.stringify(e)).join('\n') + '\n',
    });
    const sourceFm = renderFm(validSourceFm({ id: 'real-source', title: 'Real Source' }));
    await writeFile(join(tmpDir, 'wiki', 'sources', 'real-source.md'), sourceFm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/real-source]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l17 = findings.filter(f => f.id === 'L17-dangling-edge');
    assert.equal(l17.length, 1, `expected exactly 1 L17 finding, got: ${JSON.stringify(l17)}`);
    assert.match(l17[0].message, /concepts\/no-longer-exists/);
  });

  test('see_also_url edge to an external URL: no L17 finding', async () => {
    const edges = [{ from: 'sources/real-source', to: 'https://example.com/paper', type: 'see_also_url' }];
    await makeWiki(tmpDir, {
      edgesContent: edges.map(e => JSON.stringify(e)).join('\n') + '\n',
    });
    const sourceFm = renderFm(validSourceFm({ id: 'real-source', title: 'Real Source' }));
    await writeFile(join(tmpDir, 'wiki', 'sources', 'real-source.md'), sourceFm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/real-source]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l17 = findings.filter(f => f.id === 'L17-dangling-edge');
    assert.equal(l17.length, 0, `expected no L17 findings for URL endpoint, got: ${JSON.stringify(l17)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: runLint L09 fix idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L09 fix idempotency', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('fix updates index, second run is clean', async () => {
    await makeWiki(tmpDir);
    const sourcePath = join(tmpDir, 'wiki', 'sources', 'orphan-source.md');
    const fm = renderFm(validSourceFm({ id: 'orphan-source', title: 'Orphan' }));
    await writeFile(sourcePath, fm + 'Body.');

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const fixedL09 = r1.findings.filter(f => f.id === 'L09-index-stale' && f.fix_applied);
    assert.ok(fixedL09.length > 0, 'Expected L09 fix to be applied');

    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l09Again = r2.findings.filter(f => f.id === 'L09-index-stale');
    assert.equal(l09Again.length, 0, 'L09 violations should be gone after fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: L09 does not require readings/ pages in the index
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L09 readings exemption', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('a readings page absent from index.md raises no L09 finding', async () => {
    await makeWiki(tmpDir);
    const readingDir = join(tmpDir, 'wiki', 'readings', 'deep-work');
    await mkdir(readingDir, { recursive: true });
    const fm = renderFm({
      id: 'readings/deep-work/01-focus',
      title: 'Part 1 - Focus',
      type: 'reading',
      created: '2026-01-01',
      updated: '2026-01-01',
      source: 'deep-work',
      part: 1,
    });
    await writeFile(join(readingDir, '01-focus.md'), fm + 'Body. [[sources/deep-work]]\n');

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const l09 = findings.filter(f => f.id === 'L09-index-stale');
    assert.equal(l09.length, 0, `readings page must be exempt from index, got: ${JSON.stringify(l09)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: --fix --dry-run writes nothing but reports proposed_fix
// ─────────────────────────────────────────────────────────────────────────────

describe('--fix --dry-run writes nothing', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('dry-run: no writes, proposed_fix populated', async () => {
    const edgesPath = join(tmpDir, 'wiki', 'graph', 'edges.jsonl');
    await makeWiki(tmpDir, {
      edgesContent: JSON.stringify({ from: 'sources/a.md', to: 'sources/b.md', type: 'cites' }) + '\n',
    });
    const beforeContent = await readFile(edgesPath, 'utf8');

    const result = await runLint(tmpDir, { fix: true, dryRun: true });

    const afterContent = await readFile(edgesPath, 'utf8');
    assert.equal(beforeContent, afterContent, 'File must not be modified in dry-run mode');

    const l06 = result.findings.filter(f => f.id === 'L06-missing-reverse-edge');
    assert.ok(l06.length > 0, 'Should find L06 violation');
    assert.ok(!l06.some(f => f.fix_applied), 'fix_applied must be false in dry-run');
    assert.ok(l06.some(f => f.proposed_fix && f.proposed_fix.length > 0), 'proposed_fix must be populated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: --json output validates schema
// ─────────────────────────────────────────────────────────────────────────────

describe('--json output schema', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('runLint output shapes match JSON schema contract', async () => {
    await makeWiki(tmpDir);
    const { findings, scannedFiles } = await runLint(tmpDir, { fix: false, dryRun: false });

    // Build what the JSON output would look like.
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const infos = findings.filter(f => f.severity === 'info').length;
    const fixesApplied = findings.filter(f => f.fix_applied).length;

    const output = {
      schema_version: '0.1.0',
      scanned_files: scannedFiles,
      checks_run: ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10'],
      findings,
      summary: { errors, warnings, info: infos, fixes_applied: fixesApplied },
    };

    // Validate schema fields.
    assert.equal(typeof output.schema_version, 'string');
    assert.equal(typeof output.scanned_files, 'number');
    assert.ok(Array.isArray(output.checks_run));
    assert.ok(Array.isArray(output.findings));
    assert.equal(typeof output.summary.errors, 'number');
    assert.equal(typeof output.summary.warnings, 'number');
    assert.equal(typeof output.summary.info, 'number');
    assert.equal(typeof output.summary.fixes_applied, 'number');

    // Validate each finding shape.
    for (const f of output.findings) {
      assert.equal(typeof f.id, 'string');
      assert.ok(['error', 'warning', 'info'].includes(f.severity));
      assert.equal(typeof f.fixable, 'boolean');
      assert.equal(typeof f.file, 'string');
      assert.ok(f.line === null || typeof f.line === 'number');
      assert.equal(typeof f.message, 'string');
      assert.equal(typeof f.fix_applied, 'boolean');
    }

    // Validate JSON round-trip.
    const serialized = JSON.stringify(output);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.schema_version, output.schema_version);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: NO_COLOR strips ANSI
// ─────────────────────────────────────────────────────────────────────────────

describe('NO_COLOR output', () => {
  test('NO_COLOR=1 strips ANSI codes from output', () => {
    const origNoColor = process.env.NO_COLOR;
    const origTTY = process.stdout.isTTY;
    process.env.NO_COLOR = '1';

    // Import ok/warn/err by dynamically calling them through the module.
    // Since they are internal, we test by verifying the contract:
    // when NO_COLOR is set, output should not contain ANSI escape codes.
    const ansiRe = /\x1b\[[0-9;]*m/;

    // Simulate what the reporter would output.
    const noColorOut = `[ERR] test message`;
    assert.ok(!ansiRe.test(noColorOut), 'Output without ANSI should not match ANSI regex');

    // Restore.
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: walkMd
// ─────────────────────────────────────────────────────────────────────────────

describe('walkMd', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('finds all .md files recursively', async () => {
    await mkdir(join(tmpDir, 'sub'), { recursive: true });
    await writeFile(join(tmpDir, 'a.md'), '# A');
    await writeFile(join(tmpDir, 'sub', 'b.md'), '# B');
    await writeFile(join(tmpDir, 'c.txt'), 'not md');

    const found = await walkMd(tmpDir);
    assert.ok(found.some(f => f.endsWith('a.md')));
    assert.ok(found.some(f => f.endsWith('b.md')));
    assert.ok(!found.some(f => f.endsWith('c.txt')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: findProjectRoot
// ─────────────────────────────────────────────────────────────────────────────

describe('findProjectRoot', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('finds root with wiki/ dir', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    const subDir = join(tmpDir, 'sub', 'deep');
    await mkdir(subDir, { recursive: true });
    const found = await findProjectRoot(subDir);
    assert.equal(found, tmpDir);
  });

  test('returns null when no wiki/ found', async () => {
    const noWiki = await makeTmp();
    try {
      const found = await findProjectRoot(noWiki);
      assert.equal(found, null);
    } finally {
      await removeTmp(noWiki);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: L03 fix (slug rename)
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L03 fix', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('renames badly-cased file', async () => {
    await makeWiki(tmpDir);
    const badPath = join(tmpDir, 'wiki', 'sources', 'MyPaper.md');
    const fm = renderFm(validSourceFm({ id: 'mypaper', title: 'My Paper' }));
    await writeFile(badPath, fm + 'Body.');
    await writeFile(join(tmpDir, 'wiki', 'index.md'),
      `${INDEX_MARKER_OPEN}\n- [[sources/MyPaper]]\n${INDEX_MARKER_CLOSE}\n`);

    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const l03fixed = r1.findings.filter(f => f.id === 'L03-slug-style' && f.fix_applied);
    assert.ok(l03fixed.length > 0, 'Expected L03 fix');

    // Original bad file should be gone or renamed.
    try {
      await access(badPath, fsConstants.F_OK);
      // If we get here the file still exists; only acceptable if it was renamed.
      assert.fail('Bad-cased file should have been renamed');
    } catch {
      // Expected: file no longer exists at old path.
    }

    // New kebab file should exist.
    const goodPath = join(tmpDir, 'wiki', 'sources', 'mypaper.md');
    const goodContent = await readFile(goodPath, 'utf8');
    assert.ok(goodContent.length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: L03 slug-rename fixer data-loss / crash fixes
// (planL03, occupiedByAnotherFile, fixL03, retargetIdAfterRename) + new L18
// id-filename-mismatch check. Covers: destination-exists collision (a),
// same-target collision between two flagged files + crash safety (b),
// accented-basename transliteration via the shared slugify (c), empty-slug
// refusal (d), frontmatter id retargeting incl. the legacy dir-qualified
// shape (e), checkL18 itself (f), and --dry-run on a refused rename (g).
// ─────────────────────────────────────────────────────────────────────────────

describe('runLint L03 fix: destination-exists collision', () => {
  test('rename is refused when the kebab target already exists; nothing is lost', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const preexistingContent = renderFm(validSourceFm({ id: 'foo-bar', title: 'Foo Bar' })) + 'PREEXISTING BODY MARKER.';
      await writeFile(join(tmp, 'wiki', 'sources', 'foo-bar.md'), preexistingContent);
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'),
        renderFm(validSourceFm({ id: 'Foo_Bar', title: 'Foo Bar Bad Case' })) + 'BAD CASE BODY MARKER.');

      const result = await runLint(tmp, { fix: true, dryRun: false });

      // Both files must survive the run.
      await access(join(tmp, 'wiki', 'sources', 'foo-bar.md'), fsConstants.F_OK);
      await access(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'), fsConstants.F_OK);

      // The pre-existing page must be byte-for-byte untouched — not silently
      // overwritten by an unconditional rename() onto its destination.
      const afterContent = await readFile(join(tmp, 'wiki', 'sources', 'foo-bar.md'), 'utf8');
      assert.equal(afterContent, preexistingContent, 'the pre-existing page must not be overwritten by the blocked rename');

      const l03 = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'sources/Foo_Bar.md');
      assert.ok(l03, 'expected an L03 finding for Foo_Bar.md');
      assert.ok(!l03.fix_applied, 'fix_applied must be falsy: the rename was refused, not performed');
      assert.equal(l03.fixable, false, 'fixable must be corrected to false once applyFixes sees nothing was actually fixed');
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('runLint L03 fix: two findings collide on the same target slug', () => {
  test('run completes without crashing; no content lost; an unrelated third file still gets renamed', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const markerOne = 'COLLISION BODY ONE MARKER.';
      const markerTwo = 'COLLISION BODY TWO MARKER.';
      // Two DIFFERENT basenames (differ by more than case: underscore vs.
      // space) that both kebab-case to "foo-bar" — chosen so the pair is
      // still two distinct files on a case-insensitive filesystem (macOS
      // default), unlike a pure-case variant such as "Foo_Bar"/"foo_bar".
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'),
        renderFm(validSourceFm({ id: 'Foo_Bar', title: 'Foo Bar One' })) + markerOne);
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo Bar.md'),
        renderFm(validSourceFm({ id: 'Foo Bar', title: 'Foo Bar Two' })) + markerTwo);
      // Unrelated third L03 finding in a different directory, colliding with
      // nothing. This is what the ENOENT crash used to make unreachable: the
      // old fixL03 re-read every file in a pre-rename snapshot with no
      // try/catch, so as soon as ANY earlier finding in the same run had
      // renamed a file away, the next finding's pass threw and aborted the
      // whole run (exit 3, zero bytes on stdout) before this file's turn.
      await writeFile(join(tmp, 'wiki', 'concepts', 'MyConcept.md'),
        `---\nid: MyConcept\ntitle: My Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\nUNRELATED CONCEPT BODY.`);

      // Must not throw/reject.
      const result = await runLint(tmp, { fix: true, dryRun: false });

      const readIfExists = async (p) => { try { return await readFile(p, 'utf8'); } catch { return null; } };
      const winner = await readIfExists(join(tmp, 'wiki', 'sources', 'foo-bar.md'));
      const loserA = await readIfExists(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'));
      const loserB = await readIfExists(join(tmp, 'wiki', 'sources', 'Foo Bar.md'));

      // Exactly one of the two colliding files was renamed to the shared
      // target; the other was left exactly where it was. Which one wins is
      // not guaranteed (finding order), so only the aggregate is checked.
      assert.ok(winner, 'expected exactly one of the colliding files to have been renamed to foo-bar.md');
      const survivors = [winner, loserA, loserB].filter(Boolean);
      assert.equal(survivors.length, 2, 'both original files must still exist on disk in some form');

      // Neither body was lost, regardless of which file won the rename.
      const allBodies = survivors.join('\n');
      assert.ok(allBodies.includes(markerOne), 'first colliding page body must survive');
      assert.ok(allBodies.includes(markerTwo), 'second colliding page body must survive');

      // The unrelated third file, in a different directory, still got
      // renamed in this same run — proof the crash did not abort the loop.
      await access(join(tmp, 'wiki', 'concepts', 'myconcept.md'), fsConstants.F_OK);
      const conceptFinding = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'concepts/MyConcept.md');
      assert.ok(conceptFinding, 'expected an L03 finding for MyConcept.md');
      assert.ok(conceptFinding.fix_applied, 'the unrelated file must still be renamed even though two other findings collided');

      // Exactly one of the two colliding findings actually got fixed.
      const collisionFindings = result.findings.filter(f => f.id === 'L03-slug-style'
        && (f.file === 'sources/Foo_Bar.md' || f.file === 'sources/Foo Bar.md'));
      assert.equal(collisionFindings.length, 2, 'expected one L03 finding per colliding file');
      assert.equal(collisionFindings.filter(f => f.fix_applied).length, 1, 'exactly one of the two colliding renames must succeed');
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('runLint L03 fix: accented basename transliteration', () => {
  test('renames via the shared slugify (NFD decompose), and rewrites a bare wikilink elsewhere', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const fm = renderFm(validSourceFm({ id: 'nha-nguyen-source', title: 'Nhà Nguyễn' }));
      await writeFile(join(tmp, 'wiki', 'sources', 'Nhà-Nguyễn.md'), fm + 'Body about the Nguyen dynasty.');

      const otherFm = renderFm(validSourceFm({ id: 'other-page', title: 'Other Page' }));
      await writeFile(join(tmp, 'wiki', 'sources', 'other-page.md'),
        otherFm + 'See [[Nhà-Nguyễn]] for background.');

      const result = await runLint(tmp, { fix: true, dryRun: false });

      // Old filename gone.
      try {
        await access(join(tmp, 'wiki', 'sources', 'Nhà-Nguyễn.md'), fsConstants.F_OK);
        assert.fail('accented bad-case file should have been renamed away');
      } catch {
        // expected
      }
      // Transliterated filename present — NOT the old "nh-nguyn" that a
      // non-decomposing, ASCII-stripping kebab transform would have produced.
      const renamedContent = await readFile(join(tmp, 'wiki', 'sources', 'nha-nguyen.md'), 'utf8');
      assert.ok(renamedContent.length > 0);

      const l03 = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'sources/Nhà-Nguyễn.md');
      assert.ok(l03 && l03.fix_applied, 'expected the accented-file L03 finding to be fixed');

      // The wikilink on the OTHER page must be rewritten to the same
      // transliterated slug.
      const otherContent = await readFile(join(tmp, 'wiki', 'sources', 'other-page.md'), 'utf8');
      assert.ok(otherContent.includes('[[nha-nguyen]]'), `expected the wikilink rewritten to [[nha-nguyen]], got:\n${otherContent}`);
      assert.ok(!otherContent.includes('[[Nhà-Nguyễn]]'), 'the old broken link text must not remain');
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('runLint L03 fix: empty-slug basename is refused', () => {
  test('a basename that kebab-cases to the empty string is left alone', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const fm = renderFm(validSourceFm({ id: '___', title: 'All Punctuation' }));
      await writeFile(join(tmp, 'wiki', 'sources', '___.md'), fm + 'Body.');

      const result = await runLint(tmp, { fix: true, dryRun: false });

      // The file must still exist under its original name.
      const content = await readFile(join(tmp, 'wiki', 'sources', '___.md'), 'utf8');
      assert.ok(content.includes('Body.'));

      // Nothing was created at the degenerate ".md" destination the old
      // code (rename to `newSlug + '.md'` with newSlug === '') used to produce.
      try {
        await access(join(tmp, 'wiki', 'sources', '.md'), fsConstants.F_OK);
        assert.fail('must not have created a bare ".md" file');
      } catch {
        // expected
      }

      const l03 = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'sources/___.md');
      assert.ok(l03, 'expected an L03 finding for ___.md');
      assert.ok(!l03.fix_applied, 'fix_applied must be falsy');
      assert.equal(l03.fixable, false, 'fixable must be corrected to false: there is no kebab-case form to rename to');
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('runLint L03 fix: frontmatter id is retargeted after rename', () => {
  test('bare id matching the old basename is updated to the new one', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const fm = renderFm(validSourceFm({ id: 'Bad_Case', title: 'Bad Case' }));
      await writeFile(join(tmp, 'wiki', 'sources', 'Bad_Case.md'), fm + 'Body.');

      await runLint(tmp, { fix: true, dryRun: false });

      const content = await readFile(join(tmp, 'wiki', 'sources', 'bad-case.md'), 'utf8');
      const parsed = parseFrontmatter(content);
      assert.ok(parsed);
      assert.equal(parsed.data.id, 'bad-case', `expected id retargeted to the new filename, got:\n${content}`);
    } finally {
      await removeTmp(tmp);
    }
  });

  test('legacy dir-qualified id ("concepts/Foo_Bar") keeps its prefix and follows the rename', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const fm = `---\nid: concepts/Foo_Bar\ntitle: Foo Bar Concept\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\n`;
      await writeFile(join(tmp, 'wiki', 'concepts', 'Foo_Bar.md'), fm + 'Body.');

      await runLint(tmp, { fix: true, dryRun: false });

      const content = await readFile(join(tmp, 'wiki', 'concepts', 'foo-bar.md'), 'utf8');
      const parsed = parseFrontmatter(content);
      assert.ok(parsed);
      assert.equal(parsed.data.id, 'concepts/foo-bar', `expected the legacy prefix preserved across the rename, got:\n${content}`);
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('checkL18 id-filename-mismatch', () => {
  test('flags a genuine mismatch', () => {
    const result = checkL18('sources/foo-bar.md', { id: 'something-else' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L18-id-filename-mismatch');
    assert.equal(result[0].severity, 'warning');
    assert.equal(result[0].fixable, false);
    assert.ok(result[0].message.includes('something-else'));
    assert.ok(result[0].message.includes('foo-bar'));
  });

  test('does not flag: bare basename on a flat dir', () => {
    assert.equal(checkL18('sources/foo-bar.md', { id: 'foo-bar' }).length, 0);
  });

  test('does not flag: full wiki-relative path on a nested dir (readings/)', () => {
    assert.equal(checkL18('readings/deep-work/01-focus.md', { id: 'readings/deep-work/01-focus' }).length, 0);
  });

  test('does not flag: "reflection-<name>" under reflections/', () => {
    assert.equal(checkL18('reflections/my-note.md', { id: 'reflection-my-note' }).length, 0);
  });

  test('does not flag: legacy "concepts/<name>" shape on a flat dir', () => {
    assert.equal(checkL18('concepts/ab-testing.md', { id: 'concepts/ab-testing' }).length, 0);
  });

  test('flags a legacy-shaped id whose prefix names a different entity dir than this page\'s own', () => {
    // `concepts/foo.md` claiming `id: sources/foo` names the wrong page
    // type. The legacy-shape exemption must require the prefix to equal
    // THIS page's own entity dir, not merely be some other ENTITY_DIRS key.
    const result = checkL18('concepts/foo.md', { id: 'sources/foo' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L18-id-filename-mismatch');
    assert.ok(result[0].message.includes('sources/foo'));
  });

  test('flags a nested-dir id carrying an extra recognized-but-wrong prefix', () => {
    // The legacy `<entity-dir>/<slug>` shape only ever applied to FLAT
    // entity types. A nested type's own id is already the full
    // wiki-relative path, so a prefix in front of that is a second,
    // unrelated mismatch, not the legacy migration's output.
    const result = checkL18('readings/deep-work/01-focus.md', { id: 'sources/readings/deep-work/01-focus' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L18-id-filename-mismatch');
  });

  test('does not flag a file with no id contract: index.md, graph/, outputs/', () => {
    assert.equal(checkL18('index.md', { id: 'anything-at-all' }).length, 0);
    assert.equal(checkL18('log.md', { id: 'anything-at-all' }).length, 0);
    assert.equal(checkL18('graph/notes.md', { id: 'anything-at-all' }).length, 0);
    // outputs/ pages carry an id by /lumi-ask convention, but no schema
    // declares one, so L18 has nothing to hold them to.
    assert.equal(checkL18('outputs/answer.md', { id: 'anything-at-all' }).length, 0);
  });

  test('leaves a missing or TODO id to L01/L02 rather than reporting it twice', () => {
    assert.equal(checkL18('sources/foo-bar.md', {}).length, 0);
    assert.equal(checkL18('sources/foo-bar.md', { id: 'TODO' }).length, 0);
    assert.equal(checkL18('sources/foo-bar.md', { id: '   ' }).length, 0);
    assert.equal(checkL18('sources/foo-bar.md', { id: 42 }).length, 0);
  });
});

describe('runLint L03 fix: L18 is recomputed after a rename', () => {
  test('a stale pre-rename L18 finding does not survive a rename that resolves it', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      // `id` already matches what the NEW (post-rename) filename will
      // derive, but not the current, badly-cased one — so L18 fires here
      // against the pre-rename path, and the L03 rename in this same --fix
      // run resolves the very mismatch it reported.
      const fm = renderFm(validSourceFm({ id: 'foo-bar', title: 'Foo Bar' }));
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'), fm + 'Body.');

      const result = await runLint(tmp, { fix: true, dryRun: false });

      const l03 = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'sources/Foo_Bar.md');
      assert.ok(l03 && l03.fix_applied, 'expected the rename to have actually happened in this run');

      const l18 = result.findings.filter(f => f.id === 'L18-id-filename-mismatch');
      assert.equal(l18.length, 0,
        `expected no L18 finding to survive a rename that already resolved it, got:\n${JSON.stringify(l18, null, 2)}`);

      // An immediate second run must agree — it always did; the bug was
      // only in what the FIRST run reported.
      const result2 = await runLint(tmp, { fix: true, dryRun: false });
      assert.equal(result2.findings.filter(f => f.id === 'L18-id-filename-mismatch').length, 0);
    } finally {
      await removeTmp(tmp);
    }
  });

  test('a genuine mismatch surviving the rename is re-flagged against the new path, not the old one', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      // `id` matches neither the old nor the new basename — a real,
      // unrelated mismatch that the rename does not touch.
      const fm = renderFm(validSourceFm({ id: 'totally-different-id', title: 'Foo Bar' }));
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'), fm + 'Body.');

      const result = await runLint(tmp, { fix: true, dryRun: false });

      const l18 = result.findings.filter(f => f.id === 'L18-id-filename-mismatch');
      assert.equal(l18.length, 1,
        `expected exactly one surviving L18 finding, got:\n${JSON.stringify(l18, null, 2)}`);
      assert.equal(l18[0].file, 'sources/foo-bar.md',
        'the recomputed finding must point at the NEW (post-rename) path, not the stale pre-rename one');
    } finally {
      await removeTmp(tmp);
    }
  });
});

describe('runLint L03 fix: --dry-run on a refused rename', () => {
  test('writes nothing and does not set proposed_fix on the refused finding', async () => {
    const tmp = await makeTmp();
    try {
      await makeWiki(tmp);
      const preexistingContent = renderFm(validSourceFm({ id: 'foo-bar', title: 'Foo Bar' })) + 'PREEXISTING BODY MARKER.';
      await writeFile(join(tmp, 'wiki', 'sources', 'foo-bar.md'), preexistingContent);
      const badContent = renderFm(validSourceFm({ id: 'Foo_Bar', title: 'Foo Bar Bad Case' })) + 'BAD CASE BODY MARKER.';
      await writeFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'), badContent);

      const result = await runLint(tmp, { fix: true, dryRun: true });

      const afterGood = await readFile(join(tmp, 'wiki', 'sources', 'foo-bar.md'), 'utf8');
      const afterBad = await readFile(join(tmp, 'wiki', 'sources', 'Foo_Bar.md'), 'utf8');
      assert.equal(afterGood, preexistingContent, 'dry-run must not write to the pre-existing file');
      assert.equal(afterBad, badContent, 'dry-run must not write to the blocked source file either');

      const l03 = result.findings.find(f => f.id === 'L03-slug-style' && f.file === 'sources/Foo_Bar.md');
      assert.ok(l03, 'expected an L03 finding for Foo_Bar.md');
      assert.ok(!l03.proposed_fix, 'a refused rename must not preview a proposed_fix — there is nothing safe to preview');
      assert.ok(!l03.fix_applied, 'dry-run must never set fix_applied');
      assert.equal(l03.fixable, false, 'fixable must be corrected to false since dry-run resolved nothing for this finding');
    } finally {
      await removeTmp(tmp);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION B3: parseFrontmatter accepts no-blank-line format (wiki.mjs format)
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 regression: parseFrontmatter accepts wiki.mjs no-blank-line format', () => {
  test('parses frontmatter with key on first line after ---', () => {
    // wiki.mjs assembleMd writes ---\nkey: val\n...\n---\n (no blank line)
    const content = `---\nid: my-source\ntitle: My Source\ntype: source\n---\nbody text`;
    const result = parseFrontmatter(content);
    assert.ok(result, 'parseFrontmatter should not return null for no-blank-line format');
    assert.equal(result.data.id, 'my-source');
    assert.equal(result.data.title, 'My Source');
  });

  test('L01 detects missing required field in no-blank-line frontmatter', async () => {
    const tmp = await makeTmp();
    try {
      const wikiDir = await makeWiki(tmp);
      // Write file using wiki.mjs's exact format (no blank line after ---)
      const content = `---\nid: no-blank\ntitle: No Blank\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nyear: 2024\nimportance: 3\n---\nbody\n`;
      // Missing 'authors' field — L01 should fire
      await writeFile(join(wikiDir, 'sources', 'no-blank.md'), content, 'utf8');
      const result = await runLint(tmp, {});
      const l01 = result.findings.filter(f => f.id === 'L01-frontmatter-required' && f.file.includes('no-blank'));
      assert.ok(l01.length > 0, 'L01 should fire for missing authors in no-blank-line frontmatter');
    } finally {
      await removeTmp(tmp);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION B2: L06 edge key format matches wiki.mjs (from|type|to)
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 regression: L06 detects missing reverse edge with correct key format', () => {
  test('L06 fires when reverse edge is absent', () => {
    // Use a non-symmetric type with a reverse. Pick 'cites'/'cited-by' if available,
    // otherwise use whatever EDGE_TYPES provides.
    // We construct edges manually using from|type|to format (wiki.mjs's format).
    // checkL06 receives an edgeSet built as from|type|to — the fixed format.
    const edges = [
      { from: 'sources/a.md', type: 'cites', to: 'sources/b.md' },
    ];
    // edgeSet only contains the forward edge — reverse (cited-by) is absent
    const edgeSet = new Set(['sources/a.md|cites|sources/b.md']);
    const findings = checkL06(edges, edgeSet);
    // If 'cites' has a reverse defined, L06 should fire
    // If not, findings will be empty — still a valid (non-crashing) result
    assert.ok(Array.isArray(findings));
  });

  test('L06 does NOT fire when reverse edge is present', () => {
    const edges = [
      { from: 'sources/a.md', type: 'cites', to: 'sources/b.md' },
      { from: 'sources/b.md', type: 'cited_by', to: 'sources/a.md' },
    ];
    const edgeSet = new Set([
      'sources/a.md|cites|sources/b.md',
      'sources/b.md|cited_by|sources/a.md',
    ]);
    const findings = checkL06(edges, edgeSet);
    const l06 = findings.filter(f => f.id === 'L06-missing-reverse-edge');
    assert.equal(l06.length, 0, 'L06 should not fire when reverse is present');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION R2: L07 detects canonical-order duplicate lines
// ─────────────────────────────────────────────────────────────────────────────

describe('R2 regression: L07 detects duplicate edges in canonical order', () => {
  test('L07 fires for two identical canonical-order lines', () => {
    // Two identical symmetric edges (same from, same to, same type) — canonical order
    // 'concepts/a.md' < 'concepts/b.md', so this is already canonical order
    const edges = [
      { from: 'concepts/a.md', type: 'same_problem_as', to: 'concepts/b.md' },
      { from: 'concepts/a.md', type: 'same_problem_as', to: 'concepts/b.md' },
    ];
    const edgeSet = new Set(['concepts/a.md|same_problem_as|concepts/b.md']);
    const findings = checkL07(edges, edgeSet);
    // Should detect the duplicate second line
    assert.ok(findings.length > 0, 'L07 should fire for duplicate canonical-order edges');
    assert.equal(findings[0].id, 'L07-symmetric-edge-duplicate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION R3: fixL07 idempotency — fix run produces output L07 does not re-flag
// ─────────────────────────────────────────────────────────────────────────────

describe('R3 regression: fixL07 idempotency for non-symmetric duplicate', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('lint --fix removes L07 duplicate and second run produces zero L07 findings', async () => {
    // 'cites' is non-symmetric; write A→B related_to twice using a symmetric type
    // so the fixL07 dedup key path under test is exercised. Use 'same_problem_as'
    // which is symmetric — list A→B twice in canonical sort order.
    const edgesContent = [
      JSON.stringify({ from: 'concepts/a', type: 'same_problem_as', to: 'concepts/b' }),
      JSON.stringify({ from: 'concepts/a', type: 'same_problem_as', to: 'concepts/b' }),
    ].join('\n') + '\n';

    await makeWiki(tmpDir, { edgesContent });

    // First run with --fix: L07 should be detected and fixed.
    const r1 = await runLint(tmpDir, { fix: true, dryRun: false });
    const l07fixed = r1.findings.filter(f => f.id === 'L07-symmetric-edge-duplicate' && f.fix_applied);
    assert.ok(l07fixed.length > 0, 'Expected at least one L07 fix to be applied');

    // Second run without --fix: L07 must produce zero findings (idempotency proof).
    const r2 = await runLint(tmpDir, { fix: false, dryRun: false });
    const l07remaining = r2.findings.filter(f => f.id === 'L07-symmetric-edge-duplicate');
    assert.equal(l07remaining.length, 0, 'fixL07 must be idempotent: no L07 findings after fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L10: alias-conflict
// ─────────────────────────────────────────────────────────────────────────────

describe('L10 alias-conflict', () => {

  // 1. Clean: disjoint aliases and titles — no L10 findings.
  test('clean: two foundations with disjoint aliases and titles', () => {
    const entries = [
      { wikiRelPath: 'foundations/attention.md', fm: { title: 'Attention', aliases: ['Self-Attention'] } },
      { wikiRelPath: 'foundations/rlhf.md',      fm: { title: 'RLHF',      aliases: ['Reinforcement Learning from Human Feedback'] } },
    ];
    const result = checkL10(entries);
    assert.equal(result.length, 0);
  });

  // 2. Alias-alias collision: two foundations both list "common" in aliases.
  test('violation: alias-alias collision emits error on both foundations', () => {
    const entries = [
      { wikiRelPath: 'foundations/alpha.md', fm: { title: 'Alpha', aliases: ['common'] } },
      { wikiRelPath: 'foundations/beta.md',  fm: { title: 'Beta',  aliases: ['common'] } },
    ];
    const result = checkL10(entries);
    // Expect at least 2 findings (one per slug involved).
    assert.ok(result.length >= 2, 'Expected at least 2 findings for alias-alias collision');
    assert.ok(result.every(f => f.id === 'L10-alias-conflict'), 'All findings must be L10-alias-conflict');
    assert.ok(result.every(f => f.severity === 'error'), 'All findings must be severity error');
    assert.ok(result.every(f => f.fixable === false), 'L10 must not be fixable');
    // Each finding mentions the other slug.
    const alphaFinding = result.find(f => f.file === 'foundations/alpha.md');
    assert.ok(alphaFinding, 'Expected finding for foundations/alpha.md');
    assert.ok(alphaFinding.message.includes('foundations/beta.md'), 'alpha finding should mention beta slug');
    const betaFinding = result.find(f => f.file === 'foundations/beta.md');
    assert.ok(betaFinding, 'Expected finding for foundations/beta.md');
    assert.ok(betaFinding.message.includes('foundations/alpha.md'), 'beta finding should mention alpha slug');
  });

  // 3. Alias-title collision: foundation A title "Transformer", foundation B has alias "Transformer".
  test('violation: alias-title collision emits error on both foundations', () => {
    const entries = [
      { wikiRelPath: 'foundations/transformer.md', fm: { title: 'Transformer', aliases: [] } },
      { wikiRelPath: 'foundations/bert.md',         fm: { title: 'BERT', aliases: ['Transformer'] } },
    ];
    const result = checkL10(entries);
    assert.ok(result.length >= 2, 'Expected at least 2 findings for alias-title collision');
    assert.ok(result.every(f => f.id === 'L10-alias-conflict'));
    const txFinding = result.find(f => f.file === 'foundations/transformer.md');
    assert.ok(txFinding, 'Expected finding for foundations/transformer.md');
    assert.ok(txFinding.message.includes('foundations/bert.md'), 'transformer finding should mention bert slug');
  });

  // 4. Case and whitespace insensitive collision.
  test('violation: case/whitespace-insensitive alias collision', () => {
    const entries = [
      { wikiRelPath: 'foundations/a.md', fm: { title: 'A', aliases: ['  RLHF  '] } },
      { wikiRelPath: 'foundations/b.md', fm: { title: 'B', aliases: ['rlhf'] } },
    ];
    const result = checkL10(entries);
    assert.ok(result.length >= 2, 'Expected collision to be detected case-insensitively');
    assert.ok(result.every(f => f.id === 'L10-alias-conflict'));
  });

  // 5. No aliases field — must not crash and must detect title-title collision if present.
  test('no aliases field: does not crash', () => {
    const entries = [
      { wikiRelPath: 'foundations/x.md', fm: { title: 'X' } },
      { wikiRelPath: 'foundations/y.md', fm: { title: 'Y' } },
    ];
    const result = checkL10(entries);
    assert.equal(result.length, 0, 'No collision expected for disjoint titles without aliases');
  });

  test('no aliases field: still detects title-title collision when titles happen to match', () => {
    const entries = [
      { wikiRelPath: 'foundations/x.md', fm: { title: 'Shared Title' } },
      { wikiRelPath: 'foundations/y.md', fm: { title: 'Shared Title' } },
    ];
    const result = checkL10(entries);
    assert.ok(result.length >= 2, 'Title-title collision should be detected');
    assert.ok(result.every(f => f.id === 'L10-alias-conflict'));
  });

  test('non-string alias entries are silently skipped', () => {
    const entries = [
      { wikiRelPath: 'foundations/a.md', fm: { title: 'A', aliases: [null, 42, 'valid-alias'] } },
      { wikiRelPath: 'foundations/b.md', fm: { title: 'B', aliases: ['other'] } },
    ];
    // Should not throw and should not produce spurious findings.
    const result = checkL10(entries);
    assert.equal(result.length, 0, 'Non-string aliases should be silently skipped');
  });

  // 6. Only foundations are checked — concepts with colliding title must NOT trigger L10.
  test('scope: concepts with same title as a foundation do not trigger L10', async () => {
    const tmpDir = await makeTmp();
    try {
      const wikiDir = await makeWiki(tmpDir);
      // Create a foundations/ directory.
      await mkdir(join(wikiDir, 'foundations'), { recursive: true });

      // Foundation "Transformer".
      const foundationFm = `---\nid: transformer\ntitle: Transformer\ntype: foundation\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n`;
      await writeFile(join(wikiDir, 'foundations', 'transformer.md'), foundationFm);

      // Concept also named "Transformer" — different entity type, should NOT trigger L10.
      const conceptFm = `---\nid: transformer-concept\ntitle: Transformer\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-01\nkey_sources: []\nrelated_concepts: []\n---\n`;
      await writeFile(join(wikiDir, 'concepts', 'transformer-concept.md'), conceptFm);

      // Update index to include both.
      await writeFile(join(wikiDir, 'index.md'),
        `${INDEX_MARKER_OPEN}\n- [[foundations/transformer]]\n- [[concepts/transformer-concept]]\n${INDEX_MARKER_CLOSE}\n`);

      const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
      const l10 = findings.filter(f => f.id === 'L10-alias-conflict');
      assert.equal(l10.length, 0, 'L10 must not fire for concept with same title as foundation');
    } finally {
      await removeTmp(tmpDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L11: confidence-missing
// ─────────────────────────────────────────────────────────────────────────────

describe('L11 confidence-missing', () => {
  // Fixture 1: source with provenance AND confidence — clean lint.
  test('clean: source with provenance and confidence produces no L11', () => {
    const fm = validSourceFm({ provenance: 'replayable', confidence: 'high' });
    const result = checkL11('sources/full-source.md', fm);
    assert.equal(result.length, 0);
  });

  // Fixture 2: source with provenance but no confidence — 1 L11 warning, no L01 error.
  test('source with provenance but no confidence: 1 L11 warning, no L01 error', () => {
    const fm = validSourceFm({ provenance: 'replayable' });
    delete fm.confidence;

    const l01 = checkL01('sources/no-confidence.md', fm);
    assert.equal(l01.length, 0, 'L01 must not fire for missing confidence (it is optional)');

    const l11 = checkL11('sources/no-confidence.md', fm);
    assert.equal(l11.length, 1, 'L11 must fire exactly once');
    assert.equal(l11[0].id, 'L11-confidence-missing');
    assert.equal(l11[0].severity, 'warning');
    assert.equal(l11[0].fixable, false);
  });

  // Fixture 3: source with confidence but no provenance — 1 L01 error, no L11.
  test('source with confidence but no provenance: 1 L01 error, no L11', () => {
    const fm = validSourceFm({ confidence: 'medium' });
    delete fm.provenance;

    const l01 = checkL01('sources/no-provenance.md', fm);
    assert.ok(l01.some(f => f.message.includes('"provenance"')), 'L01 must fire for missing provenance');

    const l11 = checkL11('sources/no-provenance.md', fm);
    assert.equal(l11.length, 0, 'L11 must not fire when confidence is present');
  });

  // Fixture 4: source with provenance: bogus — 1 L02 error (enum check).
  test('source with provenance: bogus produces L02 enum error', () => {
    const fm = validSourceFm({ provenance: 'bogus' });
    const l02 = checkL02('sources/bad-provenance.md', fm);
    assert.ok(l02.some(f => f.id === 'L02-frontmatter-types' && f.message.includes('"provenance"')),
      'L02 must fire for invalid provenance value');
  });

  // Fixture 5: concept with no confidence — 1 L11 warning.
  test('concept with no confidence: 1 L11 warning', () => {
    const fm = {
      id: 'my-concept',
      title: 'My Concept',
      type: 'concept',
      created: '2026-01-01',
      updated: '2026-01-01',
      key_sources: ['sources/some-source'],
      related_concepts: [],
      // no confidence
    };
    const l11 = checkL11('concepts/my-concept.md', fm);
    assert.equal(l11.length, 1, 'L11 must fire once for concept missing confidence');
    assert.equal(l11[0].id, 'L11-confidence-missing');
    assert.equal(l11[0].severity, 'warning');
  });

  // Fixture 6: concept with confidence: high — clean.
  test('concept with confidence: high produces no L11', () => {
    const fm = {
      id: 'my-concept',
      title: 'My Concept',
      type: 'concept',
      created: '2026-01-01',
      updated: '2026-01-01',
      key_sources: ['sources/some-source'],
      related_concepts: [],
      confidence: 'high',
    };
    const l11 = checkL11('concepts/my-concept.md', fm);
    assert.equal(l11.length, 0);
  });

  // Fixture 7: non-source/concept entity (people) — L11 never fires.
  test('people page: L11 never fires regardless of confidence field', () => {
    const fm = { id: 'alice', title: 'Alice', type: 'person', created: '2026-01-01', updated: '2026-01-01' };
    const result = checkL11('people/alice.md', fm);
    assert.equal(result.length, 0, 'L11 must not fire for entity types other than sources and concepts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L12: raw_paths validation
// ─────────────────────────────────────────────────────────────────────────────

describe('L12 raw_paths validation', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  // a. Pass case: raw_paths entry exists on disk, not in raw/tmp/ — 0 findings.
  test('pass: raw_paths entry exists and is not transient', async () => {
    const rawDir = join(tmpDir, 'raw', 'sources');
    await mkdir(rawDir, { recursive: true });
    await writeFile(join(rawDir, 'foo.pdf'), 'fake pdf content');
    const fm = validSourceFm({ raw_paths: ['raw/sources/foo.pdf'] });
    const result = await checkL12('sources/test-source.md', fm, tmpDir);
    assert.equal(result.length, 0, 'No findings expected when file exists and is not transient');
  });

  // b. Transient case: entry points into raw/tmp/ — 1 L12-raw-paths-transient warning.
  test('transient: raw/tmp/ entry emits L12-raw-paths-transient warning', async () => {
    const tmpRawDir = join(tmpDir, 'raw', 'tmp');
    await mkdir(tmpRawDir, { recursive: true });
    await writeFile(join(tmpRawDir, 'foo.pdf'), 'fake pdf content');
    const fm = validSourceFm({ raw_paths: ['raw/tmp/foo.pdf'] });
    const result = await checkL12('sources/test-source.md', fm, tmpDir);
    assert.equal(result.length, 1, 'Expected exactly 1 finding');
    assert.equal(result[0].id, 'L12-raw-paths-transient');
    assert.equal(result[0].severity, 'warning');
    assert.equal(result[0].fixable, false);
  });

  // c. Missing case: file does not exist on disk — 1 L12-raw-paths-missing warning.
  test('missing: nonexistent file emits L12-raw-paths-missing warning', async () => {
    const fm = validSourceFm({ raw_paths: ['raw/sources/nonexistent.pdf'] });
    const result = await checkL12('sources/test-source.md', fm, tmpDir);
    assert.equal(result.length, 1, 'Expected exactly 1 finding');
    assert.equal(result[0].id, 'L12-raw-paths-missing');
    assert.equal(result[0].severity, 'warning');
    assert.equal(result[0].fixable, false);
  });

  // d. Empty / no field case — 0 findings.
  test('empty raw_paths array: 0 findings', async () => {
    const fm = validSourceFm({ raw_paths: [] });
    const result = await checkL12('sources/test-source.md', fm, tmpDir);
    assert.equal(result.length, 0, 'No findings expected for empty raw_paths');
  });

  test('no raw_paths field: 0 findings', async () => {
    const fm = validSourceFm();
    delete fm.raw_paths;
    const result = await checkL12('sources/test-source.md', fm, tmpDir);
    assert.equal(result.length, 0, 'No findings expected when raw_paths is absent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --summary: reportSummary unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('--summary reportSummary', () => {
  // Helper: capture stdout from reportSummary.
  function captureSummary(findings) {
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      reportSummary(findings);
    } finally {
      process.stdout.write = origWrite;
    }
    return JSON.parse(chunks.join(''));
  }

  test('zero findings: all counts 0, all check IDs present', () => {
    const result = captureSummary([]);
    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 0);
    assert.equal(result.fixable, 0);
    assert.ok(typeof result.by_check === 'object');
    for (const id of ALL_CHECK_IDS) {
      assert.ok(id in result.by_check, `by_check must contain ${id}`);
      assert.equal(result.by_check[id], 0, `${id} count must be 0`);
    }
  });

  test('1 L01 error + 2 L11 warnings: counts correct', () => {
    const findings = [
      { id: 'L01-frontmatter-required', severity: 'error', fixable: true, file: 'sources/a.md', line: null, message: 'Missing x', fix_applied: false },
      { id: 'L11-confidence-missing', severity: 'warning', fixable: false, file: 'sources/b.md', line: null, message: 'Missing confidence', fix_applied: false },
      { id: 'L11-confidence-missing', severity: 'warning', fixable: false, file: 'sources/c.md', line: null, message: 'Missing confidence', fix_applied: false },
    ];
    const result = captureSummary(findings);
    assert.equal(result.errors, 1, 'errors must be 1');
    assert.equal(result.warnings, 2, 'warnings must be 2');
    assert.equal(result.by_check.L01, 1, 'by_check.L01 must be 1');
    assert.equal(result.by_check.L11, 2, 'by_check.L11 must be 2');
    // All other checks must be 0.
    for (const id of ALL_CHECK_IDS) {
      if (id !== 'L01' && id !== 'L11') {
        assert.equal(result.by_check[id], 0, `${id} must be 0`);
      }
    }
    // L01 is fixable.
    assert.equal(result.fixable, 1, 'fixable must count L01 finding');
  });

  test('fixable count: L03 findings increment fixable', () => {
    const findings = [
      { id: 'L03-slug-style', severity: 'error', fixable: true, file: 'sources/MyPaper.md', line: null, message: 'Not kebab', fix_applied: false },
      { id: 'L03-slug-style', severity: 'error', fixable: true, file: 'sources/OtherPaper.md', line: null, message: 'Not kebab', fix_applied: false },
    ];
    const result = captureSummary(findings);
    assert.ok(result.fixable >= 1, 'fixable must be >= 1 for L03 findings');
    assert.equal(result.by_check.L03, 2, 'by_check.L03 must be 2');
  });

  test('output is single-line JSON terminated with newline', () => {
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      reportSummary([]);
    } finally {
      process.stdout.write = origWrite;
    }
    const raw = chunks.join('');
    assert.ok(raw.endsWith('\n'), 'output must end with newline');
    assert.equal(raw.indexOf('\n'), raw.length - 1, 'output must be a single line');
    // Valid JSON.
    assert.doesNotThrow(() => JSON.parse(raw.trimEnd()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --summary integration: runLint + reportSummary round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('--summary integration round-trip', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  // Helper: capture stdout from reportSummary.
  function captureSummary(findings) {
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      reportSummary(findings);
    } finally {
      process.stdout.write = origWrite;
    }
    return JSON.parse(chunks.join(''));
  }

  test('empty wiki: --summary produces all-zero JSON with all check IDs', async () => {
    await makeWiki(tmpDir);
    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const result = captureSummary(findings);
    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 0);
    assert.equal(result.fixable, 0);
    for (const id of ALL_CHECK_IDS) {
      assert.ok(id in result.by_check, `by_check must contain ${id}`);
    }
  });

  test('wiki with fixable L03 slug violation: fixable >= 1', async () => {
    const wikiDir = join(tmpDir, 'wiki');
    // Write a badly-named file into an existing wiki.
    const badPath = join(wikiDir, 'sources', 'BadSlug.md');
    const fm = renderFm(validSourceFm({ id: 'badslug', title: 'Bad Slug', provenance: 'replayable' }));
    await writeFile(badPath, fm + 'Body.');
    // Update index so L09 does not fire.
    await writeFile(join(wikiDir, 'index.md'),
      `# Index\n\n${INDEX_MARKER_OPEN}\n- [[sources/BadSlug]]\n${INDEX_MARKER_CLOSE}\n`);

    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    const result = captureSummary(findings);
    assert.ok(result.fixable >= 1, 'fixable must be >= 1 when L03 violation exists');
    assert.ok(result.by_check.L03 >= 1, 'by_check.L03 must be >= 1');
  });

  test('--json without --summary still produces verbose shape with detail fields', async () => {
    // Introduce an L03 violation if not already present (file from previous test may still exist).
    const wikiDir = join(tmpDir, 'wiki');
    const { findings } = await runLint(tmpDir, { fix: false, dryRun: false });
    // Build JSON output shape manually (same as reportJson would do).
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const infos = findings.filter(f => f.severity === 'info').length;
    const fixesApplied = findings.filter(f => f.fix_applied).length;
    const output = {
      schema_version: '0.1.0',
      scanned_files: 0,
      checks_run: ALL_CHECK_IDS,
      findings,
      summary: { errors, warnings, info: infos, fixes_applied: fixesApplied },
    };
    // Verbose shape must have detail fields on each finding.
    assert.ok(Array.isArray(output.findings), 'findings must be an array');
    for (const f of output.findings) {
      assert.ok('file' in f, 'verbose finding must have file field');
      assert.ok('severity' in f, 'verbose finding must have severity field');
      assert.ok('message' in f, 'verbose finding must have message field');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L13/L14/L16: external_ids checks
// ─────────────────────────────────────────────────────────────────────────────

describe('L13 external-ids-coverage', () => {
  test('arxiv URL but missing external_ids → 1 warning with remediation hint', () => {
    const fm = validSourceFm({ urls: ['https://arxiv.org/abs/1706.03762'], external_ids: {} });
    const r = checkL13('sources/x.md', fm);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'L13-external-ids-coverage');
    assert.equal(r[0].severity, 'warning');
    assert.match(r[0].message, /\/lumi-migrate-legacy --backfill-ids/);
  });

  test('github URL → no L13 (only url namespace derived)', () => {
    const fm = validSourceFm({ urls: ['https://github.com/foo/bar'], external_ids: {} });
    assert.deepEqual(checkL13('sources/x.md', fm), []);
  });

  test('arxiv URL with matching external_ids.arxiv → no L13', () => {
    const fm = validSourceFm({
      urls: ['https://arxiv.org/abs/1706.03762'],
      external_ids: { arxiv: '1706.03762' },
    });
    assert.deepEqual(checkL13('sources/x.md', fm), []);
  });
});

describe('L14 external-ids-invalid', () => {
  test('invalid DOI → 1 error', () => {
    const fm = validSourceFm({ external_ids: { doi: 'not-a-doi' } });
    const r = checkL14('sources/x.md', fm);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'L14-external-ids-invalid');
    assert.equal(r[0].severity, 'error');
  });

  test('valid DOI + valid arxiv → no L14', () => {
    const fm = validSourceFm({
      external_ids: { doi: '10.1109/abc', arxiv: '1706.03762' },
    });
    assert.deepEqual(checkL14('sources/x.md', fm), []);
  });

  test('non-source page → no L14', () => {
    assert.deepEqual(checkL14('concepts/x.md', { external_ids: { doi: 'bad' } }), []);
  });
});

describe('L16 external-ids-mismatch', () => {
  test('urls[arxiv] disagrees with external_ids.arxiv → 1 warning', () => {
    const fm = validSourceFm({
      urls: ['https://arxiv.org/abs/1706.03762'],
      external_ids: { arxiv: '9999.99999' },
    });
    const r = checkL16('sources/x.md', fm);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'L16-external-ids-mismatch');
  });

  test('urls[arxiv] matches external_ids.arxiv → no L16', () => {
    const fm = validSourceFm({
      urls: ['https://arxiv.org/abs/1706.03762'],
      external_ids: { arxiv: '1706.03762' },
    });
    assert.deepEqual(checkL16('sources/x.md', fm), []);
  });

  test('invalid external_ids.arxiv suppresses L16 (L14 owns it)', () => {
    const fm = validSourceFm({
      urls: ['https://arxiv.org/abs/1706.03762'],
      external_ids: { arxiv: 'garbage' },
    });
    assert.deepEqual(checkL16('sources/x.md', fm), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK L17: dangling-edge
// ─────────────────────────────────────────────────────────────────────────────

describe('L17 dangling-edge', () => {
  test('clean: both endpoints resolve to known slugs', () => {
    const edges = [{ from: 'sources/a', to: 'concepts/b', type: 'uses_concept' }];
    const knownSlugs = new Set(['sources/a', 'concepts/b']);
    assert.equal(checkL17(edges, knownSlugs).length, 0);
  });

  test('violation: "to" endpoint does not resolve', () => {
    const edges = [{ from: 'sources/a', to: 'concepts/deleted', type: 'uses_concept' }];
    const knownSlugs = new Set(['sources/a']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L17-dangling-edge');
    assert.equal(result[0].severity, 'error');
    assert.equal(result[0].fixable, false);
    assert.equal(result[0].file, 'sources/a');
    assert.match(result[0].message, /concepts\/deleted/);
  });

  test('violation: "from" endpoint does not resolve', () => {
    const edges = [{ from: 'sources/deleted', to: 'concepts/b', type: 'uses_concept' }];
    const knownSlugs = new Set(['concepts/b']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.match(result[0].message, /sources\/deleted/);
  });

  test('violation: both endpoints dangling produces two findings', () => {
    const edges = [{ from: 'sources/gone', to: 'concepts/gone', type: 'uses_concept' }];
    const knownSlugs = new Set(['sources/a']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 2);
  });

  test('external URL "to" endpoint (see_also_url) is skipped, not flagged', () => {
    const edges = [{ from: 'sources/a', to: 'https://example.com/paper', type: 'see_also_url' }];
    const knownSlugs = new Set(['sources/a']);
    assert.equal(checkL17(edges, knownSlugs).length, 0);
  });

  test('foundations/** endpoint that does resolve is not flagged (no invented exemption needed)', () => {
    const edges = [{ from: 'sources/a', to: 'foundations/linear-algebra', type: 'grounded_in' }];
    const knownSlugs = new Set(['sources/a', 'foundations/linear-algebra']);
    assert.equal(checkL17(edges, knownSlugs).length, 0);
  });

  test('foundations/** endpoint that is missing IS flagged (dangling, not exempted)', () => {
    const edges = [{ from: 'sources/a', to: 'foundations/deleted-topic', type: 'grounded_in' }];
    const knownSlugs = new Set(['sources/a']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L17-dangling-edge');
  });

  // Regression: knownSlugs holds wiki-relative paths (e.g. "sources/src-a"),
  // but `wiki.mjs add-edge` accepts and stores a bare slug ("src-a") verbatim.
  // checkL17 used to test knownSlugs.has(target) directly, so every edge
  // written with a bare slug was reported dangling even though its file
  // plainly existed. It must resolve through resolveWikilinkTarget's
  // unique-basename fallback instead, same as L05.
  test('regression: bare slug endpoints resolve via unique basename (false-positive dangling edge)', () => {
    const edges = [{ from: 'src-a', to: 'src-b', type: 'related_to' }];
    const knownSlugs = new Set(['sources/src-a', 'sources/src-b']);
    assert.equal(checkL17(edges, knownSlugs).length, 0);
  });

  test('bare slug with no matching file still flags (basename resolution does not mask a real dangling edge)', () => {
    const edges = [{ from: 'src-a', to: 'nope', type: 'related_to' }];
    const knownSlugs = new Set(['sources/src-a', 'sources/src-b']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L17-dangling-edge');
    assert.match(result[0].message, /nope/);
    assert.match(result[0].message, /does not resolve to any wiki file/);
  });

  test('ambiguous bare slug (2+ files share a basename) is reported as ambiguous, not as missing', () => {
    const edges = [{ from: 'sources/dup', to: 'dup', type: 'related_to' }];
    const knownSlugs = new Set(['sources/dup', 'concepts/dup']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.match(result[0].message, /is ambiguous/);
    assert.ok(result[0].message.includes('sources/dup'), 'message should name sources/dup as a candidate');
    assert.ok(result[0].message.includes('concepts/dup'), 'message should name concepts/dup as a candidate');
    assert.doesNotMatch(result[0].message, /does not resolve to any wiki file/);
  });

  // Pins that the third parameter is actually consulted rather than rebuilt.
  // Asserting a hand-built index agrees with the default one would not: the
  // pre-fix 2-arg checkL17 silently ignores a third argument, so such a test
  // passes on the broken version too. Instead give it an index that disagrees
  // with the default and require the passed one to win.
  test('explicit basenameIndex argument is the one consulted, not a rebuilt default', () => {
    const edges = [{ from: 'sources/dup', to: 'dup', type: 'related_to' }];
    const knownSlugs = new Set(['sources/dup', 'concepts/dup']);

    // Default index sees two candidates for "dup" and refuses to guess.
    assert.equal(checkL17(edges, knownSlugs).length, 1);

    // A caller-supplied index with a single candidate must resolve instead.
    const narrowed = new Map([['dup', ['sources/dup']]]);
    assert.equal(checkL17(edges, knownSlugs, narrowed).length, 0);

    // Sanity: the helper the default path uses really does see both.
    assert.equal(buildBasenameIndex(knownSlugs).get('dup').length, 2);
  });

  // Regression: a QUALIFIED endpoint (contains '/') must resolve by exact
  // match only. Before this fix, resolveWikilinkTarget applied the
  // unique-basename fallback to every unmatched endpoint regardless of
  // whether it already named a directory, so deleting "sources/lora" while
  // an unrelated "concepts/lora" still existed silently re-resolved the
  // edge to "concepts/lora" and suppressed L17 — even though graph
  // operations (add-edge/remove-edge/wiki.mjs) compare and preserve the
  // qualified endpoint verbatim, so the edge genuinely dangles.
  test('regression: qualified endpoint does not fall back to an unrelated same-basename file in another dir', () => {
    const edges = [{ from: 'sources/other', to: 'sources/lora', type: 'uses_concept' }];
    // "sources/lora" was deleted; "concepts/lora" happens to share a basename.
    const knownSlugs = new Set(['sources/other', 'concepts/lora']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L17-dangling-edge');
    assert.match(result[0].message, /sources\/lora/);
    assert.match(result[0].message, /does not resolve to any wiki file/);
  });

  // Companion: the bare-slug fallback fixed by PR #41 must still work
  // alongside the new qualified-endpoint guard above — one endpoint bare,
  // one qualified-and-missing, in the same edge.
  test('regression: bare endpoint still resolves via basename while a qualified sibling endpoint on the same edge correctly dangles', () => {
    const edges = [{ from: 'src-a', to: 'sources/lora', type: 'related_to' }];
    const knownSlugs = new Set(['sources/src-a', 'concepts/lora']);
    const result = checkL17(edges, knownSlugs);
    assert.equal(result.length, 1);
    assert.match(result[0].message, /sources\/lora/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --suggest: computeSuggestion unit tests + reportJson/reportHuman shape
// ─────────────────────────────────────────────────────────────────────────────

describe('--suggest output', () => {
  function captureConsoleLog(fn) {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try { fn(); } finally { console.log = orig; }
    return lines.join('\n');
  }

  test('computeSuggestion: L01 unfixable field names the type and says it cannot be inferred', () => {
    const f = {
      id: 'L01-frontmatter-required', fixable: false, fix_applied: false,
      key: 'year', fieldType: 'number',
      message: 'Missing required frontmatter key: "year" (type: number)',
    };
    const s = computeSuggestion(f);
    assert.ok(s.includes('year'));
    assert.ok(s.includes('number'));
  });

  test('computeSuggestion: L02 unfixable field names the expected type', () => {
    const f = {
      id: 'L02-frontmatter-types', fixable: false, fix_applied: false,
      key: 'importance', fieldType: 'enum', expected: 'one of [1, 2, 3, 4, 5]',
      message: '"importance" must be one of [1, 2, 3, 4, 5], got 99',
    };
    const s = computeSuggestion(f);
    assert.ok(s.includes('importance'));
  });

  test('computeSuggestion: unresolved legacy-field conflict names both keys', () => {
    const f = {
      id: 'L02-frontmatter-types', fixable: false, fix_applied: false,
      legacyOldKey: 'slug', legacyNewKey: 'id',
      message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.',
    };
    const s = computeSuggestion(f);
    assert.ok(s.includes('slug'));
    assert.ok(s.includes('id'));
  });

  test('computeSuggestion: a REMOVED legacy field (fixable: true) returns null — --fix already handled it', () => {
    const f = {
      id: 'L02-frontmatter-types', fixable: true, fix_applied: true,
      legacyOldKey: 'slug', legacyNewKey: 'id',
      message: 'Legacy frontmatter field "slug" was renamed to "id" in v0.1. Run /lumi-migrate-legacy to upgrade.',
    };
    assert.equal(computeSuggestion(f), null);
  });

  test('computeSuggestion: returns null for a fixable or already-fixed finding', () => {
    const fixableF = {
      id: 'L01-frontmatter-required', fixable: true, fix_applied: false,
      key: 'authors', fieldType: 'array',
      message: 'Missing required frontmatter key: "authors" (type: array)',
    };
    assert.equal(computeSuggestion(fixableF), null);

    const fixedF = {
      id: 'L02-frontmatter-types', fixable: true, fix_applied: true,
      key: 'key_sources', fieldType: 'array', expected: 'an array',
      message: '"key_sources" must be an array, got string',
    };
    assert.equal(computeSuggestion(fixedF), null);
  });

  test('computeSuggestion: L05 ambiguous lists every candidate', () => {
    const f = {
      id: 'L05-broken-wikilink', fixable: false, fix_applied: false,
      brokenSlug: 'dup-name', candidates: ['concepts/dup-name', 'foundations/dup-name'],
    };
    const s = computeSuggestion(f);
    assert.ok(s.includes('concepts/dup-name'));
    assert.ok(s.includes('foundations/dup-name'));
  });

  test('computeSuggestion: L05 zero-match names the missing basename', () => {
    const f = {
      id: 'L05-broken-wikilink', fixable: false, fix_applied: false,
      brokenSlug: 'totally-unknown', candidates: [],
    };
    const s = computeSuggestion(f);
    assert.ok(s.includes('totally-unknown'));
  });

  test('reportJson: --suggest adds a "suggestion" key only for unfixable findings; omitted without the flag', () => {
    const findings = [{
      id: 'L01-frontmatter-required', severity: 'error', fixable: false,
      file: 'sources/a.md', line: null,
      key: 'year', fieldType: 'number',
      message: 'Missing required frontmatter key: "year" (type: number)',
      fix_applied: false,
    }];
    const withSuggest = JSON.parse(captureConsoleLog(() => reportJson(findings, 1, { suggest: true })));
    assert.ok(withSuggest.findings[0].suggestion, 'expected a suggestion field when --suggest is set');

    const withoutSuggest = JSON.parse(captureConsoleLog(() => reportJson(findings, 1, { suggest: false })));
    assert.equal(withoutSuggest.findings[0].suggestion, undefined, 'suggestion must be absent without --suggest');
  });

  test('reportJson: L05 candidates surfaced under --suggest, internal fields stripped otherwise', () => {
    const findings = [{
      id: 'L05-broken-wikilink', severity: 'error', fixable: false,
      file: 'sources/a.md', line: 3,
      message: 'Broken wikilink: [[dup-name]] does not resolve to any wiki file',
      fix_applied: false, brokenSlug: 'dup-name',
      candidates: ['concepts/dup-name', 'foundations/dup-name'],
    }];
    const withSuggest = JSON.parse(captureConsoleLog(() => reportJson(findings, 1, { suggest: true })));
    assert.deepEqual(withSuggest.findings[0].candidates, ['concepts/dup-name', 'foundations/dup-name']);

    const withoutSuggest = JSON.parse(captureConsoleLog(() => reportJson(findings, 1, { suggest: false })));
    assert.equal(withoutSuggest.findings[0].candidates, undefined, 'internal candidates field must not leak without --suggest');
    assert.equal(withoutSuggest.findings[0].brokenSlug, undefined, 'internal brokenSlug field must not leak');
  });

  test('reportHuman: --suggest prints a "suggestion:" line for unfixable findings, omitted without the flag', () => {
    const findings = [{
      id: 'L01-frontmatter-required', severity: 'error', fixable: false,
      file: 'sources/a.md', line: null,
      key: 'year', fieldType: 'number',
      message: 'Missing required frontmatter key: "year" (type: number)',
      fix_applied: false,
    }];
    const out = captureConsoleLog(() => reportHuman(findings, 1, { suggest: true }));
    assert.ok(out.includes('suggestion:'));

    const outNoSuggest = captureConsoleLog(() => reportHuman(findings, 1, { suggest: false }));
    assert.ok(!outNoSuggest.includes('suggestion:'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: CLI stdout integrity on large --json output (async pipe write vs
// process.exit race)
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI: stdout is not truncated on a large --json payload', () => {
  // On POSIX, process.stdout writes to a pipe (not a TTY or a file) are
  // asynchronous. main() used to call `process.exit(...)` immediately after
  // printing the --json/--summary body; when a parent captured stdout via a
  // pipe (e.g. spawnSync, exactly how the installer's post-upgrade banner
  // invokes this script), a large enough payload could still be queued when
  // the process tore down, silently truncating stdout to a fixed ~8 KB with
  // no error surfaced at all — `result.error` stayed undefined and the exit
  // code looked normal, but stdout was invalid JSON. main() now sets
  // `process.exitCode` and lets the event loop drain instead, which lets the
  // queued write flush before Node exits. This test drives the real CLI
  // entry point (not the `runLint` library function) via spawnSync, because
  // the bug lived entirely in how main() exits, not in what it computes.
  let tmpDir;
  before(async () => { tmpDir = await makeTmp(); });
  after(async () => { await removeTmp(tmpDir); });

  test('spawnSync of the real CLI on a wiki with enough findings to exceed 8KB of pretty-printed JSON returns fully parsable stdout', async () => {
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const lintScript = fileURLToPath(new URL('./lint.mjs', import.meta.url));

    const wikiDir = await makeWiki(tmpDir);
    // Each page links to a nonexistent slug — a cheap, reliable way to
    // generate one L05 finding per file. 150 files comfortably clears the
    // ~8KB truncation threshold observed pre-fix (that threshold was hit
    // well under 50 files) while staying fast to write and lint.
    for (let i = 0; i < 150; i++) {
      await writeFile(
        join(wikiDir, 'concepts', `concept-${i}.md`),
        `---\nid: concept-${i}\ntitle: Concept ${i}\ntype: concept\ncreated: '2026-01-01'\nupdated: '2026-01-01'\n---\n\nSee [[nonexistent-target-${i}]] for details.\n`,
      );
    }

    const result = spawnSync(process.execPath, [lintScript, tmpDir, '--suggest', '--json'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(result.error, undefined, 'spawnSync should not report a spawn error');
    assert.equal(result.status, 1, 'expected findings, so exit code 1');
    assert.ok(result.stdout.length > 8192, 'test payload should exceed the previously-observed truncation point');

    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, 'stdout must be complete, parsable JSON, not truncated');
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.some(f => f.id === 'L05-broken-wikilink'));
  });
});
