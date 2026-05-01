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
} from './template-engine.js';

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
});

// ---------------------------------------------------------------------------
// renderReadme
// ---------------------------------------------------------------------------

describe('renderReadme', () => {
  test('injects purpose text when provided', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\nschema\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'TestWiki' }, 'Track attention variants');
    assert.ok(result.includes('Track attention variants'));
  });

  test('uses placeholder when no purpose given', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\nschema\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'TestWiki' }, '');
    assert.ok(result.includes('_(Describe what this wiki'));
  });

  test('substitutes project_name in title', () => {
    const template = '# {{project_name}}\n\n<!-- lumina:schema -->\n{{project_name}}\n<!-- /lumina:schema -->\n';
    const result = renderReadme(template, { project_name: 'AwesomeWiki' }, '');
    assert.ok(result.includes('# AwesomeWiki'));
  });
});
