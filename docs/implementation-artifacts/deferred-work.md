# Deferred Work

## 2026-05-04

### Goal B — `/lumi-ingest` workflow rewrite (multi-step with HITL gates)

**Deferred from:** v0.9 split decision (kept v0.9 narrowly scoped to `/lumi-verify`).

**Scope:**

- Rewrite `/lumi-ingest` from a single skill prompt into a BMAD-style step-file workflow.
- Persist intermediate state in entry frontmatter (`ingest_status: drafted | linted | verified | published`) so a session can resume mid-ingest.
- Add HITL gates between steps with explicit HALT + menu (accept / revise / accept-with-warning / quit).
- Have ingest call `/lumi-check` (structural lint) and `/lumi-verify --grounding` as sub-steps; both already exist as standalone skills by then.
- Branching: revise loops back to draft step; accept-with-warning sets `confidence: low` in frontmatter.
- Findings array (`findings:` in frontmatter) is the shared artifact between verify and the HITL gate — verify writes, ingest reads, user resolves.

**Why deferred:**

- `/lumi-verify` ships independent value (works on existing wiki via `/lumi-verify <slug>` and `/lumi-verify --all`). User-facing hallucination defense lands in v0.9 without waiting for ingest rewrite.
- Lessons from building verify (prompt design for 3-reviewer pattern, triage schema, frontmatter field shape) inform the ingest workflow design — building B before A would be backwards.
- Coupling is one-way: B reads A's outputs. As long as A's `verify_status` / `findings` schema is stable in v0.9, B can land in v0.10 without schema migration.

**Target milestone:** v0.10.

**Prerequisites:**

- v0.9 `/lumi-verify` shipped and stable.
- Frontmatter schema for `verify_status` and `findings:` finalised in `src/scripts/schemas.mjs`.

---

## 2026-05-04 (review pass)

### Goal C — `--since <date>` batch read-meta path

**Deferred from:** v0.9 review, Blind hunter finding #9.

**Scope:** Current `/lumi-verify --since <date>` design fans out one `wiki.mjs read-meta` subprocess per entity to filter by `updated >= <date>`. Acceptable on small wikis (<50 entries), expensive on larger ones (200+ entries = 200+ subprocess spawns). Add a `wiki.mjs list-entities --filter updated:>=<date>` (or similar) batch path that returns matching slugs in a single call.

**Why deferred:** Subprocess cost is real but only bites at scale we don't yet have benchmarks for. Optimising before measuring is premature; revisit when a user reports `--since` slowness.

**Target milestone:** v0.10 or later.

### Goal D — Legacy YAML compatibility quirks

**Deferred from:** v0.9 review, Edge case hunter findings #2 and #8 (tab/CR escaping in flow-mapping values, unbalanced-brace inputs in hand-edited frontmatter).

**Scope:** The flow-mapping parser is now correct for the formats lumina-wiki itself produces. It is NOT robust against arbitrary hand-edited YAML — tabs/CRs inside string values are escaped on write but not all read paths handle the inverse round-trip from external editors that introduce these characters. Either harden the parser further or document "do not hand-edit `findings:` values" prominently.

**Why deferred:** Real-world frequency near zero. Findings are machine-written by `/lumi-verify`; hand editing is a rare path. The current parser handles the formats lumina-wiki produces; expanding to "any YAML editor's quirks" is a much larger swamp.

**Target milestone:** Not scheduled. Track only if a user reports it.

### Goal E — `--single` fallback tier (single-pass reviewer)

**Deferred from:** v0.9 spec design notes (mentioned as fallback option but not implemented).

**Scope:** A `--single` opt-in flag that runs exactly one reviewer with full context (no anti-anchoring, no parallel sub-agents). Documented as the weakest tier for users who explicitly accept the tradeoff.

**Why deferred:** Adds prompt complexity for a tier we expect almost no one to use. Most runtimes that don't support Agent will hit the prompt-files-paste-back fallback first; `--single` is the third tier and rarely needed. Re-evaluate after dogfooding.

**Target milestone:** v0.10 or later, only if dogfooding surfaces demand.
