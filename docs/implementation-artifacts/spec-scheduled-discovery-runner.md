---
title: 'Scheduled discovery runner with scored candidates'
type: 'feature'
created: '2026-05-05'
status: 'done'
baseline_commit: '294ba6714eb696930ffecef2ee31c3067ece3128'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/ROADMAP.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The roadmap's "daily fetch" shape is too narrow and implies Lumina or an agent can wake itself up. Users need a repeatable discovery job that can be called by cron, launchd, GitHub Actions, CI, or manually, and that produces a reviewable inbox of new research candidates without ingesting them.

**Approach:** Add a one-shot scheduled discovery runner, a research-pack watchlist template at `_lumina/config/watchlist.yml`, and a `/lumi-research-watchlist` skill that helps non-technical users create or update that file. The runner reads the watchlist, fetches metadata through existing research tools, deduplicates candidates, writes scored candidate records under `raw/discovered/`, updates runtime state, prints a run summary, and exits. Keep download and wiki mutation in `/lumi-ingest`; discovery only creates scored candidates for later human/agent review.

## Boundaries & Constraints

**Always:**
- Runner is one-shot: it runs once, prints a summary, exits, and never installs or starts a scheduler, daemon, background worker, cron entry, launchd job, or GitHub Action.
- Candidate output is metadata-only. Writes are limited to `raw/discovered/**` and `_lumina/_state/**`, using atomic writes for state and no overwrite of existing discovered records.
- Each candidate includes a discovery relevance score and score breakdown. The score answers "should this be reviewed first?", not "is this source true?".
- Research-pack installs scaffold `_lumina/config/watchlist.yml` as an editable disabled/example config. Upgrades may create the file if missing, but must preserve an existing user-edited watchlist.
- `/lumi-research-watchlist` is the plain-language assistant for watchlist setup. It asks what topics the user wants to follow, edits only the watchlist file, validates it, and may offer a dry-run command; it must not run scheduled discovery unless the user explicitly asks.
- Reuse existing research tools where practical: source fetchers (`fetch_arxiv.py`, `fetch_s2.py`) for metadata and `discover.py` for ranking/scoring. Do not call the `/lumi-research-discover` prompt from the runner.
- Dedup uses stable external identifiers first (`arxiv:<id>`, `s2:<paperId>`, DOI, canonical URL), then a title/authors/year fallback hash. Rerunning immediately must create zero duplicate records.
- S2 is optional. Missing `SEMANTIC_SCHOLAR_API_KEY` should not fail arXiv-only runs; source failures are reported in the summary.

**Ask First:**
- If implementation requires adding a daemon, local database, hosted service, telemetry, auto-created scheduler config, or automatic ingest, HALT and ask the user.
- If the existing fetcher/tool contracts cannot support machine-readable scoring without changing their CLI behavior incompatibly, HALT and propose a smaller compatible path.

**Never:**
- Do not mutate `wiki/**`, create source pages, graph edges, index entries, or log entries from scheduled discovery.
- Do not download PDFs or full text. `/lumi-ingest` remains the first step allowed to fetch full source artifacts for an accepted candidate.
- Do not add new native modules, dev dependencies, Jest/Vitest, postinstall behavior, or top-level heavy imports in `bin/lumina.js`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | Research workspace with `watchlist.yml` containing enabled arXiv item | `lumina discover run` writes `0..N` scored candidate JSON files under `raw/discovered/<date>/<watchlist-id>/`, updates state, prints counts | exit 0 |
| No due items | All watchlist items disabled or not matching `--schedule`/source filters | No writes; summary says zero items run | exit 0 |
| Missing watchlist | Research tools installed but `_lumina/config/watchlist.yml` is absent | No writes; message points to the advanced scheduling guide and expected file shape | exit 2 |
| Immediate rerun | Same config and state after successful run | No duplicate candidate files; summary reports duplicates skipped | exit 0 |
| Dry run | `--dry-run --json` with discoverable candidates | JSON summary lists would-write candidates; no state or raw writes | exit 0 |
| Bad config | Unsafe `id`, unknown source, invalid limit, or invalid schedule | No writes | exit 2 with actionable message |
| Partial source failure | arXiv succeeds, S2 fails or key missing | arXiv candidates are written; failed/skipped source appears in summary | exit 3 only for hard partial failure, exit 0 for optional missing key skip |

</frozen-after-approval>

## Code Map

