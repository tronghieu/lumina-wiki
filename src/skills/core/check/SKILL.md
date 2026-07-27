---
name: lumi-check
description: >
  Run lint.mjs --json, summarize findings by severity, offer to apply --fix for
  auto-fixable checks (L01/L02/L03/L05/L06/L07/L09), self-check re-run to confirm 0
  errors, and surface advisory warnings for user attention.
  Use this whenever the user asks to "check the wiki", "run lint", "verify the
  graph", "are there broken links?", "what's wrong with the wiki?", "health
  check", or "are there missing reverse links?". Also fires for: weekly review
  requests, before committing wiki changes, after a bulk ingest session, or any
  time the user wants to know the structural state of the wiki.
allowed-tools:
  - Bash
  - Read
---

# /lumi-check

> If you were spawned in the same session that just ran `/lumi-ingest`, surface
> a one-line note to the user suggesting they re-run this check in a fresh
> session or via a subagent for an independent read — then proceed normally.
> Same model with blank context catches bias from the reasoning chain that
> built the pages you are now reviewing.

## Role

You are the wiki's quality gate. You run the linter, classify findings, apply
safe fixes with a self-check re-run, and surface the issues the user
must resolve manually. You do not decide what is correct content — you enforce
structural and graph-integrity rules.

## Context

Read `README.md` at the project root before this SKILL.md. The Cross-Reference
Rules section defines the bidirectional-link invariant this check enforces. The
Constraints section lists the non-negotiable rules.

Key workspace paths:
- `_lumina/scripts/lint.mjs` — the linter; always call with `--json`
- `_lumina/config/lumina.config.yaml` — bidirectional exemption globs
- `wiki/log.md` — log the check result here

Read `references/lint-checks.md` before classifying findings or explaining
which checks are auto-fixable.

## Instructions

### Step 1 — Run lint in read mode

```bash
node _lumina/scripts/lint.mjs --json
```

Do not pass `--fix` on the first pass. Read the JSON output to understand the
full scope before applying any changes.

JSON output shape:
```json
{
  "schema_version": "0.1.0",
  "scanned_files": <number>,
  "checks_run": ["L01","L02",...],
  "findings": [
    {
      "id": "<check-id>-<slug>",
      "severity": "error"|"warning"|"info",
      "fixable": true|false,
      "file": "sources/lora.md",
      "line": 12,
      "message": "...",
      "fix_applied": false,
      "proposed_fix": "..."
    }
  ],
  "summary": { "errors": N, "warnings": N, "info": N, "fixes_applied": 0 }
}
```

### Step 2 — Classify findings

Group findings using `references/lint-checks.md`: errors first, then advisory
warnings. Surface warnings even when `summary.errors === 0`.

### Step 3 — Offer to apply fixes

If there are auto-fixable findings, tell the user what will be fixed and ask for
confirmation:

"I found <N> fixable findings. I can auto-fix the following:
- L06 (missing reverse edge): <list of files>
- L09 (index out of sync)
Shall I apply --fix?"

If the user confirms (or runs `/lumi-check --fix` directly):

```bash
node _lumina/scripts/lint.mjs --fix --json
```

The `--fix` pass:
- Applies the supported auto-fixes listed in `references/lint-checks.md`
  (L01, L02, L03, L05, L06, L07, L09)
- Leaves every other check (L04, L08, L10, L11, L12, L13, L14, L16, L17)
  for manual correction
- Within a fixable check, some individual findings still can't be repaired
  safely (e.g. an L01 on a `number`/`enum` field with no safe default, or an
  L05 wikilink whose basename matches more than one page). Those specific
  findings are left standing on purpose — a correct error beats a silently
  wrong value — and show up again in Step 4

### Step 4 — Self-check re-run

After applying fixes, re-run lint to confirm the error count reached 0:

```bash
node _lumina/scripts/lint.mjs --json
```

If errors remain, do not report done. Address each remaining error specifically:
- If L06 persists after `--fix`, the reverse edge target may not exist yet. Identify
  the missing page and suggest `/lumi-ingest` or `/lumi-edit` to create it.
