# Page Templates

Full YAML frontmatter templates and section structure for each wiki page type.
Managed by the Lumina installer. Open this file when README.md instructs.

---

## Source page — `wiki/sources/<slug>.md`

```yaml
---
type: source
title: "Full title here"
slug: source-slug
date_added: YYYY-MM-DD
authors:
  - Author Name
source_type: paper   # paper | article | book | podcast | note | other
importance: 3        # 1=niche  2=useful  3=field-standard  4=influential  5=seminal
confidence: high     # high | medium | low
tags: []
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
- `## Notes` — free-form notes (user-owned; mark with `<!-- user-edited -->` to preserve on upgrade)

---

## Concept page — `wiki/concepts/<slug>.md`

```yaml
---
type: concept
title: "Concept name"
slug: concept-slug
date_added: YYYY-MM-DD
confidence: high
tags: []
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
type: person
title: "Person Name"
slug: person-slug
date_added: YYYY-MM-DD
affiliation: ""
tags: []
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
type: summary
title: "Area summary title"
slug: summary-slug
date_added: YYYY-MM-DD
confidence: medium
tags: []
---
```

**Sections:**
- `## Overview` — 3–5 sentences orienting a reader new to this area
- `## Key themes` — recurring patterns across sources in this area
- `## Sources covered` — wikilinks
- `## Key concepts` — wikilinks
- `## Open questions` — synthesis-level questions
- `## Notes`
{{#if pack_research}}

---

## Topic page — `wiki/topics/<slug>.md` (research pack)

```yaml
---
type: topic
title: "Topic name"
slug: topic-slug
date_added: YYYY-MM-DD
tags: []
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
type: foundation
title: "Foundation concept"
slug: foundation-slug
date_added: YYYY-MM-DD
tags: []
aliases: []
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
{{/if}}