- `bin/lumina.js` -- Add lazy `discover run` subcommand dispatch while preserving cold-start and existing install/uninstall behavior.
- `src/scripts/discover-runner.mjs` -- New one-shot runner: load workspace, config, state; call fetchers/scorer; dedup; write candidates and summary.
- `src/scripts/discover-runner.test.mjs` -- Node tests for config validation, dry-run, dedup, append-only writes, source filtering, and JSON summary.
- `src/scripts/lib/watchlist-config.mjs` -- New parser/validator for `_lumina/config/watchlist.yml`; validate safe IDs, schedules, sources, and limits.
- `src/scripts/lib/discovery-state.mjs` -- New state read/write helpers for `_lumina/_state/discovery-runner.json` using atomic writes.
- `src/installer/commands.js` -- Copy runner scripts into installed `_lumina/scripts/`; install research-pack `watchlist.yml` template.
- `src/installer/commands.test.js` -- Assert research installs include runner script and watchlist template.
- `src/skills/packs/research/watchlist/SKILL.md` -- New research-pack skill for assisted watchlist configuration in plain language.
- `src/templates/_lumina/config/watchlist.yml` -- Default disabled/example watchlist for research pack users.
- `package.json` -- Include new runner/lib script files in npm package and add script test entry.
- `docs/user-guide/advanced-scheduled-discovery.en.md`, `docs/user-guide/advanced-scheduled-discovery.vi.md`, `docs/user-guide/advanced-scheduled-discovery.zh.md` -- New advanced guide covering watchlist setup and scheduling with GitHub Actions, macOS/Linux cron/launchd, and Windows Task Scheduler.
- `README.md`, `README.vi.md`, `README.zh.md`, `docs/user-guide/en.md`, `docs/user-guide/vi.md`, `docs/user-guide/zh.md`, `ROADMAP.md` -- Replace daily-fetch wording with scheduled discovery, document `/lumi-research-watchlist`, explain that scheduling is external and download happens at ingest, and link to the advanced guide instead of embedding platform setup details.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/lib/watchlist-config.mjs` -- Add YAML config loader and validator -- gives the runner a strict, testable input contract.
- [x] `src/scripts/lib/discovery-state.mjs` -- Add runtime state helpers -- keeps seen keys and last run data outside canonical wiki content.
- [x] `src/scripts/discover-runner.mjs` -- Implement `runDiscover` and CLI flags (`--config`, `--schedule`, `--source`, `--limit`, `--dry-run`, `--json`) -- main scheduled discovery behavior.
- [x] `bin/lumina.js` -- Add lazy `discover run` command -- exposes the runner through the public CLI without eager imports.
- [x] `src/installer/commands.js` and `src/templates/_lumina/config/watchlist.yml` -- Copy runner files and install a write-once watchlist template for research pack workspaces -- makes sandbox installs runnable while preserving user-edited watchlists.
- [x] `src/skills/packs/research/watchlist/SKILL.md` and installer skill registration/tests -- Add `/lumi-research-watchlist` -- lets the agent help ordinary users configure watchlists without hand-editing from scratch.
- [x] `src/scripts/discover-runner.test.mjs` plus focused lib tests if needed -- Cover the I/O matrix and idempotency-sensitive behavior.
- [x] `package.json` -- Include new files and update `test:scripts` -- keeps package and CI coverage complete.
- [x] `docs/user-guide/advanced-scheduled-discovery.*.md` -- Add the advanced scheduling guide in supported languages -- documents GitHub Actions, macOS/Linux cron/launchd, and Windows Task Scheduler without bloating the main guide.
- [x] Main docs/README/ROADMAP files -- Update user-facing wording across supported languages and link to the advanced guide -- avoids promising daily-only or agent-self-running behavior.

**Acceptance Criteria:**
- Given a research workspace with an enabled arXiv watchlist item, when `lumina discover run --json` runs, then it writes scored metadata candidates to `raw/discovered/<date>/<id>/` and the JSON summary includes checked, fetched, new, duplicates, skipped, and errors counts.
- Given the same workspace immediately after a successful run, when the runner runs again, then it writes no duplicate candidates and reports duplicates skipped.
- Given `--dry-run`, when candidates are available, then no `raw/discovered/**` files and no `_lumina/_state/discovery-runner.json` changes are written.
- Given an invalid watchlist ID or unknown source, when the runner runs, then it exits 2 and writes nothing.
- Given a scored candidate record, when inspected, then it contains `score.total`, a score breakdown, `status: "new"`, `dedupKey`, source identifiers, query/watchlist metadata, and no downloaded PDF path.
- Given package install with the research pack, when the sandbox is inspected, then `_lumina/config/watchlist.yml` and the runner script are present.
- Given package install with the research pack, when installed skills are inspected, then `/lumi-research-watchlist` is present and listed in README/user-guide skill tables.
- Given `/lumi-research-watchlist` is used to add a topic, when the user provides topic, sources, schedule, and limit in plain language, then only `_lumina/config/watchlist.yml` changes and the result validates.
- Given package upgrade where `_lumina/config/watchlist.yml` already exists, when install runs again, then the existing watchlist content is preserved.
- Given the main user guide in any supported language, when scheduled discovery is mentioned, then it links to the advanced scheduled discovery guide rather than embedding platform-specific scheduler setup.

## Design Notes

MVP scoring should remain deterministic and metadata-based: topic overlap, recency, citation signal when present, metadata completeness, and duplicate penalty. Existing `discover.py` can provide the ranking score; the runner should preserve/normalize that into a readable `score` object rather than inventing LLM-only judgment.

The post-run flow is intentionally separate: scheduled discovery creates a scored inbox; `/lumi-research-discover` or `/lumi-ingest` handles human review and approved ingestion later.

Watchlist creation is intentionally simple: the installer provides a commented, disabled starter file for research-pack users, and `/lumi-research-watchlist` helps users edit it when they are ready. Runner execution should not invent topics or silently create an enabled watchlist.

## Verification

**Commands:**
- `npm run test:scripts` -- expected: discover runner and existing script tests pass.
- `npm run test:installer` -- expected: install/copy/package expectations pass.
- `npm run test:python` -- expected: existing fetcher/discovery contracts still pass.
- `npm run ci:idempotency` -- expected: install/upgrade watched paths do not drift.
- `npm run ci:package` -- expected: new scripts/templates are included and publish safety checks pass.

## Suggested Review Order

**Runner Flow**

- Start here for the one-shot discovery contract and write boundaries.
  [`discover-runner.mjs:23`](../../src/scripts/discover-runner.mjs#L23)

- Source fetch and ranking reuse the existing Python research tools.
  [`discover-runner.mjs:138`](../../src/scripts/discover-runner.mjs#L138)

- Candidate records carry dedup keys, scoring, status, and no paper download.
  [`discover-runner.mjs:179`](../../src/scripts/discover-runner.mjs#L179)

- Candidate writes are append-only and atomic.
  [`discover-runner.mjs:255`](../../src/scripts/discover-runner.mjs#L255)

**Watchlist Contract**

- Config loading keeps package `js-yaml` lazy and installed-script fallback local.
  [`watchlist-config.mjs:17`](../../src/scripts/lib/watchlist-config.mjs#L17)

- Fallback parsing keeps copied runner usable without workspace npm dependencies.
  [`watchlist-config.mjs:50`](../../src/scripts/lib/watchlist-config.mjs#L50)

- Watchlist normalization validates ids, schedules, sources, and limits.
  [`watchlist-config.mjs:143`](../../src/scripts/lib/watchlist-config.mjs#L143)

**Install Surface**

- Public CLI dispatch stays lazy and exposes `lumina discover run`.
  [`lumina.js:208`](../../bin/lumina.js#L208)

- Research installs scaffold watchlist once and preserve user edits.
  [`commands.js:240`](../../src/installer/commands.js#L240)

- Runner scripts and libs are copied into generated workspaces.
  [`commands.js:771`](../../src/installer/commands.js#L771)

- The new watchlist skill is registered with research-pack skills.
  [`commands.js:865`](../../src/installer/commands.js#L865)

**User Workflow**

- The watchlist skill keeps setup plain-language and config-only.
  [`SKILL.md:17`](../../src/skills/packs/research/watchlist/SKILL.md#L17)

- Advanced guide covers GitHub Actions, local schedulers, and ingest boundary.
  [`advanced-scheduled-discovery.en.md:47`](../user-guide/advanced-scheduled-discovery.en.md#L47)

**Verification**

- Runner tests cover dry-run, scoring, dedup, optional S2, and fallback parsing.
  [`discover-runner.test.mjs:104`](../../src/scripts/discover-runner.test.mjs#L104)

- Installer tests cover copied runner files, new skill, and watchlist preservation.
  [`commands.test.js:71`](../../src/installer/commands.test.js#L71)
