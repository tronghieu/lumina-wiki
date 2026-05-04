---
title: 'v0.9 — /lumi-ingest: multi-step workflow with HITL gates'
type: 'refactor'
created: '2026-05-04'
status: 'done'
baseline_commit: '987c1194ff2c608a74a53ef86d7c5c6057a55dcd'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/planning-artifacts/architecture.md'
  - '{project-root}/docs/implementation-artifacts/spec-v0-9-lumi-verify.md'
  - '{project-root}/ROADMAP.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/lumi-ingest` today is a single 380-line skill prompt with nine internal phases and one fine-grained checkpoint file. The user has no chance to inspect the drafted page before stubs/edges/citations cascade off it; if the draft hallucinates, every downstream artifact compounds the error. There is no integration with `/lumi-check` or the new `/lumi-verify`, so trust signals do not feed back into the ingest itself.

**Approach:** Re-cast `/lumi-ingest` as a four-stage workflow with explicit human-in-the-loop gates between stages — **draft → lint → verify → finalize**. Each stage advances a coarse `ingest_status` field on the source entry's frontmatter (durable, survives session restart). The fine-grained nine-phase checkpoint (`_state/ingest-<slug>.json`) remains intact for within-stage resume. Re-running `/lumi-ingest <slug>` on an entry mid-workflow resumes at the right stage.

## Boundaries & Constraints

**Always:**
- Gate-level state lives in entry frontmatter as `ingest_status: drafted | linted | verified | finalized`. Phase-level state stays in `_state/ingest-<slug>.json` (untouched format).
- All four stage prompts live as separate step files under `src/skills/core/ingest/references/step-NN-<name>.md`. SKILL.md becomes a thin router that detects resume state and `Read fully and follow`s the right step.
- Every gate uses the BMAD-style HALT prose menu (`HALT and ask human: [A] Accept | [E] Edit | [W] Accept-with-warning | [Q] Quit`), not a custom construct. `[E]` loops back to the same step; `[Q]` exits cleanly with status preserved.
- Schema field `ingest_status` is added to `sources` only — concept/person stubs do not flow through this gate ladder.
- `ingest_status` is optional and absent from existing entries; lint must remain silent on its absence.
- Verify stage invokes the existing `/lumi-verify` skill in **grounding-only** quick mode (no `--external`, no Blind reviewer) so ingest stays cheap; users opt into deeper verification post-finalize.
- All wiki frontmatter writes go through `wiki.mjs set-meta`. Never write directly to `wiki/*.md`. Atomic write rule §3.1 holds.
- Step files are progressive-disclosure: SKILL.md ≤ 80 lines (router only). Phase content moves into step files; nothing is duplicated across files.

**Ask First:**
- If `[W] Accept-with-warning` is chosen at the verify gate, set `confidence: low` on the entry before continuing — confirm with user that downgrade is intentional.
- If a user re-runs `/lumi-ingest <slug>` and the entry already has `ingest_status: finalized`, HALT and confirm "this entry is already finalized; restart from scratch?" before deleting the phase checkpoint.
- If verify stage returns `verify_status: drift_detected`, HALT before proceeding — drifted raw is a stronger signal than findings, do not silently downgrade-and-continue.

