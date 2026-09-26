import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderView } from './view.mjs';

const VIEWER_JS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'view', 'viewer.js');

// ---------------------------------------------------------------------------
// Minimal, hand-built `{graph, findings, freshness}` -- `renderView` is
// exercised in isolation from `buildGraph`/`project.mjs`, same convention as
// `lint.test.mjs`/`query.test.mjs`.
// ---------------------------------------------------------------------------

function baseInput(overrides = {}) {
  return {
    graph: {
      nodes: [
        { id: 'doc:docs/a.md', kind: 'doc', metaType: 'Decision', status: 'accepted', inScope: true },
      ],
      edges: [],
      findings: [],
    },
    findings: [],
    freshness: { docs: [{ path: 'docs/a.md', hash: 'deadbeef', state: 'fresh' }], summary: { fresh: 1, changed: 0, stale: 0, neverIngested: 0 } },
    ...overrides,
  };
}

describe('renderView: determinism', () => {
  test('the same input renders the same byte-identical HTML twice', async () => {
    const input = baseInput();
    const a = await renderView(input);
    const b = await renderView(input);
    assert.equal(a, b);
  });
});

describe('renderView: injection (matrix row)', () => {
  test('a quote/heading with </script><script> and U+2028 appears only escaped, and the page has exactly one inlined data block', async () => {
    const nasty = 'x</script><script>alert(1)</script>\u2028\u2029end';
    const input = baseInput({
      graph: {
        nodes: [{ id: 'doc:docs/a.md', kind: 'doc', metaType: 'Decision' }],
        edges: [{
          from: 'doc:docs/a.md',
          relation: 'references',
          to: 'doc:docs/b.md',
          evidence: [{
            file: 'docs/a.md', line: 3, quote: nasty, provenance: 'extracted',
          }],
        }],
        findings: [],
      },
    });
    const html = await renderView(input);

    assert.ok(!html.includes('</script><script>alert'), 'the raw injection payload must not survive unescaped');
    assert.ok(!html.includes('\u2028') && !html.includes('\u2029'), 'U+2028/U+2029 must not appear raw');
    assert.ok(html.includes('\\u003c/script\\u003e\\u003cscript\\u003e'), 'the escaped form must still carry the data');
    assert.ok(html.includes('\\u2028') && html.includes('\\u2029'));

    const dataBlocks = html.match(/window\.__LUMINA_VIEW_DATA__ = /g) ?? [];
    assert.equal(dataBlocks.length, 1, 'exactly one inlined data block');
  });
});

describe('renderView: no network (matrix row)', () => {
  test('no src=/href= to http(s), and the CSP meta is present', async () => {
    const html = await renderView(baseInput());
    assert.ok(!/\b(?:src|href)\s*=\s*["']https?:/i.test(html));
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  });
});

describe('renderView: empty graph (matrix row)', () => {
  test('zero nodes renders a valid page with an empty-graph message, not a throw', async () => {
    const html = await renderView(baseInput({
      graph: { nodes: [], edges: [], findings: [] },
      freshness: { docs: [], summary: { fresh: 0, changed: 0, stale: 0, neverIngested: 0 } },
    }));
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes('No in-scope documents'));
    assert.ok(html.includes('"nodes":[]'));
  });
});

// ---------------------------------------------------------------------------
// viewer.js source-level checks: force-graph's bundled tooltip (float-tooltip)
// inserts `nodeLabel`/`linkLabel` strings via innerHTML, and the page's CSP
// allows inline script -- an unescaped label built from doc content (a
// status value, a path) could carry a live `<img onerror=...>`. viewer.js
// must (a) never itself write untrusted data via innerHTML, and (b) escape
// every string it hands to force-graph's label accessors.
// ---------------------------------------------------------------------------

describe('viewer.js: XSS hygiene', () => {
  test('is syntactically valid JavaScript', () => {
    const src = readFileSync(VIEWER_JS_PATH, 'utf8');
    assert.doesNotThrow(() => new vm.Script(src));
  });

  test('never writes DOM content via innerHTML (textContent/createElement only)', () => {
    const src = readFileSync(VIEWER_JS_PATH, 'utf8');
    assert.ok(!/\.innerHTML\s*=/.test(src), 'expected no "<element>.innerHTML =" assignment in viewer.js');
  });

  test('escapeHtml (extracted and run via vm) escapes & < > " \'', () => {
    const src = readFileSync(VIEWER_JS_PATH, 'utf8');
    const match = src.match(/var HTML_ESCAPES = \{[\s\S]*?\};\s*function escapeHtml\(s\) \{[\s\S]*?\n {2}\}/);
    assert.ok(match, 'expected to find HTML_ESCAPES/escapeHtml in viewer.js');

    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`${match[0]}\nthis.__escapeHtml = escapeHtml;`, sandbox);

    const payload = '<img src=x onerror="alert(1)">\'&';
    const escaped = sandbox.__escapeHtml(payload);
    assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;');
    assert.ok(!/[<>"']/.test(escaped), 'no unescaped HTML-special character survives');
  });

  test('.nodeLabel/.linkLabel accessors both route their string through escapeHtml', () => {
    const src = readFileSync(VIEWER_JS_PATH, 'utf8');
    assert.match(src, /\.nodeLabel\(function \(n\) \{ return escapeHtml\(/);
    assert.match(src, /\.linkLabel\(function \(l\) \{ return escapeHtml\(/);
  });
});
