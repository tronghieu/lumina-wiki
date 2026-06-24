---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'implemented'
shipped_in: '1.7.0'
shipped_date: '2026-06-16'
---

# Spec: Paper Ranking & Quality Scoring

## Outcome
Transform the wiki from a passive collection of papers into an active, prioritized research backlog by surfacing quantitative influence signals and structured qualitative assessments.

## High-Level Intent
- **4C Qualitative Rubric**: Implement a standardized evaluation model for agents:
  - **Correctness**: Methodological integrity and lack of obvious flaws.
  - **Clarity**: Logical flow and presentation quality.
  - **Contribution**: Novelty and impact on the field.
  - **Context**: Quality of citations and relationship to prior work.
- **Three-Pass Analysis**: Guide agents to perform a shallow overview (Pass 1) before deep qualitative scoring (Pass 2/3) to manage context usage.
- **Venue Prestige**: Surface the reputation of the conference or journal using **CORE Rankings** (for CS/AI) and **SJR/JCR** (for Journals).
- **Influence Metrics**: Distinguish between raw citation counts and **Influential Citations** (via Semantic Scholar).

## Acceptance Criteria
1. **Skill Implementation**: New skill `/lumi-rank` that processes paper slugs to generate or update ranking blocks.
2. **Python Plugin Architecture**: Individual ranking fetchers (`fetch_scite.py`, `fetch_altmetric.py`) implemented as standalone Python tools to maintain core stability.
3. **Quantitative Integration**:
   - Surface **Influential Citation Count** from S2.
   - Surface **Support vs. Contrast** tallies from Scite.ai (gated by API key).
   - Lookup and record **Venue Prestige** (e.g., "CORE A*", "SJR Q1").
4. **Qualitative Scorecard**: A structured, human-readable section appended to the paper note (respecting `<!-- user-edited -->`) containing the 4C rubric scores.
5. **Transparency & Provenance**: All scores (LLM-generated or API-fetched) must explicitly state their source and timestamp in the frontmatter `ranking:` block.

## Implementation Notes (shipped v1.7.0, 2026-06-16)

Delivered against the acceptance criteria, with two scoped decisions:

- **Skill name**: shipped as `/lumi-research-rank` (not `/lumi-rank`) to match the
  established `lumi-research-*` research-pack naming convention.
- **Signals**: Semantic Scholar influential-citation count is the always-on
  quantitative signal (reuses `fetch_s2.py`, no key required). `fetch_scite.py`
  and `fetch_altmetric.py` ship as **optional, key-gated** plugins (`SCITE_API_KEY`,
  `ALTMETRIC_API_KEY`) that exit cleanly and are skipped when no key is set.
- **Venue prestige**: recorded from the agent's own knowledge and explicitly
  flagged `venue_source: llm-estimated` with a timestamp — no live API and no
  bundled CORE/SJR dataset (deferred). The 4C rubric and three-pass reading guide
  ship as skill references.
- **Frontmatter**: the `ranking:` block is a **flat one-level map of scalars**
  (mirroring `external_ids`) so it round-trips through `wiki.mjs set-meta`; the
  source schema gains an optional `ranking` object field. A human-readable
  `## Ranking` section carries rationales and respects `<!-- user-edited -->`.

Deferred: bundled venue-prestige dataset, a dedicated lint check for the
`ranking` block shape, and wiring ranking into the `/lumi-research-discover`
shortlist flow.
