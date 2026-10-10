# Rubric review — ARCHITECTURE-SPINE wiki-view

Reviewed: `../ARCHITECTURE-SPINE.md` (draft, 2026-10-10) against `docs/specs/spec-wiki-view/` and the code on `feat/wiki-view`.

## Verdict

Not ready to build from. The layering, the install list, the build guard, and the process contract are sound and match the code. Three rules rest on engine facts that are false, and each one breaks a spec acceptance test: AD-13 (finding to node), AD-5 (link agreement with lint), AD-14 (client reuse of `WIKILINK_RE`). Fix those three, tighten AD-7 and AD-11, then it is buildable.

## Findings

| # | Sev | Where | Finding |
| --- | --- | --- | --- |
| F1 | high | AD-13, CAP-15 | `nodeId = file without .md` is wrong for edge checks |
| F2 | high | AD-5, CAP-9 | Lint L05 does not use `resolveWikilinkTarget`; viewer and lint will disagree |
| F3 | high | AD-14 vs AD-1, AD-3, AD-16 | Client renderer cannot import `WIKILINK_RE` from `lint.mjs` |
| F4 | medium | AD-11, AD-10 | Port walk does not prevent two servers; reuse ignores version |
| F5 | medium | AD-19, AD-2 | Agent-host and minimal-profile install paths not covered |
| F6 | medium | AD-7 | Contract gaps where server and client must guess |
| F7 | medium | AD-6 | Normalization does not say it runs on resolved ids |
| F8 | low | AD-20 | Windows stop test cannot prove exit 0; UI has no test; spec oracles unnamed |
| F9 | low | AD-2 | The frozen list has no named home |
| F10 | low | several | Spec statements changed without a flag |

### F1 — AD-13 maps findings to nodes by a rule the code does not support (high)

Checked in `src/scripts/lint.mjs`.

- `checkL06`, `checkL07`, `checkL08`, `checkL17`, `checkL19` build the finding with `file = edge.from` (lines 1477, 1509, 1532, 1903, 2004, 2011).
- `edge.from` is the endpoint as written. `addEdge` in `wiki.mjs` (line 918) stores `fromSlug` verbatim. It can be bare (`lora`) or qualified (`sources/lora`). It never ends in `.md`.
- `checkL20` uses `file = 'graph/citations.jsonl'` (line 2038). `checkL09` uses `'index.md'`. `checkL10` uses a `.md` path.
- `data-mapping.md` says `file` is "a wiki-relative path such as `sources/lora.md`". That is true only for per-page checks. The spec says the code wins.

Consequence: CAP-15's own fixture is a missing reverse edge (L06). With a bare `from`, `nodeId` is `lora`, no node has that id, and the page is not marked. L20 findings get `nodeId = graph/citations.jsonl`.

Fix:

- `nodeId = resolveWikilinkTarget(file, knownSlugs, basenameIndex)`, else `null`. This strips `.md` and handles bare slugs with the same resolver as AD-5.
- Findings with `nodeId: null` go in a workspace-level list in the client. Say so in AD-13.
- Define the CAP-15 oracle as: marked set = the set of non-null `nodeId`s. Correct the `data-mapping.md` sentence.

### F2 — AD-5 does not make the viewer and lint agree on wikilinks (high)

- `checkL05` (line 1404) reports a link broken when `!knownSlugs.has(slug)`. Exact match only.
- It never calls `resolveWikilinkTarget`. A unique bare `[[lora]]` for `sources/lora` is an L05 error, marked fixable.
- `resolveWikilinkTarget('lora')` returns `sources/lora`. The viewer will render a working link.
- `[[sources/lora.md]]` is the same case: L05 error, resolver match.
- Edge endpoints are fine. `checkL17` and `makeEndpointResolver` do use the resolver.

Consequence: AD-5's "Prevents" line holds for edges and fails for links. The reader will show a live link and, below it, an L05 finding saying it "does not resolve to any wiki file". CAP-9's "Viewer and lint agree on every link in the fixture" has no defined oracle. `data-mapping.md` makes the same wrong claim.

Fix, pick one and write it in AD-5:

- Keep the resolver. Name the oracle as `resolveWikilinkTarget`, not L05. State that a link resolved only by basename is navigable and still carries its L05 finding. Recommended.
- Or use exact match in the viewer, so "broken" equals L05.

Also note in Deferred: L05 and the resolver disagree inside `lint.mjs`. It sits next to the `findEntityFile` item already there.

### F3 — AD-14 cannot be built as written (high)

