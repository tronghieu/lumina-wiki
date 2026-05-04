---
title: 'v0.9 — /lumi-verify: independent hallucination-reduction skill'
type: 'feature'
created: '2026-05-04'
status: 'in-review'
baseline_commit: '81e58e7e6b628f32ff58b81a500ec4b8c5ad8c99'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/planning-artifacts/architecture.md'
  - '{project-root}/ROADMAP.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** v0.1 ships no semantic check that wiki claims are grounded in the raw sources they cite. Hallucinations introduced at ingest time go undetected — `/lumi-check` only catches structural lint (kebab slugs, missing reverse edges), not whether a claim was fabricated. Users have no way to retrospectively verify entries already in the wiki either.

**Approach:** Ship `/lumi-verify` as a standalone core skill that runs an adversarial three-reviewer pattern (Blind / Grounding / External) over a single source entry or the whole wiki, writes findings back to entry frontmatter (`verify_status`, `findings:`), and dumps a timestamped run report to `_lumina/_state/`. Advisory only — never auto-edits body text. Works retroactively on any existing entry.

## Boundaries & Constraints

**Always:**
- Verify operates on `sources/*` entities only in v0.9. Other entity types skip with `verify_status: not_applicable`.
- All wiki writes go through `wiki.mjs set-meta` (atomic). Never write directly to `wiki/*.md`.
- Three reviewers receive deliberately different context slices to break anchoring. Run in fresh sub-agent contexts where the host runtime supports it.
- Drift preflight (raw artifact integrity) gates the Grounding reviewer — if `raw_paths` resolve to missing files, set `verify_status: drift_detected` and skip Grounding cleanly.
- The adversarial query in External reviewer is a hard requirement, not optional — must run a `<claim> debunked|criticism|alternative` query alongside the confirmatory one.
- Skill must run on Claude Code (Agent tool available) and degrade cleanly on Bash-only runtimes (Codex, Gemini, Cursor, generic) by writing per-reviewer prompt files and HALTing for user paste-back.
- Each run replaces the entry's `findings:` array. Full audit trail lives in timestamped `_lumina/_state/lumi-verify-<ts>.json` files, never overwritten.

**Ask First:**
- If a user invokes `/lumi-verify --all` against a wiki with >50 source entries, HALT and confirm before proceeding (token budget guard).
- If a Grounding finding is severe (`class: decision_needed`), present the finding inline and HALT before continuing to next entry — do not bulk-write decision_needed findings silently.

**Never:**
- Don't auto-edit wiki body text. Findings are advisory; only `verify_status` and `findings:` frontmatter are written.
- Don't bundle MCP `llm-review` or second-provider API/key plumbing — still out of scope per project rule §3.21.
- Don't skip External reviewer's adversarial query when `--external` is set.
- Don't add new `wiki.mjs` subcommands. Use existing `read-meta`, `set-meta --json-value`, `checkpoint-write`, `list-entities`.
- Don't store findings in body text or in any region marked `<!-- user-edited -->`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Grounded entry | `sources/foo` with `raw_paths` resolvable, all body claims supported by raw | `verify_status: passed`, `findings: []`, exit 0, report file written | N/A |
| Fabricated claim | Body claims fact absent from raw | `verify_status: findings_pending`, finding written with `class: patch`, `reviewer: grounding`, exit 0 | N/A |
| Drift detected | `raw_paths` lists files that no longer exist on disk | `verify_status: drift_detected`, Grounding skipped, finding logged with `class: defer`, exit 0 | Continue, do not abort run |
| No raw at all | `provenance: missing` | `verify_status: skipped`, log reason to report, exit 0 | N/A |
| External contradicts | `--external` flag, adversarial query returns refuting evidence | Finding `reviewer: external`, `class: decision_needed`, HALT for user | N/A |
| Bash-only runtime | Host without Agent tool | Write 3 prompt files to `_lumina/_state/verify-prompts/<slug>/`, HALT with paste-back instructions | N/A |
| Bad slug arg | `/lumi-verify nonexistent/foo` | Stderr message, exit 2 | exit 2 |
| Network failure on `--external` | Web search unreachable | Finding `class: defer` with reason `unreachable`, continue, exit 0 | Don't fail run |

</frozen-after-approval>

## Code Map

