---
title: 'Wiki view story 4: graph and tree panes'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/viewer-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server answers `/api/wiki`, but the page shows a placeholder. A reader needs to see the wiki as a typed graph and as a tree of pages, and to pick a page from either.

**Approach:** Replace the placeholder with a root component that loads the wiki once, a graph pane on `force-graph`, and a tree pane. The open page lives only in the URL hash. Everything that can be computed without a browser is a pure module under `ui/lib/` with `node --test` tests against the contract fixture. SPEC CAP-2, CAP-3, CAP-7; spine AD-14, AD-15.

## Boundaries & Constraints

**Always:**
- The open page is the URL hash and nothing else. Panes read it; choosing a page writes it.
- View settings live in the one reducer in `lib/state.mjs`. Hover is the only state a pane keeps to itself.
- Only `GraphPane.jsx` imports `force-graph`. Every string given to it as a label goes through `escapeHtml`.
- Modules in `ui/lib/` import neither React nor a DOM global. A test enforces it.
- Client tests take their wiki data from `test-fixtures/contract/expected/*.json`. A rule the fixture cannot reach is tested on a small hand-made input next to it.
- Interface text comes from `lib/strings.mjs`, in English.
- After any change under `ui/`, run `npm run build:viewer` and commit both generated files.

**Never:**
- No reader pane, filters, search, local graph, community coloring, or lint marks: later stories.
- No new npm package. No CSS import from `ui/`. No inline style attribute where a class will do (the CSP allows it, the shell test does not cover components, keep styling in `viewer.css`).
- No `dangerouslySetInnerHTML`. No edit under `src/project/`.
- No client-side resolution of links or ids (AD-5).
- No navigation to an address taken from wiki data unless it starts with `http://` or `https://`. An edge endpoint is untrusted text, and `javascript://...` also contains `://`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Load | `/api/wiki` answers | graph and tree drawn; no page open when the hash is empty | N/A |
| Load fails | network error or non-200 | one full-window notice with a reload button | no blank page |
| Choose a page node or tree row | click | hash becomes that page; node ringed, its neighbors bright, the rest dim; tree row selected, its folders open, scrolled into view | N/A |
| Choose a `url` node | click | an `http:` or `https:` href opens in a new tab with `noopener`; any other scheme opens nothing; hash unchanged | N/A |
| Choose a `missing` node | click | nothing | N/A |
| Hash names an unknown id | `#/nope` | nothing ringed or selected; panes keep working | N/A |
| Reload with a hash | `#/sources/lora` | that page is ringed and selected after load | N/A |
| Page with `type: null` | `index`, `log` | in the tree; in the graph only when an edge touches it | N/A |
| Undirected edge | `directed: false` | no arrow | N/A |
| Citation | `type: "cites"` | dashed line with an arrow | N/A |
| Two edges on one pair of nodes | fixture: `sources/lora` and `sources/lora-2` | drawn as separate curves | N/A |
| Self-loop | fixture: `concepts/rank` | drawn as a loop; two loops on one node do not overlap | N/A |
| Choose an edge | click | a caption names `from`, the relation type, `to`, and confidence when set; the line is drawn bright; a click on the background clears it | N/A |
| Open page off screen | chosen in the tree | the graph moves to show its node; a visible node does not move | N/A |
| Titles in any language | `Đại số`, `Éclair`, `zebra` | sorted by a fixed-locale collator, not by code unit | N/A |
| `/api/wiki` answers 200 with a wrong shape, or never answers | | the load-failure notice | no blank page |
| Hostile title | `<img src=x onerror=alert(1)>` | shown as text in tooltip, tree, and caption | N/A |
| Id needing encoding | `sources/a b`, `sources/100%`, `sources/x#y` | hash round-trips to the same id | N/A |
| Relation type absent from `schema` | fixture: `mentions` | drawn as directed | N/A |

</frozen-after-approval>

## Code Map