- AD-14: `ui/lib/render.mjs` uses "an inline rule built on the engine's `WIKILINK_RE`".
- AD-3: the symbol is exported "from its home module". Home is `lint.mjs` (line 181, not exported today).
- `lint.mjs` imports `node:fs/promises`, `node:fs`, `node:path` (lines 47–49) and reads `process.argv[1]` at top level (line 3523).
- AD-16 bundles `render.mjs` for the browser as an IIFE and defines only `process.env.NODE_ENV`.
- AD-1 says the client depends on the HTTP contract "and nothing else". Its diagram shows no engine arrow into the client.

Importing from `lint.mjs` pulls a 3,500-line Node module into the browser bundle. I did not run esbuild; the expected result is a resolve error on `node:` imports, or a runtime `process is not defined`.

There is a second gap. The read model builds `links` keys and the client looks them up. Nothing fixes the key form. Lint uses `m[1].trim()`; "target as written" could also mean untrimmed.

Fix:

- Move `WIKILINK_RE` to `schemas.mjs`, which is pure data. `lint.mjs` imports it from there.
- Send its source in `schema`, for example `schema.wikilinkPattern`. The client builds its rule from that string and imports nothing from the engine. AD-1 then holds.
- State the `links` key: capture group 1, trimmed.

### F4 — AD-11 does not prevent what it claims (medium)

- The walk probes and listens port by port. Case: server A runs on base+1 because base was busy. Base frees. A new start probes base, gets no answer, listens on base. Two servers, one workspace.
- Two starts at once: both probe, one binds, the other gets `EADDRINUSE` and moves on without probing again. Two servers.
- Reuse compares `app` and `root` only. After `lumina install` upgrades the wiki, an old process still holds old server code. AD-9 implies assets are read per request, so the old server serves the new bundle. Reuse reports it as good.
- `version` in `/api/health` has no stated source. An installed workspace has no `package.json` for the viewer.
- CAP-16 wants "a clear message" on a busy port. AD-10 allows exactly one stdout line. Where the message goes is not stated.

Fix:

- Probe all 20 ports first. Reuse on a match. Only then listen from the base upward. On `EADDRINUSE`, probe that port again before moving on.
- `version` = `packageVersion` from `_lumina/manifest.json` (the field is in the manifest typedef, `manifest.js` line 47), read at start. On a `root` match with a different `version`, do not reuse; exit 2 and tell the user to stop the old viewer.
- Say that assets are read from disk per request.
- Put the busy-port note on stderr as plain text, or add a key to the JSON line.

### F5 — AD-19 misses two existing install paths (medium)

Checked in `src/installer/commands.js`.

- `copySkillsToAgentPlatform` (line 1980) installs every skill from `getSkillDefs([...all packs])` into the agent host, with the librarian preamble. A new entry in `coreSkills` becomes a global skill too. AD-19 says "installed by classic installs only".
- The `minimal` profile (lines 497–510) copies no per-project skills. `copyScripts` still runs (line 492). The spine does not say whether `_lumina/viewer/` is copied for `minimal`.
- A global `lumi-view` will meet wikis installed by an older version. They have no `_lumina/viewer/view.mjs`. Node then fails with a module-not-found error, not with exit 2 or 3.
- `scripts/ci-agent-host-isolation.mjs` keeps its own copy of the watched-path list (line 38). AD-19 updates only `ci-idempotency`.

Fix:

- State: the viewer copy runs for both profiles, beside `copyScripts`.
- State: `lumi-view` ships to agent hosts through the existing path and runs after the preamble's `cd`.
- State: when `_lumina/viewer/view.mjs` is missing, the skill tells the user to re-run `lumina install` in that wiki.
- Add `_lumina/viewer` to both watched-path lists.

### F6 — AD-7 leaves gaps two builders will fill differently (medium)

