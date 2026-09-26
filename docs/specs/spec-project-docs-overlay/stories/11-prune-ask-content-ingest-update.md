---
title: 'facts-prune, ask reads content, ingest update mode'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
  - '{project-root}/src/templates/project/PROJECT.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** User review of story 9 raised three gaps:
- A deleted doc leaves a fact file nothing can clear, so P14 stays forever.
- ask refuses to read doc content, which makes it weaker than plain grep.
- ingest offers never-ingested docs on every run, when the user wants it to process only docs that changed.

**Approach:** Amended AD-10 and AD-15 cover these. Add a `facts-prune` subcommand, let ask read the cited doc sections, and make update mode (changed and stale only) the ingest default.

## Boundaries & Constraints

**Always:**
- **`facts-prune [--dry-run]`** (`src/project/`):
  - Selects every fact file under `_lumina/facts/` whose envelope `source` (or, for a malformed file, its path-derived source) is not an in-scope doc.
  - Skips rename candidates: a `sourceHash` that matches an in-scope doc which has no envelope of its own. P15 already detects this.
  - Takes the write lock (AD-23). Removes the file, then any directory under `_lumina/facts/` that is left empty.
  - Stdout: `{ok: true, dryRun, removed: [<fact file paths>], kept: [{file, reason: "rename-candidate", candidate}]}`, sorted.
  - `--dry-run` removes nothing but prints the same shape.
  - Exit codes: 1 for a bad flag, 2 for a config or root error, 3 for a lock timeout or internal error.
- **`PROJECT.md`:** replace the manual-delete exception with `facts-prune` in the Rules and in the command list.
- **verify and check skills:** the remedy for P14 "source gone" is `facts-prune`. Run `--dry-run` first, show what it lists, and run the real prune only after the user approves. For P15, re-ingest the new path; the old file then becomes prunable.
- **ask skill:**
  1. Locate the answer with `query`.
  2. Read the doc sections the results cite (lines around each `file:line`) to answer content questions.
  3. When no node matches, search the in-scope docs with the host's file search, and label that part of the answer "from doc search, not the graph".
  4. Every claim cites `file:line`. Keep the freshness report.
  5. Still read-only: never write docs or `_lumina/`.
- **ingest skill:**
  - Update mode is the default: select only `changed` and `stale` docs.
  - Offer `never-ingested` docs only when the user asks (for example "ingest all" or named paths), or on the first run, when no doc is ingested yet. The >20-doc approval gate still applies.
  - The final report says how many never-ingested docs remain.
- Skill descriptions stay short (what and when). No slash syntax.

