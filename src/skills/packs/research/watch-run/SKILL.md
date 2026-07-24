---
name: lumi-research-watch-run
description: >
  Run one scheduled-discovery pass over the consolidated watchlist (topics +
  feeds). Use this whenever the user asks to "check for new papers", "run
  discovery now", "poll my feeds", "see what's new this week", or asks about
  the watchlist findings. Also fires when the user wants to wire a cron /
  launchd / Task Scheduler job — point them at the wrapper script and docs.
allowed-tools:
  - Bash
  - Read
---

# /lumi-research-watch-run

## Role

You drive a single discovery pass over the user's watchlist. You never mutate
`wiki/`; the runner only writes to `raw/discovered/` and the per-feed state
files under `_lumina/_state/feeds/`. After the pass, you summarize the result
in plain language and suggest next steps.

## Context

Read `README.md` at the project root before this SKILL.md. This skill ships
with the research pack and depends on:

- `_lumina/config/watchlist.yml` — the user's topics and feeds.
- `_lumina/scripts/discover-runner.mjs` — the one-shot runner.
- `_lumina/tools/fetch_rss.py` — used by the runner for `type: feed` items.

The runner is **manual** — Lumina does not poll feeds in the background. The
user (or their scheduler) decides when to trigger this skill. See the online
guide at
https://github.com/tronghieu/lumina-wiki/blob/main/docs/user-guide/advanced-scheduled-discovery.en.md
(also in Vietnamese at .../advanced-scheduled-discovery.vi.md and Simplified
Chinese at .../advanced-scheduled-discovery.zh.md) for cron / launchd / Task
Scheduler templates, and the online guide at
https://github.com/tronghieu/lumina-wiki/blob/main/docs/user-guide/research-watch.md
for the v1.4 feed schema, etag / XXE / per-feed-state deep-dive (English).

## Instructions

### 1. Pre-flight checks

```bash
# Watchlist file exists?
test -f _lumina/config/watchlist.yml || echo "no watchlist"

# Optional: dry-run parses the YAML without writing.
node _lumina/scripts/discover-runner.mjs --dry-run --json
```

If the watchlist is missing, suggest `/lumi-research-watchlist` to create one.

### 2. Run one discovery pass

```bash
node _lumina/scripts/discover-runner.mjs --json
```

Optional flags the user might ask for:

- `--schedule daily|weekly|monthly|manual` — only run items matching that cadence.
- `--source arxiv|s2|openalex|rss` — narrow to one provider (or `rss` for feed items).
- `--limit N` — temporary override on the per-item result cap.

### 3. Present the result

Parse the JSON summary. For each watchlist item with `new > 0` or `errors`,
write a plain-language line:

```
I checked <N> watchlist items:
- <id>: <K> new candidates
- <feed_id> (feed): <K> new (<spill> deferred for next run)
- <id>: feed temporarily unreachable, will retry next time
You can review them with /lumi-research-discover or ingest with /lumi-ingest <slug>.
```

Never dump raw JSON or stack traces to the user — keep it conversational.

### 4. If the user asks about scheduling

Point them at the online guide (trilingual cron / launchd / Task Scheduler
patterns) at
https://github.com/tronghieu/lumina-wiki/blob/main/docs/user-guide/advanced-scheduled-discovery.en.md
(.vi.md and .zh.md for Vietnamese and Simplified Chinese) and the included
wrapper `_lumina/scripts/scheduler-samples/cron-daily.sh` — that file is a
local path, shipped with the workspace. For v1.4 feed schema / etag / XXE
specifics, the deep-dive lives at the online guide
https://github.com/tronghieu/lumina-wiki/blob/main/docs/user-guide/research-watch.md
(English). Do not edit their crontab or launchd files; explain the snippets
and let them paste.

## Constraints

- Never modify `wiki/`, the citation graph, or `_lumina/config/watchlist.yml`.
- Never call `fetch_pdf.py` or `resolve_pdf.py` from this skill — ingestion is
  a separate, user-initiated step.
- If a feed errors transiently (5xx, timeout), the runner already preserves
  state so the next poll recovers; do not retry by hand more than once.
- Secrets in env vars (`UNPAYWALL_EMAIL`, `CORE_API_KEY`, `OPENALEX_API_KEY`)
  must never appear in output.

## Definition of Done

- The runner exited with a JSON summary.
- The user has a plain-language summary of new candidates per watchlist item.
- Any errors are surfaced by item id, with a hint about whether the user
  needs to act (missing key) or just wait (transient network).