- `src/viewer/test-fixtures/contract/expected/wiki.json` -- 13 nodes (11 page, 1 url, 1 missing), 13 edges, 6 communities; `README.md` beside it says what each row proves.
- `src/viewer/ui/main.jsx` -- placeholder to replace. `src/viewer/app/viewer.css` -- tokens and the pane grid: `.app`, `.pane`, `.pane-graph`, `.pane-tree`, `.status`.
- `src/project/view/viewer.js` -- the look to reuse, not the code. Facts: `nodeRelSize` 4; `nodeVal = 1 + sqrt(degree)`; link color is the source node's color with alpha `59`, `14` when another node is hovered, full when active; faded node alpha `33`; link width 0.6, 1.6 when active; arrow length 3 at `relPos` 1; relation text drawn on the link only at zoom 2.5 or more, 12px constant screen size, upright, on a `--bg` pad in `--muted`; `autoPauseRedraw(false)` so hover keeps working after the layout cools; `zoomToFit(400, 40)` once on the first `onEngineStop`; filtering by `nodeVisibility` and `linkVisibility`, `graphData` set once; accessors re-applied to redraw; forces: center 1, charge -200, link distance 70, link strength `1 / max(1, min(degree of the two ends))`.
- `force-graph` -- the tooltip writes `nodeLabel` and `linkLabel` as HTML. `linkCurvature` draws a self-loop when the two ends are the same node. `linkLineDash` takes an array.

## Tasks & Acceptance

