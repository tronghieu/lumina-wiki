---
title: 'Graph query'
type: 'feature'
created: '2026-09-26'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
warnings: []
deferred: []
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