| Gap | Code fact | Fix |
| --- | --- | --- |
| No `Content-Type` per route | AD-9 sets `nosniff`; a wrong type blocks the script and the stylesheet | Add a column: `text/html`, `text/javascript`, `text/css`, `application/json`, all `charset=utf-8` |
| `entityTypes[].dir` vs node `type` | `ENTITY_DIRS[x].dir` is `'sources/'` with a trailing slash; the key is `sources` | Rename to `name`, value = the key; node `type` uses the same string |
| `graph` is an entity dir | `ENTITY_DIRS.graph` exists; AD-4 says `wiki/graph/` holds no pages | Exclude `graph` from `schema.entityTypes` |
| `required` list | `REQUIRED_FRONTMATTER` has `_base`, entries with `required: false`, and no key for `outputs` or `graph` | State: keys with `required: true`, minus `_base` keys; `[]` when the type has no entry |
| `symmetric` | Undefined on `grounded_in`, `produced`, `see_also_url` | Coerce to boolean |
| `community: null` | `detectCommunities` gives every node an index | Say when it is `null`, or drop `null` |
| Unknown relation type | `parseEdgeLines` passes any JSON line through | Say whether such an edge is dropped or shown as-is |
| `url:` and `missing:` nodes | AD-4 gives them ids; AD-15 makes any id a hash | State: only `kind: "page"` opens the reader |
| AD-4 vs AD-7 on unresolved links | AD-4: unresolved target gets `missing:<target>`; AD-7: `links` maps it to `null` | State: `url:` and `missing:` apply to edge endpoints only |
| Client on non-200 | Only lint failure is covered (AD-13) | One line for `/api/wiki` and `/api/page` failures, including a page deleted since the graph loaded |

### F7 — AD-6 normalization needs three more sentences (medium)

The reverse-pair rule itself is correct. I ran it over all 42 `EDGE_TYPES`:

- Every non-symmetric type with a reverse has that reverse declared.
- All pairs name each other except two: `features`/`appears_in` and `tagged_with`/`appears_in`. `appears_in.reverse` is `null`. The rule keeps `features` and `tagged_with`. One edge per pair. Correct.
- A lone `appears_in` row has no partner and is emitted as itself. Correct.

Gaps:

- The predicate "each other's reverse" is false for `appears_in`. Write it as: rows `(a, T, b)` and `(b, U, a)` where `T.reverse = U` or `U.reverse = T`.
- `add-edge` stores endpoints verbatim. `(lora, builds_on, bert)` and `(sources/lora, builds_on, sources/bert)` are one relation in two spellings. State that pairing, de-duplication, and sorting run on resolved ids, after AD-5.
- Symmetric edges: state the emitted order (`from < to` by id). Sorted raw strings can flip after resolution.
- Legacy `cites` and `cited_by` rows in `edges.jsonl` exist (L19 is there for them). State: normalize to `cites`; when the same citation is also in `citations.jsonl`, keep `source: "citations"`.
- Duplicates with different `confidence`: state which wins.

### F8 — AD-20 overstates what the tests prove (low)

- On Windows, `child.kill('SIGINT')` ends the process without running handlers. "Exit 0" cannot be asserted there. The test can prove only that the port is free. Ctrl-C on Windows stays a manual check. The spec's open question stays open; say so.
- No test touches the React panes or `force-graph`. The `'unsafe-inline'` assumption in AD-9 and "no outbound request" are unverified. Decide: a manual checklist on the pilot wiki, or defer by name.
- The spec names three oracles. AD-20 says only "the read model on fixtures". Name them: links vs resolver (CAP-9), marked set vs `runLint` (CAP-15), page set vs `list-entities` (CAP-7).

### F9 — AD-2's list has no named home (low)

- Three units read it: installer, `ci-package`, the coverage test.
- The existing pattern is `PROJECT_ENGINE_FILES` in `project-mode.js`, spread into `requiredFiles` in `ci-package.mjs` (line 115). Name the export and its file the same way.
- `package.json` lists `src/installer/*.js` one by one. A new installer file must be added there.
- `test:installer` lists test files by hand. Say which script runs the coverage test.
- AD-18 and AD-2 say `../scripts/`. From `lib/*.mjs` the path is `../../scripts/`. Reword.
- Add `^src/viewer/ui/` to the `ci-package` prohibited patterns, next to the fixtures.

### F10 — Spec statements the spine changes (low)

Flagged in the spine, fine as long as the spec is updated:

- "Open" means the default browser. AD-10 does not open one.
- "Every file path through `safePath`". AD-8 replaces it with a lookup map. Stricter, and correct.

Not flagged:

| Spec | Spine |
| --- | --- |
| Build spike used `marked` 18.1.0; size and same-bytes evidence is for that set | `markdown-it` 15.0.2. Evidence no longer covers the stack. Re-run the spike. |
| `index.md` and `log.md` are graph nodes only when an edge names them | Tree is built from `nodes`, so both are always nodes. State that the graph hides them when they have no edge. |
| Tree = the set `list-entities` reports, plus index and log | Page set = every `.md` under `wiki/` except `graph/`. `listEntities` walks `ENTITY_DIRS` only, and includes `graph/`. Stray files differ. |
| Lumina marker comments are hidden | All HTML comments are removed, including inside code blocks. |
| "The viewer reads nothing under `raw/`" | `runLint` calls `checkL12`, which tests each `raw_paths` entry for existence. |
| A port held by something else gives "a clear message" | Not placed (see F4). |

