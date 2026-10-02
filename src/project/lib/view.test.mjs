import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderView, detectCommunities } from './view.mjs';

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

describe('detectCommunities', () => {
  // Two triangles joined by one bridge edge, plus one isolated node.
  const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'z'].map((x) => ({ id: `concept:${x}` }));
  const e = (from, to) => ({ from: `concept:${from}`, to: `concept:${to}` });
  const edges = [e('a1', 'a2'), e('a2', 'a3'), e('a3', 'a1'), e('a3', 'b1'), e('b1', 'b2'), e('b2', 'b3'), e('b3', 'b1')];

  test('splits two linked triangles into two communities and leaves an isolated node alone', () => {
    const { of, list } = detectCommunities(nodes, edges);
    assert.deepEqual(of, [0, 0, 0, 1, 1, 1, 2]);
    assert.deepEqual(list, [
      { name: 'a3', size: 3 },
      { name: 'b1', size: 3 },
      { name: 'z', size: 1 },
    ]);
  });

  test('is deterministic and survives an edge to an unknown node', () => {
    const withDangling = [...edges, { from: 'concept:a1', to: 'concept:missing' }];
    assert.deepEqual(detectCommunities(nodes, withDangling), detectCommunities(nodes, edges));
  });

  test('renderView tags every node with its community index', async () => {
    const html = await renderView(baseInput());
    assert.ok(html.includes('"community":0'));
    assert.ok(html.includes('"communities":[{"name":"docs/a.md","size":1}]'));
  });
});

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

  test('the .nodeLabel/.linkLabel callbacks (viewer.js run via vm) return escaped HTML', () => {
    // Every DOM lookup resolves to one inert, chainable stub; ForceGraph's
    // chain records each setter's argument so the label callbacks can be
    // called directly.
    const stub = new Proxy(function () {}, {
      get: (_, prop) => {
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === Symbol.iterator) return function* () {};
        return stub;
      },
      set: () => true,
      apply: () => stub,
    });
    const captured = {};
    const graph = new Proxy({}, {
      get: (_, prop) => (...args) => {
        if (args.length > 0) captured[prop] = args[0];
        return graph;
      },
    });
    const data = {
      nodes: [
        { id: 'doc:docs/<b>.md', kind: 'doc', metaType: 'Decision', status: '<img onerror=x>', at: { file: 'docs/<b>.md', line: 1 } },
        { id: 'id:X', kind: 'id' },
      ],
      edges: [{ from: 'doc:docs/<b>.md', to: 'id:X', relation: '<script>"\'&', evidence: [] }],
      findings: [],
      freshness: { docs: [], summary: {} },
      metaTypes: ['Decision'],
    };
    const sandbox = {
      window: { __LUMINA_VIEW_DATA__: data, addEventListener() {} },
      document: stub,
      location: { pathname: '/repo/_lumina/graph/view.html' },
      getComputedStyle: () => stub,
      ForceGraph: () => () => graph,
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(VIEWER_JS_PATH, 'utf8'), sandbox);

    assert.equal(typeof captured.nodeLabel, 'function');
    assert.equal(typeof captured.linkLabel, 'function');
    assert.equal(
      captured.nodeLabel(data.nodes[0]),
      'doc:docs/&lt;b&gt;.md (Decision) [&lt;img onerror=x&gt;]',
    );
    assert.equal(captured.linkLabel({ relation: data.edges[0].relation }), '&lt;script&gt;&quot;&#39;&amp;');
  });
});
