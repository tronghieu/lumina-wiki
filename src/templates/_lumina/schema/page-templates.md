# Page Templates

Full YAML frontmatter templates and section structure for each wiki page type.
Managed by the Lumina installer. Open this file when README.md instructs.

---

## Source page — `wiki/sources/<slug>.md`

```yaml
---
id: source-slug       # bare kebab-case slug; must match the filename
title: "Full title here"
type: source
created: YYYY-MM-DD
updated: YYYY-MM-DD
authors:
  - Author Name
year: 2026
source_type: paper   # paper | article | book | podcast | note | other — free-form label, not schema-validated
importance: 3        # 1=niche  2=useful  3=field-standard  4=influential  5=seminal
provenance: missing  # replayable | partial | missing
confidence: high     # high | medium | low | unverified
tags: []             # free-form; not schema-validated
ranking:             # optional; written by /lumi-research-rank. Omit until the paper is ranked.
  # Flat map of scalars (one level only, like external_ids). Only include keys you have.
  influential_citations: 42   # Semantic Scholar influentialCitationCount
  citation_count: 318         # Semantic Scholar citationCount
  citation_source: semantic-scholar
  citation_fetched: YYYY-MM-DD
  venue_name: "NeurIPS"
  venue_tier: "CORE A*"       # free-form; agent-estimated, NOT authoritative
  venue_source: llm-estimated
  venue_estimated: YYYY-MM-DD
  scite_supporting: 12        # only when SCITE_API_KEY is set
  scite_contrasting: 1
  scite_mentioning: 64
  scite_fetched: YYYY-MM-DD
  altmetric_score: 287        # only when ALTMETRIC_API_KEY is set
  altmetric_fetched: YYYY-MM-DD
  quality_correctness: 4      # 4C rubric, 1-5 each (LLM-assessed)
  quality_clarity: 5
  quality_contribution: 4
  quality_context: 3
  quality_source: llm
  quality_assessed: YYYY-MM-DD
---
```

**Sections:**
- `## Summary` — 2–4 sentence abstract in your own words
- `## Key claims` — bulleted list of the source's central assertions
- `## Evidence` — notable data, experiments, or arguments supporting the claims
- `## Related concepts` — wikilinks to concept pages
- `## Related sources` — wikilinks to other source pages
- `## People` — wikilinks to person pages
- `## Open questions` — unanswered questions this source raises
- `## Ranking` — *(optional; managed by `/lumi-research-rank`)* human-readable influence signals and the 4C quality scorecard (Correctness, Clarity, Contribution, Context) with one-line rationales. Each figure states its source and date. The scorecard lives inside a managed region bounded by `<!-- lumina:ranking -->` and `<!-- /lumina:ranking -->`; only that region is rewritten on refresh. Free-text notes you add outside those markers (or inside `<!-- user-edited -->` markers) are preserved.
- `## Notes` — free-form notes (user-owned; mark with `<!-- user-edited -->` to preserve on upgrade)

---

## Concept page — `wiki/concepts/<slug>.md`

```yaml
---
id: concept-slug        # bare kebab-case slug; must match the filename
title: "Concept name"
type: concept
created: YYYY-MM-DD
updated: YYYY-MM-DD
key_sources: []         # wikilink slugs of sources that introduce or use this concept
related_concepts: []   # wikilink slugs of related concepts
confidence: high        # high | medium | low | unverified
tags: []                # free-form; not schema-validated
---
```

**Sections:**
- `## Definition` — one-paragraph plain-language definition
- `## Variants` — named variations with brief descriptions
- `## Key sources` — wikilinks to sources that introduce or use this concept
- `## Related concepts` — wikilinks
- `## Mentioned in` — summaries and outputs that reference this concept
- `## Notes`

---

## Person page — `wiki/people/<slug>.md`

```yaml
---
id: person-slug          # bare kebab-case slug; must match the filename
title: "Person Name"
type: person
created: YYYY-MM-DD
updated: YYYY-MM-DD
key_sources: []          # wikilink slugs of sources authored by or featuring this person
affiliations: []         # optional; list of affiliations
tags: []                 # free-form; not schema-validated
---
```

**Sections:**
- `## Overview` — one paragraph on this person's relevance to the wiki
- `## Key sources` — sources authored by or featuring this person
- `## Key concepts` — concepts strongly associated with this person
- `## Notes`

---

## Summary page — `wiki/summary/<slug>.md`

```yaml
---
id: summary-slug         # bare kebab-case slug; must match the filename
title: "Area summary title"
type: summary
created: YYYY-MM-DD
updated: YYYY-MM-DD
covers: []               # wikilink slugs of the sources and concepts this summary synthesizes
tags: []                 # free-form; not schema-validated
---
```

**Sections:**
- `## Overview` — 3–5 sentences orienting a reader new to this area
- `## Key themes` — recurring patterns across sources in this area
- `## Sources covered` — wikilinks
- `## Key concepts` — wikilinks
- `## Open questions` — synthesis-level questions
- `## Notes`

---

## Reading note — `wiki/readings/<source-slug>/<nn>-<unit-slug>.md`

Written by `/lumi-ingest` for long sources (books, theses, 50+ page documents),
one note per chapter/part. The source page links to its notes through
`annotated_by` connections; notes are not listed in `wiki/index.md`.

