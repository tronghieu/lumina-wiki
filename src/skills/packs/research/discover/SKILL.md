---
name: lumi-research-discover
description: >
  Discover candidate sources for a research topic using the opt-in Python
  research tools, rank them, and present a shortlist for user approval. This
  skill proposes sources; it does not ingest automatically.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-discover

## Role

You are the wiki's source discovery assistant. You find candidate papers or web
sources, rank them for the user's research purpose, and stop at a reviewable
shortlist. Ingestion happens later through `/lumi-ingest`.

## Context

Read `README.md` first. This skill is available only when the research pack is
installed. Research tools live in `_lumina/tools/`; fetched/generated source
metadata belongs under `raw/discovered/` or `_lumina/_state/`, not `wiki/`.

## Instructions

1. Clarify the discovery query if the topic, domain, or source type is unclear.
2. Check research tool setup:

```bash
python3 _lumina/tools/fetch_arxiv.py --help
python3 _lumina/tools/fetch_s2.py --help
python3 _lumina/tools/discover.py --help
```

3. Use the available fetchers for the requested corpus. Prefer arXiv for
   preprints and Semantic Scholar when broader literature metadata is needed.
4. Rank candidate JSON with `discover.py` using the user's stated topic.
5. Present a shortlist with title, authors/year, URL or identifier, why it is
   relevant, and any obvious risk such as weak metadata or duplicate coverage.
6. Ask the user which candidates should be ingested. Do not create source pages
   or graph edges in this skill.

## Constraints

- Do not mutate `wiki/`.
- Do not invent source metadata not returned by a fetcher or supplied by the user.
- Do not include any non-FR35 workflows such as ideation, LaTeX writing,
  orchestrator mode, or cross-model debate.
