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

A topic page has two zones:
- **Compiled zone** — `## Description`, `## Key sources`, `## Key concepts`,
  `## Open questions`. This skill rewrites it wholesale on every refresh.
- **Timeline zone** — `## Timeline`, bounded by `<!-- lumina:timeline -->` and
  `<!-- /lumina:timeline -->`. Only `wiki.mjs timeline-add` writes here (see
  Constraints); this skill only reads it during refresh.

## Context

Read `README.md` at the project root before this SKILL.md. Work only from wiki pages and graph edges that are
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
       [r] refresh — fold in newly arrived sources and update the page; preserve `created`, the timeline zone, and `<!-- user-edited -->` sections
       [a] abort   — same as skip but log the user's intent
     ```

     Map blank/Enter to `skip`. Do not proceed without an explicit choice.
     On `r`, jump to "## Refresh procedure" below — skip steps 3-5, which only
     apply to a new page.

3. Propose candidate sources and concepts by reading the graph. Run all three
   commands before presenting anything to the user:

```bash
node _lumina/scripts/wiki.mjs list-entities --type sources
node _lumina/scripts/wiki.mjs list-entities --type concepts
```

   If the user named a seed concept that already exists as a concept page, also
   fetch its immediate neighbours (the topic title itself is never a seed slug —
   the topic page does not exist yet, so do not run read-edges against it):

```bash
node _lumina/scripts/wiki.mjs read-edges concepts/<seed-slug>
```

   From the combined output, select 5-10 candidate sources and 5-10 candidate
   concepts most relevant to the topic. On a small wiki with fewer than 5 of
   either, propose all relevant ones — a shorter list is fine. Present them as a numbered list with a
   one-line reason for each. Group sources and concepts separately. Explain that
   the user can:
   - confirm the list as shown,
   - remove items by number, or
   - add wiki slugs for items not on the list.

   Do not write anything until the user explicitly approves the list.

4. Write `wiki/topics/<slug>.md` with valid topic frontmatter, the four
   compiled-zone sections, and an empty timeline region. Use today's date for
   `created`, `updated`, and `compiled_at` (all three the same value) on a new
   page.

   Required frontmatter fields: `id`, `title`, `type: topic`, `created`,
   `updated`, `compiled_at`, `key_sources` (array of source slugs the user
   approved).

   Page structure:

   ```markdown
   ---
   id: <slug>
   title: "<Topic Title>"
   type: topic
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   compiled_at: YYYY-MM-DD
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

   ## Timeline

   <!-- lumina:timeline -->
   <!-- /lumina:timeline -->
   ```

   The timeline region starts empty (see Constraints for who writes there).

5. Write edges for every approved source and concept. Call `add-edge` once for
   the forward relationship from the topic page — the engine writes the
   reverse edge automatically. For each approved source:

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> includes_source sources/<source-slug>
```

   For each approved concept:

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> covers_concept concepts/<concept-slug>
```

6. Log the new page:

```bash
node _lumina/scripts/wiki.mjs log research-topic "created topic <slug> covering <N> sources, <M> concepts"
```

7. Run lint with fix so `wiki/index.md` and structural checks stay current:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

   Re-run in read mode (no `--fix`) to see the true count — the `--fix` run's
   own `summary.errors` still counts findings it just repaired:

```bash
node _lumina/scripts/lint.mjs --json
```

   If that re-run's `summary.errors > 0`, read the lint output, address each
   error, and re-run before telling the user the skill is done.

8. Suggest `/lumi-check` in a fresh session or via a subagent after this run. A
   blank context catches bias from the reasoning chain that just built the
   topic page.

## Refresh procedure

Reached from step 2's `[r] refresh` choice. Steps 3-5 above do not apply here.

Candidate values from `key_sources`, from `read-edges` `to`/`from`, or from the
checkpoint are canonical paths (e.g. `sources/<slug>`, `concepts/<slug>`) —
pass them to `wiki.mjs` unchanged; never prepend `sources/`, `concepts/`, or
`topics/` to one. `topics/<slug>` for this topic's own page is the exception:
`<slug>` there is the bare name this topic was created with in step 1, not a
value read back from an edge.

1. Read the topic page. Read the timeline zone (between
   `<!-- lumina:timeline -->` and `<!-- /lumina:timeline -->`) and list, to the
   user, the entries dated after `compiled_at` — or every entry, if
   `compiled_at` is absent — as "arrived since last refresh".

2. Build the candidate list: the current `key_sources` plus every source with
   an `includes_source` edge from this topic:

```bash
node _lumina/scripts/wiki.mjs read-edges topics/<slug> --type includes_source
```

   Present the combined, de-duplicated list to the user. The user confirms
   each source or drops it. For every dropped source (its candidate value
   `<dropped>` is already canonical — pass it unchanged):

```bash
node _lumina/scripts/wiki.mjs remove-edge topics/<slug> includes_source <dropped>
```

3. Rewrite the compiled zone (`## Description`, `## Key sources`, `## Key
   concepts`, `## Open questions`) wholesale, integrating the confirmed
   sources — an old statement that is no longer accurate is replaced, not
   kept alongside the new one. Copy the timeline zone and any
   `<!-- user-edited -->` block byte-identical; do not touch them. Note which
   concepts are newly named in `## Key concepts` (not already covered by this
   topic) — step 4 below links them.

