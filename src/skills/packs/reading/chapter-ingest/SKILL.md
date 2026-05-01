---
name: lumi-chapter-ingest
description: >
  Ingest one book chapter into the wiki and extract character mentions, theme tags, and
  plot beats into the graph. Use whenever the user wants to ingest, file, or process a
  chapter — including phrasings like "I just finished chapter 3", "add this chapter to the
  wiki", "file chapter 2 of [book]", or "track what happened in chapter 5".
---

# /lumi-chapter-ingest

## TL;DR

Turns one chapter (raw text or PDF page range) into a `wiki/chapters/<book-slug>/` page,
seeds character stubs, records theme tags, writes plot beats, and registers bidirectional
edges — all idempotently. Re-running against the same slug is always safe.

## When to use

Invoke when the user hands you a book chapter — either as raw text pasted inline, a
file path under `raw/`, or a PDF with a page range (e.g. `raw/sources/gatsby.pdf 12-34`).
This skill writes the chapter page, seeds character stubs, records theme tags, and
registers plot beats. It is designed to be run once per chapter and is fully idempotent:
re-running against the same chapter slug produces byte-identical output.

## Inputs

- `<book-slug>` — kebab-case identifier for the book. All reading-pack pages for this book
  live under `<book-slug>/` subdirectories. Namespacing is mandatory: a workspace may hold
  multiple books and the same character name must not collide across books.
- `<chapter-reference>` — one of:
  - Raw text (pasted or piped)
  - A file path: `raw/sources/<book-slug>/<filename>`
  - A PDF page range: `raw/sources/<book-slug>.pdf <start>-<end>`
- `<chapter-number>` — integer (1-based). Stored as `number:` in frontmatter; used by
  plot-recap for spoiler-boundary ordering.
- `<chapter-title>` — human-readable title (converted to slug automatically).

## Workflow

### Playbook A: Raw text input

1. Receive text. Run `node _lumina/scripts/wiki.mjs slug "<chapter-title>" --json` to get
   the canonical slug. Chapter page path: `wiki/chapters/<book-slug>/<chapter-slug>.md`.
2. Check idempotency: if the page already exists, read its frontmatter with
   `node _lumina/scripts/wiki.mjs read-meta chapters/<book-slug>/<chapter-slug> --json`.
   If `number`, `book`, and `title` match the current inputs, skip page creation and
   proceed directly to the edge-sync step (step 5). This ensures re-runs are no-ops.
3. If the chapter page is new, write the full markdown file with valid frontmatter
   and body via `Write`. For an existing page, update frontmatter with `set-meta`.
   Required fields: `id`, `title`, `type: chapter`, `created`, `updated`, `book`,
   `number`.
4. Extract from the chapter text:
   - **Character mentions**: proper nouns that appear as actors in the narrative. Create a
     stub entry for each new character (see character-track skill for full character pages).
   - **Theme tags**: 2-5 thematic labels (e.g. `isolation`, `class-conflict`, `memory`).
   - **Plot beats**: 3-7 one-sentence event summaries in narrative order.
5. Register edges using `node _lumina/scripts/wiki.mjs add-edge`:
   - For each character mentioned: `add-edge chapters/<book-slug>/<chapter-slug> features characters/<book-slug>/<character-slug>`
   - The engine writes the `appears_in` reverse edge automatically.
   - For each theme: `add-edge chapters/<book-slug>/<chapter-slug> tagged_with themes/<book-slug>/<theme-slug>`
   - The engine writes the `appears_in` reverse edge automatically.
6. Write plot beats into `wiki/plot/<book-slug>/ch<N>-beats.md` with valid plot
   frontmatter (`book`, `up_to_chapter: <N>`, etc.) and body.
7. Update `wiki/index.md` by appending the new chapter entry (log format: book, chapter
   number, slug, date).
8. Append one line to `wiki/log.md`:
   `## [YYYY-MM-DD] chapter-ingest | <book-slug> ch<N> "<chapter-title>" → <K> characters, <M> themes`
9. Self-verification: run `node _lumina/scripts/wiki.mjs read-edges chapters/<book-slug>/<chapter-slug> --json`
   and confirm that at least one `features` edge and one `tagged_with` edge are present.
   If either is missing, add the missing edges before finishing.

### Playbook B: PDF page range

Follow Playbook A steps, but in step 1 extract text from the PDF page range using `Read`
on the file and restrict your reading to the stated page range. If the PDF is not
machine-readable (scanned), inform the user and ask them to paste the text directly.

## Output / DoD

- `wiki/chapters/<book-slug>/<chapter-slug>.md` exists with valid frontmatter (id, title,
  type, created, updated, book, number).
- `wiki/characters/<book-slug>/<character-slug>.md` stub exists for each mentioned character.
- `wiki/themes/<book-slug>/<theme-slug>.md` stub exists for each tagged theme.
- `wiki/plot/<book-slug>/ch<N>-beats.md` exists with the chapter's plot beats.
- Bidirectional edges registered: `features`/`appears_in` and `tagged_with`/`appears_in`.
- `wiki/index.md` updated. `wiki/log.md` appended.
- Re-running this skill against the same chapter slug produces byte-identical files.

## Guardrails

- Use `Write` only when creating a new page with complete frontmatter. For frontmatter
  mutations on an existing page, use `wiki.mjs set-meta`.
- Do not pass `--book` to `add-edge`; the `<book-slug>` namespace is part of the slug
  path, e.g. `characters/<book-slug>/<character-slug>`.
- Do not infer character genders, ages, or relationships from a single chapter. Record
  only what the text states directly.
- Limit theme tags to 2-5 per chapter. Over-tagging dilutes theme pages.
- The `number` frontmatter field on the chapter page is the authoritative ordering key
  for plot-recap. Set it correctly; do not guess.

## Examples

<example>
Input: user pastes text of chapter 1 of "The Great Gatsby", book-slug `great-gatsby`,
chapter-number 1, title "In My Younger and More Vulnerable Years".
Action: slug -> `in-my-younger-and-more-vulnerable-years`.
Writes: `wiki/chapters/great-gatsby/in-my-younger-and-more-vulnerable-years.md` with
`number: 1`. Extracts characters Nick, Gatsby, Daisy, Tom, Jordan. Themes: `class`,
`the-american-dream`. Registers 5 `features` edges + 5 reverse `appears_in` edges.
Writes `wiki/plot/great-gatsby/ch1-beats.md`.
</example>

<example>
Input: same chapter, re-run.
Action: read-meta returns matching number/book/title -> skip page creation, run edge-sync
only -> add-edge calls return no-op (idempotent) -> byte-identical output confirmed.
</example>

<example>
Input: chapter 2 of the same book, introduces new character "Myrtle".
Action: creates `wiki/characters/great-gatsby/myrtle.md` stub (first_seen: ch2).
Adds `features`/`appears_in` edges. Existing character pages (Nick, Gatsby) are NOT
rewritten by this skill; character-track handles updates.
</example>

<example>
Input: `raw/sources/gatsby.pdf 35-67`, chapter 3, title "The Parties Begin".
Action: reads pages 35-67, follows Playbook B. If text is extractable, proceeds normally.
If scanned, responds: "This PDF appears to be scanned. Please paste the chapter text."
</example>