**Never:**
- No hook or watch mode.
- ingest, verify, check and view never read `_lumina/facts/` or `_lumina/graph/` directly.
- `facts-prune` never deletes a rename candidate or touches any path outside `_lumina/facts/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Doc deleted | Fact file for `docs/x.md`; `docs/x.md` removed | `removed` lists it; the file is gone; `verify-evidence` then has no P14 for it | none |
| Rename | Doc renamed; new path has no envelope | `kept` lists the old file with its candidate; nothing removed | none |
| Rename after re-ingest | New path ingested | The old file is removed | none |
| Dry run | `--dry-run` | Same lists; no file changed | none |
| Bad flag | `facts-prune --force` | nothing | exit 1 |
| Update default | 2 changed, 228 never-ingested | Processes 2; reports 228 remaining | none |
| First run | 0 ingested, 30 never-ingested | Offers all 30, gated at 20 | none |
| ask content | "What does ADR-0052 decide about the cost book?" | Answer read from the cited section, with `file:line` | none |
| ask no node | A term with no node or concept | Doc-search answer, labelled, cited | none |

</intent-contract>

## Code Map

- `src/project/project.mjs`:
  - The subcommand dispatch in `main` (~606-679).
  - The `lint` and `query` flag parsing before `findRoot` is the pattern to follow.
  - The `runFactsWrite` lock usage is the pattern for `facts-prune`.
- `src/project/lib/factfile.mjs`:
  - `loadFacts` and the `verifyEvidence` P14/P15 logic (~244-300) show how a gone source and a rename candidate are detected. Reuse them rather than re-deriving.
  - The fsx lock helpers.
- `src/project/lib/fsx.mjs` -- `safePath` and the lock. Removal must stay inside `_lumina/facts/`.
- `src/skills/project/lumi-project-{ask,ingest,verify,check}/SKILL.md` -- the four skills to amend.

## Tasks & Acceptance

**Execution:**
- `src/project/project.mjs`, `src/project/lib/factfile.mjs`, their tests, `src/templates/project/PROJECT.md` -- `facts-prune`, with one test per engine matrix row.
- `src/skills/project/lumi-project-ask/SKILL.md` -- content reading and the doc-search fallback.
- `src/skills/project/lumi-project-ingest/SKILL.md` -- update mode.
- `src/skills/project/lumi-project-verify/SKILL.md`, `src/skills/project/lumi-project-check/SKILL.md` -- the `facts-prune` remedy.

**Acceptance Criteria:**
- Given the Seli copy after story 9 acceptance (`scratchpad/seli9-acc`, where 0052 is edited and stale):
  - When a doc with facts is deleted and `facts-prune` runs, then its fact file is gone and `lint` shows no P14 for it.
  - When ask receives "What does ADR-0052 decide about the cost book?", then the answer states the decision with `file:line`.
  - When ingest runs with no paths, then it processes only changed or stale docs.

## Verification

**Commands:**
- `node --test src/project/` -- expected: 0 fail.
- `npm run test:installer`, `npm run ci:package`, `npm run ci:idempotency` -- expected: ok.

## Spec Change Log

- 2026-09-26: Review showed that selecting by "not an in-scope doc" deleted the facts of docs that still exist but fell out of scope, which contradicts the user's intent (only deleted docs). The contract changed:
  - Classify by the path-derived key.
  - Keep `out-of-scope` (the doc still exists on disk) and `newer-schema` files. A live doc's own slot is never listed.
  - Positionals are the approved list; the real run deletes only those that are still removable.
  - Stdout adds `skipped`, `failed` and `warnings`, and a failed unlink exits 3.
  - KEEP: a rename candidate is kept until its new path is ingested.

## Review Triage Log

### 2026-09-26 — Review pass (stories 10 and 11 together)
- verdicts: about 55 raw findings merged into 24 rows — high 5, medium 9, low 8, false 2, maybe-false 0
- findings:
  - `[high]` `patch` prune deletes facts of docs that exist but are out of scope (Blind, Edge) — kept `out-of-scope`
  - `[high]` `patch` prune classifies by `envelope.source`, so it deletes a live doc's slot or strands a mismatch (Blind, Edge, Intent) — classify by path key; a live slot is never listed
  - `[high]` `patch` the real run deletes a different set than the one approved (Blind, Edge) — positionals are the approved list; `skipped`
  - `[high]` `patch` case-only rename leaves a permanent P14 mismatch on APFS/NTFS (Edge) — shared case-fold comparison
  - `[high]` `patch` ask stops without a doc search for an unconfigured term, which fails the matrix row (Blind, Edge, Intent) — search whenever the graph does not answer
  - `[medium]` `patch` a mid-loop failure leaves a partial delete unreported (Blind, Edge) — validate all paths first; `failed` plus exit 3
  - `[medium]` `patch` lexical-only containment check; symlinked `_lumina` (Blind, Edge) — realpath check
  - `[medium]` `patch` newer-schema files deleted by an older engine (Edge) — kept
  - `[medium]` `patch` P16 scope warnings hidden from the prune approval (Edge) — `warnings`
  - `[medium]` `patch` ask search not bounded to scope; guessed line numbers; no injection guardrail (Blind) — `scope` list plus `grep -n`; data-not-instructions rule
  - `[medium]` `patch` ask infers per-doc state from project-wide counts (Blind) — only `staleDocs`; `status` allowed
  - `[medium]` `patch` check gives an impossible re-ingest remedy for an out-of-scope P14 (Intent, Edge) — the prune dry run decides
  - `[medium]` `patch` CHANGELOG lists only the docs (Blind, Intent) — project mode, facts-prune, ask and ingest entries
  - `[medium]` `patch` missing prune tests (Blind) — 11 cases added
  - `[low]` `patch` the `..`-prefixed filename is refused (Blind, Edge) — segment check
  - `[low]` `patch` ingest remaining-count rule is conditional (Intent) — always reported
  - `[low]` `patch` verify prune scope is global, not per-doc (Blind) — out-of-request entries called out
  - `[low]` `patch` guide: engine commands not shown; incomplete stale definition; `--profile` missing; examples not requests; uninstall contradiction (Intent, Blind) — fixed in en, synced to vi and zh
  - `[low]` `patch` zh translated the `ingest all` trigger and blurred setup with install (Blind, Intent) — literal phrase; 项目设置
  - `[low]` `patch` "CAP-10:" id in a shipped prompt (Intent) — removed
  - `[low]` `reject` single `candidate` when several docs share a hash — pathological
  - `[low]` `reject` first-run re-trigger after every doc is pruned — the >20 gate covers it
  - `[false]` `reject` unreadable docs silently dropped, then pruned — `parseAll` throws (Edge checked)
  - `[false]` `reject` symlinked fact files pruned — `loadFacts` never follows links (Edge checked)

## Auto Run Result

- **Change:**
  - `facts-prune [--dry-run] [<fact file>...]` removes only the facts of deleted docs, and only the files the user approved.
  - ask answers content from the cited doc sections, and falls back to a scoped doc search.
  - ingest defaults to update mode (changed and stale docs only).
  - verify and check run the dry run, then approval, then prune.
- **Files:**
  - `src/project/project.mjs`, `src/project/lib/factfile.mjs` and their tests
  - `src/templates/project/PROJECT.md`
  - `src/skills/project/lumi-project-{ask,ingest,verify,check}/SKILL.md`
- **Review:** 24 rows. 20 patched (5 high, 9 medium, 6 low); 2 low rejected; 2 false.
- **Follow-up review:** recommended. 5 high and 9 medium entries were patched, and the prune contract changed after the first review.
- **Verification:**
  - `npm run test:all`: exit 0, including project 538 pass.
  - `ci:package`: 146 files. `ci:idempotency`: 6 `[ok]`.
  - Seli copy: deleting 0052 then running `facts-prune --dry-run` listed its file. Pruning with the approved list removed it and the empty dirs, after which `verify-evidence` reported no findings. A bad flag exits 1.
  - ask was re-verified on Seli for a content question and for a doc-search question.
- **Residual risks:**
  - The patched ingest, verify and check were not re-run by a fresh host agent end to end.
  - The case-only rename was tested in unit tests only.
