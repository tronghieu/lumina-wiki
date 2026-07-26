# Research Watch reference

This reference describes the scheduled-discovery watchlist, its files, and the runner's technical behavior. For the task workflow, use [How to find research regularly](../user-guide/advanced-scheduled-discovery.en.md) ([Tiếng Việt](../user-guide/advanced-scheduled-discovery.vi.md) · [简体中文](../user-guide/advanced-scheduled-discovery.zh.md)).

`/lumi-research-watch-run` polls every configured topic and RSS/Atom feed and writes new candidate records to `raw/discovered/`. It never modifies `wiki/`. It runs only when invoked in chat or by an external scheduler; Lumina does not poll in the background.

## Files and ownership

| Path | Owner | Purpose |
| --- | --- | --- |
| `_lumina/config/watchlist.yml` | User or `/lumi-research-watchlist` | Topics, feeds, and defaults. |
| `_lumina/_state/feeds/<feed-id>.json` | Runner | Per-feed ETag, last-seen GUIDs, and poll count. |
| `_lumina/_state/watch-run.log` | Scheduler wrapper | Runner output and timestamps; rotated at 1 MB. |
| `raw/discovered/<date>/<watchlist-id>/...` | Runner | One JSON candidate record per new item. |

## Watchlist format

Version-1 topic items remain valid. A feed item uses `type: feed`.

```yaml
version: 1
defaults:
  sources: [arxiv, openalex]
  schedule: weekly
  limit: 10
  max_new: 5

items:
  - id: rag-papers
    type: topic
    enabled: true
    query: "retrieval augmented generation"
    sources: [arxiv, openalex]
    schedule: weekly
    limit: 20
    max_new: 5

  - id: arxiv-cs-lg
    type: feed
    enabled: true
    url: "https://arxiv.org/rss/cs.LG"
    name: "arXiv cs.LG"
    schedule: daily
    max_new: 20
    extract_dois: true
```

### Feed item rules

| Field | Rule |
| --- | --- |
| `id` | Required, unique watchlist identifier. |
| `type` | `feed`; omitted `type` defaults to a topic item. |
| `url` | Required; must use `https://` and must not start with `--`. |
| `name` | Optional display name. |
| `schedule` | Optional cadence; otherwise uses the default. |
| `max_new` | Optional maximum number of newly emitted records. |
| `extract_dois` | Optional; defaults to `true`. Set `false` to skip DOI/arXiv identifier harvesting. |

`query` is not required for feeds. `sources` is ignored because the feed itself is the source.

## Run commands

```bash
lumina discover run
lumina discover run --dry-run
```

The chat command `/lumi-research-watch-run` wraps a single pass with a plain-language summary. The underlying runner also supports these filters:

```bash
node _lumina/scripts/discover-runner.mjs --source rss --json
node _lumina/scripts/discover-runner.mjs --schedule daily --json
node _lumina/scripts/discover-runner.mjs --dry-run
```

`--source rss` skips topic searches. `--schedule daily` runs only items with that cadence. `--dry-run` parses and reports planned work without writing candidate records.

## Scheduler helper

`_lumina/scripts/scheduler-samples/cron-daily.sh` is an optional helper for cron. It sets `umask 077`, creates the run log with mode `600`, rotates that log at 1 MB, and invokes the runner. The installer does not register any schedule.

## Reliability and safety behavior

- Feed state uses atomic writes. Keep the workspace on a local filesystem; network shares and cloud-synced folders can weaken atomic rename behavior.
- The runner uses conditional requests when a feed provides ETag information.
- Last-seen GUIDs are capped at 5,000 entries and entries older than 90 days are removed.
- XML containing external entities is rejected to avoid XXE processing.
- A temporary DNS or server failure preserves existing feed state; the next poll can recover.

## Troubleshooting

| Symptom | Likely cause and response |
| --- | --- |
| `feed temporarily unreachable` | DNS or a server error. State is preserved; retry on the next poll. |
| `unsafe XML` | The feed declared external entities. Verify the publisher and do not bypass the rejection. |
| A feed emits an item every run | The publisher may change its GUID or ID on each update. Report the feed URL to the project maintainers. |
| Candidate records are missing | Run `lumina discover run --dry-run` from the workspace root and inspect the selected watchlist item and schedule. |
