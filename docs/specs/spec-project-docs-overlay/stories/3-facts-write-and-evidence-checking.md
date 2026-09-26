---
title: 'facts-write and evidence checking'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_revision: '84631bfbb89b8142b72c28e0625036d774367fe9'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      src/project tests run in no npm script or CI job.
    evidence: |-
      grep for src/project in package.json, .github and scripts matches nothing; story 7 owns adding test:project to test:all and ci.yml (deferred-work.md entry).
    location: >-
      package.json
    severity: medium
---

<intent-contract>

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

</intent-contract>

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
- `src/project/lib/graph.mjs` -- export the shared resolver, and have `buildGraph` use it -- so the write-time and build-time resolvers are one resolver.
- `src/project/lib/fsx.mjs` + `fsx.test.mjs` -- `atomicWrite` and `withLock` -- AD-23.
- `src/project/lib/factfile.mjs` + `factfile.test.mjs` -- validation, canonicalization, envelope and verify -- cover every matrix row that is not CLI-only.
- `src/project/project.mjs` + `project.test.mjs` -- the two subcommands, `hash` in `status`, and every CLI exit code in the matrix -- run in `mkdtemp` copies.

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

`scope` is free text and is not checked; per spine AD-27 it becomes a label that story 4 lint matches exactly, so it is stored verbatim. A subject is restricted to the source doc because `buildGraph` attributes evidence to the subject's doc.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: unchanged (614 pass).
- `cd <mkdtemp copy of parse-pilot> && node <repo>/src/project/project.mjs status` -- expected: every doc has `hash`.

## Spec Change Log

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: 46 findings — high 0, medium 13, low 27, false 6, maybe-false 0
- findings:
  - Blind Hunter:
    - `[low]` `reject` stale-lock takeover lets two holders in — needs a crash-left lock plus two simultaneous writers on one doc; outcome equals last-writer-wins on one file; a correct fix needs a token/rename protocol
    - `[low]` `reject` release unlinks another holder's lock — needs `fn` to outlive 30 s; facts-write holds the lock for milliseconds
    - `[medium]` `patch` lock protects nothing: hash check runs before the lock, so an older snapshot can overwrite newer facts — re-hash the source inside the lock
    - `[medium]` `patch` `envPositiveInt` accepts 0 and empty string, disabling exclusion — require an integer > 0 and mark the vars test-only
    - `[medium]` `patch` TTY matrix row untested — make `readStdinText` take a stream and unit-test `{isTTY: true}`
    - `[low]` `patch` extra-args test passes through "missing fields" — send a valid payload and assert the bad-arguments message
    - `[low]` `patch` bad-source tests do not assert nothing written — assert no fact file
    - `[low]` `patch` tests run in the checked-in fixture — use mkdtemp copies
    - `[low]` `patch` dedup test cannot show keep-first — differing quotes, assert first survives
    - `[low]` `patch` rejection unit tests only assert throws — assert `errors[].index` and message
    - `[medium]` `patch` `isV1Envelope` ignores `schemaVersion` — require `schemaVersion === CURRENT_SCHEMA_VERSION`, else one P14
    - `[low]` `patch` `verifyEvidence` ignores the loadFacts key — key/`source` mismatch is one P14 at the key
    - `[low]` `patch` malformed-file P14 does not name the fact file — message names `_lumina/facts/<key>.json`
    - `[low]` `patch` P15 persists after the renamed doc has its own facts; only first hash match reported — P15 per matching doc lacking an envelope, else P14 source gone
    - `[low]` `patch` prefixed-id regex duplicated in factfile and graph — export one from graph
    - `[low]` `patch` `buildGraph` builds a second `docsMap` — use `ctx.docsMap`
    - `[low]` `patch` dead `config` parameter — delete
    - `[low]` `patch` redundant `quoteMatches` before `findQuoteLine` — one call
    - `[medium]` `patch` `scope` type unchecked; `""` changes the id (AD-27 label) — non-empty string when present
    - `[false]` `reject` input `ref` never resolved — AD-11 keeps `ref` as written; status resolves `object`
    - `[low]` `patch` `runVerifyEvidence` comment says always exits 0 — say exit 2/3 on config or fs errors
    - `[false]` `reject` story checkboxes removed — the auto template has no checkboxes; the AD-27 note predates implementation
    - `[low]` `patch` test noise: sync helper marked async, dead `rm` — delete
  - Verification Gap:
    - `[medium]` `defer` `src/project` tests not in any npm script or CI — owned by story 7 (deferred-work entry exists)
    - `[low]` `patch` keep-first dedup only tested with identical duplicates — same as the dedup row above
    - `[low]` `patch` no test rejects a dangling `frag:` object — add it
    - `[medium]` `patch` TTY rejection untested — same as the TTY row above; testable without a PTY via an injected stream
    - `[low]` `reject` stale-lock race (other finding) — same as the first Blind Hunter row
  - Edge Case Hunter:
    - `[medium]` `patch` stale-lock unlink failure (lock is a directory, EPERM) `continue`s past timeout and sleep: infinite hot loop — check timeout and sleep on that path
    - `[low]` `reject` stale takeover race — same as above
    - `[low]` `reject` release of another's lock — same as above
    - `[low]` `reject` `writeFile` failure after `wx` orphans the lock — self-heals after 30 s; disk-full only
    - `[medium]` `patch` `envPositiveInt` 0/empty — same as above
    - `[medium]` `patch` stale snapshot overwrites newer envelope — same as the lock-scope row
    - `[medium]` `patch` `doc:../../etc/hosts` object is statted outside the root and committed — `validatePrefixed` rejects a `doc:` path that is not a normalized safe relative path
    - `[medium]` `patch` scope non-string or empty — same as above
    - `[low]` `reject` internal errors reported as bad-fact exit 1 — debugging nuisance only; fix adds an error class
    - `[low]` `reject` unreadable existing fact file bypasses the newer-schema guard — needs EACCES on a file the engine wrote itself
    - `[low]` `patch` key/`source` mismatch not reported — same as above
    - `[low]` `patch` stored `evidence.line` 0/NaN breaks the finding line — fall back to 1 unless an integer >= 1
    - `[medium]` `patch` `schemaVersion` not checked in `isV1Envelope` — same as above
    - `[false]` `reject` dedup breaks "any input order" determinism — the row covers the same facts; differing duplicates are not the same facts
  - Intent Alignment:
    - `[low]` `patch` two undocumented env vars — kept as test-only overrides, documented in JSDoc, positive integers only
    - `[false]` `reject` 10 s/30 s defaults never exercised — defaults are constants checked by reading; tests use injected timings as the spec's Code Map requires
    - `[false]` `reject` bad-fact variants unit-tested, not CLI-tested — the CLI path shares `prepareEnvelope`; one CLI bad-fact test proves wiring
    - `[false]` `reject` errors list one message per bad index — "every problem" is read as every bad fact, the only reading the index-keyed shape supports