## Checklist results

| # | Check | Result |
| --- | --- | --- |
| 1 | Fixes the real divergence points | Mostly. Missed: finding-to-node mapping (F1), link key and pattern hand-off (F3), content types and type naming (F6), global skill path (F5). |
| 2 | Each AD rule is enforceable and prevents its divergence | Fails for AD-5 (F2), AD-11 (F4), AD-13 (F1), AD-14 (F3). AD-6 needs wording (F7). The rest hold. |
| 3 | Nothing deferred can diverge | Holds. One addition: the L05-vs-resolver split belongs in Deferred. |
| 4 | Ratifies the codebase | Holds except F1, F2, F3, F5. Details below. |
| 5 | Covers CAP-1 to CAP-16 | All 16 mapped. CAP-9 and CAP-15 acceptance fail as written. Spec changes in F10. |
| 6 | Every dimension decided, deferred, or flagged | See the table below. |

### Code claims checked

| Claim | Result |
| --- | --- |
| `lint.mjs` exports `runLint`, `walkMd`, `parseFrontmatter`, `parseEdgesJsonl`, `findProjectRoot`, `resolveWikilinkTarget`, `buildBasenameIndex`, `entityTypeForPath` | True (export block, lines 3488–3520). `makeEndpointResolver` is also exported. |
| `WIKILINK_RE` is not exported | True (line 181). |
| `runLint(root, {})` only reads | True. `applyFixes` runs only under `fix`, `dryRun`, or `suggest`. Findings equal `lint --json`; `main` passes no config. |
| Page id equals a `knownSlugs` entry | True (line 2841). |
| `resolveWikilinkTarget` rules as in `data-mapping.md` | True (lines 722–730). |
| CLI guards on `argv[1]` | True: `lint.mjs` line 3523, `wiki.mjs` line 2902. `view.mjs` is safe. |
| `EDGE_TYPES` shape; 42 entries | True. |
| `copyScripts` uses an explicit array, lists `lib/` by directory, swallows failures | True (lines 1591–1622). |
| Project mode copies from a frozen list and throws code 3 on a missing file | True (`PROJECT_ENGINE_FILES`, `installProject`). AD-2 mirrors it. |
| `ci-idempotency` asserts classic installs create no `_lumina/project/` | True (line 135). AD-19's mirror check fits. |
| `ci-package` has `requiredFiles` and prohibited patterns | True. It does not check `devDependencies`. |
| `ci.yml` runs on three operating systems; `publish.yml` runs `ci:package` before publish | True. `ci.yml` lists steps one by one and does not call `test:all`; a new step is needed, as AD-20 says. |
| `.gitattributes` | `* text=auto eol=lf`. The `-text -diff` line for the bundle fits. |
| `detectCommunities` in `src/project/lib/view.mjs` | Exported; returns `{of, list}` with `name`, `size`. Needs `localMoving` copied with it. |
| `package-lock.json` exists | True. `npm ci` pins transitive packages. Worth one sentence in AD-17. |
| Pinned versions exist on npm | True for all four, and for `marked` 18.1.0. |
| Uninstall | `uninstallCommand` removes `_lumina/` whole, so viewer files go with it. |

### Dimensions

| Dimension | State |
| --- | --- |
| Security of the local server | Decided (AD-8, AD-9). Gap: content types (F6). No auth by spec non-goal. |
| Error handling | Partial. Process errors and lint failure decided. Client behavior on other failures missing (F6). |
| Testing | Partial (F8). |
| Packaging | Decided (AD-2, AD-16, AD-17). List home unnamed (F9). |
| Upgrade | Missing. A running server across an upgrade (F4). A file dropped from the list stays on disk; say that is accepted. |
| Uninstall | Not stated. Code already covers it. Add one line. |
| Documentation and skill registration | Left to `delivery.md`. No map row. Add a pointer and name `test:catalog` as the gate. |
| Operations | "None" is too short. How a user stops a host-started server is not said. |

## What holds

- AD-1 layering and the separate `src/viewer/` tree.
- AD-2 explicit list with exit 3. It copies the project-mode pattern and fixes the silent-skip hole in `copyScripts`.
- AD-4 ids. They match lint's `knownSlugs` exactly.
- AD-8. Stricter than the spec and simpler.
- AD-9 guard order and CSP.
- AD-12 live reads.
- AD-16 and AD-17. The guard matches the existing `git diff --exit-code` pattern.
- AD-18 import rule.
