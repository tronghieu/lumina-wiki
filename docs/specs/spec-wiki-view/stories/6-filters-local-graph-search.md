---
title: 'Wiki view story 6: filters, local graph, and search'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 2
baseline_commit: '51dc899'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/viewer-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On a real wiki the whole graph is too much to read at once, and a reader who knows a page's name has no way to jump to it.

**Approach:** One filter box over the graph, in the manner of the markdown app the wiki's readers already know: type text to keep matching pages, or `type:`, `rel:`, and `conf:` terms to keep one kind of page or relation. Two small switches sit beside it: orphans, and depth around the open page. A separate search box above the tree finds a page and opens it. Everything is computed from the wiki data already loaded, by pure modules. SPEC CAP-4, CAP-6, CAP-12; spine AD-5, AD-15. The maintainer rejected a first build made of checkbox lists: it needed explaining.

## Boundaries & Constraints

**Always:**
- With an empty filter, orphans shown, and no depth, the whole graph is drawn. The resting view holds one input, two switches, and the color legend, nothing else.
- The reader never needs to know the syntax: focusing the box offers the three keys and, after a key, the values this wiki holds. A legend entry toggles its `type:` term.
- One pure function decides visibility from the model, the filter text, the two switches, and the open page.
- Highlighting, the edge caption, and the first fit all follow what is visible.
- An empty result says so and offers a way back.
- Every setting lives in the one reducer. A setting never changes the graph data given to the library, or the hash.
- Search and filter both ignore case and diacritics. Neither searches page bodies or makes a request.
- After any change under `ui/`, rebuild and commit both generated files.

**Never:**
- No checkbox lists of types or relations, no counts, no reset button.
- No setting kept in the URL or in browser storage. No new request. No fuzzy-matching library.
- No merging of the two boxes: the filter narrows the graph, the search opens a page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Resting view | empty filter | every node and link | N/A |
| Text | `lor` | pages whose title or slug contains it; links among them | N/A |
| Several words | `deep work` | pages matching every word | N/A |
| Kind of page | `type:sources` | source pages only | N/A |
| Two kinds | `type:sources type:concepts` | pages of either kind | N/A |
| Kind of relation | `rel:cites` | only those links; every node stays unless orphans are off | N/A |
| Citation network | `type:sources rel:cites`, orphans off | the sources joined by a `cites` link, and those links | N/A |
| Confidence | `conf:high conf:medium` | links carrying either | N/A |
| Exclusion | `-type:people`, `-rel:cites` | everything but those | N/A |
| Partial value | `type:so` | treated as a prefix: `sources` | N/A |
| Unknown key or value | `foo:bar`, `type:zzz` | `foo:bar` is plain text; `type:zzz` matches nothing | no throw |
| Hollow nodes | `type:url`, `type:missing`, `type:other` | external addresses, missing pages, pages outside an entity folder | N/A |
| Relation type outside the schema | `rel:other` | fixture: the `mentions` link | N/A |
| Orphans off | switch | nodes with no visible link disappear | N/A |
| Depth 1 | a page is open and in the graph | it and the nodes one visible link away | N/A |
| Depth with a filter | `-rel:cites`, depth 1 | steps travel visible links only | N/A |
| Depth, no usable page | none open, or the open page is not in the graph | the depth switch is not offered | N/A |
| Open page filtered out | `type:concepts` while a source is open | the open page stays visible | N/A |
| Nothing matches | `zzzz` | a note and a control that clears the filter | no blank pane without a way out |
| Suggestions | focus the empty box; type `ty`; type `type:` | the three keys; `type:`; this wiki's kinds of page | N/A |
| Legend entry | click `sources`; click it again | `type:sources` added to the filter; removed | N/A |
| Hover and open-page highlight under a filter | `-rel:cites` | only nodes joined by a visible link light up | N/A |
| Selected relation filtered out | | its caption goes | N/A |
| Search by title | `lor` | `LoRA`, `LoRA follow-up`; best match first | N/A |
| Search across word breaks | `low rank` | finds title `Low-Rank Adaptation` and slug `low-rank` | N/A |
| Search without diacritics | `dai so` | a page titled `Đại số` | N/A |
| More matches than shown | 50 matches | the first 20 and a note that more exist | N/A |
| Choose a result | click, or Enter for the first | that page opens in all panes; the query stays | Enter during text composition does nothing |

</frozen-after-approval>

## Code Map

- `src/viewer/ui/lib/graph-model.mjs` -- `buildGraphModel(wiki)` -> `{nodes, links, neighbors, degree}`; node `{id, kind, type, title, color, val}`; link `{key, source, target, type, directed, confidence, citation, curvature}` with string ends. `legendOf(model, entityTypes)` -> `[{key, label, color, variant}]`, keys `type:<name>`, `other`, `url`, `missing`.
- `src/viewer/ui/lib/search.mjs` -- `fold(text)`, `searchPages(nodes, query, limit)`.
- `src/viewer/ui/lib/filter.mjs`, `state.mjs`, `panes/GraphControls.jsx` -- the checkbox build this story replaces.
- `src/viewer/ui/panes/GraphPane.jsx` -- applies a `visible` prop through `nodeVisibility` and `linkVisibility`; `lit()` reads `model.neighbors`, which ignores filters; `zoomToFit(ms, padding, nodeFilter)` takes a filter.
- `src/viewer/ui/App.jsx` -- computes `visible`, renders the controls inside the graph pane and the search box inside the tree pane; resolves the edge caption from `state.selectedEdge` alone.
- `src/viewer/test-fixtures/contract/expected/wiki.json` -- fixture; `mentions` is the relation type missing from the schema.

