---
title: 'Cross-doc lint'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_revision: '6981094835a88d767339c63014a58abaf653277d'
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

**Problem:** Nothing checks the rules attached to meta-relations across docs, so a doc citing a superseded decision part goes unnoticed, and CI has no agent-free gate (CAP-9).

**Approach:** Add a `project.mjs lint [--fail-on error|warning]` subcommand. It runs `buildGraph` over a fresh parse plus the committed facts, applies relation rules P01–P08 (partial supersession per spine AD-27), and folds in the engine findings. It emits the fixed lint JSON and exits by severity.

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`. Import only `node:` builtins, relative files, and the vendored js-yaml.
- Rule ids come only from `RULES`. Severities come from `RULES`.
- Rules key on meta-types and meta-relations, never on project type names.
- **Output** has exactly these keys: `{schemaVersion: 1, checks_run[], findings[{id, severity, file, line, message}], summary{errors, warnings, infos}}`.
  - `checks_run` lists every `RULES` id, in `RULES` order.
  - `findings` are sorted.
  - The same input always gives byte-identical output.
- **Exit code:**
  - 0 when no finding reaches the `--fail-on` level (default `error`).
  - 1 when one does. The JSON is still printed.
  - 1 for a bad argument, with `{error, code}` on stderr.
- **Findings folded in:**
  - `buildGraph` findings (P09, P10, P11, P12, P17–P20).
  - P13: one warning per doc whose `status` state is `stale`, at `file:1`.
  - P14 and P15 from `verifyEvidence`.
  - P16 from the scope warnings, at `_lumina/config/project.yaml:1`.
- `ontology.mjs`: the Decision lifecycle gains `partially-superseded`.
- `buildGraph` edge evidence carries `scope` when the fact had one. Output for scope-less facts is unchanged.
- **P11** fires for an `id:<X>` object where `X` matches neither a type `idPattern` nor an `externalIds` pattern. It is emitted inside `buildGraph` at the fact's evidence line.

**Never:**
- Never edit a doc, never write any file, and add no `--fix`.
- No user-defined rules and no lint on non-governance meta-types beyond the relation rules.
- No query or view (stories 5 and 6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Cycle | `supersedes`, `depends-on` or `part-of` edges forming a cycle | One P01 / P06 / P07 per cycle (strongly connected set of 2+ nodes), at the evidence of its smallest edge; the message lists members sorted | — |
| Full supersession | `supersedes` to a `doc:` with no `scope` on any evidence | P03 at every evidence `file:line` of every other edge into that doc, except from the superseding doc | — |
| Partial, fragment | `supersedes` to `frag:X#a` | P03 only for edges into `frag:X#a` | — |
| Partial, scope | `supersedes` to `doc:X`, evidence with `scope: S` | P03 only for citing evidence into `doc:X` with `scope: S`; scope-less citers of X are not flagged | — |
| Mixed | Parse gives an unscoped `supersedes` and an agent fact gives a scoped one on the same pair | Treated as partial | — |
| Target status | Full target's status is not `superseded`; partial target's status is neither `superseded` nor `partially-superseded`; target has no status | P02 at the `supersedes` evidence; no status means no P02 | — |
| Governs | `governs` from a node whose status is `superseded` | P05 at each evidence of that edge; a `partially-superseded` governor is not flagged | — |
| Satisfies | In-scope `doc:` of meta-type Requirement with no incoming `satisfies` | P04 at `file:declaresLine` or `file:1` | — |
| Contradicts | Any `contradicts` edge | P08 at its first evidence | — |
| Unknown id | Agent fact with object `id:ZZ-1` matching no pattern | P11 | — |
| Fail-on | Warnings only, default level / `--fail-on warning` | exit 0 / exit 1 | — |
| Bad args | `--fail-on info`, an unknown flag, or an extra positional argument | nothing on stdout | exit 1 |

</intent-contract>

## Code Map

- `src/project/project.mjs`:
  - `main` rejects any argument after the subcommand. `lint` needs `--fail-on`, and story 5 will add more flags, so parse flags per subcommand with `node:util` `parseArgs`.
  - Reuse `parseAll`, `loadFacts`, `buildGraph`, `computeDocStatus`, `makeRefResolves` and `failForEngineError`. The per-doc status loop from `runStatus` is shared with lint, not copied.
