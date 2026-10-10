---
title: 'Wiki view story 2: read model and contract fixture'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'e7adbe3ca9706ba955e6b51b08297ca6dda484f1'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/data-mapping.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing turns a classic wiki on disk into the nodes, edges, pages, and lint findings the viewer shows, and the server and client stories have no shared reference for that JSON.

**Approach:** Build the read model as three functions over the classic engine's own exports, with community detection copied under a parity test. Write one contract fixture, a small workspace plus its expected JSON, by hand from the spine before any read-model code. Spine AD-3 to AD-6, AD-13, AD-21, AD-23.

## Boundaries & Constraints

**Always:**
- `data.mjs` exports exactly `readWiki(root)`, `readPage(root, id)`, `readLint(root)`, each returning the full response body of its AD-7 route.
- Every call reads the disk. Nothing is cached between calls. Nothing is written.
- The page set is every `.md` file under `wiki/` whose first path segment is not `graph`. Link targets, edge endpoints, and finding files resolve through `resolveWikilinkTarget` against that set, in the code and in every test oracle.
- `readPage` finds its `id` by exact lookup in a `Map` built by its own walk. `links` is a null-prototype object.
- Output order: nodes by `id`; edges by `from`, then `type`, then `to`; findings by `file` (null first), `line` (null first, then numeric), `id`, `message`. Strings compare by UTF-16 code unit, field by field, never as one joined key.
- Expected JSON is written from the spine rules. Engine output (`lint.mjs --json`, the project-mode `detectCommunities`) may feed it; `data.mjs` output may not.

**Never:**
- No import of `wiki.mjs` or of `src/project/` (the parity test alone may import `src/project/lib/view.mjs`). No npm package.
- No engine edit beyond moving `WIKILINK_RE`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Page without frontmatter | `index.md`, `log.md` | Node `type: null`, title = last id segment; page `frontmatter: {}`, `body` = whole file | N/A |
| Page with frontmatter | any entity page | `type` = folder name (`sources`); `body` = `parseFrontmatter().body` verbatim, leading newline kept | N/A |
| Numeric title | `title: 2024`; `title: 0` | `"2024"`; `"0"` | N/A |
| Title absent, blank, or not a string or number | | last id segment | N/A |
| Page file removed between the walk and the read | another program is writing the wiki | `readWiki` leaves it out; `readPage` returns `null` | no throw |
| Missing `wiki/` folder | folder removed under a running viewer | all three reads reject | the server answers 500 |
| File under `wiki/graph/` | `graph/notes.md` | no node; `readPage` gives `null`; a finding on it has `nodeId: null` | N/A |
| Relation stored both ways, one bare endpoint | `(a, T, b)`, `(b-bare, T.reverse, a)` | one edge, typed per AD-6 | N/A |
| Reverse row with no partner | `(b, U, a)` alone | emitted as stored | N/A |
| Symmetric row stored twice, `high` then `low` | `(a, S, b)`, `(b, S, a)` | one edge, `directed: false`, `from < to`, `confidence: "high"` | N/A |
| Self-loop | `(a, S, a)`; `(a, T, a)`; `(a, T, a)` with `(a, T.reverse, a)` | one each; the reverse pair is one edge | N/A |
| `cites` and `cited_by` in `edges.jsonl` | either direction | `cites` edge; `source: "citations"` when `citations.jsonl` holds the same pair, else `"edges"` | N/A |
| Citation row without `type`, or typed `cited_by` | in `citations.jsonl` | `cites` from `from` to `to`; never flipped | N/A |
| Unknown edge type | not in `EDGE_TYPES` | emitted, `directed: true` | N/A |
| URL endpoint, missing endpoint | `https://x.y/z`, `sources/gone` | nodes `url:https://x.y/z`, `missing:sources/gone`; `type: null`, `community: null` | N/A |
| Malformed row | non-JSON line, `42`, `[1]`, `null`, a non-string or blank `from`, `type`, or `to`, in either graph file | skipped by `readWiki` | no throw |
| Bad `confidence` | `"certain"` | `null` | N/A |
| No graph files | neither `.jsonl` exists | `edges: []`; every page still a node | no throw |
| Unknown or hostile id | `nope`, `../README`, `/etc/passwd`, `sources/lora.md`, `__proto__` | `readPage` returns `null` | no throw |
| Finding names an endpoint | L06, `file: "sources/lora"` | `nodeId: "sources/lora"` | N/A |
| Finding names a path that is no page | `file: "index.md"`, only `sources/index.md` exists | `nodeId: null`, no match by base name | N/A |
| Finding names a `.jsonl` file | L20, `file: "graph/citations.jsonl"` | `nodeId: null` | N/A |
| Finding with a non-string `file` | `file: 5`, or no `file` | `file: null`, `nodeId: null` | no throw |

