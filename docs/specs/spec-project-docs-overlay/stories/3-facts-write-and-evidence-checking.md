---
title: 'facts-write and evidence checking'
type: 'feature'
created: '2026-09-26'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Agent-extracted facts have no validated way into `_lumina/facts/`, and nothing reports a committed fact whose evidence quote is gone (CAP-6 engine side, CAP-11).

**Approach:** `project.mjs facts-write` takes one doc's fact set as JSON on stdin, validates it against the current file and parse, and replaces that doc's fact file under a lock. `verify-evidence` checks every committed fact file against the live docs. `status` reports each doc's hash, so the ingest skill can supply it.

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`. Import only `node:` builtins, relative files, and the vendored js-yaml.
- Use one quote matcher (`evidence.mjs`), one resolver (the one `buildGraph` uses), and one fact constructor (`makeFact`).
- **stdin** is `{source, sourceHash, facts[]}`. Each fact is `{kind, subject, relation, object|value, ref?, scope?, evidence{quote}, provenance}`. An input `evidence.line` is ignored and recomputed with `findQuoteLine`.
- **Validation is all-or-nothing.** Any invalid fact rejects the whole call; `errors[{index, message}]` lists every problem, and nothing is written.
- `subject` is `doc:<source>` or `frag:<source>#<anchor>`. An unknown anchor is retried once through `slug()`; if it still does not match, the fact is rejected.
- An edge's `object` is canonicalized through the shared resolver:
  - A resolved object becomes its node id.
  - An unresolved, unprefixed written form is kept as written; `build` then reports it as P09.
  - A prefixed `doc:`, `frag:` or `concept:` object that does not resolve is rejected.
- `ref` defaults to the written `object` for an edge, and to the written `subject` for an attr fact.
- Identical fact ids are deduplicated, keeping the first.
- **Fact file envelope:**
  - Path: `_lumina/facts/<source>.json`.
  - Contents: `{schemaVersion, source, sourceHash, ontologyVersion, facts}` in that key order, with facts sorted by `id`.
  - Written as `JSON.stringify(…, null, 2)` followed by `\n`.
- **Writes:**
  - Go through an engine `atomicWrite`: a unique temp name made from the pid plus random bytes, then fsync, then rename.
  - Hold `_lumina/_state/lock`, taken by exclusive create. A lock older than 30 s is taken over. Retry for 10 s, then exit 3.
  - Replace only the one named file.
- `verify-evidence` is report-only and exits 0. Findings are `{id, severity, file, line, message}`, sorted, using `RULES` P14 and P15.

**Never:**
- Do not build `lint`, emit P13, or add `--fail-on` (story 4). Do not add skills, a hook, `refresh`, or a cache.
- Never edit a doc. Never move or delete a fact file; a rename is only a finding.
- Never partially write a fact set.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Happy | Valid facts, hash matches; object `ADR-0009` | File written, lines recomputed, object `doc:<ADR-0009 path>`, ref `ADR-0009`; stdout `{ok, source, file, facts: n}` | exit 0 |
| Deterministic | Same facts twice, in any input order | Byte-identical file | — |
| Empty set | `facts: []` | Envelope written; `status` moves from `never-ingested` to `fresh` | exit 0 |
| Hash mismatch | `sourceHash` differs from current | Nothing written | exit 1, "re-read the doc" |
| Bad fact | Quote not in source; subject in another doc; unknown anchor or concept; bad kind/provenance | Nothing written; every bad index listed | exit 1 |
| Dangling written ref | Object `ADR-9999` | Accepted as written | exit 0 |
| Bad source | Unsafe path, or not in scope | Nothing written | exit 2 |
| Bad stdin | Not JSON, missing fields, stdin is a TTY, extra CLI args | Nothing written | exit 1 |
| Newer file | Existing fact file with newer `schemaVersion` | Untouched | exit 3 |
| Lock | Live lock held beyond 10 s / lock older than 30 s | exit 3 / taken over and written | — |
| Broken quote | Quoted sentence deleted from doc | `verify-evidence`: one P14 at `source:line` naming fact id and quote | exit 0 |
| Orphan file | Fact file's source gone; its `sourceHash` equals an in-scope doc's hash | P15 at the new path naming the old one; no hash match gives one P14 "source gone" | exit 0 |
| Malformed file | Fact file is bad JSON or not a v1 envelope | One P14 for that file | exit 0 |

