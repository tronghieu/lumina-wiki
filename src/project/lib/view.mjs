/**
 * @file view.mjs
 * @description `renderView({graph, findings, freshness})` (CAP-12, AD-16):
 * assembles the one self-contained `_lumina/graph/view.html` string. Reads
 * the vendored `force-graph` UMD bundle and the viewer's own JS/CSS as text
 * (relative to `import.meta.url`, never imported -- AD-6) and inlines them,
 * plus the graph data as one escaped JSON block. No filesystem write here;
 * `project.mjs`'s `view` subcommand does the (lazy-imported) `atomicWrite`.
 *
 * Determinism (AD-19's "byte-identical on unchanged input"): no timestamp is
 * ever written; every input (`graph`, `findings`, `freshness`) is already
 * sorted by its producer, and this module's own serialization introduces no
 * further nondeterminism (plain `JSON.stringify`, static template strings).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { META_TYPES } from '../ontology.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_PATH = join(HERE, '..', 'vendor', 'force-graph.min.js');
const VIEWER_JS_PATH = join(HERE, '..', 'view', 'viewer.js');
const VIEWER_CSS_PATH = join(HERE, '..', 'view', 'viewer.css');

// Escaped as \uXXXX (AD-16): `<`/`>`/`&` so `</script>` (or an HTML comment
// via `<!--`) can never prematurely close the inline <script>, and U+2028/
// U+2029 because they are valid JSON string characters but illegal raw
// inside a JS string literal (they'd otherwise terminate the statement).
// Built from character codes, not literal source characters: U+2028/U+2029
// are themselves line terminators, illegal unescaped in this file's own
// source (a string or regex literal may not contain a raw one).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LS]: '\\u2028',
  [PS]: '\\u2029',
};
const ESCAPE_RE = new RegExp('[<>&' + LS + PS + ']', 'g');

/** One inlined JSON data block, safe to embed inside a `<script>` element. */
function inlineJson(value) {
  return JSON.stringify(value).replace(ESCAPE_RE, (c) => ESCAPES[c]);
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;";

/**
 * @param {object} params
 * @param {{nodes: object[], edges: object[], findings: object[]}} params.graph - `buildGraph()`'s output (or an equivalent already-sorted shape), nodes optionally enriched with `metaType`/`at`.
 * @param {object[]} params.findings - the full lint finding set (same as `lint` produces).
 * @param {{docs: object[], summary: object}} params.freshness - `computeDocStatuses()`'s output.
 * @returns {Promise<string>} the complete HTML page.
 */
export async function renderView({ graph, findings, freshness }) {
  const [forceGraphSrc, viewerJs, viewerCss] = await Promise.all([
    readFile(VENDOR_PATH, 'utf8'),
    readFile(VIEWER_JS_PATH, 'utf8'),
    readFile(VIEWER_CSS_PATH, 'utf8'),
  ]);

  const data = {
    nodes: graph.nodes,
    edges: graph.edges,
    findings,
    freshness,
    // The fixed meta-type list (ontology.mjs), so viewer.js builds its
    // filters/legend from one source instead of a second, hand-kept copy.
    metaTypes: Object.keys(META_TYPES),
  };

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Lumina project graph</title>
<style>
${viewerCss}
</style>
</head>
<body>
<div id="app">
  <div id="graph-canvas"></div>
  <div id="empty-message" hidden>No in-scope documents.</div>
  <div id="panel">
    <div id="search-box">
      <input id="search-input" type="search" placeholder="Search nodes" autocomplete="off">
    </div>
    <div id="summary"></div>
    <details id="settings" open>
      <summary>Settings</summary>
      <div id="filter-meta-types"></div>
      <label>Status <select id="filter-status"><option value="">(any)</option></select></label>
      <label>Folder <select id="filter-folder"><option value="">(any)</option></select></label>
      <label><input type="checkbox" id="filter-orphans"> Hide orphan nodes</label>
      <label><input type="checkbox" id="show-rings"> Show finding rings</label>
      <label>Local graph hops <input type="number" id="local-hops" min="0" step="1" value=""> <button id="local-clear" type="button">Clear</button></label>
      <label>Center force <input type="range" id="force-center" min="0" max="2" step="0.05" value="1"></label>
      <label>Repel force <input type="range" id="force-charge" min="-500" max="0" step="10" value="-200"></label>
      <label>Link strength <input type="range" id="force-link-strength" min="0" max="2" step="0.05" value="1"></label>
      <label>Link distance <input type="range" id="force-link-distance" min="10" max="300" step="5" value="70"></label>
    </details>
    <div id="legend"></div>
  </div>
  <div id="detail" hidden>
    <button id="detail-close" type="button" aria-label="Close">&times;</button>
    <div id="detail-body"></div>
  </div>
</div>
<script>
${forceGraphSrc}
</script>
<script>
window.__LUMINA_VIEW_DATA__ = ${inlineJson(data)};
</script>
<script>
${viewerJs}
</script>
</body>
</html>
`;
}
