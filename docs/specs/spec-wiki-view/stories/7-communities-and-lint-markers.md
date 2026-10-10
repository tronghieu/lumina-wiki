---
title: 'Wiki view story 7: communities and lint markers'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'bf9d875'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/viewer-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The graph shows what kind each page is, but not which pages belong together, and nothing tells a reader which pages the wiki's own checks complain about.

**Approach:** Add a second color mode that paints each page by its detected community and lists the communities with their members. Load the lint findings once, after the graph is on screen, and mark the pages they point at: always in the tree, behind a toggle in the graph, and in full in the reader. A failed lint request costs only the marks. SPEC CAP-5, CAP-15; spine AD-6, AD-12, AD-13.

## Boundaries & Constraints

**Always:**
- Community numbers and names come from `/api/wiki` as sent. The client computes no community.
- Community color is the community palette entry at the community's index, cycled. `url` and `missing` nodes, which have no community, keep their hollow look.
- `/api/lint` is requested once per page load, after `/api/wiki` has been drawn. Its failure shows one small notice and leaves graph, tree, and reader working.
- A page is marked only for a finding whose `nodeId` is that page. Findings with `nodeId: null` are listed once, in a group for the whole wiki.
- The tree always marks. The graph marks only while the toggle is on; the toggle starts off.
- The viewer shows findings and offers no fix.
- Color mode and the lint toggle live in the one reducer.
- After any change under `ui/`, rebuild and commit both generated files.

**Never:**
- No lint run from the client, no polling, no retry timer.
- No new filter kinds: communities are a way to color and to list, not a filter.
- No change to the server.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Color by community | mode switched | each page node takes its community's color; the type toggles keep working and show no type colors | N/A |
| Community list | community mode | one entry per community, largest first as sent: the title of its name page, its size, and its member pages as links | N/A |
| Community of one | a page with no relations | listed like any other | N/A |
| Back to type colors | mode switched back | the first view returns | N/A |
| Lint loads | `/api/lint` answers | tree rows of pages with findings carry a mark colored by the worst severity; folders holding such a page carry a fainter one | N/A |
| Lint toggle on | graph | marked page nodes get a ring colored by the worst severity | N/A |
| Open a marked page | reader | its findings listed: check id, severity, message, and line when set | N/A |
| Findings that name no page | `nodeId: null` | listed once under the whole-wiki group, with the file each names | N/A |
| Lint summary | any | counts of errors, warnings, and info shown with the toggle | N/A |
| Lint fails | 500, network error, wrong shape | a small notice by the toggle; no marks; everything else works | no blank window |
| Lint still loading | slow reply | no marks yet; the toggle is disabled | N/A |
| No findings | clean wiki | no marks; the summary says so | N/A |
| Hostile finding text | message with markup | shown as text | N/A |

</frozen-after-approval>

## Code Map

- `/api/wiki` -- `nodes[].community` is an index into `communities` or `null`; `communities[]` is `{name, size}`, where `name` is the id of the community's highest-degree page.
- `/api/lint` -- `{findings: [{id, severity, fixable, file, line, message, nodeId}], summary: {errors, warnings, info}}`; `severity` is `error`, `warning`, or `info`; findings are sorted by the server.
- `src/viewer/test-fixtures/contract/expected/wiki.json` -- 6 communities. `lint.json` -- 23 findings, two with `nodeId: null`; `readings/deep-work/01-focus` is the one page with none.
- `src/viewer/ui/lib/graph-model.mjs` -- model nodes carry `community` and `color`; `TYPE_PALETTE`, `NEUTRAL`, `legendOf`.
- `src/viewer/ui/lib/state.mjs` -- the reducer; state holds `collapsed`, `selectedEdge`, `filter`, `showOrphans`, `hops`, `query`.
- `src/viewer/ui/lib/tree.mjs` -- `ancestorsOf(id)` gives the folders that hold a page.
- `src/viewer/ui/panes/GraphPane.jsx` -- draws rings in `nodeCanvasObject`; node fill comes from `node.color`.
- `src/viewer/ui/panes/GraphControls.jsx`, `TreePane.jsx`, `ReaderPane.jsx`, `App.jsx` -- where the new controls, marks, and findings go.
- `src/project/view/viewer.js:49-53` -- the community palette to reuse: `#4e79a7, #f28e2b, #e15759, #76b7b2, #59a14f, #edc948, #b07aa1, #ff9da7, #9c755f, #bab0ac`. Lint ring there: radius plus 2.5, colors from `--error`, `--warning`, `--info`.

## Tasks & Acceptance