4. Update metadata and edges from the rewritten compiled zone. Set
   `key_sources` to the full confirmed list:

```bash
node _lumina/scripts/wiki.mjs set-meta topics/<slug> key_sources '["sources/<slug>", "..."]' --json-value
```

   Set `updated` and `compiled_at` to today:

```bash
node _lumina/scripts/wiki.mjs set-meta topics/<slug> updated YYYY-MM-DD
node _lumina/scripts/wiki.mjs set-meta topics/<slug> compiled_at YYYY-MM-DD
```

   For each confirmed source not already linked (newly added to `key_sources`
   this refresh), add the edge — its candidate value `<source>` is already
   canonical, pass it unchanged:

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> includes_source <source>
```

   For each concept newly named in `## Key concepts` (from step 3) — a bare
   name you are naming for the first time here, not a candidate read back
   from an edge — add the edge using its canonical `concepts/<name>` path,
   same command as the new-page path (step 5 above):

```bash
node _lumina/scripts/wiki.mjs add-edge topics/<slug> covers_concept concepts/<concept-slug>
```

   Read the topic's current concept edges and diff against the rewritten
   `## Key concepts` section:

```bash
node _lumina/scripts/wiki.mjs read-edges topics/<slug> --type covers_concept --direction outbound
```

   For every `to` value `<concept>` in the result that is no longer named in
   the rewritten `## Key concepts`, remove the edge — pass `<concept>`
   unchanged (it is already canonical); the reverse `covered_by_topic` edge is
   removed in the same operation:

```bash
node _lumina/scripts/wiki.mjs remove-edge topics/<slug> covers_concept <concept>
```

   Dropped sources were already unlinked in step 2 above via `remove-edge`;
   dropped concepts are unlinked the same way, just above.

5. **Tension pass.** Read the `## Key claims` section of each confirmed key
   source. Propose at most five pairs where one source's claim conflicts with
   another's, each with a one-line reason. Present all proposed pairs to the
   user before writing anything. `<a>` and `<b>` below are the confirmed
   `key_sources` values, already canonical (`sources/<name>`); pass them
   unchanged. For each pair the user confirms:

```bash
node _lumina/scripts/wiki.mjs add-edge <a> challenges <b>
node _lumina/scripts/wiki.mjs timeline-add topics/<slug> --kind note --text "Marked [[<a>]] challenges [[<b>]]: <one-line reason>"
```

   If the text begins with `--`, pass it as `--text="<text>"` so it is not
   read as another flag.

   Never add a `challenges` edge without the user confirming that specific
   pair. Skip a pair the user declines.

6. Log the refresh:

```bash
node _lumina/scripts/wiki.mjs log research-topic "refreshed topic <slug> | +<n> sources | <m> tensions marked"
```

   `<n>` is the count of sources added to `key_sources` in step 4 (candidates
   not previously listed there); `<m>` is the count of confirmed tension pairs.

Then continue with steps 7 and 8 above (lint, suggest `/lumi-check`).

## Constraints

- Do not read `raw/` files at any point. All information comes from already-ingested
  wiki pages and graph edges.
- Do not create concept or source pages from this skill. If a candidate the user
  wants does not have a wiki page, tell them to run `/lumi-ingest` first.
- Every forward link from the topic page to a concept or source needs a
  reverse edge — the engine writes the reverse edge in the same operation.
  Never add reverse edges manually.
- When refreshing an existing topic, preserve the original `created` date, the
  timeline zone, and any `<!-- user-edited -->` sections verbatim. Only
  `updated`, `compiled_at`, `key_sources`, and the compiled-zone sections may
  change.
- Never write inside `<!-- lumina:timeline -->` … `<!-- /lumina:timeline -->`.
  That zone is written only by `wiki.mjs timeline-add`, called by
  `/lumi-ingest`, `/lumi-edit`, and this skill's own tension pass (step 5 of
  the refresh procedure) — never by directly editing the page.
- Never add a `challenges` edge without the user confirming that specific pair.
- Translate all user-facing messages into the configured communication language.
  Do not expose internal command names or file paths unless the user asks.
- No emoji in the topic page or in messages to the user.

## Definition of Done

- `wiki/topics/<slug>.md` exists with valid frontmatter (`id`, `title`,
  `type: topic`, `created`, `updated`, `compiled_at`, `key_sources`
  containing at least one entry), all four compiled-zone sections
  (Description / Key sources / Key concepts / Open questions), and a
  `## Timeline` section with the marker region (empty on a new page).
- Bidirectional edges exist for every linked source and concept — forward from
  the topic page, written once via `add-edge`, with the reverse edge on each
  source and concept page written automatically by the engine.
- `node _lumina/scripts/lint.mjs --fix --json` runs clean, and a read-only
  re-run (`lint.mjs --json`, no `--fix`) leaves `summary.errors === 0`.
- `wiki/log.md` has an append-only `research-topic` entry recording the
  slug, source count, and concept count (new page) or the source and tension
  counts (refresh).
- If the page already existed, the user's choice (skip / refresh / abort) is
  logged in `wiki/log.md` with the actual decision taken.
- On a refresh: `compiled_at` is today's date, the timeline zone and any
  `<!-- user-edited -->` block are byte-identical to before the refresh, every
  dropped source's `includes_source` edge is removed, every dropped concept's
  `covers_concept` edge is removed, and every confirmed `challenges` pair has
  both the edge and its `note` timeline entry.
