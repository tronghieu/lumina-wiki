# Deferred Work

## Promoted out of deferred (record only)

- **Goal B — `/lumi-ingest` workflow rewrite (multi-step with HITL gates)** — originally split out of v0.9 on 2026-05-04, then promoted back into v0.9 scope on 2026-05-04 by user decision. The verify and ingest-workflow features now ship together in v0.9. New scope captured in a sibling spec: `spec-v0-9-ingest-workflow.md`.

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
