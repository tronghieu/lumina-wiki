import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter } from './frontmatter.mjs';

describe('splitFrontmatter: no frontmatter', () => {
  test('whole text is body when it does not start with a delimiter line', () => {
    const text = '# Title\n\nSome body text.\n';
    const result = splitFrontmatter(text);
    assert.deepEqual(result, { data: null, error: null, body: text, bodyStartLine: 1 });
  });

  test('an unterminated block (no closing delimiter) is treated as body', () => {
    const text = '---\nid: ADR-0001\n\n# Title\nbody\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.equal(result.error, null);
    assert.equal(result.body, text);
    assert.equal(result.bodyStartLine, 1);
  });
});

describe('splitFrontmatter: valid frontmatter', () => {
  test('splits data from body and reports the 1-based body start line', () => {
    const text = '---\nid: ADR-0009\ntype: adr\n---\n# Title\n\nBody line.\n';
    const result = splitFrontmatter(text);
    assert.deepEqual(result.data, { id: 'ADR-0009', type: 'adr' });
    assert.equal(result.error, null);
    assert.equal(result.body, '# Title\n\nBody line.\n');
    assert.equal(result.bodyStartLine, 5);
  });

  test('tolerates a leading BOM', () => {
    const text = '﻿---\nid: ADR-0009\n---\nbody\n';
    const result = splitFrontmatter(text);
    assert.deepEqual(result.data, { id: 'ADR-0009' });
    assert.equal(result.error, null);
    assert.equal(result.body, 'body\n');
    assert.equal(result.bodyStartLine, 4);
  });

  test('an empty frontmatter block parses to null data with no error', () => {
    const text = '---\n---\nbody\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.equal(result.error, null);
    assert.equal(result.bodyStartLine, 3);
  });

  test('a Vietnamese frontmatter value round-trips through the vendored YAML loader', () => {
    const text = '---\ntitle: "Hạn mức tín dụng"\nrelated: [ADR-0009]\n---\nBody.\n';
    const result = splitFrontmatter(text);
    assert.deepEqual(result.data, { title: 'Hạn mức tín dụng', related: ['ADR-0009'] });
    assert.equal(result.error, null);
  });

  test('CRLF line endings still produce correct line numbers', () => {
    const text = '---\r\nid: X\r\n---\r\nline4\r\nline5\r\n';
    const result = splitFrontmatter(text);
    assert.deepEqual(result.data, { id: 'X' });
    assert.equal(result.body, 'line4\r\nline5\r\n'.split(/\r\n|\r|\n/).join('\n'));
    assert.equal(result.bodyStartLine, 4);
  });
});

describe('splitFrontmatter: bad frontmatter', () => {
  test('a YAML syntax error surfaces as a non-null error message, data null, whole input as body', () => {
    const text = '---\nid: [unclosed\n---\nbody\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.equal(result.body, text);
    assert.equal(result.bodyStartLine, 1);
  });

  test('a non-mapping frontmatter block (a scalar) is an error, whole input as body', () => {
    const text = '---\njust a string\n---\nbody\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.equal(result.body, text);
    assert.equal(result.bodyStartLine, 1);
  });

  test('a non-mapping frontmatter block (a sequence) is an error, whole input as body', () => {
    const text = '---\n- one\n- two\n---\nbody\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.equal(result.body, text);
    assert.equal(result.bodyStartLine, 1);
  });

  test('a `---` thematic break, then prose, then a later `---` keeps every line in body', () => {
    // Looks like frontmatter (opens and later has a closing `---` line), but
    // the "YAML" in between is really two paragraphs of prose -- it must not
    // parse as a mapping, and none of those lines may be lost from body.
    const text = '---\n\nSome intro prose.\n\nMore prose here.\n\n---\n\n## Real heading\n';
    const result = splitFrontmatter(text);
    assert.equal(result.data, null);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.equal(result.body, text);
    assert.equal(result.bodyStartLine, 1);
  });
});
