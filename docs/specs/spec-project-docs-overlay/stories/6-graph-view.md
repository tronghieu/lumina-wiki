---
title: 'Graph view'
type: 'feature'
created: '2026-09-26'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/graph-view.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A human cannot browse the project graph visually. Nothing shows which nodes carry lint violations or stale facts, and nothing links back to the source line (CAP-12).

**Approach:** `project.mjs view` writes one self-contained `_lumina/graph/view.html`. It inlines the vendored `force-graph` 1.51.4 UMD, the viewer code and styles, and the escaped graph data (nodes, edges, evidence, lint findings, doc freshness). The page gives the Obsidian-like interaction listed in `graph-view.md`.

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`. The engine imports only `node:` builtins, relative files, and the vendored js-yaml.
- `force-graph` and the viewer files are read as text and inlined, never imported (AD-6, AD-16).
- The viewer module is imported lazily inside the `view` branch, not at the top of `project.mjs`.
- `view` is the only writer of `_lumina/graph/view.html`. It writes through the engine `atomicWrite`, touches nothing else, and prints `{ok: true, file: "_lumina/graph/view.html"}`. Any argument gives exit 1.
- **Data:**
  - Paths are repo-relative.
  - The inlined JSON escapes `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX`.
  - Findings are the same set `lint` produces.
  - Freshness is the per-doc status loop.
  - Output is byte-identical on unchanged input: no timestamps, and sorted data.
- **No network:**
  - No remote URL is loaded or requested.
  - A `<meta http-equiv="Content-Security-Policy">` sets `default-src 'none'`, allows only inline script and style, plus `data:` images.
- **Page features** (`graph-view.md`):
  - Force layout with drag, zoom and pan; node size by degree.
  - Hover highlights the node and its neighbors and fades the rest.
  - Colour by meta-type, with a legend.
  - Settings panel: filters by meta-type, status and folder; an orphan toggle; sliders for center, repel, link strength and link distance.
  - Local graph within N hops of the selected node; search.
  - Directional arrows with relation labels on edges.
  - Nodes with lint findings, and docs whose state is `stale`, are highlighted distinctly.
  - Click opens a detail panel showing type, status, evidence quotes, findings and a `vscode://file/<abs>:<line>` link.
  - Light and dark themes via `prefers-color-scheme`.
- **Editor link:** the absolute root comes from `location.pathname` at view time, by stripping `/_lumina/graph/view.html`. A Windows drive path (`/C:/…`) loses its leading slash.
- `vendor/force-graph.min.js` is byte-identical to the package's `dist/force-graph.min.js`. `vendor/THIRD-PARTY-NOTICES.md` adds force-graph (MIT) and the license and copyright of every dependency bundled into that file.

**Never:**
- No React, no 3D, no build step, no CDN, no fonts or assets from outside the file.
- No viewer server. No graph or cache written anywhere except `view.html`.
- No installer, package allowlist or skill changes (stories 7 and 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Happy | `view` on parse-pilot | `view.html` written; stdout `{ok, file}` | exit 0 |
| Deterministic | `view` twice, unchanged input | Byte-identical file | — |
| Injection | A doc heading or evidence quote containing `</script><script>` and U+2028 | Inlined data holds only escaped forms; the page parses one data block | — |
| No network | Generated file | Contains no `src=`/`href=` to `http(s):`; CSP meta present | — |
| Empty graph | No in-scope docs | Valid page with an empty graph message | exit 0 |
| Bad args | `view extra` or `view --x` | Nothing written | exit 1 |
| Cold start | `project.mjs status` | `lib/view.mjs` and `force-graph.min.js` are not loaded | — |

</intent-contract>

## Code Map

- `src/project/project.mjs`:
  - Add `view` to `SUBCOMMANDS`. It rejects args like the other no-flag subcommands.
  - Reuse `runLint`'s findings assembly by factoring it into one function that `lint` and `view` both call, rather than a copy.
  - Reuse `computeDocStatuses`, `parseAll`, `loadFacts`, `buildGraph` and `existsUnderRoot`.
- `src/project/lib/fsx.mjs`: `atomicWrite(absPath, text)`.
- `src/project/lib/view.mjs` (new): `renderView({graph, findings, freshness})` returns the HTML string, with the data escaping. It reads `../vendor/force-graph.min.js`, `../view/viewer.js` and `../view/viewer.css` relative to `import.meta.url`.
- `src/project/view/viewer.js` and `viewer.css` (new): the page code, browser-only, using the global `ForceGraph`.
- Vendor source is already extracted at `/private/tmp/claude-501/-Users-luuhieu-Projects-lumina-wiki/319898e4-2485-43da-afba-d2e0a8a513d4/scratchpad/fg/package/`:
  - `dist/force-graph.min.js` is 173.4 KB, has no `</script`, and makes no network calls; its only URLs are XML namespaces.
  - `package.json` lists the dependencies to license: `@tweenjs/tween.js`, `accessor-fn`, `bezier-js`, `canvas-color-tracker`, `d3-array`, `d3-drag`, `d3-force-3d`, `d3-scale`, `d3-scale-chromatic`, `d3-selection`, `d3-zoom`, `float-tooltip`, `index-array-by`, `kapsule`, `lodash-es`.
  - Get each dependency's LICENSE with `npm pack <dep>@<resolved version>` into the scratchpad. That is dev-time only; nothing is added to `package.json`.
- `src/project/vendor/THIRD-PARTY-NOTICES.md`: append, keeping the js-yaml section.
- `src/project/imports.test.mjs`: the import-boundary test. `vendor/force-graph.min.js` is UMD and must be exempt or not scanned as an engine import.

## Tasks & Acceptance

**Execution:**
- `src/project/vendor/force-graph.min.js` + `THIRD-PARTY-NOTICES.md` -- vendor and license -- AD-16.
- `src/project/lib/view.mjs` + `view.test.mjs` -- HTML assembly and escaping -- matrix rows Injection, No network, Empty graph, Deterministic.
- `src/project/view/viewer.js`, `viewer.css` -- the page features -- `graph-view.md`.
- `src/project/project.mjs` + `project.test.mjs` -- the `view` subcommand, the shared findings function, and a lazy import -- rows Happy, Bad args, Cold start (for example, spawn `status` with `--trace-imports`-style module loading checks, or assert the source has no static import of `./lib/view.mjs`).

**Acceptance Criteria:**
- Given a Seli copy with facts (story 4 acceptance), when `view` runs and the file is opened via `file://` in Chrome with no network, then:
  - the graph renders with no console errors and no network requests;
  - filtering by meta-type works;
  - clicking a node shows its evidence and a `vscode://file/…:line` link to the right absolute path;
  - the README P03 node is highlighted.
- Given parse-pilot, when `view` runs, then the file is under 400 KB.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: 614 pass.
- `cmp src/project/vendor/force-graph.min.js <scratchpad>/fg/package/dist/force-graph.min.js` -- expected: identical.

**Manual checks:**
- The Chrome acceptance above on the Seli copy at `<scratchpad>/seli4`.

## Spec Change Log

## Review Triage Log
