import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { parseDoc, parseAll } from './parse.mjs';
import { loadConfig } from './config.mjs';
import { contentHash } from './hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test-fixtures');

function baseConfig(overrides = {}) {
  return {
    sources: { include: ['docs'], exclude: [] },
    types: {},
    relations: {},
    relatedRules: [],
    externalIds: [],
    concepts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Doc type resolution
// ---------------------------------------------------------------------------

describe('parseDoc: doc type', () => {
  test('paths and frontmatter both given: both must match', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], frontmatter: { type: 'adr' } } },
    });
    const doc = parseDoc('docs/adr/x.md', '---\ntype: adr\n---\n# Title\n', config);
    assert.equal(doc.type, 'ADR');
    assert.equal(doc.metaType, 'Decision');
    assert.equal(doc.findings.length, 0);
  });

  test('frontmatter mismatches: no type match, P12 fires (frontmatterType present)', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], frontmatter: { type: 'adr' } } },
    });
    const doc = parseDoc('docs/adr/x.md', '---\ntype: other\n---\n# Title\n', config);
    assert.equal(doc.type, null);
    assert.equal(doc.metaType, 'Document');
    assert.equal(doc.frontmatterType, 'other');
    assert.equal(doc.findings.length, 1);
    assert.equal(doc.findings[0].id, 'P12');
    assert.equal(doc.findings[0].severity, 'warning');
    assert.equal(doc.findings[0].file, 'docs/adr/x.md');
    assert.equal(doc.findings[0].line, 2);
  });

  test('path mismatches and no frontmatter type: no match, no P12', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], frontmatter: { type: 'adr' } } },
    });
    const doc = parseDoc('docs/other/x.md', '# Title\n', config);
    assert.equal(doc.type, null);
    assert.equal(doc.findings.length, 0);
  });

  test('path mismatches but a frontmatter type is present: P12 fires', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], frontmatter: { type: 'adr' } } },
    });
    const doc = parseDoc('docs/other/x.md', '---\ntype: adr\n---\n# Title\n', config);
    assert.equal(doc.type, null);
    assert.equal(doc.findings.length, 1);
    assert.equal(doc.findings[0].id, 'P12');
    assert.ok(doc.findings[0].message.includes('adr'));
  });

  test('paths-only type matches regardless of frontmatter content', () => {
    const config = baseConfig({ types: { Convention: { metaType: 'Rule', paths: ['docs/conventions/**'] } } });
    const doc = parseDoc('docs/conventions/c1.md', '# C1\n', config);
    assert.equal(doc.type, 'Convention');
    assert.equal(doc.metaType, 'Rule');
  });

  test('frontmatter-only type matches regardless of path', () => {
    const config = baseConfig({ types: { Runbook: { metaType: 'Process', frontmatter: { type: 'runbook' } } } });
    const doc = parseDoc('anywhere/x.md', '---\ntype: runbook\n---\n# X\n', config);
    assert.equal(doc.type, 'Runbook');
    assert.equal(doc.metaType, 'Process');
  });

  test('first matching type in config order wins', () => {
    const config = baseConfig({
      types: {
        First: { metaType: 'Decision', paths: ['docs/**'] },
        Second: { metaType: 'Rule', paths: ['docs/**'] },
      },
    });
    const doc = parseDoc('docs/x.md', '# X\n', config);
    assert.equal(doc.type, 'First');
    assert.equal(doc.metaType, 'Decision');
  });
});

// ---------------------------------------------------------------------------
// Declared ID
// ---------------------------------------------------------------------------

