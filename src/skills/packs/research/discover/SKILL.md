---
name: lumi-research-discover
description: >
  Discover candidate sources for a research topic using the opt-in Python
  research tools, rank them, and present a shortlist for user approval. This
  skill proposes sources; it does not ingest automatically.
allowed-tools:
  - Bash
  - Read
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

References:
- Read `references/source-modes.md` before choosing `topic`, `anchor`, or
  `from-wiki`.
- Read `references/ranking-signals.md` before deduping, ranking, or
  checkpointing a shortlist.

## Instructions

1. Clarify the discovery query if the topic, domain, or source type is unclear.
2. Check research tool setup:

```bash
python3 _lumina/tools/init_discovery.py --help
python3 _lumina/tools/fetch_arxiv.py --help
python3 _lumina/tools/fetch_s2.py --help
python3 _lumina/tools/fetch_wikipedia.py --help
python3 _lumina/tools/fetch_deepxiv.py --help
python3 _lumina/tools/discover.py --help
```

3. Pick one seed mode from `references/source-modes.md`: `topic`, `anchor`, or
   `from-wiki`. Use only the documented commands and flags.
4. Deduplicate candidates against existing wiki/discovered/checkpoint state using
   `references/ranking-signals.md`.
5. Rank candidate JSON with `discover.py --topic "<topic>"`; preserve returned
   `_score`, then add a human-readable rationale and risk note.
6. Present a checkpointed shortlist with title, authors/year, URL or identifier,
   `_score`, rationale, duplicate status, and recommended next action.
7. Ask the user which candidates should be ingested. Do not create source pages
   or graph edges in this skill.

## Constraints

- Do not mutate `wiki/`.
- Do not invent source metadata not returned by a fetcher or supplied by the user.
- Do not invent tool flags. Use only `--topic`, `--project-root`, `--phases`,
  `--resume`, `--fetchers`, and `--limit` for `init_discovery.py`.
- Do not include any non-FR35 workflows such as ideation, LaTeX writing,
  orchestrator mode, or cross-model debate.

## Definition of Done

- Shortlist is deduped against wiki sources and discovered state.
- Every shortlisted item includes `_score`, rationale, and risk/duplicate note.
- Discovery checkpoints or an explicit resume decision are reflected in the
  response.
- No `wiki/` files, index entries, graph edges, or log entries are written.
