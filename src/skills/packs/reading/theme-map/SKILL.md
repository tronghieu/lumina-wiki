---
name: lumi-reading-theme-map
description: >
  Build and maintain thematic cluster pages in wiki/themes/<book-slug>/ by linking
  themes to the chapters and characters they appear in. Use whenever the user wants to
  analyze, map, or update themes — including phrasings like "map out the themes",
  "cluster the themes after chapter 5", "what themes appear across the book",
  "theme analysis", or "update theme pages".
---

# /lumi-reading-theme-map

## TL;DR

Creates and updates `wiki/themes/<book-slug>/<theme-slug>.md` pages by clustering
theme tags already applied by chapter-ingest into coherent cross-chapter themes, then
linking each theme to its chapters and the characters associated with it.

A theme page is only created when a theme tag appears in at least two chapters — a
single-chapter tag is not yet a theme; it is a local observation. This threshold keeps
theme pages meaningful and prevents noise.

## Context

Read `README.md` at the project root for the full schema. Theme pages live under
`wiki/themes/<book-slug>/` — namespaced per book. Themes link to chapters via
`tagged_with`/`appears_in` edges (written by chapter-ingest) and to characters via
`associated_with`/`expresses_theme` edges (written by this skill).

Theme stubs are seeded by chapter-ingest; this skill promotes stubs to full pages and
updates them as more chapters are ingested.

## Inputs

- `<book-slug>` — the book to operate on.
- Optional `--from-chapter <N>` — only process theme tags from chapters numbered >= N.
  Useful for incremental updates after reading a batch of new chapters.
- No chapter cursor required: theme-map is not spoiler-sensitive. It operates on all
  ingested chapters unless explicitly restricted.

## Workflow

### Step 1 — Collect all theme stubs for the book

```bash
node _lumina/scripts/wiki.mjs list-entities themes/<book-slug> --json
```

For each theme slug found, read its `appears_in` edges to discover which chapters
link to it:

```bash
node _lumina/scripts/wiki.mjs read-edges --from themes/<book-slug>/<theme-slug> --type appears_in --json
```

### Step 2 — Apply the two-chapter threshold

Count the chapters that link to each theme. If the count is:
- **< 2**: leave the stub as-is. Do not write a full theme page. Note these in the
  summary report as "pending themes (not yet a cross-chapter pattern)".
- **>= 2**: proceed to Step 3 for this theme.

The reasoning: a theme tagged in only one chapter might be a local motif rather than a
structural theme. Waiting for a second chapter confirmation prevents over-clustering.

### Step 3 — Write or update the theme page

For each theme that meets the threshold:

1. Check if a full theme page exists or only a stub:
   ```bash
   node _lumina/scripts/wiki.mjs read-meta themes/<book-slug>/<theme-slug> --json
   ```

2. Update frontmatter via `set-meta`:
   ```bash
   node _lumina/scripts/wiki.mjs set-meta themes/<book-slug>/<theme-slug> updated YYYY-MM-DD
   ```
   Required frontmatter fields (see README.md): `id`, `title`, `type: theme`, `created`,
   `updated`, `book`.

3. Write (or rewrite) the theme page body with these sections:
   - `## Definition` — one paragraph explaining what this theme means in the context of
     this book. Stay grounded in the text; do not import external literary theory.
   - `## Chapters` — wikilinks to every chapter where this theme appears, with a one-line
     note per chapter on how the theme manifests.
   - `## Characters` — list the characters most associated with this theme.
   - `## Open Questions` — aspects of the theme not yet resolved by the ingested chapters.

   Writing the body is moderate-risk (rewrites the theme page). For bulk re-clustering
   (rewriting 5+ theme pages at once), confirm with the user before proceeding.

### Step 4 — Link themes to characters

For each character who appears in 2+ chapters sharing this theme, register an
association edge:

```bash
node _lumina/scripts/wiki.mjs add-edge themes/<book-slug>/<theme-slug> associated_with characters/<book-slug>/<character-slug>
node _lumina/scripts/wiki.mjs add-edge characters/<book-slug>/<character-slug> expresses_theme themes/<book-slug>/<theme-slug>
```

Use judgment: not every character in a chapter expresses every theme. Link only when
the character's role is central to the theme's manifestation in that chapter.

### Step 5 — Self-verification

After writing all theme pages, verify the threshold invariant:

```bash
node _lumina/scripts/wiki.mjs read-edges --from themes/<book-slug>/<theme-slug> --type appears_in --json
```

Every promoted theme page must have `>= 2` `appears_in` edges. If any page has only
one, it was promoted prematurely — revert to stub status and note in the report.

## Output / Definition of Done

- Every theme that appears in >= 2 chapters has a full page under `wiki/themes/<book-slug>/`.
- Each theme page has bidirectional links: `tagged_with`/`appears_in` to chapters,
  `associated_with`/`expresses_theme` to characters.
- Theme stubs for single-chapter tags remain as stubs (not promoted).
- `wiki/log.md` has a new entry:
  `## [YYYY-MM-DD] theme-map | <book-slug> → <K> themes promoted, <M> stubs pending`

## Guardrails

- Require user confirmation before bulk re-clustering (rewriting >= 5 theme pages).
  Single-page updates are safe; mass updates are risky because they rewrite multiple
  wiki pages atomically.
- Use `Write` only to create a new theme stub with complete frontmatter. For
  frontmatter mutations on an existing page, use `wiki.mjs set-meta`.
- Do not create theme pages from single-chapter evidence. The two-chapter threshold is
  the quality gate.
- Do not pass `--book` to `add-edge`; the `<book-slug>` namespace is part of the slug
  path.

## Examples

<example>
Input: user says "map themes for great-gatsby after all 5 chapters".
Action: list-entities themes/great-gatsby. Find stubs: class, the-american-dream,
isolation, love, illusion. Read appears_in edges for each.
class: 4 chapters -> promote. the-american-dream: 3 chapters -> promote.
isolation: 1 chapter -> leave as stub. love: 2 chapters -> promote.
illusion: 2 chapters -> promote. Write 4 theme pages. Report 1 stub pending.
</example>

<example>
Input: user says "what themes link to gatsby the character?".
Action: read-edges --from characters/great-gatsby/gatsby --type expresses_theme --json.
Report results. Read-only query; no writes.
</example>

<example>
Input: user says "re-cluster all themes from scratch" (5 theme pages would be rewritten).
Action: this is a bulk update. Before proceeding, report: "This will rewrite 5 theme
pages. Confirm?" Wait for user confirmation before writing.
</example>

<example>
Input: chapter 3 has been ingested with a new tag `mortality`. Only one chapter uses it.
Action: leave wiki/themes/great-gatsby/mortality.md as a stub. Note in summary:
"mortality: 1 chapter (pending second occurrence to promote)".
</example>