describe('parseDoc: declared ID', () => {
  const config = baseConfig({
    types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], idPattern: 'ADR-\\d{4}' } },
  });

  test('frontmatter id, anchored idPattern match extracts the prefix', () => {
    const doc = parseDoc('docs/adr/x.md', '---\nid: ADR-0009-extra\n---\n# Title\n', config);
    assert.equal(doc.declares, 'ADR-0009');
    assert.equal(doc.declaresLine, 2);
  });

  test('frontmatter id, no idPattern match at the start: whole trimmed value kept', () => {
    const doc = parseDoc('docs/adr/x.md', '---\nid: XYZ-123\n---\n# Title\n', config);
    assert.equal(doc.declares, 'XYZ-123');
  });

  test('no frontmatter id: falls back to H1, anchored match still applies', () => {
    const doc = parseDoc('docs/adr/x.md', '# ADR-0009: Title Text\n', config);
    assert.equal(doc.declares, 'ADR-0009');
    assert.equal(doc.declaresLine, 1);
  });

  test('no frontmatter id and no H1: null, declaresLine null', () => {
    const doc = parseDoc('docs/adr/x.md', 'Just a paragraph, no heading.\n', config);
    assert.equal(doc.declares, null);
    assert.equal(doc.declaresLine, null);
  });

  test('declaresLine points at the H1 line when a frontmatter block precedes it', () => {
    const doc = parseDoc('docs/adr/x.md', '---\ntitle: X\n---\n\n# ADR-0009: Title\n', config);
    assert.equal(doc.declares, 'ADR-0009');
    assert.equal(doc.declaresLine, 5);
  });

  test('no type resolved (no idPattern available): whole trimmed id kept', () => {
    const noTypeConfig = baseConfig();
    const doc = parseDoc('docs/adr/x.md', '---\nid: ADR-0009-extra\n---\n# Title\n', noTypeConfig);
    assert.equal(doc.declares, 'ADR-0009-extra');
  });

  test('a non-string frontmatter id (e.g. "id: 0009" parsing to a number) is treated as absent', () => {
    const doc = parseDoc('docs/adr/x.md', '---\nid: 0009\n---\n# ADR-0009: Title\n', config);
    // Falls back to the H1, not the numeric frontmatter value.
    assert.equal(doc.declares, 'ADR-0009');
    const docNoH1 = parseDoc('docs/adr/x.md', '---\nid: 0009\n---\nNo heading here.\n', config);
    assert.equal(docNoH1.declares, null);
  });

  test('an object/array frontmatter id is treated as absent', () => {
    const doc = parseDoc('docs/adr/x.md', '---\nid: [a, b]\n---\n# ADR-0009: Title\n', config);
    assert.equal(doc.declares, 'ADR-0009');
  });

  test('the anchored idPattern match requires a right boundary: "ADR-00091" does not declare "ADR-0009"', () => {
    const doc = parseDoc('docs/adr/x.md', '---\nid: ADR-00091\n---\n# Title\n', config);
    // No match at all (idPattern requires exactly 4 digits followed by a
    // non-word character); falls back to the whole trimmed frontmatter value.
    assert.equal(doc.declares, 'ADR-00091');
  });

  test('findFrontmatterKeyLine ignores a nested (indented) key of the same name', () => {
    const text = '---\nfoo:\n  id: nested-value\nid: ADR-0009\n---\n# Title\n';
    const doc = parseDoc('docs/adr/x.md', text, config);
    assert.equal(doc.declares, 'ADR-0009');
    assert.equal(doc.declaresLine, 4);
  });
});

// ---------------------------------------------------------------------------
// Body ID mentions and skipped regions
// ---------------------------------------------------------------------------

