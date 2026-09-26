/**
 * Tests for src/installer/template-engine.js
 *
 * Uses node:test + node:assert.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  render,
  renderReadme,
  extractSchemaRegion,
  replaceSchemaRegion,
  upsertMarkerBlock,
  stripMarkerBlock,
  MarkerBlockError,
} from './template-engine.js';

const OPEN = '<!-- lumina:project -->';
const CLOSE = '<!-- /lumina:project -->';

// ---------------------------------------------------------------------------
// render — variable substitution
// ---------------------------------------------------------------------------

describe('render — variable substitution', () => {
  test('substitutes a simple {{variable}}', () => {
    const result = render('Hello {{name}}!', { name: 'World' });
    assert.equal(result, 'Hello World!');
  });

  test('substitutes multiple variables', () => {
    const result = render('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
    assert.equal(result, 'foo and bar');
  });

  test('unknown variable renders as empty string', () => {
    const result = render('{{unknown}}', {});
    assert.equal(result, '');
  });

  test('null variable renders as empty string', () => {
    const result = render('{{key}}', { key: null });
    assert.equal(result, '');
  });

  test('boolean true renders as "true"', () => {
    const result = render('{{flag}}', { flag: true });
    assert.equal(result, 'true');
  });

  test('number renders as string', () => {
    const result = render('{{count}}', { count: 42 });
    assert.equal(result, '42');
  });

  test('leaves literal text unchanged', () => {
    const result = render('No variables here.', {});
    assert.equal(result, 'No variables here.');
  });

  test('normalizes CRLF to LF', () => {
    const result = render('line1\r\nline2', {});
    assert.equal(result, 'line1\nline2');
  });
});

// ---------------------------------------------------------------------------
// render — {{#if}} conditionals
// ---------------------------------------------------------------------------

describe('render — conditional blocks', () => {
  test('shows block when condition is truthy', () => {
    const tmpl = '{{#if show_section}}\nVisible\n{{/if}}';
    const result = render(tmpl, { show_section: true });
    assert.ok(result.includes('Visible'));
  });

  test('hides block when condition is falsy', () => {
    const tmpl = '{{#if show_section}}\nVisible\n{{/if}}';
    const result = render(tmpl, { show_section: false });
    assert.ok(!result.includes('Visible'));
  });

  test('hides block when condition is undefined', () => {
    const tmpl = 'before{{#if missing}}\nHidden\n{{/if}}after';
    const result = render(tmpl, {});
    assert.ok(!result.includes('Hidden'));
    assert.ok(result.includes('before'));
    assert.ok(result.includes('after'));
  });

  test('pack_research conditional block is shown when true', () => {
    const tmpl = '{{#if pack_research}}\nresearch stuff\n{{/if}}';
    const result = render(tmpl, { pack_research: true });
    assert.ok(result.includes('research stuff'));
  });

  test('pack_research conditional block is hidden when false', () => {
    const tmpl = '{{#if pack_research}}\nresearch stuff\n{{/if}}';
    const result = render(tmpl, { pack_research: false });
    assert.ok(!result.includes('research stuff'));
  });

  test('pack_reading conditional block is shown when true', () => {
    const tmpl = '{{#if pack_reading}}\nreading stuff\n{{/if}}';
    const result = render(tmpl, { pack_reading: true });
    assert.ok(result.includes('reading stuff'));
  });

  test('multiple adjacent conditional blocks work independently', () => {
    const tmpl = [
      '{{#if a}}\nblock-a\n{{/if}}',
      '{{#if b}}\nblock-b\n{{/if}}',
    ].join('\n');
    const result = render(tmpl, { a: true, b: false });
    assert.ok(result.includes('block-a'));
    assert.ok(!result.includes('block-b'));
  });

  test('variable substitution inside conditional block', () => {
    const tmpl = '{{#if show}}\nHello {{name}}\n{{/if}}';
    const result = render(tmpl, { show: true, name: 'Hieu' });
    assert.ok(result.includes('Hello Hieu'));
  });
});

// ---------------------------------------------------------------------------
// extractSchemaRegion
// ---------------------------------------------------------------------------

describe('extractSchemaRegion', () => {
  test('extracts content between schema markers', () => {
    const content = 'before\n<!-- lumina:schema -->\nschema content\n<!-- /lumina:schema -->\nafter';
    const region = extractSchemaRegion(content);
    assert.ok(region.includes('schema content'));
    assert.ok(!region.includes('before'));
    assert.ok(!region.includes('after'));
  });

  test('ignores marker text that is not on its own line', () => {
    const content = [
      'Schema markers like `<!-- lumina:schema -->` can be described inline.',
      '<!-- lumina:schema -->',
      'real schema',
      '<!-- /lumina:schema -->',
    ].join('\n');
    const region = extractSchemaRegion(content);
    assert.equal(region, 'real schema');
  });

  test('returns null when open marker is missing', () => {
    const content = 'no markers here\n<!-- /lumina:schema -->\n';
    assert.equal(extractSchemaRegion(content), null);
  });

  test('returns null when close marker is missing', () => {
    const content = '<!-- lumina:schema -->\nno close marker';
    assert.equal(extractSchemaRegion(content), null);
  });

  test('returns null when markers are in wrong order', () => {
    const content = '<!-- /lumina:schema -->\n<!-- lumina:schema -->\n';
    assert.equal(extractSchemaRegion(content), null);
  });
});

// ---------------------------------------------------------------------------
// replaceSchemaRegion
// ---------------------------------------------------------------------------

describe('replaceSchemaRegion', () => {
  test('replaces only the schema region, preserving surrounding content', () => {
    const existing = [
      '# My Project',
      '',
      'Purpose paragraph.',
      '',
      '<!-- lumina:schema -->',
      '\nOld schema content',
      '<!-- /lumina:schema -->',
      '',
      'User content after.',
    ].join('\n');

    const result = replaceSchemaRegion(existing, '\nNew schema content\n');

    assert.ok(result.includes('# My Project'));
    assert.ok(result.includes('Purpose paragraph.'));
    assert.ok(result.includes('New schema content'));
    assert.ok(result.includes('User content after.'));
    assert.ok(!result.includes('Old schema content'));
  });

  test('returns existing content unchanged when markers are missing', () => {
    const content = 'No markers here.';
    const result = replaceSchemaRegion(content, 'new schema');
    assert.equal(result, content);
  });

  test('preserves content before open marker byte-for-byte', () => {
    const existing = '# Title\n\nPurpose\n\n<!-- lumina:schema -->\nold\n<!-- /lumina:schema -->\n';
    const result = replaceSchemaRegion(existing, '\nnew\n');
    assert.ok(result.startsWith('# Title\n\nPurpose\n\n<!-- lumina:schema -->'));
  });

  test('replaces only marker lines, not inline marker mentions', () => {
    const existing = [
      'Inline docs mention `<!-- lumina:schema -->` and `<!-- /lumina:schema -->`.',
      '',
      '<!-- lumina:schema -->',
      'old',
      '<!-- /lumina:schema -->',
    ].join('\n');

    const result = replaceSchemaRegion(existing, 'new');

    assert.ok(result.includes('Inline docs mention'));
    assert.ok(result.includes('new'));
    assert.ok(!result.includes('\nold\n'));
  });
});

// ---------------------------------------------------------------------------
// renderReadme
// ---------------------------------------------------------------------------

describe('renderReadme', () => {
  test('injects purpose text when provided', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\nschema\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'TestWiki' }, 'Track attention variants');
    assert.ok(result.includes('## Project Purpose'));
    assert.ok(result.includes('Track attention variants'));
  });

  test('uses placeholder when no purpose given', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\nschema\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'TestWiki' }, '');
    assert.ok(result.includes('## Project Purpose'));
    assert.ok(result.includes('_(Describe what this wiki'));
  });

  test('substitutes project_name in title', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\n{{project_name}}\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'AwesomeWiki' }, '');
    assert.ok(result.includes('# AwesomeWiki'));
  });
});

// ---------------------------------------------------------------------------
// upsertMarkerBlock / stripMarkerBlock (project-docs-overlay story 7 / AD-3)
// ---------------------------------------------------------------------------

describe('upsertMarkerBlock', () => {
  test('absent file (empty content) is created holding only the block', () => {
    const result = upsertMarkerBlock('', OPEN, CLOSE, 'body line');
    assert.equal(result, `${OPEN}\nbody line\n${CLOSE}\n`);
  });

  test('appends block to existing content with one blank separator line, LF', () => {
    const existing = '# AGENTS.md\n\nSome existing content.\n';
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'body');
    assert.equal(result, `# AGENTS.md\n\nSome existing content.\n\n${OPEN}\nbody\n${CLOSE}\n`);
  });

  test('appends block to existing CRLF content, preserving CRLF throughout', () => {
    const existing = '# AGENTS.md\r\n\r\nSome existing content.\r\n';
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'body');
    assert.equal(result, `# AGENTS.md\r\n\r\nSome existing content.\r\n\r\n${OPEN}\r\nbody\r\n${CLOSE}\r\n`);
    assert.ok(result.split('\r\n').every(line => !line.includes('\n')));
  });

  test('unterminated last line is not counted: one CRLF line picks CRLF', () => {
    const result = upsertMarkerBlock('a\r\nb', OPEN, CLOSE, 'body');
    assert.equal(result, `a\r\nb\r\n\r\n${OPEN}\r\nbody\r\n${CLOSE}\r\n`);
  });

  test('replaces only the region between existing markers, keeps bytes outside untouched', () => {
    const existing = 'before\n\n' + OPEN + '\nold body\n' + CLOSE + '\n\nafter\n';
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'new body');
    assert.equal(result, 'before\n\n' + OPEN + '\nnew body\n' + CLOSE + '\n\nafter\n');
  });

  test('re-running with identical body is idempotent (byte-identical output)', () => {
    const first = upsertMarkerBlock('# Foo\n', OPEN, CLOSE, 'body');
    const second = upsertMarkerBlock(first, OPEN, CLOSE, 'body');
    assert.equal(second, first);
  });

  test('multi-line body renders one line per body line', () => {
    const result = upsertMarkerBlock('', OPEN, CLOSE, 'line one\nline two');
    assert.equal(result, `${OPEN}\nline one\nline two\n${CLOSE}\n`);
  });
});

describe('stripMarkerBlock', () => {
  test('markers not found returns content unchanged', () => {
    const existing = 'nothing to see here\n';
    assert.equal(stripMarkerBlock(existing, OPEN, CLOSE), existing);
  });

  test('file holding only the block strips to empty string', () => {
    const existing = `${OPEN}\nbody\n${CLOSE}\n`;
    const result = stripMarkerBlock(existing, OPEN, CLOSE);
    assert.equal(result.trim(), '');
  });

  test('strips block plus its leading blank separator line, keeps the rest', () => {
    const existing = 'before\n\n' + OPEN + '\nbody\n' + CLOSE + '\n\nafter\n';
    const result = stripMarkerBlock(existing, OPEN, CLOSE);
    assert.equal(result, 'before\n\nafter\n');
  });

  test('preserves CRLF line endings on the remaining content', () => {
    const existing = 'before\r\n\r\n' + OPEN + '\r\nbody\r\n' + CLOSE + '\r\n\r\nafter\r\n';
    const result = stripMarkerBlock(existing, OPEN, CLOSE);
    assert.equal(result, 'before\r\n\r\nafter\r\n');
  });
});

describe('upsertMarkerBlock / stripMarkerBlock — EOL edge cases', () => {
  test('mixed EOL: every existing line keeps its own terminator; new lines use the dominant EOL', () => {
    const existing = 'a\r\nb\nc\r\n'; // 2 CRLF, 1 LF -> dominant CRLF
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'X');
    assert.equal(result, 'a\r\nb\nc\r\n\r\n' + OPEN + '\r\nX\r\n' + CLOSE + '\r\n');
  });

  test('no trailing newline: existing bytes are kept, a terminator is added only where new content follows', () => {
    const existing = 'a\nb'; // no trailing newline
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'X');
    assert.equal(result, 'a\nb\n\n' + OPEN + '\nX\n' + CLOSE + '\n');
  });

  test('replace case never adds a trailing EOL the file did not have', () => {
    const existing = 'before\n' + OPEN + '\nold\n' + CLOSE; // close marker is the last line, no trailing newline
    const result = upsertMarkerBlock(existing, OPEN, CLOSE, 'new');
    assert.equal(result, 'before\n' + OPEN + '\nnew\n' + CLOSE);
  });

  test('install-then-strip round trip restores a file that already had content, byte-for-byte', () => {
    const original = 'before\n';
    const installed = upsertMarkerBlock(original, OPEN, CLOSE, 'body');
    const stripped = stripMarkerBlock(installed, OPEN, CLOSE);
    assert.equal(stripped, original);
  });

  test('install-then-strip round trip restores content surrounding the block', () => {
    const original = 'before\ntext\n';
    const installed = upsertMarkerBlock(original, OPEN, CLOSE, 'body\nmore body');
    const stripped = stripMarkerBlock(installed, OPEN, CLOSE);
    assert.equal(stripped, original);
  });
});

describe('upsertMarkerBlock / stripMarkerBlock — refuse unbalanced or duplicated markers', () => {
  test('upsert throws MarkerBlockError on an open marker with no close', () => {
    const broken = 'before\n' + OPEN + '\nuser content\n';
    assert.throws(() => upsertMarkerBlock(broken, OPEN, CLOSE, 'body'), MarkerBlockError);
  });

  test('upsert throws MarkerBlockError on a duplicated open marker', () => {
    const broken = OPEN + '\na\n' + OPEN + '\nb\n' + CLOSE + '\n';
    assert.throws(() => upsertMarkerBlock(broken, OPEN, CLOSE, 'body'), MarkerBlockError);
  });

  test('upsert throws MarkerBlockError on a duplicated close marker', () => {
    const broken = OPEN + '\na\n' + CLOSE + '\nb\n' + CLOSE + '\n';
    assert.throws(() => upsertMarkerBlock(broken, OPEN, CLOSE, 'body'), MarkerBlockError);
  });

  test('upsert throws MarkerBlockError when close appears before open', () => {
    const broken = CLOSE + '\na\n' + OPEN + '\n';
    assert.throws(() => upsertMarkerBlock(broken, OPEN, CLOSE, 'body'), MarkerBlockError);
  });

  test('strip throws MarkerBlockError on the same malformed input, never silently deletes', () => {
    const broken = 'before\n' + OPEN + '\nuser content\n';
    assert.throws(() => stripMarkerBlock(broken, OPEN, CLOSE), MarkerBlockError);
  });
});
