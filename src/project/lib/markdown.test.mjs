import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, renderedText, scanBody, escapeRegex, matchAll } from './markdown.mjs';

test('slug lowercases and turns spaces into hyphens', () => {
  assert.equal(slug('Getting Started'), 'getting-started');
});

test('slug drops punctuation not in the keep set', () => {
  assert.equal(slug("What's New?"), 'whats-new');
  assert.equal(slug('Section 1: Overview!'), 'section-1-overview');
  assert.equal(slug('Two  spaces'), 'two--spaces');
});

test('slug keeps underscore, hyphen, and numbers as-is', () => {
  assert.equal(slug('foo_bar-baz 2'), 'foo_bar-baz-2');
});

test('slug preserves Vietnamese diacritics', () => {
  assert.equal(slug('Hạn mức tín dụng'), 'hạn-mức-tín-dụng');
  assert.equal(slug('Đặc điểm'), 'đặc-điểm');
});

test('slug NFC-normalizes so NFD and precomposed input match', () => {
  const precomposed = 'café'; // é = U+00E9
  const decomposed = 'café'; // e + combining acute (U+0301)
  assert.equal(slug(precomposed), slug(decomposed));
  assert.equal(slug(decomposed), 'café');
});

test('slug is idempotent on already-slugged input', () => {
  const once = slug('Hello World Again');
  assert.equal(slug(once), once);
});

// ---------------------------------------------------------------------------
// renderedText
// ---------------------------------------------------------------------------

test('renderedText strips paired emphasis delimiters, keeping content', () => {
  assert.equal(renderedText('_(BMAD)_'), '(BMAD)');
  assert.equal(renderedText('**Bold**'), 'Bold');
  assert.equal(renderedText('__also bold__'), 'also bold');
});

test('renderedText strips backticks, keeping content', () => {
  assert.equal(renderedText('`code`'), 'code');
});

test('renderedText turns [text](url) into text', () => {
  assert.equal(renderedText('[Getting Started](docs/start.md)'), 'Getting Started');
});

test('renderedText strips HTML tags, keeping content', () => {
  assert.equal(renderedText('<sub>note</sub>'), 'note');
});

test('renderedText keeps intraword underscores and code-span content (GitHub anchors, AD-20)', () => {
  assert.equal(renderedText('snake_case_name'), 'snake_case_name');
  assert.equal(renderedText('`user_id` field'), 'user_id field');
  assert.equal(renderedText('`_x_` and `a*b*c`'), '_x_ and a*b*c');
  assert.equal(renderedText('*a_b*'), 'a_b');
  assert.equal(slug(renderedText('snake_case_name')), 'snake_case_name');
  assert.equal(slug(renderedText('`user_id` field')), 'user_id-field');
});

test('scanBody anchors a heading with underscores the way GitHub does', () => {
  const result = scanBody('# snake_case_name\n\n## `user_id` field\n', 1);
  assert.deepEqual(result.headings.map((h) => h.anchor), ['snake_case_name', 'user_id-field']);
});

test('renderedText handles a mix in one pass', () => {
  assert.equal(
    renderedText('**Bold** and `code` and [t](u) and <b>html</b>'),
    'Bold and code and t and html',
  );
});

// ---------------------------------------------------------------------------
// escapeRegex
// ---------------------------------------------------------------------------

test('escapeRegex escapes every regex metacharacter', () => {
  assert.equal(escapeRegex('a.b*c?'), 'a\\.b\\*c\\?');
  assert.equal(new RegExp(escapeRegex('a.b*c?'), 'u').test('a.b*c?'), true);
});

// ---------------------------------------------------------------------------
// matchAll
// ---------------------------------------------------------------------------

test('matchAll finds every occurrence with Unicode word-boundary lookarounds', () => {
  const results = matchAll('ADR-\\d{4}', 'See ADR-0009 and ADR-0052.');
  assert.deepEqual(results, [
    { match: 'ADR-0009', index: 4 },
    { match: 'ADR-0052', index: 17 },
  ]);
});

test('matchAll does not match inside a larger word (no partial match)', () => {
  const results = matchAll('ADR-0009', 'XADR-0009 and ADR-0009X and ADR-0009');
  assert.deepEqual(results, [{ match: 'ADR-0009', index: 28 }]);
});

test('matchAll strips trailing .,;:- from a body match', () => {
  const results = matchAll('FR[\\w.-]+', 'See FR-102. Done.');
  assert.deepEqual(results, [{ match: 'FR-102', index: 4 }]);
});

test('matchAll matches a Vietnamese concept alias case-insensitively', () => {
  const results = matchAll(escapeRegex('hạn mức'), 'Chính sách Hạn Mức tín dụng thay đổi.', {
    ignoreCase: true,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].match, 'Hạn Mức');
});

// ---------------------------------------------------------------------------
// scanBody
// ---------------------------------------------------------------------------

