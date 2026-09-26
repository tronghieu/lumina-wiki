---
title: 'Graph view'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_revision: '70655cbf21f417f5ec0a43408d7f7f797b00b59e'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/graph-view.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
warnings: []
deferred:
  - summary: >-
      src/project tests run in no npm script or CI job.
    evidence: |-
      package.json and ci.yml reference no src/project tests; story 7 owns test:project wiring.
    location: >-
      package.json
    severity: medium
  - summary: >-
      Browser-side viewer logic (computeRoot, empty state, filters, local graph) has no automated test.
    evidence: |-
      No test executes viewer.js beyond a syntax check; testing needs pure helpers pulled out of the IIFE or a stub DOM. Covered only by the manual Chrome check.
    location: >-
      src/project/view/viewer.js
    severity: medium
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

### 2026-09-26 — Review pass
- verdicts: 41 findings — high 2, medium 15, low 21, false 3, maybe-false 0
- findings:
  - Blind Hunter:
    - `[high]` `patch` XSS: `nodeLabel`/`linkLabel` strings go through float-tooltip `innerHTML`; `'unsafe-inline'` lets an `onerror` in a status or path run — HTML-escape every tooltip string; every other DOM write from data uses `textContent`
    - `[medium]` `patch` stale and warning rings share one colour; no ring legend — distinct stale colour and a ring legend
    - `[low]` `patch` info findings drawn as warnings — own colour
    - `[medium]` `patch` findings and stale attached by `at.file`, so concept/id/frag nodes inherit a citing doc's findings; unattached findings (P16) never shown — attach to `doc:` nodes only; a summary panel lists counts and unattached findings
    - `[low]` `patch` editor link not re-encoded (`#`, `?`, `%`) — encode path segments
    - `[low]` `patch` search zooms to filtered-out nodes — restrict to visible nodes
    - `[low]` `reject` local-graph BFS walks hidden nodes; no-selection hops no-op — defensible UI behaviour; Clear exits
    - `[medium]` `patch` relation labels only on hover — draw labels on canvas past a zoom threshold
    - `[medium]` `patch` no test executes `viewer.js`; an edge with a missing endpoint throws in `neighborsOf` — `vm.Script` syntax check and drop edges whose endpoints are absent
    - `[low]` `patch` "paths are repo-relative" unasserted — assert the absolute root is absent from the HTML
    - `[low]` `patch` resolver/graph loading repeated three times in `project.mjs` — one loader shared by lint, query, view
    - `[low]` `patch` `atFor` O(N·E) over every node — index edges by endpoint once
    - `[medium]` `patch` detail panel shows only `evidence[0]` and no evidence `file:line` links — list every evidence entry with its `vscode://` link (CAP-12)
  - Edge Case Hunter:
    - `[high]` `patch` tooltip XSS — same as above
    - `[medium]` `patch` missing edge endpoint blanks the viewer — same as above
    - `[low]` `patch` info ring colour — same as above
    - `[medium]` `patch` concept/id inherit findings — same as above
    - `[low]` `patch` search ignores filters — same as above
    - `[low]` `patch` no resize handler — resize the graph with the window
    - `[low]` `patch` link encoding — same as above
    - `[low]` `patch` page opened from another path gives wrong links — hide the link when the suffix does not match
    - `[medium]` `patch` only `evidence[0]` shown — same as above
    - `[low]` `defer` empty-graph test vacuous (the div is static) — part of the viewer-logic test gap below
    - `[low]` `patch` link claim — same as the encoding row
    - `[false]` `reject` viewer assets missing from `package.json` `files` — the intent's Never excludes allowlist changes; story 7's completeness test covers every `src/project` file
  - Verification Gap:
    - `[medium]` `patch` node enrichment (`metaType`, `at`) never checked — parse the data block and assert known nodes
    - `[medium]` `patch` inlined findings/freshness never checked — deep-equal against `lint` and `status` on the same root
    - `[medium]` `patch` "bundle inlined" assertion passes without the bundle — assert the vendored file content is in the HTML
    - `[medium]` `defer` viewer helpers (`computeRoot`, empty state, filters) untested — needs helpers pulled out of the IIFE or a stub DOM; manual Chrome check covers them this story
    - `[low]` `reject` cold-start regex misses a multi-line static import — cost of a static import is negligible; no runtime harness exists
    - `[medium]` `defer` `src/project` tests not in CI — story 7
  - Intent Alignment:
    - `[false]` `reject` cold start structural vs runtime — structural check matches the Code Map's allowed form
    - `[low]` `patch` injection tested only on hand-built input and quotes — add a `view` run on a doc whose heading holds the payload
    - `[low]` `patch` empty graph tested as markup presence — same as the deferred viewer-logic gap (counted as patch for the data assertion)
    - `[low]` `patch` findings attached by file — same as above
    - `[medium]` `patch` edge labels hover-only — same as above
    - `[false]` `reject` status filter uses frontmatter status — the spec's "status" is node status; freshness is shown by rings
    - `[low]` `patch` evidence quotes partial — same as above
    - `[low]` `patch` editor link strips the slash on all platforms — correct, a Unix path otherwise gives `vscode://file//…`; add the encoding fix
    - `[medium]` `patch` notices list only direct dependencies; transitive bundled packages (d3-dispatch, d3-timer, d3-quadtree, d3-interpolate, …) and bezier-js copyright missing — list every package in force-graph@1.51.4's production dependency tree with its license and copyright
    - `[low]` `patch` stale and warning share a colour — same as above