Link forms, written here outside the table: `[[lora]]`, `[[sources/lora|LoRA]]`, `[[ lora ]]`, `[[nope]]`, `[[https://a.b]]`. Their `links` keys are `lora`, `sources/lora`, `lora`, `nope`, `https://a.b`; their values are the id, the id, the id, `null`, `null`.

</frozen-after-approval>

## Code Map

- `src/scripts/lint.mjs` -- one `export {}` block near the end. `walkMd(dir)`: absolute paths in unsorted `readdir` order, backslashes on Windows, `graph/` not skipped; convert with `relative(wikiRoot, f).replace(/\\/g, '/')` as line 2835 does. `parseFrontmatter(content)`: `{data, body, fmText, tail}` or `null`. `parseEdgesJsonl(path)`: parsed rows of any JSON type, `[]` on a missing file. `resolveWikilinkTarget(raw, knownSlugs, basenameIndex)`: trims, strips `.md`, exact match, else unique basename for a name without `/`, else `null`; throws on a non-string. `buildBasenameIndex(set)` caches per `Set` object. `entityTypeForPath(wikiRelPath)`: the folder name, for any path with a known first segment. `runLint(root, {})`: `{findings, scannedFiles}`, no writes; findings carry extra keys; severities are `error`, `warning`, `info`; it throws on a `null` row and on a non-string `to` of a reversible type. `WIKILINK_RE` is at line 181, unexported, used at 791, 1395, 1555, 2864 through `.source`.
- `src/scripts/schemas.mjs` -- pure data. `ENTITY_DIRS` includes `graph`. `EDGE_TYPES` entries: `{name, from, to, reverse, symmetric?, ...}`; `symmetric` is absent on some; a symmetric type names itself in `reverse`; `appears_in` is the reverse of two types. `REQUIRED_FRONTMATTER` has `_base` plus one list per type.
- `src/scripts/lib/edges.mjs` -- `edgeTypeByName(name)`.
- `src/project/lib/view.mjs:57-140` -- `localMoving`, `detectCommunities(nodes, edges)`; no imports; needs sorted input. `view.test.mjs:29-31` has a seven-node input inline.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/schemas.mjs`, `src/scripts/lint.mjs` -- move `WIKILINK_RE` to `schemas.mjs` as an export; import it in `lint.mjs` -- AD-3.
- [x] `src/viewer/test-fixtures/contract/workspace/` -- the fixture wiki, holding every AD-23 case and every matrix row that `runLint` survives. Keep lint output independent of directory order: `index.md` omits at most one entity page; no ambiguous bare endpoint; no `raw_paths` key. Include two ids where one is a prefix of the other followed by `-`.
- [x] `src/viewer/test-fixtures/contract/expected/wiki.json`, `lint.json`, `pages.json` -- expected bodies. `pages.json` is keyed by id: `index`, one source page with every link form, the nested reading unit. Written before `data.mjs` exists.
- [x] `src/viewer/lib/communities.mjs` -- verbatim copy of the two functions, exporting `detectCommunities`.
- [x] `src/viewer/lib/communities.test.mjs` -- parity with the project-mode function on the seven-node input and on a 40-node graph built from a fixed-seed generator inside the test.
- [x] `src/viewer/lib/data.mjs` -- the three functions, following AD-6 step by step. Community detection takes the final page-to-page edges.
- [x] `src/viewer/lib/data.test.mjs` -- deep equality with the expected JSON (`generatedAt` aside); the three AD-20 oracles; every matrix row, using temp copies for rows the fixture cannot hold; the fixture's file list and sizes unchanged after all calls.
- [x] `src/viewer/lib/imports.test.mjs` -- every import in the non-test `.mjs` files of `src/viewer/lib/` and in `src/viewer/view.mjs`, when present, is a `node:` builtin, a sibling, or the engine path of AD-18.

**Acceptance Criteria:**
- Given the fixture, when the three functions run on Linux, macOS, and Windows, then each result deep-equals its expected file.
- Given a page added to a fixture copy between two calls, when `readWiki` runs again, then the new page is in the result.
- Given the moved regex, when `npm run test:scripts` and `npm run test:catalog` run, then both pass unchanged.

## Implementation Notes

- The fixture has 11 pages, 13 nodes, 13 edges, 6 communities, and 23 lint findings. Every hand-derived value agreed with the engine.
- `readWiki` takes 84 ms and `readLint` 42 ms on a generated wiki of 1,000 pages and 5,000 edge rows.
- The code and its tests were written by separate agents from the plan alone; the only mismatch was a prototype comparison on `links`.
- `readLint` rejects when `runLint` throws on a corrupt graph file. Logged in `docs/implementation-artifacts/deferred-work.md` as an engine fix.

## Spec Change Log

- **2026-10-10, plan critique before coding.** The first draft required a string `type` on citation rows (the engine never reads it), left collapse order and tie-breaks open, and listed fixture rows that crash `runLint`. Amended here and in AD-6, AD-7, AD-13, AD-22 before any code.
- **2026-10-10, review pass 1.** Reverse self-loops now pair like any other pair; a finding `file` ending in `.md` matches a page id exactly; blank strings are malformed; the schema is checked against the engine instead of a snapshot. Patched in place. KEEP: the fixture and its README; the edge step order; one resolver.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | "No writes" test could not see a write (ran last, sizes only) | medium | patch | mutation `{fix: true}` survived; now a fresh copy, lint first, sha256 |
| 2 | Null-first ordering of findings never exercised | medium | patch | mutation survived; ordering test added |
| 3 | Throw on a missing `wiki/` untested | medium | patch | mutation survived; `assert.rejects` on all three reads |
| 4 | Reverse self-loop pair emitted twice | medium | bad_spec | AD-6 was unclear; guard removed, AD-6 reworded, test added |
| 5 | Confidence carry-over on a one-way pair untested | low | patch | assertion added |
| 6 | Malformed rows tested in `edges.jsonl` only | medium | patch | a bad citation row would have been a 500; rows added to the test |
| 7 | Blank endpoint or type yields an empty title or type | medium | patch | reproduced; blank strings are malformed rows |
| 8 | Whitespace-only title emitted blank | low | patch | `trim()` |
| 9 | Community name truncated for an id with `:` | low | patch | ids passed with a `:` prefix; the copied function stays verbatim |
| 10 | Import test accepted `../../scripts/../x` and missed import forms | medium | patch | checker rewritten with its own self-test |
| 11 | Local confidence set duplicates the engine's | low | patch | `EDGE_CONFIDENCE` imported |
| 12 | Non-string `file` test had a dead branch and no positive assertion | low | patch | asserts a `file: null` finding exists |
| 13 | `readLint` absent from the live-read test | low | patch | added |
| 14 | Fixture does not pin code-unit order | low | patch | temp-copy test with an uppercase id |
| 15 | Fixture has no id that needs encoding | low | reject | `hash.test.mjs` covers encoding on ids; the fixture stays ASCII so its hand derivation stays checkable |
| 16 | `expected/wiki.json` pins the whole engine schema | medium | patch | schema checked against the engine's tables; README says the block is a snapshot |
| 17 | `imports.test.mjs` outside AD-22's file list | low | patch | AD-22 reworded |
| 18 | Leftover `console.log`; loose community count | low | patch | removed; asserts 4 |
| 19 | Folder named like an `Object.prototype` key gets a bogus type | low | patch | own-key check |
| 20 | `__proto__` frontmatter key supplies a title | low | patch | own-property check |
| 21 | Page removed between walk and read throws | medium | patch | the wiki is written while viewed; `ENOENT` now skips or returns `null` |
| 22 | File named `.md` yields an id ending in `/` | low | patch | skipped |
| 23 | Numeric title loses its written form (`007` shows `7`) | low | reject | needs a second frontmatter parse; recorded under Deferred in the spine |
| 24 | Endpoint naming a file under `graph/` resolves in lint, not here | false | reject | the page set excludes `graph/` by AD-4 |
| 25 | `index.md` finding marked on `topics/index` by base name | medium | patch | paths match exactly; AD-13 amended |
| 26 | `runLint` throws on a `null` row | medium | defer | pre-existing engine behavior; logged in deferred-work |

## Design Notes

`schema.entityTypes` is the keys of `ENTITY_DIRS` without `graph`; `required` drops the keys of `REQUIRED_FRONTMATTER._base`. `schema.relationTypes[].symmetric` is `entry.symmetric === true`; `reverse` passes through, so a symmetric type carries its own name.

`readLint` fails when `runLint` throws on a corrupt graph file. That is the engine's behavior; the client shows a notice (AD-13).

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass
- `npm run test:scripts && npm run test:catalog` -- expected: no regression
- `npm run ci:idempotency` -- expected: pass (`schemas.mjs` and `lint.mjs` are installed files)