## Auto Run Result

- **Change:** `facts-write` validates one doc's facts from stdin and replaces `_lumina/facts/<source>.json` under `_lumina/_state/lock`; `verify-evidence` reports P14/P15 over committed fact files; `status` entries carry `hash`; `buildGraph` and `facts-write` share one resolver.
- **Files:**
  - `src/project/lib/factfile.mjs` (new): envelope validation, canonicalization, serialization, `verifyEvidence`.
  - `src/project/lib/fsx.mjs`: `atomicWrite`, `withLock`.
  - `src/project/lib/graph.mjs`: exported `makeResolverContext`, `resolveFactRef`, `PREFIXED_ID_RE`; `doc:` paths must be normalized and safe.
  - `src/project/project.mjs`: two subcommands, `hash` in `status`, source re-hash inside the lock.
  - Tests: `factfile.test.mjs` (new), `fsx.test.mjs`, `project.test.mjs`.
- **Review:** 46 findings; 33 patched (13 medium, 20 low), 1 deferred (CI wiring, story 7), 12 rejected (6 false, 6 low and unlikely: lock takeover/release races, orphan lock on write failure, internal errors as exit 1, unreadable existing fact file).
- **Follow-up review:** recommended. Patched medium entries: 13. Unverified risk: the in-lock re-hash and the `doc:` path guard in the shared resolver changed behavior after the first review.
- **Verification:** `node --test src/project/` 401 pass, 2 skipped (case-sensitive FS only); `npm run test:scripts` 614 pass; `status` on a parse-pilot copy gives a 64-hex `hash` per doc; Seli `build` 0.20 s, 313 nodes, 1467 edges, no P10 (unchanged from story 2).
- **Residual risks:** stale-lock takeover by two simultaneous writers can let both in; `src/project` tests are not in CI until story 7.
