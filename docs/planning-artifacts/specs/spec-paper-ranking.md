---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'refined'
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