</frozen-after-approval>

## Code Map

- `src/project/project.mjs`:
  - Add `facts-write` and `verify-evidence` to `SUBCOMMANDS` and dispatch; `facts-write` reads all of stdin.
  - `runStatus` adds `hash` to each `docs[]` entry.
  - Reuse `failForEngineError`, `existsUnderRoot`, `parseAll`, `loadFacts`, `ontologyVersion`, `CURRENT_SCHEMA_VERSION`.
- `src/project/lib/graph.mjs`:
  - Export one resolver built from `{config, parsed, exists}`. It returns `resolveRef` or `validatePrefixed` (lines ~311, ~370), and `buildGraph` must call it too.
  - `graph.test.mjs` must pass unchanged.
- `src/project/lib/fsx.mjs`: add `atomicWrite(absPath, text)` (parent dirs created) and `withLock(lockPath, fn, {staleMs, timeoutMs})`. Timings are injectable so tests stay fast. Mirror `src/installer/fs.js` `atomicWrite` (line 56), but with unique temp names; do not import it.
- `src/project/lib/factfile.mjs` (new, pure):
  - `prepareEnvelope(input, {config, parsed, texts, resolve, ontologyVersion})` returns the envelope or throws with `errors[]`.
  - `serializeEnvelope(envelope)`.
  - `verifyEvidence({parsed, texts, facts})` returns findings.
- Reuse:
  - `lib/evidence.mjs` `quoteMatches` and `findQuoteLine`.
  - `lib/fact.mjs` `makeFact`, which computes the id.
  - `lib/markdown.mjs` `slug`.
  - `parseAll` gives `texts` as raw decoded text and each doc's `headings[].anchor`.
- `src/project/test-fixtures/parse-pilot/` has an ADR-0009/0052 pair and a `credit limit` concept. Tests copy it into `mkdtemp`; never write into fixtures.

## Tasks & Acceptance

**Execution:**
- [ ] `src/project/lib/graph.mjs` -- export the shared resolver, and have `buildGraph` use it -- so the write-time and build-time resolvers are one resolver.
- [ ] `src/project/lib/fsx.mjs` + `fsx.test.mjs` -- `atomicWrite` and `withLock` -- AD-23.
- [ ] `src/project/lib/factfile.mjs` + `factfile.test.mjs` -- validation, canonicalization, envelope and verify -- cover every matrix row that is not CLI-only.
- [ ] `src/project/project.mjs` + `project.test.mjs` -- the two subcommands, `hash` in `status`, and every CLI exit code in the matrix -- run in `mkdtemp` copies.

**Acceptance Criteria:**
- Given a fixture copy, when `facts-write` stores an ADR-0052 `supersedes` fact on `ADR-0009`, then `build` has that edge with `provenance: extracted` and `status` reports ADR-0052 as `fresh`.
- Given that state, when an unquoted line of ADR-0052 is edited, then `status` says `changed`. When the quoted sentence is then deleted, `status` says `stale` and `verify-evidence` reports P14.
- Given a lock file held and refreshed by another process, when `facts-write` runs with shortened timings, then it exits 3 and the fact file is unchanged.

## Design Notes

```json
{"source":"docs/adr/0052-new.md","sourceHash":"<status hash>","facts":[
 {"kind":"edge","subject":"doc:docs/adr/0052-new.md","relation":"supersedes",
  "object":"ADR-0009","scope":"row: Retry policy","evidence":{"quote":"Supersedes ADR-0009"},"provenance":"extracted"}]}
```

`scope` is free text and is not checked; the partial-supersession model is decided before story 4. A subject is restricted to the source doc because `buildGraph` attributes evidence to the subject's doc.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: unchanged (614 pass).
- `cd <mkdtemp copy of parse-pilot> && node <repo>/src/project/project.mjs status` -- expected: every doc has `hash`.

## Implementation Notes

## Spec Change Log

## Review Triage Log
