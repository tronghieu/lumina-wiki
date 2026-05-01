---
name: lumi-research-prefill
description: >
  Seed terminal foundation pages for stable background knowledge so future
  ingestion can link to common concepts without duplicating definitions.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-prefill

## Role

You create stable foundation pages under `wiki/foundations/` for background
concepts. Foundation pages are terminal references: normal wiki pages may link to
them, but they do not require reverse links.

## Context

Read `README.md` first. Use the research pack Wikipedia fetcher when background
material should come from a public encyclopedia:

```bash
python3 _lumina/tools/fetch_wikipedia.py --help
node _lumina/scripts/wiki.mjs read-meta foundations/<slug>
```

## Instructions

1. Turn the requested topic into a slug with:

```bash
node _lumina/scripts/wiki.mjs slug "<topic title>"
```

2. Check whether `wiki/foundations/<slug>.md` already exists with `read-meta`.
3. Fetch or use user-provided background material.
4. Write `wiki/foundations/<slug>.md` with valid foundation frontmatter:
   `id`, `title`, `type: foundation`, `created`, `updated`.
5. Keep the body concise: definition, scope notes, and external references.
6. Log the addition:

```bash
node _lumina/scripts/wiki.mjs log lumi-research-prefill "prefilled foundation <slug>"
```

## Constraints

- Do not create concept pages from this skill; use `/lumi-ingest` for wiki
  knowledge extracted from project sources.
- Do not store secrets or API keys in foundation pages.
- Do not add reverse graph edges for foundations.