- `src/project/lib/graph.mjs`:
  - Edge evidence is built at line ~651. Add `scope` there, and include it in the `sortEvidence` key (~72).
  - `sortFindings` (~85) is duplicated in `lib/factfile.mjs`. Export one and use it everywhere.
  - Use `classifyIdShape` (~291) for P11, inside the `already`-prefixed branch for `id:` objects.
- `src/project/lib/factfile.mjs`: `verifyEvidence` gives P14 and P15.
- `src/project/lib/parse.mjs`: `parseAll` calls `selectScope` but drops `warnings`; return them. P20 (~490) reads `META_TYPES.Decision.lifecycle`.
- `src/project/lib/lint.mjs` (new, pure): `lintGraph({graph, parsed, ...})` returns the relation-rule findings. Node status comes from `graph.nodes[].status`; a `frag:` node without one falls back to its doc's status.
- `src/project/ontology.mjs` and `ontology.test.mjs`: the lifecycle value.
- `src/project/test-fixtures/parse-pilot/` has ADR-0009/0052 and the `superseded_by` inverse relation. Build a new `test-fixtures/lint-basic/` for the matrix; tests create agent facts with `facts-write` in `mkdtemp` copies.

## Tasks & Acceptance

**Execution:**
- `src/project/ontology.mjs` + test -- add `partially-superseded` to the lifecycle -- AD-27.
- `src/project/lib/graph.mjs` + test -- carry `scope` on evidence, emit P11, export `sortFindings` -- the inputs lint needs.
- `src/project/lib/parse.mjs` + test -- return scope `warnings` from `parseAll` -- P16.
- `src/project/lib/lint.mjs` + `lint.test.mjs` -- rules P01–P08 -- one test per matrix row that is not CLI-only.
- `src/project/project.mjs` + `project.test.mjs` -- the `lint` subcommand, flag parsing, output shape and exit codes -- matrix rows Fail-on and Bad args, plus a determinism test.
- `src/project/test-fixtures/lint-basic/` -- the minimal docs and config the matrix needs.

**Acceptance Criteria:**
- Given a copy of Seli's `docs/` with the story 2 acceptance config, and `facts-write` facts saying ADR-0052 `supersedes` ADR-0009 with scope `AP stays in Capigo` and `docs/adr/README.md` citing ADR-0009 with the same scope, when `lint` runs, then it reports P03 at the README row that restates the AP clause (`docs/adr/README.md:102` today), no other P03 for ADR-0009, and finishes in under 1 s.
- Given unchanged docs and facts, when `lint` runs twice, then both stdouts are byte-identical.
- Given the parse-pilot fixture, when `build` runs, then its output equals story 2's output except for findings changed by P11 or the new lifecycle value.

## Design Notes

A merged `supersedes` edge is partial when its `to` is `frag:` or any of its evidence has a `scope`. Scoped agent facts are more specific than a parsed frontmatter link, so mixed evidence counts as partial. A citer's own `supersedes` edge and self-references are never P03.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: 614 pass.
- Seli acceptance (above) in the scratchpad copy -- expected: the P03 location and under 1 s.