**Execution:**
- [x] `ui/lib/communities.mjs`, test -- `COMMUNITY_PALETTE`; `communityColor(index)`; `communityList(wiki)` -> `[{index, name, title, size, color, members: [{id, title}]}]` in the order sent, members by title then id.
- [x] `ui/lib/lint-marks.mjs`, test -- `lintIndex(lint)` -> `{byNode: Map<id, {worst, findings}>, folders: Map<path, worst>, workspace: findings[], summary, total}`; `worst` ranks `error` over `warning` over `info`; `findingsFor(index, id)`. `null` or a wrong shape in, empty index out.
- [x] `ui/lib/state.mjs`, test -- `colorMode` (`type` or `community`) and `showLint`; actions `setColorMode`, `setShowLint`.
- [x] `ui/lib/strings.mjs` -- labels. "Problems" for findings, "Cluster" for community, "Page type" for type.
- [x] `ui/panes/GraphPane.jsx` -- props `colorMode` and `lintRings` (a map from node id to severity, or `null`); fill by community in that mode; ring when given; both by redraw only.
- [x] `ui/panes/GraphControls.jsx` -- two rows: Orphans and Problems with the counts; Color by. In cluster mode the legend loses its colors and a list of groups follows, each a closed `<details>` with its members as links.
- [x] `ui/panes/FindingList.jsx` -- one list form for findings, used by the reader and the page list.
- [x] `ui/panes/TreePane.jsx` -- marks on pages and folders; a `footer` slot.
- [x] `ui/panes/ReaderPane.jsx` -- the open page's findings after its relations.
- [x] `ui/App.jsx`, `app/viewer.css` -- fetch lint once after the wiki is ready; wire; style. The findings that name no page go under the page list, closed by default.
- [x] `app/viewer.js`, `app/THIRD-PARTY-NOTICES.md` -- rebuild.

**Acceptance Criteria:**
- Given the fixture in a browser, when community mode is chosen, then nodes recolor and six communities are listed with their members.
- Given the fixture, then every page except `readings/deep-work/01-focus` is marked in the tree; with the toggle on, each marked page that has a graph node is ringed (`index` and `log` have none); opening `sources/lora` lists its findings with check ids; the two findings that name no page appear once in the whole-wiki group.
- Given `/api/lint` failing, then the graph, tree, and reader behave as before and a notice says the checks could not be loaded.
- Given `npm run test:viewer` and `npm run ci:viewer-bundle`, then both pass.

## Implementation Notes

The graph panel stays small: the default view adds one checkbox, three counts, and one select. The whole-wiki findings sit under the page list, not in the graph panel, because the tree is the pane that always marks.

## Spec Change Log

- **2026-10-10, maintainer on the build.** The interface says "Cluster" for community, "Page type" for type, and "Problems" for lint findings. The matrix rows above keep the spec's words. The Depth switch of story 6 is removed in this story's commit.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | A broken checks reply read as "none found": the shape guard lived in the root, untested, and unusable items were dropped silently | high | patch | mutant survived; `lintResult(ok, body)` owns the decision; any unusable item fails the load |
| 2 | A severity named like `constructor` outranked `error`; an unknown severity gave a finding with no mark | medium | patch | reproduced by two reviewers; own-key lookups; only the three known severities are usable |
| 3 | Fill rule in group mode untested; dropping `community` from the model greyed every page with the suite green | medium | patch | two mutants survived; `nodeFill(node, mode)` in `communities.mjs`, tested on the fixture model |
| 4 | Community color by index pinned by no test | medium | patch | two mutants survived; literal palette lookups |
| 5 | Worst severity pinned in one arrival order only | medium | patch | two mutants survived; error-first and error-in-the-middle cases, fixture literals |
| 6 | Rings shown with the toggle off survived as a mutant | low | patch | `ringsOf(index, on)`, tested |
| 7 | Relations kept page-type colors in group mode | medium | patch | link color comes from the same fill as its source node |
| 8 | Problem rings stayed at full strength on dimmed nodes | low | patch | the ring fades with its node |
| 9 | Findings hidden when the page failed to load or was not found | medium | patch | the section renders in those states too |
| 10 | Hollow legend swatches turned filled in group mode | low | patch | `is-plain` on filled swatches only |
| 11 | A non-array `communities` or a `null` entry blanked the viewer | low | patch | `communityList` guards; tests |
| 12 | `display: flex` on `summary` removed the disclosure triangle | medium | patch | summary keeps its default display |
| 13 | Finding fields ran together: `L05warning` | medium | patch | seen in Chrome; spaces in the markup |
| 14 | Tree mark said "info" where the panel says "notes" | low | patch | one name table in the strings module |
| 15 | Status change of the checks not announced | low | patch | `role="status"` on the summary |
| 16 | Tests rebuilt the expected value with the code's own helper | low | patch | literals from the fixture |
| 17 | Switch row overflowed the panel; whole-wiki list sat in the graph panel | medium | patch | seen in Chrome before review; two rows; the list moved under the page list |
| 18 | Depth switch unwanted; "Kind" and "Group" not understood | high | bad_spec | maintainer, on the build; Depth removed and CAP-6 retired; labels now "Color by: Page type / Cluster" with a hint |
| 19 | `index` and `log` are marked in the tree but have no graph node, so not every marked page is ringed | low | patch | acceptance line reworded below |
| 20 | Palette repeats after ten clusters | low | reject | same palette and rule as the project-mode view; the list names each cluster |
| 21 | Rings tell severity by color only | low | reject | the tree mark carries a label and the reader lists the text |
| 22 | A finding for a page created after the graph loaded is shown nowhere until reload | low | reject | AD-12: the graph data is loaded once per page load |
| 23 | One render can show the new page's findings under the old body | low | reject | one frame; no wrong state remains |
| 24 | Checks slower than 30 s fail for good | low | reject | no retry timer is allowed; the notice says so |
| 25 | `AbortSignal.timeout` missing in old browsers | false | reject | already used by the page and wiki requests; current browsers only |
| 26 | Model nodes might lack `community`; `--warning` and `--info` might be undefined | false | reject | both exist; the blind reviewer could not see them |

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass
- `npm run build:viewer && npm run ci:viewer-bundle` -- expected: pass after the generated files are staged

**Manual checks (if no CLI):**
- In a browser on the fixture: the three acceptance cases above.