**Never:**
- Don't change the nine-phase checkpoint format or its file path. v0.8 sandboxes with mid-ingest checkpoints must keep working.
- Don't bundle a new verify reviewer into ingest. Reuse `/lumi-verify --grounding <slug>`; one source of truth per skill.
- Don't auto-edit the source page body in response to findings. The verify gate writes `findings:` and `verify_status:`; revise loops are user-driven.
- Don't add new `wiki.mjs` subcommands. Use existing `read-meta`, `set-meta`, `checkpoint-read`, `checkpoint-write`.
- Don't re-introduce phase content as inline blocks in SKILL.md. Step files are the only home.
- Don't surface internal mechanics in user-facing docs (`ingest_status` enum, `_state/` paths, step file names). Project rule §3.21 holds — user-guide describes gates as "checkpoints where you say yes/no".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fresh ingest, all gates accepted | `raw/sources/foo.pdf`, no existing entry | `ingest_status` advances `drafted → linted → verified → finalized`; one log entry; lint clean; `verify_status: passed` | N/A |
| Resume after restart at draft gate | Entry has `ingest_status: drafted`, user re-runs `/lumi-ingest <slug>` | SKILL.md reads frontmatter, jumps to step-02-lint without re-drafting | N/A |
| Revise loop at draft gate | User picks `[E]` at gate 1 | Loop back into step-01 with user's revision instructions; no checkpoint advance until next `[A]` | N/A |
| Lint errors at gate 2 | `lint.mjs --fix --json` reports residual errors after auto-fix | HALT with error list; require user direction; do not silently advance | exit 0 from skill, no advance |
| Verify finds patch-class issues | Grounding reviewer writes `findings:` with `class: patch` | Present findings inline; gate 3 menu adds `[W]` path → sets `confidence: low`, `ingest_status: verified` | N/A |
| Verify detects drift | `verify_status: drift_detected` after grounding preflight | HALT regardless of menu choice; user must repair raw or explicitly skip | N/A |
| Re-run on finalized entry | `ingest_status: finalized` | HALT, ask "restart?"; on confirm, set `ingest_status: drafted` then delete phase checkpoint then re-enter step-01 | exit 0 on decline (declining is not an error) |
| Quit mid-workflow | User picks `[Q]` at any gate | `ingest_status` preserved at last-completed stage; phase checkpoint untouched; clean exit 0 | N/A |
| Existing entry without `ingest_status` | Pre-v0.9 entries | Treated as legacy: `/lumi-ingest <slug>` offers "this entry predates the workflow; run lint+verify only?" | N/A |

</frozen-after-approval>

## Code Map

