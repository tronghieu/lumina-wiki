# Research Watch — Scheduled discovery for topics + feeds

`/lumi-research-watch-run` polls everything in your watchlist (search topics
and RSS / Atom feeds) and writes new candidate records into
`raw/discovered/`. It never modifies `wiki/`. Use `/lumi-research-discover`
afterwards to review and `/lumi-ingest` to pull individual sources into the
graph.

> **Lumina does not poll feeds in the background.** It only checks when you
> run `/lumi-research-watch-run` or when your scheduler triggers the wrapper
> script. You stay in control of when discovery happens.

## What lands where

| Path | Owner | Notes |
|---|---|---|
| `_lumina/config/watchlist.yml` | you (via `/lumi-research-watchlist`) | The list of topics + feeds. |
| `_lumina/_state/feeds/<feed-id>.json` | the runner | Per-feed etag, last-seen guids, poll count. |
| `_lumina/_state/watch-run.log` | the cron wrapper | Last run timestamps + runner stdout. Rotates at 1 MB. |
| `raw/discovered/<date>/<watchlist-id>/...` | the runner | One JSON candidate record per new item. |

## Watchlist v1 → v1.4: adding feeds

The existing `type: topic` items still work as-is. New: items with
`type: feed`.

```yaml
version: 1
defaults:
  sources: [arxiv, openalex]
  schedule: weekly
  limit: 10
  max_new: 5

items:
  - id: rag-papers
    type: topic                 # default when absent — keeps v1 valid
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

Schema rules for `type: feed`:

- `url` must use **https://** and must not start with `--`.
- `query` is not required; `sources` is ignored (the feed is the source).
- `extract_dois` defaults to `true`; set `false` to skip DOI/arXiv harvesting.

## Running a single pass

```bash
node _lumina/scripts/discover-runner.mjs --json
```

Useful flags:

- `--source rss` — only poll feeds (skip topic search items).
- `--schedule daily` — only run items with that cadence.
- `--dry-run` — parse the watchlist and report what would happen.

`/lumi-research-watch-run` wraps this with a plain-language summary.

## Scheduling (you own the timing)

Lumina ships exactly one helper: `_lumina/scripts/scheduler-samples/cron-daily.sh`.
It sets `umask 077`, creates `_lumina/_state/watch-run.log` with `chmod 600`,
rotates the log at 1 MB, and invokes the runner. **The installer never
registers it with your scheduler** — pick whichever of the three patterns
below fits your OS.

### Linux / macOS — crontab

```cron
0 8 * * * /absolute/path/to/your-wiki/_lumina/scripts/scheduler-samples/cron-daily.sh
```

### macOS — launchd user agent

Save as `~/Library/LaunchAgents/wiki.lumina.watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>wiki.lumina.watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/your-wiki/_lumina/scripts/scheduler-samples/cron-daily.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/wiki.lumina.watch.plist`.

### Windows — Task Scheduler (via WSL)

```powershell
schtasks /Create /TN "LuminaWatch" `
  /TR "wsl.exe -- /absolute/path/to/wiki/_lumina/scripts/scheduler-samples/cron-daily.sh" `
  /SC DAILY /ST 08:00
```

## Filesystem-locality note

Atomic state writes (`tmp + os.replace`) assume the project is on a local
filesystem. Putting `_lumina/_state/feeds/` on a network share (NFS, SMB,
cloud-synced folder) can break the atomic-rename guarantee — a partial state
file may survive a crash.

## Troubleshooting

- "feed temporarily unreachable" — usually 5xx or DNS. The runner already
  preserves state; the next poll recovers. No action needed.
- "unsafe XML" in the log — Lumina rejected a feed whose body declared
  external entities (XXE attack surface). Verify the feed publisher.
- `last_seen_guids` grows over months — Lumina caps it at 5000 entries and
  evicts entries older than 90 days; no manual cleanup needed.
- A feed re-emits the same item every poll — its server likely changes the
  `<id>` / `<guid>` element on every update. Open an issue with the feed URL.
