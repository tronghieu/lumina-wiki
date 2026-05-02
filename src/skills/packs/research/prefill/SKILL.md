---
name: lumi-research-prefill
description: >
  Seed terminal foundation pages for stable background knowledge so future
  ingestion can link to common concepts without duplicating definitions.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-prefill

## Role

You create stable foundation pages under `wiki/foundations/` for background
concepts. Foundation pages are terminal references: normal wiki pages may link to
them, but they do not require reverse links.

## Context

Read `README.md` first. Use the research pack Wikipedia fetcher when background
material should come from a public encyclopedia:

```bash
python3 _lumina/tools/fetch_wikipedia.py --help
node _lumina/scripts/wiki.mjs read-meta foundations/<slug>
```

## Instructions

1. Turn the requested topic into a slug with:

```bash
node _lumina/scripts/wiki.mjs slug "<topic title>"
```

2. Check whether `wiki/foundations/<slug>.md` already exists:

```bash
node _lumina/scripts/wiki.mjs read-meta foundations/<slug>
```

   - **exit 2 (not found)** — continue to step 3.
   - **exit 0 (exists)** — read the file, then show the user the `title`, `created`
     date, and the most recent line in `wiki/log.md` that references this slug.
     Ask exactly one question with three options (no other action until answered):

     ```
     Foundation "<title>" already exists.
       [s] skip    — abort, no changes (default)
       [r] refresh — re-fetch from Wikipedia, update non-marked sections and `updated`
       [a] abort   — same as skip but log the user's intent
     ```

     Do not proceed without an explicit choice. Map blank/Enter to `skip`.

3. Fetch or handle background material based on exit code from the Wikipedia fetcher:

```bash
python3 _lumina/tools/fetch_wikipedia.py page "<title>"
```

   - **exit 0** — use the JSON output directly.
   - **exit 2 AND stderr is JSON with `kind == "disambiguation"`** — run a search
     to surface candidates:

     ```bash
     python3 _lumina/tools/fetch_wikipedia.py search "<title>" --limit 5
     ```

     Present the numbered results (title + snippet) and let the user:
     - pick a candidate number,
     - type a more specific title, or
     - type `manual` to paste content directly.

     Re-run `page` with the chosen title, or accept the user-pasted content.

   - **exit 2 for any other reason** (empty title, page not found) — surface the
     `error` field from stderr JSON and abort.
   - **exit 3 (network error)** — tell the user and offer two options: retry, or
     paste content manually.
4. Write `wiki/foundations/<slug>.md` with valid foundation frontmatter:
   `id`, `title`, `type: foundation`, `created`, `updated`.
5. Keep the body concise: definition, scope notes, and external references.
6. Log the addition:

```bash
node _lumina/scripts/wiki.mjs log lumi-research-prefill "prefilled foundation <slug>"
```

7. Run lint with fix so `wiki/index.md` and structural checks stay current:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

## Constraints

- Do not create concept pages from this skill; use `/lumi-ingest` for wiki
  knowledge extracted from project sources.
- Do not store secrets or API keys in foundation pages.
- Do not add reverse graph edges for foundations.
- When refreshing an existing foundation, preserve the original `created` date and
  any `<!-- user-edited -->` sections verbatim. Only `updated` and non-marked
  sections may change.

## Definition of Done

- Foundation page exists with valid frontmatter and concise source-backed body.
- `node _lumina/scripts/lint.mjs --fix --json` has updated `wiki/index.md` if
  needed and leaves `summary.errors === 0`.
- `wiki/log.md` has an append-only `lumi-research-prefill` entry.
- If the page already existed, the user's choice (skip / refresh / abort) is logged
  in `wiki/log.md` with the actual decision taken.