- `src/scripts/schemas.mjs` -- Add `{ key: 'ingest_status', type: 'enum', required: false, values: ['drafted','linted','verified','finalized'] }` to `sources` entity. Mirrors `verify_status` placement.
- `src/scripts/wiki.mjs` -- `verify-frontmatter` picks up new field automatically. No subcommand changes.
- `src/scripts/wiki.test.mjs` -- Cases: `set-meta ingest_status drafted` round-trip; lint silent when field absent; reject invalid enum value.
- `src/skills/core/ingest/SKILL.md` -- Rewrite as thin router (≤ 80 lines): frontmatter unchanged; body covers role + activation + state-detection + first-step handoff. Move phase content into step files.
- `src/skills/core/ingest/references/step-01-draft.md` (NEW) -- Phases 0–7 of current SKILL.md (resume check, resolve input, detect, slug, source page, stubs, edges, citations, index). Ends with HALT at draft gate. On `[A]`: write `ingest_status: drafted`, NEXT → step-02.
- `src/skills/core/ingest/references/step-02-lint.md` (NEW) -- Phase 8 of current SKILL.md (`lint.mjs --fix --json`, surface residual errors). Ends with HALT at lint gate. On `[A]`: write `ingest_status: linted`, NEXT → step-03.
- `src/skills/core/ingest/references/step-03-verify.md` (NEW) -- Invoke `/lumi-verify --grounding <slug>` (or fallback to direct `wiki.mjs read-meta` + grounding reviewer prompt if Agent tool unavailable, mirroring verify's fallback ladder). Read resulting `findings:` and `verify_status:`. Ends with HALT at verify gate. On `[A]`: write `ingest_status: verified`, NEXT → step-04. On `[W]`: also set `confidence: low`.
- `src/skills/core/ingest/references/step-04-finalize.md` (NEW) -- Phase 9 of current SKILL.md (`wiki.mjs log ingest`, set checkpoint phase done, write `ingest_status: finalized`). Terminal step.
- `src/skills/core/ingest/references/pdf-preprocessing.md` -- Unchanged. Referenced from step-01.
- `src/skills/core/ingest/references/dedup-policy.md` -- Unchanged. Referenced from step-01.
- `src/templates/README.md` -- Minor: refresh `/lumi-ingest` row to mention checkpoint behavior in plain language ("pauses at checkpoints so you can review before saving").
- `README.md`, `README.vi.md`, `README.zh.md` -- Same plain-language refresh, three languages (rule §17–18).
- `docs/user-guide/en.md`, `docs/user-guide/vi.md`, `docs/user-guide/zh.md` -- Update ingest section to describe gate flow in 4-part structure (purpose / when / how / what you get). Banned-word list (§3 rule 21) holds — no `ingest_status`, no `_state/`, no step file paths.
- `ROADMAP.md` -- Update v0.9 entry to reflect both verify AND ingest-workflow shipped together.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/schemas.mjs` -- Add `ingest_status` enum to `sources` entity directly under `verify_status` -- extends schema for gate state
- [x] `src/scripts/wiki.test.mjs` -- Add 3 cases: `set-meta ingest_status drafted` round-trip, absent field passes lint, invalid enum rejected -- guards the contract
- [x] `src/skills/core/ingest/references/step-01-draft.md` -- Author step file: phases 0–7 + draft gate HALT menu + state-write on accept -- main deliverable, draft stage
- [x] `src/skills/core/ingest/references/step-02-lint.md` -- Author step file: phase 8 + lint gate HALT + state-write -- main deliverable, lint stage
- [x] `src/skills/core/ingest/references/step-03-verify.md` -- Author step file: invoke `/lumi-verify --grounding`, read findings, verify gate HALT (4-option: A/E/W/Q), state-write on accept, drift-detected hard halt -- main deliverable, verify stage
- [x] `src/skills/core/ingest/references/step-04-finalize.md` -- Author step file: phase 9 + final state-write `ingest_status: finalized` + log entry -- terminal step
- [x] `src/skills/core/ingest/SKILL.md` -- Rewrite to thin router: detect existing `ingest_status` on slug, route to correct step file via `Read fully and follow`. Preserve frontmatter (name, description, allowed-tools). Cap ≤ 80 lines body -- entry point
- [x] `src/templates/README.md` -- Refresh `/lumi-ingest` row in `<!-- lumina:schema -->` region with plain-language gate description -- rendered into user projects on install
- [x] `README.md`, `README.vi.md`, `README.zh.md` -- Same refresh in three languages, project root packages -- multi-language sync
- [x] `docs/user-guide/en.md`, `docs/user-guide/vi.md`, `docs/user-guide/zh.md` -- Rewrite ingest section in 4-part structure with gate-flow walkthrough; no internal mechanics -- multi-language sync
- [x] `ROADMAP.md` -- Update v0.9 entry: both verify AND ingest-workflow shipped in this version -- keep roadmap accurate

**Acceptance Criteria:**
- Given a fresh source `raw/sources/foo.pdf`, when running `/lumi-ingest raw/sources/foo.pdf` and accepting all four gates, then the entry ends with `ingest_status: finalized`, `verify_status: passed`, lint clean, one new line in `wiki/log.md`.
- Given an entry with `ingest_status: drafted`, when re-running `/lumi-ingest <slug>` in a fresh session, then the workflow skips draft and HALTs at the lint gate without re-running phases 0–7.
- Given a verify-gate HALT with patch-class findings, when user picks `[W] Accept-with-warning`, then the entry receives `confidence: low` and `ingest_status: verified`; `[A] Accept` produces `confidence` unchanged.
- Given a v0.8-era entry without `ingest_status`, when `/lumi-ingest <slug>` is invoked on it, then the skill offers a legacy path (lint+verify only) and does not crash on the missing field.
- Given the new schema field is optional, when `npm run test:scripts` runs against fixtures lacking `ingest_status`, then no L01/L02 lint errors are emitted.
- Given a fresh install, when `npm run ci:idempotency` runs, then the gate stays green (no `_state/` drift in watched paths).
- Given the SKILL.md rewrite, when measuring body line count, then it is ≤ 80 lines (router-only). Phase content lives in step files.

## Spec Change Log

### 2026-05-04 — review-driven amendments (iteration 1)

Triggering findings (from 3-reviewer adversarial review of the in-progress diff):

- **`checkpoint-write` invocation in step-04 used a non-existent `--json-value` flag** with the JSON literal as positional[2]. The real signature is `<skill> <phase> [<json-file>|-]` — third positional is a file path, JSON content goes via stdin. Step-04 Phase 9.5 rewritten to use stdin (with `jq` one-liner as alternate).
- **`[W]` confirmation fired AFTER state writes**, contradicting the Ask First boundary that says confirm before downgrade. Step-03 amended: confirm prose first, then writes (in order: `confidence` first so a crash leaves a strictly-conservative state).
- **`[Q]` paths fell through to `## NEXT` directive** in all four step files. Added explicit "STOP — do not read the NEXT directive" to every `[Q]` exit path.
- **Drift `[M]` left `verify_status: drift_detected` in frontmatter** instead of resetting to `skipped`. Step-03 drift handler amended to reset `verify_status` and `provenance` and `raw_paths` atomically before presenting the standard gate.
- **Lint `[E]` re-run was ambiguous about `--fix`** — could loop indefinitely on auto-fixable errors. Step-02 `[E]` clarified to require the full Phase 8 instruction including `--fix`.
- **Re-ingest on `finalized` had a state-coherence race window** between confirm and step-01 entry (session crash → ingest_status: finalized + empty checkpoint → router routes to step-04). SKILL.md amended: on restart confirm, write `ingest_status: drafted` BEFORE deleting checkpoint, before entering step-01.
- **Legacy entry path was a routing stub with no implementation.** SKILL.md amended: legacy entries get an explicit `[A] | [Q]` prompt; on `[A]`, write `ingest_status: drafted` (mark as adopted), then route to step-02.
- **Tier 2 verify in step-03 had no `Read fully and follow` directive** — vague prose reference to the verify SKILL. Amended to explicit handoff instruction.
- **README skill rows surfaced verbatim enum names** (`draft, lint, verify, finalize`) in user-facing docs, violating the spec's Never rule and project rule §3.21. All three project READMEs + template README rewritten with plain-language descriptions ("write the draft, check structure, cross-check claims, save").
- **Schema field placement** put `ingest_status` after `findings` rather than adjacent to `verify_status` as Code Map specified. Reordered.
- **ZH user-guide "what you get" had 4 bullets vs EN's 5** — missing the "auto-created concept/person pages" callout. Synced.
- **I/O matrix exit-code for finalized-decline was `exit 2`** — wrong; exit 2 is reserved for errors per the project's exit-code contract, and a deliberate user decline is not an error. Amended to `exit 0`.

KEEP instructions (preserve through any future loop):
- Four step files under `references/`, SKILL.md as thin router (≤80 body lines). Don't re-collapse into one prompt.
- `ingest_status` durable on entry frontmatter, separate from fine-grained phase checkpoint. Don't merge state spaces.
- Verify gate reuses `/lumi-verify --grounding`. Don't inline a duplicate grounding reviewer.
- BMAD-style HALT prose menus. Don't invent a custom gate construct.
- Drift is a hard halt at verify gate. Don't auto-downgrade-and-continue.
- 4-part user-guide structure (purpose / when / how / what you get) per project rule §3.21. Don't surface internal mechanics in user-facing docs.

## Design Notes

**Why frontmatter for gate state, not a separate file:**
Frontmatter survives `git clone` and session restart without auxiliary state. The fine-grained `_state/ingest-<slug>.json` checkpoint is gitignored runtime state and lives within a single resume; the four-gate `ingest_status` is a coarse anchor that lets a user pick up an entry from any machine. Mirrors the verify pattern (`verify_status` in frontmatter, run report in `_state/`).

**Why reuse `/lumi-verify` instead of inlining grounding:**
Single source of truth for grounding logic. The verify skill already implements the grounding reviewer with drift preflight, fallback ladder, and findings-array contract. Inlining a duplicate in step-03 would create two prompts that drift apart.

**Step-file convention:**
- Each step file opens with `## RULES` (guardrails repeated to fight context-rot), then `## INSTRUCTIONS`, then `## NEXT` (single `Read fully and follow` directive). Borrowed from BMAD `bmad-quick-dev` step shape.
- Gate menus use literal prose: `HALT and ask human: [A] Accept | [E] Edit | [Q] Quit` (verify gate adds `[W] Accept-with-warning`).
- Resume detection in SKILL.md is a small decision tree: read entry frontmatter → branch on `ingest_status` value → handoff. No lookahead into multiple step files.

**Mode A/B/C input handling stays in step-01.** No re-design of input resolution; the rewrite is structural, not behavioral, on input.

## Verification

**Commands:**
- `npm run test:scripts` -- expected: green including new `ingest_status` cases
- `npm run test:installer` -- expected: green (no installer surface change beyond SKILL.md content)
- `npm run ci:idempotency` -- expected: green
- `npm run ci:package` -- expected: green (new step files included via existing core-pack glob; verify pattern matches)
- `wc -l src/skills/core/ingest/SKILL.md` -- expected: ≤ ~100 lines total (frontmatter + ≤ 80 body)

**Manual checks:**
- Sandbox install: `.claude/skills/lumi-ingest` symlink resolves; step files appear under `references/`.
- Fresh ingest end-to-end on a small fixture PDF: gate menus render, accept-all produces `ingest_status: finalized`.
- Resume: kill mid-workflow, re-run with same slug, confirm correct stage entry.
- Drift: artificially break `raw_paths`, run verify gate, confirm hard HALT.

## Suggested Review Order

**Workflow architecture (entry point)**

- Thin router — entry point for the entire skill. Detects `ingest_status` and dispatches to the right step file.
  [`SKILL.md:1`](../../src/skills/core/ingest/SKILL.md#L1)

- Stage 1 — input resolution + draft writing (Phases 0–7), ending with the draft gate. Where the cascade now happens *before* user review.
  [`step-01-draft.md:1`](../../src/skills/core/ingest/references/step-01-draft.md#L1)

- Stage 2 — lint with auto-fix; HALT on residual errors. Cheapest semantic check, runs before verify.
  [`step-02-lint.md:1`](../../src/skills/core/ingest/references/step-02-lint.md#L1)

- Stage 3 — invoke `/lumi-verify --grounding`; gate adds `[W] Accept-with-warning` and a hard halt on drift.
  [`step-03-verify.md:1`](../../src/skills/core/ingest/references/step-03-verify.md#L1)

- Stage 4 — log + final state writes. The terminal step.
  [`step-04-finalize.md:1`](../../src/skills/core/ingest/references/step-04-finalize.md#L1)

**Contract (schema + tests)**

- New `ingest_status` enum on `sources`, optional, mirrors `verify_status` placement.
  [`schemas.mjs:264`](../../src/scripts/schemas.mjs#L264)

- Four test cases guarding round-trip, optional-absent, invalid-enum, and full enum coverage.
  [`wiki.test.mjs:1972`](../../src/scripts/wiki.test.mjs#L1972)

**User-facing surfaces (multi-language)**

- EN user-guide section in 4-part structure (purpose / when / how / what you get); plain language only.
  [`en.md:333`](../../docs/user-guide/en.md#L333)

- VI user-guide — same structure, Vietnamese.
  [`vi.md:333`](../../docs/user-guide/vi.md#L333)

- ZH user-guide — same structure, Chinese; "what you get" synced to 5 bullets.
  [`zh.md:333`](../../docs/user-guide/zh.md#L333)

- Template README (rendered into user projects on install).
  [`README.md:174`](../../src/templates/README.md#L174)

- Project root READMEs (npm package surface) — three languages.
  [`README.md:164`](../../README.md#L164)
  [`README.vi.md:164`](../../README.vi.md#L164)
  [`README.zh.md:164`](../../README.zh.md#L164)

**Roadmap**

- v0.9 entry rewritten to cover both verify AND ingest-workflow shipped together.
  [`ROADMAP.md:9`](../../ROADMAP.md#L9)
