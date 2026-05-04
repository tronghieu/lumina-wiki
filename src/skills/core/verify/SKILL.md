---
name: lumi-verify
description: >
  Check that wiki notes match the sources they cite. Flags statements that
  appear in a wiki page but are not supported by the cited material, statements
  that contradict other parts of the same page, and (with --external) statements
  contradicted by current web search results. Reports findings for the user to
  review; never edits notes automatically.
  Run on one page (`/lumi-verify <slug>`), the whole wiki (`/lumi-verify --all`),
  or only recently-changed pages (`--since <date>`). Use after AI adds new wiki
  pages, before sharing or exporting the wiki, or as a periodic health check on
  older pages. Trigger on phrases like "verify", "fact-check the wiki", "is this
  page accurate?", "check sources", "retro verify". Operates on sources/* pages
  in v0.9; other page types are skipped.
allowed-tools:
  - Bash
  - Read
  - Agent
---

# /lumi-verify

Read `README.md` at the project root before this SKILL.md.

## Role

You are the wiki's semantic integrity auditor. You run three reviewers — each
deliberately starved of the others' context — to find fabricated or drifted
claims in `sources/*` entries without anchoring bias. Findings are advisory:
you write to frontmatter only, never to body text.

## Context

Key workspace paths:
- `_lumina/scripts/wiki.mjs` — all frontmatter mutations go through here
- `_lumina/_state/lumi-verify-<ts>.json` — timestamped run report (never overwritten)
- `_lumina/_state/verify-prompts/<slug>/` — Bash-only fallback prompt files
- `wiki/sources/` — entities this skill operates on
- `wiki/graph/` — edge context for Grounding reviewer
- `raw/` — immutable raw artifacts; only read, never written

Read `references/reviewers.md` before launching any reviewer sub-agent or
writing Bash-only prompt files. It contains the full text of all three
reviewer prompts.

Read `references/triage.md` before classifying a finding or merging results
from multiple reviewers.

## Instructions

### Step 1 — Detect runtime

Try to determine whether the Agent tool is available. If the host runtime
supports Agent (Claude Code), proceed with the preferred path. Otherwise,
take the Bash-only fallback path described in Step 3b.

### Step 2 — Parse args and resolve targets

Accepted invocations:
- `/lumi-verify <slug>` — verify one entry, e.g. `sources/attention-revisited`
- `/lumi-verify --all` — verify every `sources/*` entry
- `/lumi-verify --since <date>` — verify entries whose `updated` >= `<date>` (ISO 8601 date or datetime). Reject malformed dates with exit 1.
- `/lumi-verify --external` — additionally run the External reviewer (open-web check). Default is offline-only (Blind + Grounding).

Resolve the target list:

```bash
node _lumina/scripts/wiki.mjs list-entities --type sources --json
```

For a single `<slug>` arg: validate it exists, exit 2 with a message if not.

For `--all`: count entries. If count > 50, HALT and confirm with the user
before proceeding (token budget guard).

For `--since <date>`: filter the list using each entry's `updated` frontmatter
field read via `wiki.mjs read-meta`.

### Step 3 — For each target entry

#### Preflight: read entry metadata

```bash
node _lumina/scripts/wiki.mjs read-meta <slug> --json
```

Collect: `raw_paths`, `provenance`, `verify_status` (if any).

**Provenance gate:**
- `provenance: missing` or no `raw_paths` at all → set `verify_status: skipped`,
  log reason, write to report, skip remaining steps for this entry.
- `raw_paths` present: check each path exists on disk using `Bash test -f`.
  If any resolve to missing files → set `verify_status: drift_detected`, log
  which files are missing, write to report. Skip Grounding reviewer (Steps 3a-ii
  below) cleanly — do not error.

#### 3a — Preferred path (Agent tool available)

Launch up to two reviewers in parallel (Blind always runs; Grounding only if
preflight passed). External runs only when `--external` is passed explicitly.

Read `references/reviewers.md` for the full text of each reviewer prompt before
launching.

**Reviewer i — Blind**

Launch a sub-agent with:
- Context: the full text of `wiki/sources/<slug>.md`
- No access to raw files, no graph, no sources frontmatter field
- Task: per the Blind reviewer prompt in `references/reviewers.md`

**Reviewer ii — Grounding** (skip if drift_detected or provenance: missing)

Launch a sub-agent with:
- Context: entry text + contents of every file listed in `raw_paths` + relevant
  excerpt from `wiki/graph/edges.jsonl` for this entry
- Task: per the Grounding reviewer prompt in `references/reviewers.md`

**Reviewer iii — External** (only if `--external` flag passed)

Launch a sub-agent with:
- Context: entry text + two web queries (confirmatory + adversarial)
- The adversarial query `<central claim> debunked|criticism|alternative` is
  mandatory. Do not skip it.
- Task: per the External reviewer prompt in `references/reviewers.md`

Collect each reviewer's findings as a structured list. Proceed to Step 4.

