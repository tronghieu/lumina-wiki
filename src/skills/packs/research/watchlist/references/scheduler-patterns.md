# Scheduler platform patterns

Read this only after the user asks to automate discovery and names a platform.
Automation starts the installed runner; it never installs itself. First run a
manual discovery pass successfully, then confirm the workspace path, the
cadence, and whether the scheduler may write candidate records.

Use the runner from the workspace root. Add `--schedule daily`, `weekly`, or
`monthly` when one scheduler should honor only that cadence. Without a schedule
filter, every enabled item runs whenever the command is invoked.

## GitHub Actions

Use this for a workspace stored in a GitHub repository when an unattended
runner is appropriate. Schedule times are UTC. The workflow needs permission
to commit only if the user wants candidate records committed.

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
      - run: lumina discover run --schedule weekly --json
```

If the user wants commits, add their normal review or commit step after the
run; do not silently add a push.

## cron and launchd

For cron, use absolute paths because scheduler environments have a minimal
`PATH`:

```cron
0 8 * * 1 cd /absolute/path/to/wiki && /absolute/path/to/node _lumina/scripts/discover-runner.mjs --schedule weekly --json >> _lumina/_state/watch-run.log 2>&1
```

The shipped `_lumina/scripts/scheduler-samples/cron-daily.sh` provides log
rotation and restrictive permissions, but intentionally has no cadence filter;
use it only when every enabled item should run on each invocation. For launchd,
run the same absolute command from a `ProgramArguments` array and set
`WorkingDirectory` to the workspace root. A sleeping laptop may miss cron or
launchd schedules.

## Windows Task Scheduler

Create a task with the requested trigger. Set **Program/script** to the full
path of `node.exe`, **Add arguments** to
`_lumina/scripts/discover-runner.mjs --schedule weekly --json`, and **Start
in** to the workspace root. Run it once manually and verify the result before
leaving it enabled.

## After setup

Inspect `raw/discovered/` and `_lumina/_state/watch-run.log` after the first
scheduled run. If the task cannot find Node or the workspace, correct the
absolute program path or working directory rather than changing the watchlist.