- `src/scripts/schemas.mjs` -- Add two optional fields (`verify_status` enum, `findings` array) to `sources` entity in `REQUIRED_FRONTMATTER`. Single source of truth for both consumers.
- `src/scripts/wiki.mjs` -- `verify-frontmatter` validator picks up new fields automatically from schema. Add inline shape check for `findings[]` items (id, reviewer, class, claim, evidence, action).
- `src/scripts/wiki.test.mjs` -- Cases for `set-meta verify_status passed` and `set-meta findings '[...]' --json-value`; assert lint accepts grounded fixture and rejects malformed findings.
- `src/skills/core/verify/SKILL.md` -- New skill prompt. Frontmatter `name: lumi-verify`, `allowed-tools: [Bash, Read, Agent]`. Body covers args, 3-reviewer pattern, fallback ladder, output contract.
- `src/installer/commands.js` -- Register `lumi-verify` in `getSkillDefs()` core pack so installer copies + symlinks it.
- `src/installer/commands.test.js` -- Update expected core-skill list assertion to include `lumi-verify`.
- `src/templates/README.md` -- Add `/lumi-verify` to skill table inside `<!-- lumina:schema -->` region (rendered into user's project on install). Only EN template exists.
- `README.md`, `README.vi.md`, `README.zh.md` -- Project-root lumina-wiki package READMEs; add `/lumi-verify` to the published skill list. Multi-language sync rule §17–18.
- `docs/user-guide/en.md`, `docs/user-guide/vi.md`, `docs/user-guide/zh.md` -- Post-install usage docs; add `/lumi-verify` section with worked example.
- `ROADMAP.md` -- Move v0.9 verify section to "shipped" status; bump current-version line.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/schemas.mjs` -- Add `{ key: 'verify_status', type: 'enum', required: false, values: ['passed','findings_pending','drift_detected','skipped','not_applicable'] }` and `{ key: 'findings', type: 'array', required: false }` to `sources` entry -- extends schema for verify writeback without breaking existing entries
- [x] `src/scripts/wiki.mjs` -- Extend `verify-frontmatter` to validate `findings[]` item shape when array is non-empty (`id: number, reviewer: blind|grounding|external, class: decision_needed|patch|defer|dismiss, claim: string, evidence: string, action: string`) -- locks the finding contract so malformed writebacks fail lint
- [x] `src/scripts/wiki.test.mjs` -- Add tests for `set-meta verify_status passed`, `set-meta findings '[...]' --json-value`, and rejection of malformed findings -- guards the contract
- [x] `src/skills/core/verify/SKILL.md` -- Author the skill prompt: `# /lumi-verify`, sections Role, Context, Instructions (3-reviewer pipeline + fallback), Output Format, Examples, Guardrails, Definition of Done -- main deliverable
- [x] `src/installer/commands.js` -- Add `lumi-verify` entry to `getSkillDefs()` under core pack with leaf `verify` -- registers skill for install
- [x] `src/installer/commands.test.js` -- Update core-skill list assertion -- keeps installer tests green
- [x] `src/templates/README.md` -- Add `/lumi-verify` to skill list inside `<!-- lumina:schema -->` region (single template; vi/zh template variants do not exist yet) -- updates the README rendered into user projects on install
- [x] `README.md`, `README.vi.md`, `README.zh.md` (project root) -- Add `/lumi-verify` to the skill section in all three lumina-wiki package READMEs -- multi-language sync rule §17–18
- [x] `docs/user-guide/en.md`, `docs/user-guide/vi.md`, `docs/user-guide/zh.md` -- Add `/lumi-verify` usage section with worked example (single-slug retro mode + `--all` + key flags) per language -- multi-language sync rule §17–18
- [x] `ROADMAP.md` -- Update v0.9 entry to reflect shipped scope (verify only; ingest workflow deferred to v0.10) -- keep roadmap accurate

**Acceptance Criteria:**
- Given a fixture wiki with one grounded source and one fabricated-claim source, when running `/lumi-verify --all`, then the grounded entry gets `verify_status: passed` and the fabricated entry gets `verify_status: findings_pending` with at least one finding of `reviewer: grounding`.
- Given an entry with `raw_paths` pointing to a missing file, when running `/lumi-verify <slug>`, then `verify_status: drift_detected` is set and Grounding reviewer is skipped (not run, not failed).
- Given the same wiki state, when running `/lumi-verify <slug>` twice, then the second run produces an identical `findings:` array (same ids, same content) and writes a new timestamped report file without overwriting the first.
- Given a host runtime without Agent tool support, when running `/lumi-verify <slug>`, then 3 prompt files are written to `_lumina/_state/verify-prompts/<slug>/{blind,grounding,external}.md` and the skill HALTs with paste-back instructions.
- Given a fresh install with the new skill, when running `npm run ci:idempotency`, then the gate stays green (no `_lumina/_state/` files in the watched-paths diff).
- Given the new schema fields are optional, when running `npm run test:scripts` against existing entries lacking these fields, then no L01/L02 lint errors are emitted.

## Spec Change Log

### 2026-05-04 — review-driven amendments (iteration 1)

Triggering findings (from 3-reviewer adversarial review of the in-progress diff):

- **User-guide tone too technical** (user feedback during review). Spec didn't constrain user-facing language style. Amended `docs/project-context.md` §3 rule 21: user-facing docs target non-technical readers; banned-word list; four-part skill-section structure. Rewrote all user-guide /lumi-verify sections, README skill rows, SKILL.md frontmatter description.
- **`--stage` flag had three different semantics** across SKILL.md, ROADMAP, and user-guide. Removed from user-guide entirely; replaced in SKILL.md with `--external` (single boolean flag for the open-web reviewer). v0.9 ships with three flags: `<slug>`, `--all`, `--since <date>`, plus `--external`.
- **`dismiss`-only verdict contradicted between SKILL.md Step 5 and `references/triage.md`.** Picked triage.md's rule (`dismiss → passed`, dismissals are noise and don't block). SKILL.md Step 5 amended to match.
- **SKILL.md Step 6 used `fs.writeFileSync`** — direct violation of project-context.md §3 rule 1 (atomic write). Rewrote Step 6 to use Write tool for tmp file + `wiki.mjs checkpoint-write` for atomic landing in `_lumina/_state/`. Also closes the shell-injection vector that interpolated finding text into a `node -e` string.
- **Triage-merge could produce structurally contradictory findings** (e.g. `reviewer: blind, class: decision_needed` despite Blind being forbidden from `decision_needed`). Amended Step 5 triage rule: when a class is upgraded by a later reviewer, attribute the upgraded finding to the upgrading reviewer.
- **Flow-mapping parser correctness bugs** in `wiki.mjs` (escape detection, colon-in-value, scalar round-trip, non-array bypass). Patched in place; format unchanged. Added 5 round-trip + negative tests to `wiki.test.mjs`.
- **ROADMAP heading "(in progress)"** was directly contradicted by spec task ("move to shipped"). Amended to "(implementing — branch feat/v0.9-lumi-verify)" since shipped status comes only on merge + tag, not on branch landing.

