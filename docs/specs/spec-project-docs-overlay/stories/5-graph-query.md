---
title: 'Graph query'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_revision: 'a1088c7d0f6c1636741ac873e8f8225f570db3e7'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
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
---

<intent-contract>

## Intent

**Problem:** The ask skill (story 9) has no engine surface for answering project questions from the graph with `file:line` citations (CAP-7, CAP-10 engine side). It also cannot tell the user when answers rest on stale facts (CAP-8).

**Approach:** Add the fixed query operations from spine AD-28 to `project.mjs query`, computed live from `buildGraph`. Every returned item carries `file:line` and a quote, and every response carries freshness.

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`. Import only `node:` builtins, relative files, and the vendored js-yaml.
- **Operations:**
  - `query node <ref>`
  - `query list --meta-type T [--status S]`
  - `query neighbors <ref> --direction in|out [--relation R]`
  - Flags are parsed before root discovery, the same way as `lint`.
- **`<ref>` resolution:**
  - First as an existing node id (`doc:`, `frag:`, `concept:` or `id:`).
  - Otherwise through the shared resolver (`resolveFactRef`), cited from the repo root. This covers declared IDs, repo-relative paths, concept names or aliases, and external IDs.
  - A ref that resolves to no node in the graph exits 2 with `{error, code}`.
- **Response:** `{schemaVersion: 1, op, …, freshness: {stale, changed, neverIngested, staleDocs[]}}`.
  - The counts come from the same per-doc status loop `status` and `lint` use.
  - `staleDocs` holds the sorted paths.
- **Items:**
  - An item is a node or an edge. It carries `evidence[]` of `{file, line, quote}` taken from the graph.
  - A node's own location is `at: {file, line, quote}`:
    - For a `doc:`: its declared-ID line, else line 1, quoting that line's text.
    - For a `frag:`: its heading line and heading text.
    - For `id:` and `concept:` nodes: the first sorted evidence of an edge into them.
- Output is sorted and byte-identical on unchanged input. Nothing is written.

**Never:**
- No query language, path search, multi-hop walks, or full-text search.
- No new rules or findings; lint owns those.
- No view (story 6) and no skill (story 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Node by ID | `query node ADR-0009` | `node` (id, metaType, status, `at`), `out[]` and `in[]` edges, each `{relation, to\|from, evidence[]}` | exit 0 |
| Concept | `query node "hạn mức"` (an alias) | The `concept:credit-limit` node; `in[]` holds every `mentions` edge with each mention's `file:line` | exit 0 |
| Path | `query node docs/adr/0052-new.md` | The `doc:` node | exit 0 |
| Unknown ref | `query node NOPE-1` | Nothing on stdout | exit 2 |
| List | `query list --meta-type Decision --status superseded` | `items[]` of `{id, metaType, status, at}`, sorted by id | exit 0 |
| Bad meta-type | `--meta-type Foo`, or `list` without `--meta-type` | — | exit 1 |
| Neighbors | `query neighbors ADR-0009 --direction in --relation supersedes` | `items[]` of `{relation, node{id, metaType, status, at}, evidence[]}` | exit 0 |
| Bad neighbors args | Missing or invalid `--direction`; `--relation` not in `META_RELATIONS` | — | exit 1 |
| Bad op | Missing op, unknown op, missing `<ref>`, extra positional | — | exit 1 |
| Stale | A committed fact's quote was deleted from its doc | That doc is in `freshness.staleDocs`; results still reflect the current text | exit 0 |

</intent-contract>

## Code Map

- `src/project/project.mjs`:
  - `parseLintArgs` (~373) and its call in `main` (before `findRoot`) are the pattern for `parseQueryArgs`.
  - Reuse `computeDocStatuses` (~151) for freshness, and `parseAll`, `loadFacts`, `buildGraph` and `existsUnderRoot`.
- `src/project/lib/graph.mjs`:
  - `makeResolverContext` and `resolveFactRef` are the resolver.
  - A pseudo citing doc `{path: '', includeRoot: ''}` resolves from the repo root.
  - `resolveConceptAlias` (~275) already matches names and aliases NFC, case-insensitively.
- `src/project/lib/markdown.mjs:240`: headings are `{level, text, anchor, line}`, on `parsed.docs[].headings`.
- Parsed docs carry `declaresLine`, and `parsed.texts` has the text for the quote.
- `src/project/ontology.mjs`: `META_TYPES` keys and `META_RELATIONS` are what flags are validated against.
- `src/project/lib/query.mjs` (new, pure): `queryNode`, `queryList` and `queryNeighbors` over `{graph, parsed, resolve}`.
- Fixture: `test-fixtures/parse-pilot/` has ADR-0009/0052, `superseded_by`, and the `credit limit` concept with alias `hạn mức`.

## Tasks & Acceptance

**Execution:**
- `src/project/lib/query.mjs` + `query.test.mjs` -- the three operations and `at` locations -- one test per non-CLI matrix row.
- `src/project/project.mjs` + `project.test.mjs` -- the `query` subcommand, flag parsing, freshness and exit codes -- the CLI rows plus a determinism test, in mkdtemp copies.

**Acceptance Criteria:**
- Given a Seli copy with the story 4 acceptance config plus concept `credit limit` (alias `hạn mức`), when `query node "credit limit"` runs, then every mention edge cites a `file:line` whose line contains the term, and the call takes under 1 s.
- Given a fact whose quoted sentence was deleted, when any `query` runs, then `freshness.staleDocs` names that doc.
- Given CAP-10's question, when `query list --meta-type Decision --status superseded` is followed by `query neighbors <each> --direction out --relation governs`, then every returned item carries `file:line` and a quote.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: 614 pass.
- Seli acceptance (above) in a scratchpad copy -- expected: the mention lines check and under 1 s.

## Spec Change Log

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: 34 findings — high 0, medium 11, low 16, false 7, maybe-false 0
- findings:
  - Edge Case Hunter:
    - `[medium]` `patch` undeclared type-shaped ID (placeholder `id:<raw>` node) unreachable by its bare ref — accept a dangling result's `placeholder` when the graph has it
    - `[low]` `reject` duplicate declared ID never cited exits 2 — lint P10 reports the duplicate; query has nothing to return
    - `[low]` `reject` `frag:` id without `#` — facts-write validates subjects; hand-edited envelopes only
    - `[medium]` `patch` `id:`/`concept:` node with only outgoing edges gets `at` with empty file — fall back to the first outgoing evidence
    - `[low]` `patch` BOM leaks into `at.quote` on line 1 — strip a leading U+FEFF
    - `[low]` `reject` O(N·E) `at` lookup in `queryList` — Seli is 473 nodes × 1975 edges, well under budget
    - `[low]` `reject` non-string fragment status from an attr fact — agent-written value, `--status` compares strings by design
    - `[low]` `patch` `--status ""` silently returns nothing — reject an empty `--status` with exit 1
    - `[low]` `patch` same as the empty-`at` row (claim form)
    - `[false]` `reject` unknown-ref error carries no freshness — the matrix requires nothing on stdout
    - `[medium]` `patch` CLI tests run in the checked-in fixture — Tasks require mkdtemp copies
  - Blind Hunter:
    - `[medium]` `patch` placeholder `id:` unreachable — same as above
    - `[false]` `reject` `list --meta-type Decision` includes fragments — a fragment is a node with its doc's metaType; the Items rule covers nodes; pinned by a new test
    - `[medium]` `patch` fabricated `at` — same as above; out-of-scope doc `at.quote` stays `''` (its text is never read)
    - `[low]` `patch` ref `path#nope` returns the whole doc — a ref with `#` that resolves to a `doc:` is not found (exit 2)
    - `[medium]` `patch` acceptance tests missing or vacuous — add the CAP-10 chain, a "credit limit" name query, and a mention-line check reading the file line
    - `[low]` `patch` vacuous CLI loops — assert non-empty lists; stale test also checks a parse-derived result reflects the edit; no-writes covers all three ops
    - `[medium]` `patch` not mkdtemp — same as above
    - `[low]` `patch` `< 1000 ms` CLI assertion is flaky and off-criterion — remove; timing stays in the manual Seli check
    - `[low]` `patch` duplicated `cmp`/`sortEvidence`, repeated `byId` and `nodeMetaType` work, no-op `?? undefined` — reuse graph exports, build once
  - Intent Alignment:
    - `[false]` `reject` R1a: stale facts still returned — parse-derived results are live and `freshness.staleDocs` flags the rest, which is CAP-8's contract
    - `[false]` `reject` R2a: fragments in `list` — same as above
    - `[false]` `reject` R3b: keys omitted when unknown — graph nodes omit them too; consumers treat absence as unknown
    - `[medium]` `patch` R4: placeholder IDs — same as above
    - `[false]` `reject` R5a: `scope` dropped from evidence — the Items rule fixes evidence to `{file, line, quote}`
    - `[low]` `patch` tests on other surfaces than the matrix examples — covered by the CAP-10 chain, the `supersedes` neighbors and the Path CLI tests
  - Verification Gap:
    - `[medium]` `defer` `src/project` tests not in CI — story 7 owns it
    - `[low]` `patch` `neighbors --direction out` never tested with results — assert neighbor ids are the `to` endpoints
    - `[low]` `patch` `queryList` tested only over `doc:` nodes — add Requirement (external ID) and Decision-with-fragment cases
    - `[low]` `patch` `doc:` `at` fallback to line 1 never asserted — deepEqual in the Path test
    - `[low]` `patch` in-edge `(relation, from)` order never asserted — ordered deepEqual
    - `[low]` `patch` neighbors unknown ref exit 2 and freshness counts unverified — add both
    - `[false]` `reject` fragments in `list` (other finding) — same as above
    - `[medium]` `patch` placeholder `C005` unreachable (other finding) — same as the placeholder row