## Auto Run Result

- **Change:** `project.mjs view` writes one self-contained `_lumina/graph/view.html`. The page inlines the vendored force-graph 1.51.4, the viewer JS and CSS, and escaped data: nodes enriched with `metaType` and `at`, edges, lint findings, and freshness. It sets a CSP meta tag and loads nothing from the network. It implements the full feature list in `graph-view.md` and has a findings and freshness summary panel. The viewer module is lazily imported. `project.mjs` gained one shared graph loader.
- **Files:**
  - `src/project/lib/view.mjs` (new): HTML assembly and escaping.
  - `src/project/view/viewer.js`, `viewer.css` (new): the page.
  - `src/project/vendor/force-graph.min.js` (new): byte-identical to npm `dist`.
  - `src/project/vendor/THIRD-PARTY-NOTICES.md`: all 31 bundled packages.
  - `src/project/project.mjs`: the `view` subcommand, the shared loader and `assembleFindings`.
  - `src/project/lib/query.mjs`: exported location helpers and an endpoint index.
  - Tests: `view.test.mjs` (new) and `project.test.mjs`.
- **Review:** 41 findings.
  - Patched: 34, including 2 high (one tooltip XSS, reported twice) and 11 medium.
  - Deferred: 2 (CI wiring; browser-side logic tests).
  - Rejected: 5 (3 false, 2 low).
- **Follow-up review:** recommended. Patched high entries: 1 (XSS). The unverified risks are that the viewer logic changed after review and that the XSS fix is checked only by a unit escape test and a no-`innerHTML` scan.
- **Verification:**
  - `node --test src/project/`: 513 pass, 2 skipped.
  - `npm run test:scripts`: 614 pass.
  - `cmp` on the vendor bundle: identical.
  - Seli copy: `view` takes 0.22 s and writes 1.2 MB. The page was served from 127.0.0.1 in Chrome.
    - It renders with no console errors, and its only request is the page itself.
    - The legend, ring legend and summary panel show.
    - The inlined data has the README P03 at line 102 and the 2 stale docs.
- **Residual risks:**
  - Node click and hover could not be exercised in the automated tab (`document.hidden` is true, so force-graph never runs its hit-testing), so a manual click in a foreground Chrome window is still needed.
  - A doc without a declared ID gets `at.quote` `---` when its first line is frontmatter.