#### 3b — Bash-only fallback path (no Agent tool)

Write per-reviewer prompt files using the text from `references/reviewers.md`,
substituting the actual entry content and raw file contents:

```
_lumina/_state/verify-prompts/<slug>/blind.md
_lumina/_state/verify-prompts/<slug>/grounding.md   (if raw_paths resolved)
_lumina/_state/verify-prompts/<slug>/external.md    (if --external passed)
```

HALT. Tell the user:

"Agent tool not available. Reviewer prompts written to
`_lumina/_state/verify-prompts/<slug>/`. Run each in a fresh session and paste
the findings back here to continue."

Do not proceed to Step 4 until the user provides findings.

### Step 4 — Triage and merge findings

Read `references/triage.md` for the full four-bucket classification rubric and
merging rules.

Each finding must have this shape:

```json
{
  "id": <integer>,
  "reviewer": "blind" | "grounding" | "external",
  "class": "decision_needed" | "patch" | "defer" | "dismiss",
  "claim": "<the claim as written in the entry>",
  "evidence": "<what the reviewer found>",
  "action": "<recommended action for the user>"
}
```

Assign sequential integer ids starting at 1 per entry (reset per entry, not
per run).

If any finding has `class: decision_needed`, HALT immediately after presenting
that finding. Do not continue to the next entry or write any other findings
silently. Confirm with the user before proceeding.

### Step 5 — Write frontmatter

Unless `--stage` is passed, write results back via `wiki.mjs set-meta`:

```bash
# Write verify_status (scalar)
node _lumina/scripts/wiki.mjs set-meta <slug> verify_status <verdict>

# Write findings array (use --json-value for array)
node _lumina/scripts/wiki.mjs set-meta <slug> findings '<findings-json-array>' --json-value
```

Verdict rules (applied per entry, in order):
- Preflight: no `raw_paths` at all → `verify_status: skipped`. Skip remaining rules.
- Preflight: any `raw_paths` resolves to missing file → `verify_status: drift_detected`. Skip remaining rules.
- Any finding with `class: decision_needed` → HALT before writing (see Step 4); resume only after the user resolves it.
- Any finding with `class: patch` or `class: defer` → `verify_status: findings_pending`.
- All findings are `class: dismiss`, OR no findings at all → `verify_status: passed`. Keep `dismiss` items in `findings:` for audit but do not block.

Triage merge: when the same claim appears in two reviewers' outputs, keep the higher-severity `class` value but preserve the original `reviewer` field of the more-severe finding (do not produce mixed reviewer/class combinations like `reviewer: blind, class: decision_needed` — Blind is forbidden from `decision_needed`; if Blind's finding gets upgraded by a later reviewer, attribute it to the upgrading reviewer).

The `findings:` array replaces the previous array on each run. The full audit
trail lives in the timestamped report file, never overwritten.

### Step 6 — Write run report

Save the report atomically through `wiki.mjs checkpoint-write` (handles temp + fsync + rename, creates `_lumina/_state/` if missing). Do NOT use `fs.writeFileSync` directly — it violates the atomic-write rule and shell-interpolating finding text into a `node -e` string risks injection from quoted user content.

Two-step pattern that avoids both hazards:

1. Use the `Write` tool to put the report JSON in a tmp file under the OS temp dir (e.g. `/tmp/lumi-verify-report.json`). The Write tool serializes the object — no shell escaping concerns.
2. Hand the tmp file to `checkpoint-write`:

```bash
ts=$(date -u +%Y%m%dT%H%M%SZ)
node _lumina/scripts/wiki.mjs checkpoint-write lumi-verify "$ts" /tmp/lumi-verify-report.json
```

This produces `_lumina/_state/lumi-verify-<ts>.json` atomically and is safe regardless of finding content. The tmp file may be left in place — it is overwritten on the next run.

Report shape: see Output Format below.

### Step 7 — Log the run

```bash
node _lumina/scripts/wiki.mjs log verify "Verified <N> entries: <passed> passed, <findings_pending> findings, <skipped> skipped, <drift_detected> drift."
```

## Output Format

### Run report (`_lumina/_state/lumi-verify-<ts>.json`)

```json
{
  "schema_version": "0.9.0",
  "run_at": "<ISO timestamp>",
  "args": { "targets": ["sources/foo"], "external": false, "stage": false },
  "entries": [
    {
      "slug": "sources/foo",
      "verdict": "passed" | "findings_pending" | "drift_detected" | "skipped" | "not_applicable",
      "reviewers_run": ["blind", "grounding"],
      "findings": [],
      "drift_paths": []
    }
  ],
  "summary": {
    "total": 1,
    "passed": 1,
    "findings_pending": 0,
    "drift_detected": 0,
    "skipped": 0,
    "not_applicable": 0
  }
}
```

### Frontmatter fields written to each entry

| Field | Type | Values |
|---|---|---|
| `verify_status` | enum | `passed`, `findings_pending`, `drift_detected`, `skipped`, `not_applicable` |
| `findings` | array | Finding objects (see shape in Step 4); empty array when passed |