test('scanBody extracts headings and links, skipping fenced code, HTML comments, and the lumina:project block', () => {
  const bodyLines = [
    '# Title',                                            // 0
    '',                                                    // 1
    '## Notes',                                            // 2
    '',                                                    // 3
    'Some `inline code` stays.',                           // 4
    '',                                                    // 5
    '```js',                                               // 6
    '## Not a heading in fence',                           // 7
    '[not a link](x.md)',                                  // 8
    '```',                                                 // 9
    '',                                                    // 10
    '<!-- a comment line -->',                             // 11
    '',                                                    // 12
    '<!--',                                                // 13
    'multi line comment',                                 // 14
    '## Not a heading either',                             // 15
    '-->',                                                 // 16
    '',                                                    // 17
    '<!-- lumina:project -->',                             // 18
    '## Skipped heading',                                  // 19
    '<!-- /lumina:project -->',                            // 20
    '',                                                    // 21
    '## Notes',                                            // 22
    '',                                                    // 23
    '## Hạn mức tín dụng',                                 // 24
    '',                                                    // 25
    'See [the guide](docs/guide.md#section) for details.', // 26
    '',                                                    // 27
    '[ref-label]: docs/other.md "Other doc"',              // 28
    '',                                                    // 29
  ];
  const startLine = 5;
  const result = scanBody(bodyLines.join('\n'), startLine);

  assert.deepEqual(result.headings, [
    { level: 1, text: 'Title', anchor: 'title', line: 5 },
    { level: 2, text: 'Notes', anchor: 'notes', line: 7 },
    { level: 2, text: 'Notes', anchor: 'notes-1', line: 27 },
    { level: 2, text: 'Hạn mức tín dụng', anchor: 'hạn-mức-tín-dụng', line: 29 },
  ]);

  assert.deepEqual(result.links, [
    { target: 'docs/guide.md#section', line: 31, quote: '[the guide](docs/guide.md#section)' },
    { target: 'docs/other.md', line: 33, quote: '[ref-label]: docs/other.md "Other doc"' },
  ]);

  // Inline code is scanned, not skipped: the line survives with its text intact.
  assert.ok(result.lines.some((l) => l.text === 'Some `inline code` stays.'));

  // Nothing from a skipped region ever leaks into the scannable lines.
  const allText = result.lines.map((l) => l.text).join('\n');
  assert.ok(!allText.includes('Not a heading'));
  assert.ok(!allText.includes('not a link'));
  assert.ok(!allText.includes('Skipped heading'));
  assert.ok(!allText.includes('comment line'));
});

test('scanBody does not extract an image as a link', () => {
  const result = scanBody('![alt text](pic.png)\n\nSee [real link](page.md) too.\n', 1);
  assert.deepEqual(result.links, [{ target: 'page.md', line: 3, quote: '[real link](page.md)' }]);
});

test('scanBody does not extract a link written inside an inline code span', () => {
  const result = scanBody('Use `[x](y)` literally, but [real](page.md) is a link.\n', 1);
  assert.deepEqual(result.links, [{ target: 'page.md', line: 1, quote: '[real](page.md)' }]);
});

test('scanBody does not extract a footnote definition as a reference-style link', () => {
  const result = scanBody('[^1]: See the guide.\n\n[label]: docs/other.md\n', 1);
  assert.deepEqual(result.links, [{ target: 'docs/other.md', line: 3, quote: '[label]: docs/other.md' }]);
});

test('a `<!--` inside an inline code span does not open an HTML comment', () => {
  const result = scanBody('Use `<!--` here.\n\n## Heading After\n', 1);
  assert.deepEqual(result.headings, [{ level: 2, text: 'Heading After', anchor: 'heading-after', line: 3 }]);
  assert.ok(result.lines.some((l) => l.text === 'Use `<!--` here.'));
});

test('a comment that closes and reopens on the same line keeps the text between, and the reopened comment stays hidden', () => {
  const body = [
    '<!-- start',
    'hidden line',
    'end --> kept text <!-- reopened',
    'still hidden',
    'close --> visible after',
    '',
    '## Heading',
  ].join('\n');
  const result = scanBody(body, 1);

  assert.deepEqual(result.headings, [{ level: 2, text: 'Heading', anchor: 'heading', line: 7 }]);

  const allText = result.lines.map((l) => l.text).join('\n');
  assert.ok(allText.includes('kept text'));
  assert.ok(allText.includes('visible after'));
  assert.ok(!allText.includes('hidden line'));
  assert.ok(!allText.includes('still hidden'));
  assert.ok(!allText.includes('reopened'));
});

test('a shorter or other-char fence run inside a ```` fence does not close it', () => {
  const body = [
    '````md',
    '```',
    '~~~~',
    '## Not a heading',
    'See [inner](inner.md) and ADR-0009.',
    '```',
    '````',
    '',
    'After [outer](outer.md).',
  ].join('\n');
  const result = scanBody(body, 1);
  assert.deepEqual(result.headings, []);
  assert.deepEqual(result.links, [{ target: 'outer.md', line: 9, quote: '[outer](outer.md)' }]);
  const allText = result.lines.map((l) => l.text).join('\n');
  assert.ok(!allText.includes('ADR-0009'));
  assert.ok(!allText.includes('inner'));
});

test('scanBody dedupes heading anchors across a chain, never reusing an anchor GitHub already assigned', () => {
  const result = scanBody('## Notes\n\n## Notes\n\n## Notes-1\n', 1);
  const anchors = result.headings.map((h) => h.anchor);
  assert.deepEqual(anchors, ['notes', 'notes-1', 'notes-1-1']);
  assert.equal(new Set(anchors).size, 3);
});

test('matchAll returns correct results across repeated calls with the same pattern (regex cache does not leak state)', () => {
  const first = matchAll('ADR-\\d{4}', 'ADR-0001 only here');
  const second = matchAll('ADR-\\d{4}', 'ADR-0002 and ADR-0003');
  assert.deepEqual(first, [{ match: 'ADR-0001', index: 0 }]);
  assert.deepEqual(second, [
    { match: 'ADR-0002', index: 0 },
    { match: 'ADR-0003', index: 13 },
  ]);
});
