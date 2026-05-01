---
name: lumi-research-survey
description: >
  Produce a grounded survey from existing wiki sources, concepts, and graph
  edges. Writes a summary page only when the user asks to save the survey.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-survey

## Role

You synthesize what the wiki already knows into a survey-style narrative. You do
not discover or ingest new sources here; gaps should be reported explicitly.

## Context

Read `README.md` first. Use `_lumina/scripts/wiki.mjs` for entity and graph
queries:

```bash
node _lumina/scripts/wiki.mjs list-entities --type sources
node _lumina/scripts/wiki.mjs list-entities --type concepts
node _lumina/scripts/wiki.mjs read-meta sources/<slug>
node _lumina/scripts/wiki.mjs read-edges sources/<slug>
```

## Instructions

1. Identify the topic scope and the source/concept pages that support it.
2. Read only relevant wiki pages and graph edges.
3. Synthesize the survey with cited source references and a section for gaps or
   unresolved disagreements.
4. If the user asks to save it, write `wiki/summary/<survey-slug>.md` with valid
   summary frontmatter and link the covered pages.
5. Log the saved survey:

```bash
node _lumina/scripts/wiki.mjs log lumi-research-survey "saved survey <survey-slug>"
```

## Constraints

- Do not read raw source files unless the user explicitly asks for a gap audit.
- Do not create new source or concept pages.
- Do not claim coverage beyond the current wiki graph.
