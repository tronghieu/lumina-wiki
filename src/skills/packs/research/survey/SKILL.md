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

Read `README.md` first. Survey pages live under `wiki/summary/` and use the
same frontmatter contract as any other summary page: `id`, `title`,
`type: summary`, `created`, `updated`, and `covers` (an array of every wiki
page slug the survey draws on). `covers` is required — a summary page without
it fails lint (L01).

When speaking with the user, follow the README language rule exactly. Use the
configured communication language and avoid technical tool words unless the
user asks for them.

## Instructions

1. Identify the topic scope and the source/concept pages that support it. Ask
   the user a clarifying question if the scope is ambiguous rather than
   guessing.

2. Read only relevant wiki pages and graph edges:

```bash
node _lumina/scripts/wiki.mjs list-entities --type sources
node _lumina/scripts/wiki.mjs list-entities --type concepts
node _lumina/scripts/wiki.mjs read-meta sources/<slug>
node _lumina/scripts/wiki.mjs read-edges sources/<slug>
```

3. Synthesize the survey in chat. Cite every claim to a wiki page
   (`[[sources/<slug>]]` or `[[concepts/<slug>]]`) and add an explicit gaps
   section naming what the wiki does not yet cover or where sources disagree.
   This is a draft — do not write any file yet.

4. Ask the user whether to save the survey. Do not write
   `wiki/summary/<slug>.md` until the user explicitly asks to save it. If the
   user only wanted an answer in chat, stop here.

5. If the user asks to save, generate the slug:

```bash
node _lumina/scripts/wiki.mjs slug "<survey title>"
```

6. Check whether `wiki/summary/<slug>.md` already exists:

```bash
node _lumina/scripts/wiki.mjs read-meta summary/<slug>
```

   - **exit 2 (not found)** — continue to step 7.
   - **exit 0 (exists)** — read the file, then show the user the `title` and
     `created` date. Ask exactly one question with three options in the user's
     language (no other action until answered). Explain the choices plainly:

     ```
     Survey "<title>" already exists.
       [s] skip    — abort, no changes (default)
       [r] refresh — replace the survey body with the new draft; preserve `created` and `<!-- user-edited -->` sections
       [a] abort   — same as skip but log the user's intent
     ```

     Map blank/Enter to `skip`. Do not proceed without an explicit choice.

7. Write `wiki/summary/<slug>.md` with valid summary frontmatter and the two
   standard sections. Use today's date for both `created` and `updated` on a
   new page; on a refresh keep the original `created` date. `covers` must list
   every wiki page slug the survey cites — omitting it is the most common way
   this skill fails lint.

   ```markdown
   ---
   id: <slug>
   title: "<Survey Title>"
   type: summary
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   covers:
     - sources/<slug>
     - concepts/<slug>
     - ...
   ---

   ## Survey

   <!-- The narrative synthesis, written in document_output_language, with
        inline [[wikilinks]] to every cited page. -->

   ## Gaps

   <!-- Bullet list of what the wiki does not yet cover, or where sources
        disagree. Keep the section even when empty — write "none identified"
        rather than omitting it. -->
   ```

8. Log the saved survey:

```bash
node _lumina/scripts/wiki.mjs log research-survey "saved survey <slug>"
```

   On a refresh, write `"refreshed survey <slug> ..."` instead.

9. Run lint with fix so `wiki/index.md` and structural checks stay current:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

   If `summary.errors > 0`, read the lint output, address each error, and
   re-run before telling the user the skill is done.

10. Suggest `/lumi-check` in a fresh session or via a subagent after saving. A
    blank context catches bias from the reasoning chain that just wrote the
    survey.

## Constraints

- Do not read raw source files unless the user explicitly asks for a gap audit.
- Do not create new source or concept pages.
- Do not claim coverage beyond the current wiki graph.
- Do not write `wiki/summary/<slug>.md` before the user explicitly asks to
  save the survey — an unsaved survey lives only in the chat response.
- When refreshing an existing survey, preserve the original `created` date and
  any `<!-- user-edited -->` sections verbatim. Only `updated`, the survey
  body, and `covers` may change.

## Examples

<example>
User asks: "What does the wiki know about attention mechanisms?" without
asking to save it.
Action: read the `sources` and `concepts` entity lists, read edges for the
relevant pages, then answer in chat with citations to `[[sources/...]]` and
`[[concepts/...]]`, plus a gaps note (for example: "no source yet covers
sparse attention variants"). No slug is generated and no file is written.
</example>

<example>
User asks the same question, then says "save that as a survey".
Action: generate the slug, confirm `wiki/summary/attention-mechanisms.md`
does not already exist, write the page with a `covers` array listing every
cited source and concept slug plus the `## Survey` / `## Gaps` sections, log
`research-survey "saved survey attention-mechanisms"`, run
`lint.mjs --fix --json`, and suggest running `/lumi-check` in a fresh session.
</example>

## Definition of Done

- Unsaved survey responses name supporting wiki pages and explicit gaps.
- Saved survey pages have valid summary frontmatter, including a non-empty
  `covers` array listing every cited page.
- The survey file was written only after the user explicitly asked to save it.
- If saved, lint leaves `summary.errors === 0`, `wiki/index.md` is current, and
  `wiki/log.md` has an append-only `research-survey` entry.
- If the page already existed, the user's choice (skip / refresh / abort) is
  logged in `wiki/log.md` with the actual decision taken.
