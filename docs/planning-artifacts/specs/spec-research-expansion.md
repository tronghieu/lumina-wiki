---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'refined'
---

# Spec: Research Source & Discovery Expansion

## Outcome
Establish a reliable, multi-source ingestion and discovery pipeline that resolves persistent identifiers (DOIs) to full-text PDFs and monitors high-signal external feeds (RSS/Blogs) to proactively identify new research.

## High-Level Intent
- **Namespaced ID Architecture**: Transition to a structured `external_ids` object in `schemas.mjs` to prevent ID collisions. Active namespaces: `doi`, `arxiv`, `s2`, `url` (canonical form, used for dedup). Reserved for later phases: `openalex` (lands with the OpenAlex fetcher), `isbn`, `s2_corpus`.
- **Full-Text Fallback Ladder**: Implement a deterministic resolution chain: DOI → OpenAlex → Unpaywall → CORE.
- **Discovery Channel Expansion (RSS/Feeds)**:
  - Treat RSS/Atom feeds as proactive triggers for the discovery flow.
  - Extend `/lumi-research-discover` to poll journal feeds and AI lab blogs.
  - Automatically extract DOIs or identifiers from feed content to bridge with the ingestion pipeline.
- **Unified Watchlist**: Consolidate keyword-based ArXiv queries and URL-based RSS feeds into a single `_lumina/config/watchlist.yml`.

## Phasing

This spec ships in phases. A phase lands when its acceptance items are merged; later phases may refine earlier ones.

- **Phase 1 — Schema & helpers** (foundation): AC1a, AC5a.
- **Phase 2 — Multi-provider fetchers**: AC1b, AC2, AC4.
- **Phase 3 — RSS & watchlist**: AC3, AC5b, watchlist consolidation.

Phase boundaries are guidance, not contracts — splitting or merging phases during implementation is fine if rationale is captured in the PR description.

## Acceptance Criteria

1. **Schema Support**:
   - **(1a, phase 1)** `schemas.mjs` updated with `external_ids` object on Source pages. Active namespaces: `doi`, `arxiv`, `s2`, `url`. Validation, lint coverage, and a Node↔Python parity fixture for ID helpers.
   - **(1b, phase 2)** A `sources[]` provenance array on Source pages tracking which provider returned each ID (e.g. `{ns, value, via, fetched_at}`). Lands together with the first multi-provider fetcher so there is real provenance to record.
2. **Multi-Provider Fetchers (phase 2)**: Standalone Python tools for OpenAlex, Unpaywall, and CORE providing standardized JSON outputs. The `openalex` namespace is added to the active registry in this phase.
3. **RSS Integration (phase 3)**: A `fetch_rss.py` tool that enables `/lumi-research-discover` to ingest feed items into the discovery shortlist.
4. **Resolution Logic (phase 2)**: `/lumi-ingest` can take an extracted DOI/ArXiv ID from a feed and execute the fallback ladder to fetch full-text.
5. **State Management**:
   - **(5a, phase 1)** `_lumina/_state/discovery-runner.json` dedup uses expanded `external_ids` so the same paper surfaced via different namespaces (e.g. arxiv ID vs. its DOI form) is recognised as one candidate.
   - **(5b, phase 3)** Dedup extends to RSS-based candidates alongside API-based ones.