- If L01 or L02 persist, `--fix` recognized the check but could not safely
  repair this particular finding — most often a `number` or `enum` field
  (e.g. a source's `year` or `importance`) with no value it could infer on its
  own. It never writes a wrong-typed placeholder; a standing finding means it
  genuinely needs a human or an inference pass. Run
  `node _lumina/scripts/lint.mjs --suggest --json` and read each finding's
  `suggestion` field for a concrete value or next step, then either apply it
  yourself with `wiki.mjs set-meta` or hand the batch to `/lumi-migrate-legacy`
  (`set-meta` will refuse a value that doesn't match the field's declared
  type, so a bad guess never lands silently):
  ```bash
  node _lumina/scripts/wiki.mjs set-meta <slug> <key> "<value>"
  ```
- If L05 persists, the wikilink's basename matched zero or more than one page
  — `--fix` only rewrites a link when exactly one match exists. Run
  `node _lumina/scripts/lint.mjs --suggest --json` and read each finding's
  `candidates` array (the matching pages, if any) and `suggestion` field, then
  either pick the right target yourself or hand it to `/lumi-migrate-legacy`
  to decide from page context.
- If L08 or L10 remain, report the exact edges or alias conflicts that need
  manual correction.
- If L13 or L16 persist, suggest `/lumi-migrate-legacy --backfill-ids` — these
  are not fixed by `lint.mjs --fix`.
- If L17 (dangling edge) persists, the edge still points at a slug with no
  wiki file. Run `wiki.mjs remove-edge <from> <type> <to>` to drop it, or
  recreate the missing page if the relationship should still hold.

Repeat until `summary.errors === 0`. Do not loop more than 3 times — if errors
persist, surface them to the user as needing manual attention (point them at
`/lumi-migrate-legacy` if the remaining findings are the judgment-only kind
above).

### Step 5 — Log the check

```bash
node _lumina/scripts/wiki.mjs log check "<N> errors fixed, <M> warnings advisory. <N2> errors remain."
```

## Output Format

Present findings in a structured list. Group errors first, then warnings.

```
Lint check: <scanned_files> files scanned

Errors (N):
  concepts/positional-encoding.md:18 — a return link is missing, pointing back to sources/attention-revisited (L06)
  summary/transformers-overview.md:42 — a link points to a page that does not exist: [[flash-decoding]] (L05)

Warnings (M, advisory):
  concepts/rotary-embeddings.md — this page has no inbound or outbound links yet (L04)
  wiki/index.md — the page catalog is out of date (L09)

Fixes available: L06, L09 (N total). Apply? [yes/no]
```

After fix + re-run:
```
Fixed N errors. Re-run: 0 errors, M warnings.
Log entry written.
```

## Examples

<example>
User: "Run a lint check."

Normal case — clean wiki with only advisory warnings:
```bash
node _lumina/scripts/lint.mjs --json
# → { "summary": { "errors": 0, "warnings": 2, ... } }
```
Report: "0 errors. 2 advisory warnings: [list]. No fixes needed."
Log: `check | 0 errors, 2 warnings advisory.`
</example>

<example>
User: "/lumi-check --fix" (or user confirms fix after seeing the plan)

Normal fix path — missing reverse edges:
```bash
node _lumina/scripts/lint.mjs --json
# → 3 L06 errors; show the user the file list
# User confirms
node _lumina/scripts/lint.mjs --fix --json
# → 3 fixes applied
node _lumina/scripts/lint.mjs --json
# → 0 errors (self-check re-run confirms)
node _lumina/scripts/wiki.mjs log check "3 L06 errors fixed. 0 errors remain."
```
The self-check re-run is non-negotiable — do not report "fixed" until lint
confirms 0 errors.
</example>

<example>
User: "Check the wiki and auto-fix everything without asking me."

Guardrail escalation — user wants silent auto-fix:
Never apply --fix without first showing what will change. Explain what the fix
list contains and ask for confirmation. This protects against file renames and
index rewrites the user may want to review first.
</example>

## Guardrails

- Always run lint --json (read-only) before running lint --fix. Never apply fixes
  without showing the user what will change.
- Do not modify `wiki/` directly during this skill — all mutations go through
  `lint.mjs --fix` (which uses atomic writes internally).
- Do not suppress warnings as noise. Surface every advisory so the user is aware.
- The self-check re-run is non-negotiable. Reporting "fixed" without a confirming
  lint pass is not acceptable.

## Definition of Done

Before reporting done, verify:

(a) `node _lumina/scripts/lint.mjs --json` shows `summary.errors === 0`
(b) `wiki/log.md` has a new `## [YYYY-MM-DD] check | ...` entry
(c) Running `/lumi-check` again immediately after produces the same 0-error result
    (no regressions from the fix pass)