## Auto Run Result

- **Change:** `project.mjs query` with `node`, `list` and `neighbors` (AD-28). It is computed live from `buildGraph` with the shared resolver. Every item carries `at` or `evidence` as `{file, line, quote}`, and every response carries `freshness` including `staleDocs`.
- **Files:**
  - `src/project/lib/query.mjs` (new, pure).
  - `src/project/project.mjs`: the `query` subcommand; flags are parsed before root discovery.
  - `src/project/lib/graph.mjs`: exports `cmp` and `sortEvidence`.
  - Tests: `query.test.mjs` (new) and `project.test.mjs`.
- **Review:** 34 findings. 22 patched (11 medium, 11 low); 1 deferred (CI wiring, story 7); 11 rejected (7 false, 4 low and unlikely).
- **Follow-up review:** recommended. Patched medium entries: 11. The unverified risk is that placeholder and anchor ref resolution changed after the first review.
- **Verification:**
  - `node --test src/project/`: 494 pass, 2 skipped.
  - `npm run test:scripts`: 614 pass.
  - Seli copy: `query node "credit limit"` returns 12 docs and 29 mentions. Every cited line contains the term. The query takes 0.21 s.
  - `freshness.staleDocs` names docs whose facts predate a config change.
- **Residual risks:**
  - `list --meta-type T` includes heading fragments. This is pinned by a test; revisit if the ask skill finds it noisy.
  - Tests are not in CI.