describe('parseDoc: body ID mentions', () => {
  const config = baseConfig({
    types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'], idPattern: 'ADR-\\d{4}' } },
    externalIds: [{ pattern: 'FR-\\d+' }],
  });

  test('scans prose and inline code, skips fences, HTML comments, and lumina blocks', () => {
    const text = [
      '# Title',
      '',
      'See ADR-0100 and FR-42 in prose.',
      '',
      '`ADR-0200` inline code is scanned.',
      '',
      '<!-- ADR-0300 inside a comment -->',
      '',
      '<!-- lumina:project -->',
      'ADR-0400 inside a lumina block.',
      '<!-- /lumina:project -->',
      '',
      '```',
      'ADR-0500 inside a fence.',
      '```',
      '',
    ].join('\n');
    const doc = parseDoc('docs/adr/x.md', text, config);
    const mentioned = doc.facts.filter((f) => f.relation === 'mentions').map((f) => f.object).sort();
    assert.deepEqual(mentioned, ['ADR-0100', 'ADR-0200', 'FR-42'].sort());
  });

  test('trailing punctuation is stripped from a body match', () => {
    const doc = parseDoc('docs/adr/x.md', 'See ADR-0009.\n', config);
    const mentioned = doc.facts.filter((f) => f.relation === 'mentions').map((f) => f.object);
    assert.deepEqual(mentioned, ['ADR-0009']);
  });

  test('each mention fact carries line and quote evidence', () => {
    const doc = parseDoc('docs/adr/x.md', '# T\n\nSee ADR-0009 here.\n', config);
    const fact = doc.facts.find((f) => f.relation === 'mentions' && f.object === 'ADR-0009');
    assert.equal(fact.evidence.line, 3);
    assert.equal(fact.evidence.quote, 'ADR-0009');
    assert.equal(fact.subject, 'doc:docs/adr/x.md');
    assert.equal(fact.provenance, 'extracted');
  });

  test('ID mentions are NFC-normalized before matching, like concept mentions', () => {
    // idPattern written in precomposed form; the body cites the decomposed
    // form (e + combining acute). Without normalizing the scanned line to
    // NFC first, these would not match.
    const precomposedPattern = 'café-\\d+';
    const decomposedBody = 'Ref café-123 here.\n';
    const cfg = baseConfig({ externalIds: [{ pattern: precomposedPattern }] });
    const doc = parseDoc('docs/x.md', decomposedBody, cfg);
    const mentioned = doc.facts.filter((f) => f.relation === 'mentions').map((f) => f.object);
    assert.deepEqual(mentioned, ['café-123']);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter relations
// ---------------------------------------------------------------------------

describe('parseDoc: frontmatter relations', () => {
  const config = baseConfig({ relations: { superseded_by: { relation: 'supersedes', inverse: true } } });

  test('related: list value, one edge per non-empty string item, non-strings skipped', () => {
    const text = '---\nrelated:\n  - ADR-0001\n  - 42\n  - docs/other.md\n---\n# T\n';
    const doc = parseDoc('docs/x.md', text, config);
    const related = doc.facts.filter((f) => f.relation === 'related');
    assert.deepEqual(related.map((f) => f.object), ['ADR-0001', 'docs/other.md']);
    for (const f of related) {
      assert.equal(f.ref, f.object);
      assert.equal(f.subject, 'doc:docs/x.md');
      assert.equal(f.provenance, 'extracted');
    }
  });

  test('related: scalar string produces one edge', () => {
    const doc = parseDoc('docs/x.md', '---\nrelated: ADR-0009\n---\n# T\n', config);
    const related = doc.facts.filter((f) => f.relation === 'related');
    assert.equal(related.length, 1);
    assert.equal(related[0].object, 'ADR-0009');
  });

  test('related: null produces no edges', () => {
    const doc = parseDoc('docs/x.md', '---\nrelated: null\n---\n# T\n', config);
    assert.equal(doc.facts.filter((f) => f.relation === 'related').length, 0);
  });

  test('a literal meta-relation-name key is a relation key even absent from config.relations', () => {
    const doc = parseDoc('docs/x.md', '---\ndepends-on: ADR-0002\n---\n# T\n', config);
    const facts = doc.facts.filter((f) => f.relation === 'depends-on');
    assert.equal(facts.length, 1);
    assert.equal(facts[0].object, 'ADR-0002');
  });

  test('a key present in config.relations is a relation key; the raw key name is kept, not the meta-relation', () => {
    const doc = parseDoc('docs/x.md', '---\nsuperseded_by: ADR-0003\n---\n# T\n', config);
    const facts = doc.facts.filter((f) => f.relation === 'superseded_by');
    assert.equal(facts.length, 1);
    assert.equal(facts[0].object, 'ADR-0003');
    assert.equal(doc.facts.some((f) => f.relation === 'supersedes'), false);
  });

  test('an unrelated frontmatter key produces no edges', () => {
    const doc = parseDoc('docs/x.md', '---\ntags: [foo, bar]\n---\n# T\n', config);
    assert.equal(doc.facts.length, 0);
  });

  test('evidence.line points at the value\'s actual file line', () => {
    const doc = parseDoc('docs/x.md', '---\ntitle: X\nrelated: ADR-0009\n---\n# T\n', config);
    const fact = doc.facts.find((f) => f.relation === 'related');
    assert.equal(fact.evidence.line, 3);
    assert.equal(fact.evidence.quote, 'ADR-0009');
  });

  test('evidence.line is not fooled by an earlier occurrence of the same value under a different key', () => {
    const text = '---\nother: ADR-0001\nrelated: ADR-0001\n---\n# T\n';
    const doc = parseDoc('docs/x.md', text, config);
    const fact = doc.facts.find((f) => f.relation === 'related');
    assert.equal(fact.evidence.line, 3); // the "related:" line, not "other:" at line 2
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('parseDoc: links', () => {
  const config = baseConfig();

  test('inline link: raw "link" edge, target as object/ref, full markdown as quote', () => {
    const doc = parseDoc('docs/x.md', '# T\n\nSee [another](0052-new.md#status) for more.\n', config);
    const fact = doc.facts.find((f) => f.relation === 'link');
    assert.equal(fact.object, '0052-new.md#status');
    assert.equal(fact.ref, '0052-new.md#status');
    assert.equal(fact.evidence.quote, '[another](0052-new.md#status)');
    assert.equal(fact.evidence.line, 3);
  });

  test('an anchor-only target ("#y" alone) keeps the raw target as written', () => {
    const doc = parseDoc('docs/x.md', '# T\n\n[jump](#status)\n', config);
    const fact = doc.facts.find((f) => f.relation === 'link');
    assert.equal(fact.object, '#status');
  });

  test('a reference-style definition line produces a "link" edge', () => {
    const doc = parseDoc('docs/x.md', '# T\n\n[note]: 0052-new.md "Some note"\n', config);
    const fact = doc.facts.find((f) => f.relation === 'link');
    assert.equal(fact.object, '0052-new.md');
  });

  test('a reference-style usage ("[text][label]") is not itself a link fact', () => {
    const text = '# T\n\nSee [text][label] here.\n\n[label]: url.md\n';
    const doc = parseDoc('docs/x.md', text, config);
    const links = doc.facts.filter((f) => f.relation === 'link');
    assert.equal(links.length, 1);
    assert.equal(links[0].object, 'url.md');
  });
});

// ---------------------------------------------------------------------------
// Concept mentions
// ---------------------------------------------------------------------------

describe('parseDoc: concept mentions', () => {
  const config = baseConfig({ concepts: [{ name: 'credit limit', aliases: ['hạn mức'] }] });

  test('matches the concept name case-insensitively', () => {
    const doc = parseDoc('docs/x.md', '# T\n\nOur Credit Limit policy changed.\n', config);
    const fact = doc.facts.find((f) => f.relation === 'mentions' && f.object === 'concept:credit-limit');
    assert.ok(fact);
    assert.equal(fact.ref, 'Credit Limit');
  });

  test('matches a Vietnamese alias', () => {
    const doc = parseDoc('docs/x.md', '# T\n\nChính sách hạn mức tín dụng thay đổi.\n', config);
    const fact = doc.facts.find((f) => f.relation === 'mentions' && f.object === 'concept:credit-limit');
    assert.ok(fact);
  });

  test('is not matched inside fenced code', () => {
    const doc = parseDoc('docs/x.md', '# T\n\n```\ncredit limit\n```\n', config);
    assert.equal(doc.facts.filter((f) => f.relation === 'mentions').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

describe('parseDoc: anchors', () => {
  test('two headings with the same rendered text dedupe as notes, notes-1', () => {
    const config = baseConfig();
    const text = '# Title\n\n## Notes\n\ntext\n\n## Notes\n\nmore text\n';
    const doc = parseDoc('docs/x.md', text, config);
    const notes = doc.headings.filter((h) => h.text === 'Notes');
    assert.deepEqual(notes.map((h) => h.anchor), ['notes', 'notes-1']);
  });
});

// ---------------------------------------------------------------------------
// Bad frontmatter
// ---------------------------------------------------------------------------

describe('parseDoc: bad frontmatter', () => {
  test('a YAML syntax error yields P17; the doc is parsed without frontmatter', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/**'], frontmatter: { type: 'adr' } } },
    });
    const doc = parseDoc('docs/x.md', '---\nid: [unclosed\n---\n# Title\n', config);
    const p17 = doc.findings.find((f) => f.id === 'P17');
    assert.ok(p17);
    assert.equal(p17.severity, 'warning');
    assert.equal(p17.file, 'docs/x.md');
    assert.equal(doc.frontmatterType, null);
    assert.equal(doc.type, null);
    assert.equal(doc.declares, null); // an H1 declares only through an idPattern match
  });
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

describe('parseDoc: status', () => {
  function makeConfig(status) {
    return baseConfig({ types: { ADR: { metaType: 'Decision', paths: ['docs/**'], status } } });
  }

  test('heading source: first non-empty line of the section, no map, first word lowercased and trimmed of punctuation', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\n## Status\n\nAccepted, some more text.\n', config);
    assert.equal(doc.status, 'accepted');
  });

  test('heading absent: falls back to an inline "**Status:** X" line', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\n**Status:** Accepted - 2026-09-01\n', config);
    assert.equal(doc.status, 'accepted');
  });

  test('map: the longest matching prefix wins', () => {
    const config = makeConfig({
      sources: [{ frontmatter: 'status' }],
      map: { 'Đã duyệt': 'accepted', Đã: 'something-else' },
    });
    const doc = parseDoc('docs/x.md', '---\nstatus: "Đã duyệt vào 2026"\n---\n# T\n', config);
    assert.equal(doc.status, 'accepted');
  });

  test('map: a key must match at a boundary; "accepted" does not match "accepted-with-changes"', () => {
    const config = makeConfig({ sources: [{ frontmatter: 'status' }], map: { accepted: 'ACCEPTED' } });
    const doc = parseDoc('docs/x.md', '---\nstatus: accepted-with-changes\n---\n# T\n', config);
    // Map does not apply (no boundary after "accepted"); falls back to the
    // first-word rule instead of the mapped "ACCEPTED".
    assert.equal(doc.status, 'accepted-with-changes');
  });

  test('map matching is NFC-normalized (a decomposed status value matches a precomposed key) and case-insensitive', () => {
    const config = makeConfig({ sources: [{ frontmatter: 'status' }], map: { 'CAFÉ': 'special' } });
    const decomposedValue = 'café report'; // e + combining acute, uppercase key, lowercase value
    const doc = parseDoc('docs/x.md', `---\nstatus: "${decomposedValue}"\n---\n# T\n`, config);
    assert.equal(doc.status, 'special');
  });

  test('heading source: a leading list/blockquote/ordered-list marker is stripped before checking for content', () => {
    const bulletDoc = parseDoc('docs/x.md', '# T\n\n## Status\n\n- Accepted\n', makeConfig({ sources: [{ heading: 'Status' }], map: {} }));
    assert.equal(bulletDoc.status, 'accepted');
    const quoteDoc = parseDoc('docs/x.md', '# T\n\n## Status\n\n> Accepted\n', makeConfig({ sources: [{ heading: 'Status' }], map: {} }));
    assert.equal(quoteDoc.status, 'accepted');
    const orderedDoc = parseDoc('docs/x.md', '# T\n\n## Status\n\n1. Accepted\n', makeConfig({ sources: [{ heading: 'Status' }], map: {} }));
    assert.equal(orderedDoc.status, 'accepted');
  });

  test('heading source: a subheading inside the section is skipped, not taken as the status value', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const text = '# T\n\n## Status\n\n### Details\n\nAccepted\n';
    const doc = parseDoc('docs/x.md', text, config);
    assert.equal(doc.status, 'accepted');
    assert.equal(doc.findings.some((f) => f.id === 'P20'), false);
  });

  test('heading source: a marker-only section with no real content yields no status', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    // Each "content" line is only a marker plus trailing whitespace: stripping
    // the marker leaves nothing, so every line in the section is empty.
    const doc = parseDoc('docs/x.md', '# T\n\n## Status\n\n- \n\n> \n', config);
    assert.equal(doc.status, null);
  });

  test('sources disagree: P19 fires, first source wins (the Seli ADR-0009 pattern); partially-superseded is in the lifecycle, so no P20', () => {
    const config = makeConfig({ sources: [{ frontmatter: 'status' }, { heading: 'Status' }], map: {} });
    const text = '---\nstatus: partially-superseded\n---\n# T\n\n## Status\n\nAccepted\n';
    const doc = parseDoc('docs/x.md', text, config);
    assert.equal(doc.status, 'partially-superseded');
    assert.ok(doc.findings.some((f) => f.id === 'P19'));
    assert.equal(doc.findings.some((f) => f.id === 'P20'), false);
  });

  test('a valid lifecycle value on a Decision does not fire P20', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\n## Status\n\nAccepted\n', config);
    assert.equal(doc.status, 'accepted');
    assert.equal(doc.findings.some((f) => f.id === 'P20'), false);
  });

  test('no status found: value is null, no findings', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\nNo status section here.\n', config);
    assert.equal(doc.status, null);
    assert.equal(doc.findings.filter((f) => f.id === 'P19' || f.id === 'P20').length, 0);
  });

  test('P20 only fires on Decision, not on other meta-types', () => {
    const config = baseConfig({
      types: { Convention: { metaType: 'Rule', paths: ['docs/**'], status: { sources: [{ heading: 'Status' }], map: {} } } },
    });
    const doc = parseDoc('docs/x.md', '# T\n\n## Status\n\nWeird-value\n', config);
    assert.equal(doc.status, 'weird-value');
    assert.equal(doc.findings.some((f) => f.id === 'P20'), false);
  });

  test('P19/P20 report the winning source\'s line (a frontmatter key), not line 1', () => {
    const config = makeConfig({ sources: [{ frontmatter: 'status' }, { heading: 'Status' }], map: {} });
    const text = '---\ntitle: X\nstatus: weird-status\n---\n# T\n\n## Status\n\nAccepted\n';
    const doc = parseDoc('docs/x.md', text, config);
    const p19 = doc.findings.find((f) => f.id === 'P19');
    const p20 = doc.findings.find((f) => f.id === 'P20');
    assert.equal(p19.line, 3); // the "status:" frontmatter key's own line
    assert.equal(p20.line, 3);
  });

  test('P20 reports the "## Status" heading\'s own line when the heading source wins', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\n## Status\n\nWeird\n', config);
    const p20 = doc.findings.find((f) => f.id === 'P20');
    assert.ok(p20);
    assert.equal(p20.line, 3);
  });

  test('P20 reports the inline "**Status:** X" line when that fallback wins', () => {
    const config = makeConfig({ sources: [{ heading: 'Status' }], map: {} });
    const doc = parseDoc('docs/x.md', '# T\n\nSome text.\n\n**Status:** Weird\n', config);
    const p20 = doc.findings.find((f) => f.id === 'P20');
    assert.ok(p20);
    assert.equal(p20.line, 5);
  });
});

// ---------------------------------------------------------------------------
// Precomputed hash and the per-config pattern cache
// ---------------------------------------------------------------------------

describe('parseDoc: precomputed hash', () => {
  test('a precomputed hash is used as-is, skipping parseDoc\'s own computation', () => {
    const config = baseConfig();
    const fakeHash = 'deadbeef'.repeat(8);
    const doc = parseDoc('docs/x.md', '# T\n', config, fakeHash);
    assert.equal(doc.hash, fakeHash);
  });

  test('omitting the hash falls back to computing it from the given text', () => {
    const config = baseConfig();
    const text = '# T\n';
    const doc = parseDoc('docs/x.md', text, config);
    assert.equal(doc.hash, contentHash(Buffer.from(text, 'utf8')));
  });
});

describe('parseDoc: pattern cache correctness', () => {
  test('reusing one config across many parseDoc calls does not leak regex state between docs', () => {
    const config = baseConfig({
      types: { ADR: { metaType: 'Decision', paths: ['docs/**'], idPattern: 'ADR-\\d{4}' } },
      concepts: [{ name: 'credit limit', aliases: [] }],
    });
    const doc1 = parseDoc('docs/a.md', 'Mentions ADR-0001 and credit limit.\n', config);
    const doc2 = parseDoc('docs/b.md', 'Mentions ADR-0002 only.\n', config);
    const doc3 = parseDoc('docs/c.md', 'Mentions ADR-0001 and ADR-0003 and credit limit again.\n', config);
    assert.deepEqual(doc1.facts.filter((f) => f.relation === 'mentions').map((f) => f.object).sort(), ['ADR-0001', 'concept:credit-limit']);
    assert.deepEqual(doc2.facts.filter((f) => f.relation === 'mentions').map((f) => f.object), ['ADR-0002']);
    assert.deepEqual(
      doc3.facts.filter((f) => f.relation === 'mentions').map((f) => f.object).sort(),
      ['ADR-0001', 'ADR-0003', 'concept:credit-limit'].sort(),
    );
  });

  test('a type\'s path matcher is cached but still matches every doc against that same config', () => {
    const config = baseConfig({ types: { ADR: { metaType: 'Decision', paths: ['docs/adr/**'] } } });
    const inScope = parseDoc('docs/adr/a.md', '# A\n', config);
    const outOfScope = parseDoc('docs/other/b.md', '# B\n', config);
    assert.equal(inScope.type, 'ADR');
    assert.equal(outOfScope.type, null);
  });
});

// ---------------------------------------------------------------------------
// parseAll (fixture: parse-pilot)
// ---------------------------------------------------------------------------

describe('parseAll: parse-pilot fixture', () => {
  const root = join(FIXTURES, 'parse-pilot');
  let config;

  before(async () => {
    config = await loadConfig(root);
  });

  test('docs are sorted by path', async () => {
    const { docs } = await parseAll(root, config);
    const paths = docs.map((d) => d.path);
    assert.deepEqual(paths, [...paths].sort());
    assert.ok(paths.length >= 9);
  });

  test('parse is deterministic across two runs on unchanged input', async () => {
    const first = await parseAll(root, config);
    const second = await parseAll(root, config);
    assert.equal(JSON.stringify(first.docs), JSON.stringify(second.docs));
  });

  test('returns a texts Map (path -> decoded source) alongside docs; hash is computed from raw bytes', async () => {
    const { docs, texts } = await parseAll(root, config);
    assert.ok(texts instanceof Map);
    assert.equal(texts.size, docs.length);
    const path = 'docs/adr/0009-partial.md';
    const text = texts.get(path);
    assert.equal(typeof text, 'string');
    assert.ok(text.includes('# ADR-0009'));
    const doc = docs.find((d) => d.path === path);
    const raw = await readFile(join(root, path));
    assert.equal(doc.hash, contentHash(raw));
  });

  test('ADR-0009: type, declared id, disagreeing status, P19 only -- partially-superseded is in the lifecycle (Seli pilot scenario)', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/adr/0009-partial.md');
    assert.equal(doc.type, 'ADR');
    assert.equal(doc.metaType, 'Decision');
    assert.equal(doc.declares, 'ADR-0009');
    assert.equal(doc.status, 'partially-superseded');
    assert.ok(doc.findings.some((f) => f.id === 'P19'));
    assert.equal(doc.findings.some((f) => f.id === 'P20'), false);
  });

  test('ADR-0009: skipped regions hide ADR-9999, prose/inline-code/concept mentions still land', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/adr/0009-partial.md');
    const objects = doc.facts.map((f) => f.object);
    assert.equal(objects.includes('ADR-9999'), false);
    assert.ok(objects.includes('FR-102'));
    assert.ok(objects.includes('concept:credit-limit'));
    assert.deepEqual(
      doc.facts.filter((f) => f.relation === 'related').map((f) => f.object),
      ['docs/adr/0052-new.md'],
    );
    assert.equal(doc.facts.some((f) => f.relation === 'superseded_by'), false);
  });

  test('ADR-0052: agreeing status sources, no findings', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/adr/0052-new.md');
    assert.equal(doc.status, 'accepted');
    assert.equal(doc.findings.length, 0);
  });

  test('ADR-0011: inline "**Status:** Accepted" fallback resolves to accepted (the Capigo pattern)', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/adr/0011-inline-status.md');
    assert.equal(doc.status, 'accepted');
  });

  test('C010: declared via H1 fallback (no frontmatter), no status source found', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/conventions/c010-no-frontmatter.md');
    assert.equal(doc.type, 'Convention');
    assert.equal(doc.declares, 'C010');
    assert.equal(doc.status, null);
  });

  test('C002-migrations: declared id via frontmatter (idPattern trims to "C002"), heading status with no map', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/conventions/c002-migrations.md');
    assert.equal(doc.declares, 'C002');
    assert.equal(doc.status, 'deprecated');
    const mention = doc.facts.find((f) => f.relation === 'mentions' && f.object === 'C002');
    assert.ok(mention);
    // The body citation's object equals the doc's own declared id: this is
    // what lets buildGraph resolve the mention to this convention doc.
    assert.equal(mention.object, doc.declares);
  });

  test('broken.md: P17 fires, doc parsed without frontmatter', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/broken.md');
    assert.ok(doc.findings.some((f) => f.id === 'P17'));
    assert.equal(doc.frontmatterType, null);
  });

  test('unmapped.md: P12 fires for an unmapped frontmatter type', async () => {
    const { docs } = await parseAll(root, config);
    const doc = docs.find((d) => d.path === 'docs/misc/unmapped.md');
    assert.equal(doc.type, null);
    assert.ok(doc.findings.some((f) => f.id === 'P12'));
  });

  test('Capigo-style superseded_by: list, scalar, and null', async () => {
    const { docs } = await parseAll(root, config);
    const a = docs.find((d) => d.path === 'docs/capigo/dec-a.md');
    const b = docs.find((d) => d.path === 'docs/capigo/dec-b.md');
    const c = docs.find((d) => d.path === 'docs/capigo/dec-c.md');
    assert.deepEqual(a.facts.filter((f) => f.relation === 'superseded_by').map((f) => f.object), ['dec-b.md', 'dec-c.md']);
    assert.deepEqual(b.facts.filter((f) => f.relation === 'superseded_by').map((f) => f.object), ['dec-c.md']);
    assert.equal(c.facts.filter((f) => f.relation === 'superseded_by').length, 0);
    assert.deepEqual(b.facts.filter((f) => f.relation === 'depends-on').map((f) => f.object), ['dec-a.md']);
  });

  test('includeRoot: wildcard segment replaced, cut at **', async () => {
    const { docs } = await parseAll(root, config);
    const guide = docs.find((d) => d.path === 'packages/alpha/docs/guide.md');
    assert.equal(guide.includeRoot, 'packages/alpha/docs');
    const adr = docs.find((d) => d.path === 'docs/adr/0009-partial.md');
    assert.equal(adr.includeRoot, 'docs');
  });
});