KEEP instructions (preserve through any future loop):
- `findings:` array replaces previous on each run; full audit trail lives in timestamped report file. Don't append-merge findings.
- Drift preflight gates Grounding (don't run Grounding on missing raw_paths). Don't crash on drift.
- Adversarial query in External reviewer is mandatory when `--external` is set. Don't make it skippable.
- Sources-only scope for v0.9. Don't extend to other entity types in this iteration.
- 4-part user-guide structure (purpose / when / how / what you get). Don't re-introduce reviewer tables, status enums, or stage-flag matrices in user-guide prose.

## Design Notes

**Three-reviewer rationale (BMAD code-review adaptation):**

| Reviewer | Context cap | Catches |
|---|---|---|
| Blind | Wiki entry text only — no `sources:`, no raw, no graph | Internal incoherence, mushy attribution, claims without numbers |
| Grounding | Entry + `raw_paths` files + `graph/` snippet | Claim absent from cited raw, attribution drift, edge-type misuse |
| External (gated `--external`) | Entry + open-web confirmatory + open-web adversarial | World-knowledge contradiction, retracted papers, refuted results |

Anti-anchoring is **structural**: each reviewer is starved of context the others have, so the same model produces three independent angles. Drift check (was Stage B in roadmap) collapses into Grounding's preflight — runs first, blocks Grounding cleanly if raw is gone.

**Triage schema (BMAD-style, four buckets):** `decision_needed` (HALT for user), `patch` (clear hallucination, suggest fix), `defer` (pre-existing or out-of-scope), `dismiss` (false positive). Verify never auto-applies; all classes write to frontmatter for user review.

**Fallback ladder (BMAD `step-02-review.md` pattern):**
1. Preferred — Agent tool, 3 sub-agents in parallel.
2. Fallback — write `_lumina/_state/verify-prompts/<slug>/{blind,grounding,external}.md`, HALT, ask user to run each in fresh session and paste back.
3. Single-pass (user opts in via `--single`) — one reviewer with full context, no anti-anchoring; documented as weakest tier.

## Verification

**Commands:**
- `npm run test:scripts` -- expected: all green including new wiki.test.mjs cases
- `npm run test:installer` -- expected: green with updated core-skill assertion
- `npm run ci:idempotency` -- expected: green (no `_state/` drift in watched paths)
- `npm run ci:package` -- expected: green (new SKILL.md included via existing core-pack glob)
- `node bin/lumina.js --version --no-update` -- expected: version flag still <2s

**Manual checks:**
- Sandbox install includes `.claude/skills/lumi-verify` symlink and `.agents/skills/lumi-verify/SKILL.md` copy.
- `/lumi-verify` slash command appears in Claude Code skill picker.
- Run on a synthetic 3-entry fixture wiki (one grounded, one fabricated, one drifted); confirm verdict matrix matches Acceptance Criteria.
