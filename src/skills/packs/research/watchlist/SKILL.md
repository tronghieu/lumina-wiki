---
name: lumi-research-watchlist
description: >
  Help the user choose research topics to follow and configure the scheduled
  discovery watchlist in plain language. Use this whenever the user wants to
  add, change, pause, remove, or review topics for scheduled discovery, even if
  they do not mention the watchlist file by name.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /lumi-research-watchlist

## Role

You help the user decide what research topics Lumina-Wiki should check again
later, then update the scheduled discovery watchlist. You make the setup feel
like choosing topics to follow, not like editing a config file.

## Context

Read `README.md` at the project root before this SKILL.md. This skill is
available only when the research pack is installed.

Scheduled discovery uses:
- `_lumina/config/watchlist.yml` for the topics the user wants to follow.
- `lumina discover run` or `_lumina/scripts/discover-runner.mjs` for a one-shot
  discovery run.
- `raw/discovered/` for scored candidate records created later by the runner.

Read `references/watchlist-schema.md` before interpreting, creating, or editing
the watchlist. Read `references/scheduler-patterns.md` only when the user asks
to automate a run on a specific platform.

This skill configures the watchlist only. It does not run scheduled discovery
unless the user explicitly asks for a dry run or a real run.

## Instructions

### 1. Understand the user's intent

Decide whether the user wants to:

- add a new topic,
- change an existing topic,
- pause or resume a topic,
- remove a topic,
- review the current watchlist,
- get help choosing good topics.

If the request is ambiguous, ask one short question. Prefer practical choices:
topic, how often to check, sources, and how many new items they want to see.

### 2. Read or create the watchlist

Read `_lumina/config/watchlist.yml` if it exists.

If it does not exist, create a starter file with this structure and keep all
items disabled until the user chooses otherwise:

```yaml
version: 1
defaults:
  sources: [arxiv]
  schedule: weekly
  limit: 10
  max_new: 5

items: []
```

Preserve existing items and comments where practical. Do not reorder the whole
file unless it is malformed and the user agrees to repair it.

### 3. Convert plain language into watchlist fields

Use this mapping:

- `id`: short lowercase label, letters/numbers/hyphens only.
- `query`: the research phrase to search for.
- `sources`: use `arxiv` by default; add `s2` when the user has Semantic
  Scholar set up; add `openalex` when broader coverage (cross-walk metadata,
  humanities/biomedicine, older work) is requested. OpenAlex can work without
  local credentials for small checks; set `OPENALEX_API_KEY` for the free daily
  API budget and usage tracking.
- `schedule`: `manual`, `daily`, `weekly`, or `monthly`.
- `limit`: how many candidates to fetch before deduping.
- `max_new`: how many new candidates the user wants to see per run.
- `enabled`: `true` only after the user confirms the topic should be active.

For RSS or Atom feeds, use a `type: feed` item with an HTTPS `url`; read
`references/watchlist-schema.md` for its fields and safety rules. Do not use
`sources` or `query` for a feed item.

Good defaults:

```yaml
schedule: weekly
sources: [arxiv]
limit: 20
max_new: 5
enabled: true
```

Use `manual` when the user wants to save a topic but not let scheduled runs pick
it up yet.

### 4. Edit only the watchlist

Make the smallest edit that satisfies the user's request. Do not modify
`wiki/`, `raw/`, `.env`, or any scheduler files.

For a new topic, append an item:

```yaml
  - id: agent-memory
    enabled: true
    query: "LLM agent memory"
    sources: [arxiv]
    schedule: weekly
    limit: 20
    max_new: 5
```

For pause/resume, change only `enabled`.

For schedule changes, change only `schedule`.

For removal, ask first whether the user wants to pause instead. Removing a topic
does not delete already discovered candidates.

### 5. Validate

First inspect the edited watchlist for enabled `type: feed` items.

If there are no enabled feeds, a topic-only preview is safe when the user asks
to preview the result:

```bash
lumina discover run --dry-run --json
```

If `lumina` is not available in the environment, try:

```bash
node _lumina/scripts/discover-runner.mjs --dry-run --json
```

Do not use `--dry-run` when an enabled feed is present: polling a feed updates
its ETag and seen-item state. Instead, manually inspect the YAML below. If the
user explicitly requested a real run, leave it to
`/lumi-research-watch-run`, which performs one real pass without first polling
the feed as a preview.

For any watchlist, manually inspect that the YAML has:

- `version: 1`
- an `items:` list
- unique lowercase `id` values
- valid `schedule` values: `manual`, `daily`, `weekly`, `monthly`
- valid `sources` values supported by the installed runner
- positive numeric `limit` and `max_new` values when present
- for each feed: `type: feed`, a unique safe `id`, and an HTTPS `url` (with no
  `query` or `sources` fields)

Report validation problems in plain language and fix them before finishing.

### 6. Explain what happens next

Tell the user:

- the watchlist has been updated,
- scheduled discovery still needs an outside scheduler such as GitHub Actions,
  cron, launchd, or Windows Task Scheduler,
- the runner will collect scored candidates only,
- papers are downloaded later during `/lumi-ingest`, after the user chooses a
  candidate.

If the user asks how to schedule it, use
`references/scheduler-patterns.md` for GitHub Actions, cron, launchd, or
Windows Task Scheduler guidance. The `/lumi-research-watch-run` skill runs one
pass over the watchlist on demand. Keep scheduler setup separate from this
watchlist edit unless the user explicitly requests and confirms a platform.

## Constraints

- Do not run a real discovery command unless the user explicitly asks.
- Do not create cron, launchd, GitHub Actions, or Windows Task Scheduler files
  unless the user explicitly asks and confirms the target platform.
- Do not download PDFs.
- Do not create or edit wiki pages.
- Do not store API keys or secrets in the watchlist.
- Keep communication in the language configured by the workspace README.

## Definition of Done

- `_lumina/config/watchlist.yml` exists and reflects the user's requested
  topic changes.
- Existing unrelated watchlist items are preserved.
- The file validates by topic-only runner preview when requested, or by manual
  shape inspection when an enabled feed is present or the runner is unavailable.
- The user is told clearly that scheduling is external and ingestion happens
  later.
