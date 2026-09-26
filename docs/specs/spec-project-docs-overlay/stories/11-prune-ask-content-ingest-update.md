---
title: 'facts-prune, ask reads content, ingest update mode'
type: 'feature'
created: '2026-09-26'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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

## Review Triage Log