## Spec Change Log

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: 34 findings — high 0, medium 16, low 14, false 4, maybe-false 0
- findings:
  - Blind Hunter:
    - `[medium]` `patch` lint bad-argument exit depends on cwd (exit 2 outside a root) — parse lint flags in `main` before `findRoot`
    - `[medium]` `patch` P03 flags self-references (target's own fragments, superseding doc's fragments) — Design Notes forbid; compare doc paths
    - `[medium]` `patch` P03 flags other `supersedes` edges into the same target — reproduced on parse-pilot (`dec-a.md:2`, `dec-b.md:3`); exclude `supersedes` edges and every superseding doc of the target
    - `[medium]` `patch` full supersession misses citers of `frag:X#…` — a fragment is part of the doc
    - `[low]` `patch` cycles through fragments missed — collapse `frag:` to its doc for P01/P06/P07, drop resulting self-loops
    - `[low]` `reject` recursive Tarjan overflows at ~5000-edge chains — no doc graph has such chains; iterative rewrite adds complexity
    - `[medium]` `patch` `buildGraph` evidence `scope` untested — add graph tests and a CLI scoped P03 test
    - `[medium]` `patch` P13/P14/P16 fold-ins and error exit untested at the CLI — add lint tests
    - `[false]` `reject` AC "build equals story 2" untested — checked by hand: nodes and edges identical, only the `partially-superseded` P20 removed; Seli AC recorded by the implementer (P03 at README:102, 0.19 s)
    - `[low]` `patch` `lint.mjs` header says graph findings are P09–P20 — fix the range
    - `[low]` `patch` `scope: null` treated as a scope — use `!= null` in graph and lint
    - `[low]` `patch` `makeFinding` in four places — export one next to `sortFindings`
    - `[low]` `reject` `statusOf` uses `split('#')` — matches `docPathOfSubject` in graph; changing one diverges them
    - `[low]` `patch` dead `parsed.warnings ?? []` — delete
  - Verification Gap:
    - `[medium]` `defer` `src/project` tests not in CI — story 7 owns it
    - `[medium]` `patch` scope-on-evidence untested — same as above
    - `[medium]` `patch` fold-ins untested — same as above
    - `[low]` `patch` fragment's own status overriding its doc untested — add a lint test
    - `[medium]` `patch` two superseders flag each other — same as the other-supersedes row
  - Intent Alignment:
    - `[low]` `patch` rule tests run on hand-built graphs, not through `buildGraph` — covered by the added CLI scoped-P03 and Mixed tests
    - `[medium]` `patch` A1 exclusion flags pilot docs — same as the other-supersedes row
    - `[medium]` `patch` B1 misses fragment citers of a fully superseded doc — same as above
    - `[false]` `reject` C3 fragment status fallback — the Code Map specifies it
    - `[medium]` `patch` D2 bad args after root lookup — same as above
  - Edge Case Hunter:
    - `[low]` `reject` Tarjan recursion depth — same as above
    - `[medium]` `patch` superseding doc's fragment cites target → false P03 — same as the self-reference row
    - `[medium]` `patch` full supersession misses fragment citers — same as above
    - `[low]` `patch` P04 ignores `satisfies` into a fragment of the requirement doc — count fragment targets for their doc
    - `[low]` `reject` rule evidence may be an absorbed mention line — same doc; fixing needs relation origin on evidence
    - `[low]` `patch` spurious P11 on an `id:X` that is a duplicate declared ID — skip when `declaredIdOwners` has X
    - `[low]` `patch` hand-edited `scope` null or empty — same as the `!= null` row, plus empty string ignored
    - `[false]` `reject` scope whitespace/case mismatch — AD-27 requires verbatim labels
    - `[false]` `reject` shared `sortFindings` dedups identical P14 rows — messages carry the fact id; identical rows are true duplicates
    - `[medium]` `patch` bad-arg exit 2 outside a root — same as the D2 row

## Auto Run Result

- **Change:** `project.mjs lint [--fail-on error|warning]` runs relation rules P01–P08 (`lib/lint.mjs`, partial supersession per AD-27) over `buildGraph`, and folds in graph findings, P13, P14/P15 and P16. The output shape and exit codes are fixed. The Decision lifecycle gains `partially-superseded`. Edge evidence now carries `scope`. `buildGraph` emits P11.
- **Files:**
  - `src/project/lib/lint.mjs` (new): the relation rules.
  - `src/project/lib/graph.mjs`: `scope` on evidence, P11, shared `makeFinding`/`sortFindings`.
  - `src/project/lib/parse.mjs`: `parseAll` returns scope `warnings`.
  - `src/project/lib/factfile.mjs`: uses the shared helpers.
  - `src/project/ontology.mjs`: new lifecycle value.
  - `src/project/project.mjs`: the `lint` subcommand, flag parsing before root discovery, and a shared status loop.
  - Fixture `test-fixtures/lint-basic/`, plus tests.
- **Review:** 34 findings.
  - 26 patched: 16 medium, 10 low.
  - 1 deferred: CI wiring, story 7.
  - 7 rejected:
    - 4 false;
    - 3 low: Tarjan recursion depth, absorbed-mention evidence line, `#` in paths.
- **Follow-up review:** recommended. Patched medium entries: 16. Unverified risk: the P03 citer and exclusion logic was rewritten after the first review.
- **Verification:**
  - `node --test src/project/`: 448 pass, 2 skipped.
  - `npm run test:scripts`: 614 pass.
  - parse-pilot `build` against story 2: nodes and edges identical; only the `partially-superseded` P20 was removed.
  - Seli copy with two `facts-write` facts:
    - exactly one P03, at `docs/adr/README.md:102`;
    - `lint` in 0.17 s, with byte-identical stdout across two runs.
- **Residual risks:**
  - Seli shows 694 warnings with the minimal acceptance config, mostly P09 from unconfigured FR IDs, so setup (story 8) must propose `externalIds`.
  - Lint tests are not yet in CI.
