# How to find research regularly without filling your wiki automatically

Use this guide when you already know which research topics or feeds you want to follow. It gives you a repeatable flow: describe a watchlist in chat, run one safe test, review the new candidates, and ingest only sources you choose.

## Prerequisites

- A Lumina-Wiki workspace installed with the research pack.
- A watchlist created through `/lumi-research-watchlist`.
- For automation, a computer or GitHub repository that can run `lumina` and access the workspace.

Discovery only creates candidate records in `raw/discovered/`. It does not add them to your wiki, download a full source, or decide what you should read.

## 1. Create the watchlist in chat

Start with:

```text
/lumi-research-watchlist
```

Describe the topic, frequency, source preference, and number of new items. For example:

```text
Track research about phone use in classrooms every week. Show at most five new items and start with arXiv.
```

Use the same command to add an RSS or Atom feed from a specific publisher. Start with a small weekly list so review stays manageable.

## 2. Run a safe test

From the workspace root, preview one pass before saving candidates:

```bash
lumina discover run --dry-run
```

If the topics and sources are correct, run the real pass:

```bash
lumina discover run
```

New candidates appear in `raw/discovered/`. You can also ask in chat for a single pass with `/lumi-research-watch-run`.

## 3. Review before adding anything

Ask your assistant to compare candidates against your goal. For example:

```text
Review the new research candidates and recommend the three most useful sources for my classroom-phone topic. Explain why each is worth reading and flag duplicates or weak matches.
```

Treat the result as a reading shortlist, not an automatic import. Open the original sources and choose what deserves a permanent note.

## 4. Ingest the sources you choose

For each selected source, use:

```text
/lumi-ingest <selected source>
```

Only this step reads the selected source in depth and adds its notes to the wiki.

## 5. Automate the discovery pass

Automation is optional. Set it up only after a manual test works, and keep review and ingest under your control.

### GitHub Actions

Use GitHub Actions when the workspace is in a GitHub repository and you want the check to run while your computer is off. Add `.github/workflows/lumina-discovery.yml`:

```yaml
name: Lumina discovery

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
      - run: lumina discover run
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -d raw/discovered ]; then git add raw/discovered; fi
          git diff --cached --quiet || git commit -m "chore: add discovered research"
          git push
```

GitHub schedules use UTC. Run the workflow manually once and verify that it commits only candidate records. If the repository blocks direct pushes, adapt the final step to your normal review process.

### macOS and Linux

Use cron when the machine is normally awake at the chosen time. Find the workspace path with `pwd`, then open your crontab:

```bash
crontab -e
```

Add one line, replacing the example path with your workspace path:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

Confirm the schedule with `crontab -l`. Cron does not reliably run while a laptop is asleep. Use GitHub Actions or an always-on machine if that matters.

### Windows

Use Windows Task Scheduler:

1. Create a **Basic Task** with a weekly trigger.
2. Choose **Start a program**.
3. Set **Program/script** to `lumina` and **Add arguments** to `discover run`.
4. Set **Start in** to the workspace folder.
5. Run the task once and confirm that candidates appear in `raw/discovered/`.

The computer must be on, or the task must be configured to run after the next available start time.

## Verify and troubleshoot

After an automated run, review `raw/discovered/` before ingesting. If no candidates appear, run `lumina discover run --dry-run` manually from the workspace root and correct the watchlist in chat. If a scheduled task cannot find `lumina`, use the full path to the command or fix its working folder, then run the task manually again.

For technical feed rules and command details, see the [Research Watch reference](../reference/research-watch.md).