### User-facing summary

After all entries processed:

```
Verify run complete — <N> entries checked
  passed:           <N>
  findings_pending: <N>
  drift_detected:   <N>
  skipped:          <N>

Report: _lumina/_state/lumi-verify-<ts>.json
```

For `findings_pending` entries, list each finding with its class and recommended
action so the user can act without opening the report file.

## Examples

<example>
User: "/lumi-verify sources/attention-revisited"

Happy path — grounded entry:
```bash
node _lumina/scripts/wiki.mjs read-meta sources/attention-revisited --json
# → raw_paths: ["raw/download/arxiv/2604.03501v2.pdf"], provenance: replayable
# test -f confirms file exists
# Launch Blind reviewer sub-agent → no findings
# Launch Grounding reviewer sub-agent → no findings
node _lumina/scripts/wiki.mjs set-meta sources/attention-revisited verify_status passed
node _lumina/scripts/wiki.mjs set-meta sources/attention-revisited findings '[]' --json-value
# Write _lumina/_state/lumi-verify-20260503T120000Z.json
node _lumina/scripts/wiki.mjs log verify "Verified 1 entries: 1 passed, 0 findings, 0 skipped, 0 drift."
```
Report: "1 entry checked. passed: 1."
</example>

<example>
User: "/lumi-verify sources/gpt4-technical-report"

Fabricated-claim path — Grounding finds a discrepancy:

```bash
node _lumina/scripts/wiki.mjs read-meta sources/gpt4-technical-report --json
# → raw_paths: ["raw/sources/gpt4-technical-report.pdf"], provenance: replayable
# test -f confirms file exists
# Launch Blind reviewer → 1 finding: claim lacks attribution, class: patch
# Launch Grounding reviewer → 1 finding: "97.3% MMLU" not in raw (raw says 86.4%), class: patch
```

Triage: 2 findings, highest class is `patch`, no `decision_needed`.

```bash
node _lumina/scripts/wiki.mjs set-meta sources/gpt4-technical-report verify_status findings_pending
node _lumina/scripts/wiki.mjs set-meta sources/gpt4-technical-report findings '[
  {"id":1,"reviewer":"blind","class":"patch","claim":"GPT-4 significantly outperforms prior models","evidence":"Claim lacks specific numbers or citation","action":"Add quantitative reference or qualify with source section"},
  {"id":2,"reviewer":"grounding","class":"patch","claim":"GPT-4 achieved 97.3% on MMLU","evidence":"Raw PDF section 3.1 states 86.4%; 97.3% not found anywhere in document","action":"Correct the figure or note it refers to a different benchmark subset"}
]' --json-value
```

Report to user:
"1 entry checked. findings_pending: 1.

sources/gpt4-technical-report — 2 findings:
  [patch] blind: 'GPT-4 significantly outperforms...' — lacks specific numbers. Action: add quantitative reference.
  [patch] grounding: '97.3% on MMLU' — raw says 86.4%. Action: correct the figure."
</example>

## Guardrails

**Always:**
- Operate on `sources/*` entities only. Any non-sources slug gets
  `verify_status: not_applicable` without running reviewers.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write directly
  to `wiki/*.md` files.
- Each reviewer receives a deliberately limited context slice (see
  `references/reviewers.md`). Do not give Blind reviewer access to raw files.
  Do not give Grounding reviewer the open web. Anti-anchoring is structural.
- Run the External reviewer's adversarial query (`<claim> debunked|criticism|alternative`)
  whenever `--external` is set. This query is not optional.
- Drift preflight gates Grounding. If `raw_paths` files are missing, set
  `verify_status: drift_detected` and skip Grounding — do not crash or error.
- Write a new timestamped report file on every run. Never overwrite a previous
  report.

**Ask first:**
- If `--all` targets more than 50 entries, HALT and confirm before proceeding.
- If any finding has `class: decision_needed`, present it and HALT before
  continuing to the next entry or writing further findings.

**Never:**
- Never auto-edit wiki body text. `verify_status` and `findings:` frontmatter
  are the only fields written by this skill.
- Never bundle external API keys or MCP `llm-review` plumbing.
- Never skip the External reviewer's adversarial query when `--external` is set.
- Never add new `wiki.mjs` subcommands. Use only: `read-meta`, `set-meta`,
  `list-entities`, `checkpoint-write`, `log`.
- Never store findings in body text or in regions marked `<!-- user-edited -->`.

## Definition of Done

Before reporting done, verify:

(a) Every target entry has `verify_status` written (or `--stage` was passed)
(b) `findings:` frontmatter is an array (empty for `passed` entries)
(c) A new `_lumina/_state/lumi-verify-<ts>.json` report file exists and is
    valid JSON
(d) `wiki/log.md` has a new `## [YYYY-MM-DD] verify | ...` entry
(e) No `decision_needed` findings were written silently — each one caused a HALT
    and was confirmed by the user before continuing