## Contracts

Bucket names. A node's kind is its entity type name, or `other` (a page with no type), `url`, `missing`. A link's relation bucket is its type when `schema.relationTypes` lists it, else `other`. A link's confidence bucket is `high`, `medium`, `low`, or `none`.

`ui/lib/query.mjs`
- `parseFilter(text)` -> `{words, include: {type, rel, conf}, exclude: {type, rel, conf}}`; `words` is an array of folded strings, the six others are arrays of folded values. Terms split on whitespace; a double-quoted run is one word. `type:`, `rel:`, `conf:` (any case) start a term; a leading `-` excludes; a key with an empty value is dropped; anything else is a word.
- `matchValue(value, name)` -> true when the folded `name` starts with the folded `value`.
- `toggleTerm(text, term)` -> the text without `term` when present as a whole term, else with it appended after one space; trims the ends.
- `suggest(text, vocabulary)` -> up to 12 `{label, text}` for the term being typed, which is the text after the last whitespace: empty or a prefix of a key gives the matching keys (`type:`, `rel:`, `conf:`); a key followed by a partial value gives that key's values from `vocabulary` that start with it and are not already in the filter; `text` is the whole filter with the last term completed.

`ui/lib/filter.mjs`
- `vocabulary(model, wiki)` -> `{type: string[], rel: string[], conf: string[]}`: the buckets present in the model, kinds in legend order, relations in schema order with `other` last, confidences in the order high, medium, low, none.
- `visibleSets(model, wiki, {filter, showOrphans, hops}, openId)` -> `{nodeIds: Set, linkKeys: Set, neighbors: Map<id, Set<id>>}`. A node passes when its kind matches some `include.type` value (or there is none), matches no `exclude.type` value, and its folded title or folded slug contains every word. A link passes when the same holds for its relation and confidence buckets and both ends pass; the open page counts as passing. Then: orphans off drops nodes no passing link touches; depth keeps nodes within `hops` passing links of the open page; an open page in the model is always kept; `linkKeys` holds passing links with both ends kept; `neighbors` is built from `linkKeys`.
- `nodeBucket`, `relationBucket`, `confidenceBucket` as named above.

`ui/lib/state.mjs` settings: `filter` (string), `showOrphans` (boolean, default true), `hops` (`null`, 1, 2, 3), `query` (the page search text). Actions `setFilter`, `setShowOrphans`, `setHops`, `setQuery`. The checkbox build's `hidden`, `hideLonely`, `toggleHidden`, `setHideLonely`, and `resetView` are removed.

`ui/lib/search.mjs`: `searchPages(nodes, query, limit = 20)` -> `{results, total}`. Hyphens, underscores, and punctuation in titles, slugs, and the query fold to spaces. Rank: the title starts with the query; a word boundary in the title is followed by the query; the same for the slug; the query occurs anywhere in either.

## Tasks & Acceptance

**Execution:**
- [ ] `ui/lib/query.mjs`, `query.test.mjs` -- the four functions.
- [ ] `ui/lib/filter.mjs`, `filter.test.mjs` -- rewritten to the contract; every filter row of the matrix on the fixture.
- [ ] `ui/lib/search.mjs`, `search.test.mjs` -- word breaks, more folds, `total`.
- [ ] `ui/lib/state.mjs`, `state.test.mjs`, `ui/lib/strings.mjs` -- the new settings and labels; the old ones removed.
- [ ] `ui/panes/GraphControls.jsx` -- the filter box with suggestions, the two switches, the legend as toggles, the nothing-matches note.
- [ ] `ui/panes/SearchBox.jsx` -- `total`, the composition guard, announced results.
- [ ] `ui/panes/GraphPane.jsx` -- neighbors from `visible`; fit to what is visible; refit when nothing visible is on screen.
- [ ] `ui/App.jsx`, `app/viewer.css` -- wire and style; the caption follows visibility.
- [ ] `app/viewer.js`, `app/THIRD-PARTY-NOTICES.md` -- rebuild.

**Acceptance Criteria:**
- Given the fixture in a browser, when `type:sources rel:cites` is typed and orphans are switched off, then the graph shows the three sources and their citation lines, and nothing else.
- Given a page open and depth 1, then only it and its direct neighbors remain; depth "all" restores the rest.
- Given the empty filter box focused, then the three keys are offered; choosing `type:` offers this wiki's kinds of page.
- Given `lor` in the search box, when the first result is chosen, then that page opens in the reader, the tree, and the graph.
- Given `npm run test:viewer` and `npm run ci:viewer-bundle`, then both pass.

## Implementation Notes

## Spec Change Log

