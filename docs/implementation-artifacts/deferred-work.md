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
