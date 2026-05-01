---
name: lumi-reading-character-track
description: >
  Maintain character pages in wiki/characters/<book-slug>/ and update inter-character
  relationship edges as new chapters are ingested. Use whenever the user wants to update
  or review character information — including phrasings like "update character profiles
  after chapter 4", "add the relationship between Alice and Bob", "who has Alice met so
  far", "track character appearances", or "refresh character pages".
---

# /lumi-reading-character-track

## TL;DR

Updates `wiki/characters/<book-slug>/<character-slug>.md` pages with new chapter
appearances and inter-character relationship edges after a chapter has been ingested.
Run this after each chapter-ingest (or in batch after several chapters).

## Context

Read `README.md` at the project root for the full schema. Character pages live under
`wiki/characters/<book-slug>/` — the book-slug namespace is mandatory because a workspace
may hold multiple books and the same character name must not collide across them.

Book namespaces are encoded in the slug path, e.g.
`characters/<book-slug>/<character-slug>`. See `README.md` for the full edge-type
vocabulary; the reading-pack inter-character edge used here is `appears_with`
(symmetric, stored once).

## Inputs

- `<book-slug>` — kebab-case identifier for the book.
- `<chapter-slug>` or `--all` — which chapter(s) to process appearances from. If the
  user says "update characters after chapter 4", use that chapter's slug. If no chapter
  is specified, scan all chapter pages for this book and update all character pages.

## Workflow

### Step 1 — Discover affected characters

List chapters to process:

```bash
node _lumina/scripts/wiki.mjs list-entities chapters/<book-slug> --json
```

For each target chapter, read the `features` edges to find character slugs:

```bash
node _lumina/scripts/wiki.mjs read-edges --from chapters/<book-slug>/<chapter-slug> --type features --json
```

### Step 2 — Update each character page

For each character found:

1. Check if the page already exists:
   ```bash
   node _lumina/scripts/wiki.mjs read-meta characters/<book-slug>/<character-slug> --json
   ```
   Exit 2 means not found — create a new stub (see chapter-ingest for stub format).
   If it exists, proceed to update.

2. Update the `updated` frontmatter field:
   ```bash
   node _lumina/scripts/wiki.mjs set-meta characters/<book-slug>/<character-slug> updated YYYY-MM-DD
   ```

3. Add an `appears_in` edge back to this chapter if not already present (chapter-ingest
   should have written it, but verify):
   ```bash
   node _lumina/scripts/wiki.mjs read-edges --from characters/<book-slug>/<character-slug> --type appears_in --json
   ```
   If the chapter is missing from the results, add it:
   ```bash
   node _lumina/scripts/wiki.mjs add-edge characters/<book-slug>/<character-slug> appears_in chapters/<book-slug>/<chapter-slug>
   ```

4. Write a prose `## Appearances` section update to the character's body — append the
   new chapter appearance with a one-line summary of what the character did.

### Step 3 — Register inter-character edges

Read the chapter text to identify which characters interact in this chapter. For each
pair that appears together in a scene:

```bash
# appears_with is symmetric — stored once with sorted endpoints
node _lumina/scripts/wiki.mjs add-edge characters/<book-slug>/<char-a> appears_with characters/<book-slug>/<char-b>
```

Do not infer relationships beyond what the chapter text states. Speculation belongs in
an `## Open Questions` section on the character page, not in edges.

### Step 4 — Self-verification

Run edge read for each updated character and confirm:

```bash
node _lumina/scripts/wiki.mjs read-edges --from characters/<book-slug>/<character-slug> --json
```

Every inter-character edge must use the `characters/<book-slug>/<character-slug>`
slug form. If any bare character slug appears, add the edge again with the namespaced
slug. The engine is idempotent: re-adding a correctly formed edge is a safe no-op.

## Output / Definition of Done

- Every character mentioned in the target chapter(s) has an up-to-date page under
  `wiki/characters/<book-slug>/`.
- Each character page has at least one `appears_in` edge back to a chapter.
- Inter-character `appears_with` edges are registered for all pairs that interact in
  the processed chapter(s).
- All inter-character edges use namespaced slugs.
- `wiki/log.md` has a new entry:
  `## [YYYY-MM-DD] character-track | <book-slug> ch<N> → <K> characters updated, <M> edges added`

## Guardrails

- Use `Write` only to create a new character stub with complete frontmatter. For
  frontmatter mutations on an existing page, use `wiki.mjs set-meta`.
- Do not overwrite existing character page body text; append only.
- Do not infer character attributes not stated in the text. Record only what is explicit.
- `appears_with` is symmetric — call `add-edge` once with the two character slugs in
  alphabetical order (the engine handles canonical storage), or call it either way;
  the engine will deduplicate.
- If a character appears in multiple books, their pages under different book-slugs are
  completely separate entities. Never cross-link them unless the user explicitly asks.

## Examples

<example>
Input: user says "update characters after chapter 2 of great-gatsby".
Action: read `features` edges from `chapters/great-gatsby/02-the-parties.md`.
Find: nick, gatsby, daisy, myrtle. Check each page. Update `updated` field. Append
"ch2: attends Gatsby's party" to Gatsby's ## Appearances. Register
`appears_with` edge between nick and gatsby (if not already present).
</example>

<example>
Input: user says "add the fact that Tom deceives Daisy in chapter 2".
Action: Append a note to Tom's character page. Do not create a graph edge unless the
schema defines an appropriate reading-pack edge type.
</example>

<example>
Input: user says "who has appeared with Gatsby so far?".
Action: `read-edges --from characters/great-gatsby/gatsby --type appears_with --json`.
Report the list. This is a read-only query — no edges are written.
</example>
