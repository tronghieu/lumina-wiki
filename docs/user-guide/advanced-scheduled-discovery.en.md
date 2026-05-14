# Advanced: Find Research Regularly

Regular research discovery helps Lumina-Wiki occasionally find more papers or
research material for topics you care about. Each run only creates a list of
suggested material for you to review. It does not add material to the wiki and
does not download paper files.

Think of it this way: Lumina-Wiki searches first, and you still decide what is
worth reading.

## Recommended Flow

1. Choose a few topics to follow.
2. Lumina-Wiki finds new material for those topics.
3. You review the new list, or ask your assistant to help read it.
4. You choose what is worth reading.
5. Use `/lumi-ingest` to add the chosen material to the wiki.

Regular discovery stops at step 2. Careful reading, paper download, summaries,
wiki pages, and links to older notes still happen during `/lumi-ingest`.

## 1. Choose Topics To Follow

In your assistant chat, run:

```text
/lumi-research-watchlist
```

You can speak naturally, for example:

```text
I want to follow research about the effects of phone use in classrooms. Search once a week and show about 5 useful items each time.
```

The assistant will save this topic to your follow list. You do not need to
remember the config file name.

Good starting choices:

- Weekly is enough for most topics.
- Use arXiv first if you have not configured other sources.
- Show about 5 new items each time, so the list stays readable.

## 2. Test One Run

Before running for real, test it:

```bash
lumina discover run --dry-run
```

This only checks what Lumina-Wiki would search for. It does not write new
results.

If it looks right, run:

```bash
lumina discover run
```

After a real run, Lumina-Wiki saves the new list under `raw/discovered/`.

## 3. What To Do After A New List Appears

This is the most important part: do not add every result to the wiki.

You can review the list yourself, or ask your assistant to review it first:

```text
Look at the new material in raw/discovered/ and help me choose the 3 most useful items about the effects of phone use in classrooms.
```

The assistant should help you:

- group material by smaller topics,
- explain why something is worth reading,
- skip duplicates or material too far from your topic,
- suggest what to add to the wiki first.

Then choose one item and add it to the wiki:

```text
/lumi-ingest <the material you choose>
```

Only at this step does Lumina-Wiki download full content, summarize it, create a
wiki page, and link it with your older notes.

## 4. Run Regularly With GitHub Actions

Use this if your project is on GitHub and you want discovery to run even when
your computer is off.

Create `.github/workflows/lumina-discovery.yml` with this content:

```yaml
name: Lumina scheduled discovery

on:
  schedule:
    - cron: "0 1 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g lumina-wiki
      - run: lumina discover run --json
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -d raw/discovered ]; then git add raw/discovered; fi
          if [ -f _lumina/_state/discovery-runner.json ]; then git add _lumina/_state/discovery-runner.json; fi
          git diff --cached --quiet || git commit -m "chore: add discovered research"
          git push
```

This example runs every Monday. GitHub uses UTC time, so the real time may be
different from your local time.

This workflow does commit automatically. If a run finds nothing new, the
`git commit` step skips itself because there is nothing to save.

## 5. Run Regularly On macOS Or Linux With Cron

Cron is a simple way to tell your computer to run a command at a fixed time.

First, open a terminal in your Lumina-Wiki project and run:

```bash
pwd
```

This prints the full path to your project. Keep that path. Example:

```text
/Users/you/Projects/my-wiki
```

Next, open cron:

```bash
crontab -e
```

If your computer asks you to choose an editor, choose `nano` if you are not
sure. In `nano`, press `Ctrl+O`, Enter to save, then `Ctrl+X` to exit.

Add a line like this at the end:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

Replace `/Users/you/Projects/my-wiki` with your real project path.

That line means: every Monday at 8:00 in the morning, go to the project folder
and run the research discovery command.

You can change the timing like this:

```cron
# Every day at 8:00
0 8 * * * cd /Users/you/Projects/my-wiki && lumina discover run

# Every Monday at 8:00
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run

# First day of every month at 8:00
0 8 1 * * cd /Users/you/Projects/my-wiki && lumina discover run
```

If you want an easy place to check errors later, use the logging version:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run >> .lumina-discovery.log 2>&1
```

After saving, check that cron kept the schedule:

```bash
crontab -l
```

The computer must be awake at the scheduled time. If a laptop is asleep, cron
may not run.

## 6. Run Regularly On Windows

Windows has **Task Scheduler**. Use it if your project is on a Windows machine.

Create a Basic Task:

- Trigger: weekly, at the time you choose.
- Action: Start a program.
- Program: `lumina`.
- Arguments: `discover run`.
- Start in: your project folder.

The computer must be on at the scheduled time.

## 7. Follow RSS / Atom Feeds (v1.4+)

You can also follow an RSS / Atom feed alongside topic searches. The runner
polls every feed in your watchlist once per scheduled invocation, dedups
against per-feed state, and writes new candidates into `raw/discovered/`
like any topic search.

Add a `type: feed` item via `/lumi-research-watchlist`, or by editing
`_lumina/config/watchlist.yml` directly:

```yaml
items:
  - id: arxiv-cs-lg
    type: feed
    enabled: true
    url: "https://arxiv.org/rss/cs.LG"
    name: "arXiv cs.LG"
    schedule: daily
    max_new: 20
```

Existing `type: topic` items keep working with no change. The feed URL must
use `https://` and must not begin with `--`.

Per-feed state lives at `_lumina/_state/feeds/<feed-id>.json` (etag,
last-seen guids, poll count). Lumina caps `last_seen_guids` at 5000 entries
and evicts entries older than 90 days, so the file stays small even after
years of polling.

If you want a single one-shot pass from inside chat (no scheduler), use
`/lumi-research-watch-run`. It is the in-chat equivalent of
`lumina discover run` and reports a plain-language summary of what was new.

For the v1.4 feed schema, etag caching, XXE rejection, and the
`cron-daily.sh` wrapper that pairs `umask 077` with log rotation, see
[Research Watch deep-dive](research-watch.md) (English; v1.4 technical reference).