- **2026-10-10, maintainer on the story 7 build.** The Depth switch is removed: one control too many. Every line above about depth or hops is void; SPEC CAP-6 is retired. The code left with story 7's commit.

- **2026-10-10, maintainer feedback on the first build.** The first build filtered with checkbox lists of types, relations, and confidence levels, with counts and a reset button. The maintainer could not tell what the block was for and asked for a filter search like the one in the markdown app his readers know. The filter is now one query box with three keys, suggestions, and two switches. Capabilities are unchanged. KEEP: one pure visibility function; hidden nodes stay in the layout; search separate from the filter; settings in the one reducer.
- **Same pass, from review.** Highlighting read the unfiltered neighbor map; the edge caption outlived its edge; the hop selector was live for a page outside the graph; a narrowed graph could leave an empty pane with no way out; search split words on spaces only.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Panel too heavy and unclear | high | bad_spec | maintainer feedback; checkbox design replaced |
| 2 | Edge caption outlives its edge | medium | patch | caption gated on the visible link set |
| 3 | Highlight ignores filters | medium | patch | reproduced on the fixture; neighbors now come from visible links |
| 4 | Hop selector live for a page outside the graph | medium | patch | reproduced; the switch is offered only for a page in the model |
| 5 | No empty state, no sign that a filter is active | medium | patch | the filter text is always in view; a note and a clear control when nothing matches |
| 6 | No refit after narrowing | medium | patch | fit uses the visible filter; refit when no visible node is on screen |
| 7 | Controls covered the caption | low | patch | moot with the small panel; caption raised |
| 8 | Checkbox groups unnamed | low | reject | the groups are gone |
| 9 | Search: no composition guard, results not announced, weak focus cue | low | patch | fixed |
| 10 | Search splits on spaces only; `low rank` misses `Low-Rank` | medium | patch | reproduced; punctuation folds to spaces, word-boundary ranks |
| 11 | Search cap of 20 is silent; box scrolls away | low | patch | `total` and a note; sticky box |
| 12 | Folding misses `ł`, `ø`, `ß` | low | patch | added |
| 13 | A relation type named `other` would share a bucket | low | reject | no such type exists; the schema would have to add one named `other` |
| 14 | Three copies of "is hidden"; `legendOf` run twice | low | reject | removed with the checkbox build |
| 15 | Story text and code disagreed on signatures | low | patch | this file rewritten with the contracts |
| 16 | Reducer fields shipped in the story 5 commit | false | reject | noted there; the bundle must match its sources at every commit |
| 17 | Typing an exclusion blanked the graph at each keystroke: `-ty` was read as a title word | medium | patch | a lone `-` and `-` plus a key prefix are dropped; tests |
| 18 | Filter words folded punctuation on one side only: `deep-work`, `lora-2`, `"low rank"` matched nothing | medium | patch | reproduced; both sides go through `foldWords`; slug tests |
| 19 | Prefix matching could not isolate `authored` from `authored_by` | medium | patch | an exact name beats a prefix (`resolveValues`); hand-made wiki test |
| 20 | A legend click could not undo a kind picked through a prefix or hidden through an exclusion | medium | patch | `legendEntries`, pure, with the four cases tested |
| 21 | "Nothing matches" never showed while a page was open, since the open page is always drawn | medium | patch | `matchCount` counts what the filter itself keeps |
| 22 | Caption and depth gates lived in the root, untested; a hidden selection came back when the filter was cleared | low | patch | `selectedLink` and `open` in `filter.mjs`; the selection is cleared once hidden |
| 23 | 22 of 82 mutants survived: slug-only match, every-word rule, rank tiers, suggestion sign and key case, reducer hand-off | medium | patch | tests added with literal expectations; rank cases that alphabetical order cannot reproduce |
| 24 | Folding stripped marks in every script and split decomposed text at its marks | low | patch | Latin range only; fold before split; kana and NFD tests |
| 25 | Missing letter folds: dotless i, eth, thorn, h and t with stroke | low | patch | added |
| 26 | Suggestions inside an open quote; a silent cap of 12 on `rel:` values | low | patch | no suggestion inside a quote; cap removed, the list scrolls |
| 27 | Escape during composition cleared the filter; focus lost after "Clear filter"; no keyboard path into the suggestions | low | patch | composition guard; focus returns to the box; ArrowDown enters the list |
| 28 | A search query with no letter or digit showed neither results nor a note | low | patch | any non-blank query with no result shows the note |
| 29 | Long result list covered the tree; selected row hidden under the sticky box; panel clipped in a narrow pane | low | patch | CSS limits; the selected row scrolls to the center |
| 30 | Zoom jump with one visible node; a node hidden by typing stayed clickable for a moment | low | patch | center instead of fit; hover and clicks ignore hidden nodes |
| 31 | Suggestions follow the last term only, not the caret | low | defer | editing in the middle of a long filter is rare; logged |
| 32 | Search results not announced | false | reject | the count and no-match notes are `role="status"` already |

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass
- `npm run build:viewer && npm run ci:viewer-bundle` -- expected: pass after the generated files are staged

**Manual checks (if no CLI):**
- In a browser on the fixture: check each matrix row that names something visible.
