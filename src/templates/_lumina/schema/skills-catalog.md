# Lumina — Skills Catalog

One-line summary of every skill installed in this workspace. Read by `/lumi-help skills` to give users a map of what's available.

The runtime manifest at `_lumina/manifest.json` is the source of truth for *which* packs are installed; this file is the source of truth for *what each skill does*.

## Core (always installed)

- `/lumi-init` — bootstrap a wiki from existing `raw/` content
- `/lumi-ingest` — read a source and write a wiki page (drafts shown for review, then continues unless judgment is needed)
- `/lumi-ask` — query the wiki, synthesize an answer, optionally file a page
- `/lumi-edit` — add, remove, or revise wiki content
- `/lumi-check` — lint: broken links, orphans, missing reverse links
- `/lumi-reset` — scoped destructive cleanup (never touches `raw/`)
- `/lumi-verify` — flag wiki claims that diverge from cited sources (never auto-edits)
- `/lumi-help` — orient yourself; recommend the next action
{{#if pack_research}}

## Research pack

- `/lumi-research-discover` — ranked candidate shortlist of new sources
- `/lumi-research-watchlist` — choose topics for scheduled discovery
- `/lumi-research-survey` — narrative synthesis across a topic's sources
- `/lumi-research-prefill` — seed `foundations/` to prevent concept duplication
- `/lumi-research-topic` — cluster concepts and sources into a thematic topic page
- `/lumi-research-setup` — interactive API key configuration
{{/if}}{{#if pack_reading}}

## Reading pack

- `/lumi-reading-chapter-ingest` — file a chapter; update characters/themes/plot pages
- `/lumi-reading-character-track` — build or refresh a character profile across chapters
- `/lumi-reading-theme-map` — trace a theme across chapters with citations
- `/lumi-reading-plot-recap` — spoiler-bounded plot summary up to a chapter
{{/if}}