```yaml
---
id: readings/<source-slug>/<nn>-<unit-slug>
title: "Part N: Title (pp. from–to)"
type: reading
created: YYYY-MM-DD
updated: YYYY-MM-DD
source: source-slug
part: N
pages: "from-to"     # optional; omit for sources without page numbers
---
```

**Sections:**
- Opening line (before any heading): `Part N of [[sources/<source-slug>]] (pp. from–to).` — the body wikilink keeps the note reachable and non-orphaned
- `## Question this unit answers` — the one question the chapter/part addresses
- `## Key terms` — terms the author defines or uses in a special sense, with page cites
- `## Propositions` — the unit's leading claims, each with a page cite
- `## Arguments` — premises → conclusion, page-cited
- `## Evidence` — data, examples, or experiments offered
- `## Quotes` — verbatim quotes only, each as `"exact words" (p. N)` — these are machine-checked against the source
- `## Tensions and links` — where this unit contradicts, extends, or depends on other units
- `## Open questions`
{{#if pack_research}}

---

## Topic page — `wiki/topics/<slug>.md` (research pack)

Created via `/lumi-research-topic`.

```yaml
---
id: topic-slug           # bare kebab-case slug; must match the filename
title: "Topic name"
type: topic
created: YYYY-MM-DD
updated: YYYY-MM-DD
key_sources: []          # wikilink slugs of sources included in this topic
tags: []                 # free-form; not schema-validated
---
```

**Sections:**
- `## Description`
- `## Key sources`
- `## Key concepts`
- `## Open questions`

---

## Foundation page — `wiki/foundations/<slug>.md` (research pack)

Terminal pages — receive inward links but do not write reverse links.

```yaml
---
id: foundation-slug      # bare kebab-case slug; must match the filename
title: "Foundation concept"
type: foundation
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: []                 # free-form; not schema-validated
aliases: []              # optional; alternate names for this foundation
---
```

**Sections:**
- `## Definition`
- `## Background`
- `## Notes`
{{/if}}
{{#if pack_reading}}

---

## Chapter page — `wiki/chapters/<book-slug>/<chapter-slug>.md` (reading pack)

```yaml
---
id: chapters/<book-slug>/<chapter-slug>
title: "Chapter N: Title"
type: chapter
created: YYYY-MM-DD
updated: YYYY-MM-DD
book: book-slug
number: N
---
```

**Sections:**
- `## Summary`
- `## Key events`
- `## Characters introduced`
- `## Themes`
- `## Notes`

---

## Character page — `wiki/characters/<book-slug>/<character-slug>.md` (reading pack)

```yaml
---
id: characters/<book-slug>/<character-slug>
title: "Character Name"
type: character
created: YYYY-MM-DD
updated: YYYY-MM-DD
book: book-slug
first_seen: chapters/<book-slug>/<chapter-slug>
---
```

**Sections:**
- `## Description`
- `## Role`
- `## Key relationships`
- `## Appearances` — wikilinks to chapters
- `## Notes`

---

## Theme page — `wiki/themes/<book-slug>/<theme-slug>.md` (reading pack)

```yaml
---
id: themes/<book-slug>/<theme-slug>
title: "Theme name"
type: theme
created: YYYY-MM-DD
updated: YYYY-MM-DD
book: book-slug
---
```

**Sections:**
- `## Description`
- `## Evidence` — chapters and scenes where this theme appears
- `## Related themes`
- `## Notes`

---

## Plot page — `wiki/plot/<book-slug>/ch<N>-beats.md` (reading pack)

Written by `/lumi-reading-chapter-ingest` — one plot-beats page per chapter, holding
the chapter's events in narrative order so `/lumi-reading-plot-recap` can build
spoiler-safe recaps from them.

```yaml
---
id: plot/<book-slug>/ch<N>-beats
title: "Plot beats: Chapter N"
type: plot
created: YYYY-MM-DD
updated: YYYY-MM-DD
book: book-slug
up_to_chapter: N
---
```

**Sections:**
- `## Beats` — 3-7 one-sentence event summaries, in narrative order
- `## Notes`
{{/if}}
{{#if pack_learning}}

---

## Reflection page — `wiki/reflections/<slug>.md` (learning pack)

Created and updated via `/lumi-learning-reflect`. AI never writes reflection content.

```yaml
---
id: reflection-<slug>
title: "My understanding of <Concept Name>"
type: reflection
created: YYYY-MM-DD
updated: YYYY-MM-DD
related_concepts:
  - concept-slug
related_sources:
  - source-slug
evolution_count: 1
---
```

**Sections:**
- `## Current understanding` — **rewritable**: the user's latest thinking in their own words; AI may quote past versions to prompt reflection but never edits this section
- `## Evolution` — **append-only**: one dated entry per reflection session; never edit or delete entries

**Evolution entry format:**
```markdown
### YYYY-MM-DD — <brief label>
<What you wrote or changed in this session (1–3 sentences)>
```

**Boundary rule:** Reflection pages are **personal overlay** — they reference academic pages via frontmatter only (no wikilinks that create graph edges). Do not write `[[concept-slug]]` inline body links; reference concepts only in `related_concepts:` frontmatter. No reverse link is required from concept/source pages back to reflections.
{{/if}}
