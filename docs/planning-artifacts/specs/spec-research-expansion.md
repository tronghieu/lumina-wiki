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
- **Namespaced ID Architecture**: Transition to a structured `external_ids` object (doi, openalex, arxiv, s2, url) in `schemas.mjs` to prevent ID collisions. `url` is a post-spec extension carried over from the arxiv-only era; `openalex` is reserved and lands with the OpenAlex fetcher (AC2).
- **Full-Text Fallback Ladder**: Implement a deterministic resolution chain: DOI → OpenAlex → Unpaywall → CORE.
- **Discovery Channel Expansion (RSS/Feeds)**:
  - Treat RSS/Atom feeds as proactive triggers for the discovery flow.
  - Extend `/lumi-research-discover` to poll journal feeds and AI lab blogs.
  - Automatically extract DOIs or identifiers from feed content to bridge with the ingestion pipeline.
- **Unified Watchlist**: Consolidate keyword-based ArXiv queries and URL-based RSS feeds into a single `_lumina/config/watchlist.yml`.

## Acceptance Criteria
1. **Schema Support**: `schemas.mjs` updated with `external_ids` mapping and a `sources` array for provenance tracking.
2. **Multi-Provider Fetchers**: Standalone Python tools for OpenAlex, Unpaywall, and CORE providing standardized JSON outputs.
3. **RSS Integration**: A `fetch_rss.py` tool that enables `/lumi-research-discover` to ingest feed items into the discovery shortlist.
4. **Resolution Logic**: `/lumi-ingest` can take an extracted DOI/ArXiv ID from a feed and execute the fallback ladder to fetch full-text.
5. **State Management**: Use `_lumina/_state/discovery-runner.json` to deduplicate both API-based and RSS-based candidates.
