#!/usr/bin/env bash
# cron-daily.sh — invoke /lumi-research-watch-run from a cron / launchd / Task
# Scheduler job. The wrapper is INERT by default; nothing schedules it until
# the user explicitly wires it into their scheduler (see
# docs/user-guide/research-watch.md).
#
# Path-portability: cd into the project root via $(dirname "$0") so the same
# script works regardless of where the scheduler invokes it from.

set -euo pipefail

# Restrictive umask BEFORE the log redirect so any new files inherit 600.
umask 077

# Resolve project root (three levels up from this script).
cd "$(dirname "$0")/../../.."

LOG="_lumina/_state/watch-run.log"
ROTATED="${LOG}.1"
mkdir -p "$(dirname "$LOG")"

# Rotate at ~1 MB.
if [ -f "$LOG" ]; then
  size_bytes=$(wc -c < "$LOG" | tr -d ' ')
  if [ "$size_bytes" -gt 1048576 ]; then
    mv "$LOG" "$ROTATED"
  fi
fi

touch "$LOG"
chmod 600 "$LOG"

{
  echo "=== $(date -u +%FT%TZ) watch-run start ==="
  node _lumina/scripts/discover-runner.mjs --watchlist _lumina/config/watchlist.yml || rc=$?
  echo "=== $(date -u +%FT%TZ) watch-run end (rc=${rc:-0}) ==="
} >> "$LOG" 2>&1
