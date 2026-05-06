---
name: lumi-research-topic
description: >
  Cluster existing concepts and sources into a thematic topic page under
  wiki/topics/ so related knowledge is grouped and cross-referenced in the graph.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-topic

## Role

You group already-ingested concepts and sources into a thematic topic page under
`wiki/topics/`. Topic pages are an organizing layer — they do not introduce new
knowledge; they surface relationships that already exist in the graph.

## Context

Read `README.md` first. Work only from wiki pages and graph edges that are
already in the workspace. Do not read `raw/` source files and do not invent
entries that lack a wiki page. If the user wants to include something not yet
ingested, tell them to run `/lumi-ingest` first, then return here.

When speaking with the user, follow the README language rule exactly. Use the
configured communication language, translate workflow terms, and avoid technical
tool words unless the user asks for them.

## Instructions

1. Ask the user for a topic name if they have not already provided one. You may
   suggest a refined version if the phrasing is vague — but confirm before
   continuing. Then generate the slug:

```bash
node _lumina/scripts/wiki.mjs slug "<topic title>"
```

2. Check whether `wiki/topics/<slug>.md` already exists:

```bash
node _lumina/scripts/wiki.mjs read-meta topics/<slug>
```

   - **exit 2 (not found)** — continue to step 3.
   - **exit 0 (exists)** — read the file, then show the user the `title` and
     `created` date. Ask exactly one question with three options in the user's
     language (no other action until answered). Explain the choices plainly:

     ```
     Topic "<title>" already exists.
       [s] skip    — abort, no changes (default)
       [r] refresh — propose a new candidate list and update the page; preserve `created` and `<!-- user-edited -->` sections
       [a] abort   — same as skip but log the user's intent
     ```

     Map blank/Enter to `skip`. Do not proceed without an explicit choice.

3. Propose candidate sources and concepts by reading the graph. Run all three
   commands before presenting anything to the user:

```bash
node _lumina/scripts/wiki.mjs list-entities --type sources
node _lumina/scripts/wiki.mjs list-entities --type concepts
```

   If the user named a seed concept, also fetch its immediate neighbours:

```bash
node _lumina/scripts/wiki.mjs read-edges concepts/<seed-slug>
```

   From the combined output, select 5-10 candidate sources and 5-10 candidate
   concepts most relevant to the topic. Present them as a numbered list with a
   one-line reason for each. Group sources and concepts separately. Explain that
   the user can:
   - confirm the list as shown,
   - remove items by number, or
   - add wiki slugs for items not on the list.

   Do not write anything until the user explicitly approves the list.

4. Write `wiki/topics/<slug>.md` with valid topic frontmatter and the four
   standard sections. Use today's date for both `created` and `updated` on a
   new page; on a refresh keep the original `created` date.

   Required frontmatter fields: `id`, `title`, `type: topic`, `created`,
   `updated`, `key_sources` (array of source slugs the user approved).

   Page structure:

   ```markdown
   ---
   id: <slug>
   title: "<Topic Title>"
   type: topic
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   key_sources:
     - sources/<slug>
     - ...
   ---

   ## Description

   <!-- A short paragraph explaining what this topic covers and why the grouped
        sources and concepts belong together. Write in document_output_language. -->

   ## Key sources

   <!-- One bullet per approved source: [[sources/<slug>]] — one sentence on why
        it belongs here. -->

   ## Key concepts

   <!-- One bullet per approved concept: [[concepts/<slug>]] — one sentence on
        the concept's role in this topic. -->

   ## Open questions

   <!-- Bullet list of unresolved questions, tensions, or gaps the topic surface.
        Leave blank if none are obvious; the user can fill this in later. -->
   ```

5. Write bidirectional edges for every approved source and concept. For each
   approved source, add both directions:

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> includes_source sources/<source-slug>
node _lumina/scripts/wiki.mjs add-edge sources/<source-slug> included_in_topic topics/<slug>
```

   For each approved concept, add both directions:

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> covers_concept concepts/<concept-slug>
node _lumina/scripts/wiki.mjs add-edge concepts/<concept-slug> covered_by_topic topics/<slug>
```

   If `add-edge` is not the correct subcommand, check available subcommands with
   `node _lumina/scripts/wiki.mjs --help` and use the correct one before
   proceeding.

6. Log the operation:

```bash
node _lumina/scripts/wiki.mjs log lumi-research-topic "created topic <slug> covering <N> sources, <M> concepts"
```

   On a refresh, write `"refreshed topic <slug> ..."` instead.

7. Run lint with fix so `wiki/index.md` and structural checks stay current:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

   If `summary.errors > 0`, read the lint output, address each error, and re-run
   before telling the user the skill is done.

## Constraints

- Do not read `raw/` files at any point. All information comes from already-ingested
  wiki pages and graph edges.
- Do not create concept or source pages from this skill. If a candidate the user
  wants does not have a wiki page, tell them to run `/lumi-ingest` first.
- Every forward link from the topic page to a concept or source must have a
  reverse edge written in the same operation. This is a hard graph rule — do not
  skip it.
- When refreshing an existing topic, preserve the original `created` date and any
  `<!-- user-edited -->` sections verbatim. Only `updated`, `key_sources`, and
  non-marked sections may change.
- Translate all user-facing messages into the configured communication language.
  Do not expose internal command names or file paths unless the user asks.
- No emoji in the topic page or in messages to the user.

## Definition of Done

- `wiki/topics/<slug>.md` exists with valid frontmatter (`id`, `title`,
  `type: topic`, `created`, `updated`, `key_sources` containing at least one
  entry) and all four standard sections (Description / Key sources / Key
  concepts / Open questions).
- Bidirectional edges exist for every linked source and concept — forward from
  the topic page and reverse on each source and concept page.
- `node _lumina/scripts/lint.mjs --fix --json` leaves `summary.errors === 0`.
- `wiki/log.md` has an append-only `lumi-research-topic` entry recording the
  slug, source count, and concept count.
- If the page already existed, the user's choice (skip / refresh / abort) is
  logged in `wiki/log.md` with the actual decision taken.