**Execution:**
- [x] `ui/lib/hash.mjs` -- `idToHash(id)` -> `'#/' + segments.map(encodeURIComponent).join('/')`; `hashToId(hash)` -> the id, or `null` for an empty hash, a hash without the `#/` prefix, or one that fails to decode.
- [x] `ui/lib/escape.mjs` -- `escapeHtml(value)` for `& < > " '`.
- [x] `ui/lib/strings.mjs` -- every interface string, one export `STRINGS`.
- [x] `ui/lib/tree.mjs` -- `buildTree(nodes, entityTypes)` -> rows `{kind: 'page', id, title}` and `{kind: 'folder', path, name, children}` from page nodes only. Root pages first, by id. Then top folders in `entityTypes` order, others after by name. Inside a folder: folders by name, then pages by title, then id. `ancestorsOf(id)` -> the folder paths that hold it.
- [x] `ui/lib/graph-model.mjs` -- `TYPE_PALETTE` (14 Catppuccin Mocha accents; first six in the project viewer's order), `NEUTRAL` gray. `buildGraphModel(wiki)` -> `{nodes, links, neighbors, degree}`: nodes are every node an edge touches plus every page whose `type` is not null; each has `id, kind, title, color, val`; color is the palette entry at the type's index in `schema.entityTypes`, cycled, `NEUTRAL` for a null type, a `url`, or a `missing` node; links have `source, target, type, directed, confidence, citation, curvature, key`; curvature spreads edges that share an unordered pair and gives each self-loop its own non-zero value; `key` is unique. `nodeTooltip(node)` and `edgeCaption(link, titleOf)` return plain text.
- [x] `ui/lib/state.mjs` -- `initialState`, `reducer(state, action)` with `toggleFolder`, `openFolders` (a list of paths), `selectEdge`, `clearEdge`.
- [x] `ui/lib/*.test.mjs` -- one test file per module above, on the contract fixture and the matrix rows; `purity.test.mjs` scans every non-test file in `ui/lib/` for an import of `react`, `react-dom`, `force-graph`, or a use of `window`, `document`, `navigator`, `location`.
- [x] `ui/panes/TreePane.jsx` -- props `{tree, openId, collapsed, onToggle, onOpen}`; rows are buttons; the selected row scrolls into view when `openId` changes.
- [x] `ui/panes/GraphPane.jsx` -- props `{model, openId, onOpen, onSelectEdge}`; owns the `force-graph` instance, hover, `ResizeObserver`, the legend, and the look listed in the Code Map; `url` and `missing` nodes drawn hollow, `missing` in `--error`.
- [x] `ui/App.jsx`, `ui/main.jsx` -- load `/api/wiki` once; subscribe to `hashchange`; hold the reducer; open the open page's folders; render the two panes, the edge caption, and the load-failure notice.
- [x] `app/viewer.css` -- tree rows, legend, caption, notice.
- [x] `app/viewer.js`, `app/THIRD-PARTY-NOTICES.md` -- rebuild.

**Acceptance Criteria:**
- Given the fixture served by `view.mjs`, when the page loads in a browser, then every entity type present has a legend color, `sources/lora` and `sources/lora-2` are joined by one line without an arrow and one dashed arrow, and the tree lists `index`, `log`, and the reading unit under `readings/deep-work`.
- Given a click on a tree row, then the address bar shows that page's hash and Back returns to the previous one.
- Given `npm run test:viewer` and `npm run ci:viewer-bundle`, then both pass.

## Implementation Notes

- Checked in Chrome on a copy of the contract fixture: type colors and legend, hollow `url` and `missing` nodes, dashed citations, separate curves for two edges on one pair, both self-loops on `concepts/rank`, hover and open-page focus, the edge caption, tree selection, hash updates, and Back.
- Hover still works after the layout has settled with `autoPauseRedraw` left at its default.
- A tab that the browser reports as hidden delays the library's click handling, which runs on animation frames. That is the browser throttling a hidden tab, not viewer behavior.
- Bundle: 417,355 bytes, 34 packages. `markdown-it` returns with the reader in story 5.
- `GraphPane` props are `{model, legend, openId, selectedEdge, onOpen, onSelectEdge, onClearEdge, children}`.

## Spec Change Log

- **2026-10-10, review pass 1.** The type palette reused the colors that mean error, warning, and info, and held five near-identical pinks; it is now twelve distinct colors with red left out. Legend entries, tooltip strings, the open-page rule, and the address allow-list moved from the components into `ui/lib/` with tests, because a mutation of each survived. The graph now stops when the layout settles instead of on a 15-second clock, and repaints only on change. The frozen rule on hand-made test data was reworded. Patched in place. KEEP: the hash as the only record of the open page; copies of the model handed to the library; curvature for edges that share a pair.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Model link flags and node size never asserted | medium | patch | four mutants survived; fixture assertions added |
| 2 | Palette cycling unexercised | low | patch | assertion with one type more than the palette |
| 3 | Untyped page touched by an edge uncovered | medium | patch | mutant survived; hand-made case added |
| 4 | Two-link curvature check passes on `0` and `-0` | medium | patch | non-zero assertion added |
| 5 | Nested folder and root page order unpinned | low | patch | two cases added |
| 6 | Purity scan misses subpaths, `globalThis.`, non-`.mjs` files; trips on strings | medium | patch | scan rewritten with a self-test |
| 7 | Address guard for `url` nodes lived in the pane, untested | high | patch | `links.mjs` holds the one allow-list, with tests |
| 8 | Tooltip escaping composed in the pane | high | patch | `nodeLabelHtml`, `linkLabelHtml` in lib, tested on hostile input |
| 9 | Open-page rule untested | medium | patch | `openPageId` in lib |
| 10 | Legend computed in the pane | low | patch | `legendOf` in lib |
| 11 | Tooltip theme lost to the library's later rule | low | patch | selector raised |
| 12 | Full-rate repaint forever; redundant with re-applied accessors | medium | patch | `autoPauseRedraw(false)` removed; checked in a browser after the layout cooled |
| 13 | Ring and stroke widths in graph units | low | patch | divided by the zoom scale |
| 14 | First fit after 15 s; overrides the reader; never lays out in a hidden tab | medium | patch | stops on settled layout; no fit after the reader touched the view |
| 15 | Type palette collides with error, warning, info; near-identical pinks | medium | bad_spec | palette replaced |
| 16 | Relation text ignores the focus dimming | low | patch | hidden for links outside the focus |
| 17 | Selected edge not shown in the graph, no dismissal | low | patch | drawn bright; background click clears |
| 18 | Pointer cursor over nodes that do nothing | low | patch | cursor only where a click acts |
| 19 | Stale comment and dead branch in `App.jsx`; dead loop in the model | low | patch | removed |
| 20 | Literal `x`, bare `(high)`, unused `appTitle` | low | patch | strings moved; confidence labelled |
| 21 | Folder named like an `Object.prototype` key cannot collapse | low | patch | own-property reads |
| 22 | Tests use hand-made data against a frozen rule | low | bad_spec | rule reworded |
| 23 | Titles with diacritics sort after all ASCII | medium | bad_spec | fixed-locale collator |
| 24 | Wrong-shape 200 blanks the page; a silent server never fails | medium | patch | shape check and a 15 s limit |
| 25 | Failure hint blamed a stopped viewer for any error | low | patch | reworded |
| 26 | No accessible names on graph, tree, caption | low | patch | labels and status roles |
| 27 | Edges have no keyboard path | low | reject | the reader's relations list is the keyboard path, from story 5 |
| 28 | Lone node magnified by the fit; hover sticks after the pointer leaves | low | patch | fit skipped; hover cleared |
| 29 | Clicking the open page's node leaves its collapsed folder closed | low | patch | folders reopened |
| 30 | Empty model shows an empty legend box | low | patch | legend hidden, a note shown |
| 31 | No test for `strings.mjs` | low | patch | shape test added |
| 32 | `GraphPane` props differ from the task list | false | reject | the task list is superseded by the code and this log |

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass
- `npm run build:viewer && npm run ci:viewer-bundle` -- expected: pass after the generated files are staged

**Manual checks (if no CLI):**
- Start `node src/viewer/view.mjs` in a copy of the contract fixture workspace and open the address in a browser. Check each matrix row that names something visible.
