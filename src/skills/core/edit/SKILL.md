---
name: lumi-edit
description: >
  Guided wiki page authoring and refactoring: apply user-directed edits to a
  wiki page with schema validation and bidirectional-edge integrity preserved.
  Use this whenever the user asks to update, fix, revise, rewrite, correct, or
  clean up a wiki page — even if they don't say "edit". Also fires for: "fix the
  reverse link on X", "update the summary for Y", "set importance to 4 on Z",
  "the lint check found a missing link in ...", or any request that modifies one
  wiki page without ingesting a new source.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# /lumi-edit

## Role

You are the wiki page editor. You apply the user's requested change to one wiki page,
keep all cross-reference edges consistent, and confirm the page is lint-clean before
reporting done. You do not ingest new sources, create new entity pages, or modify raw/.

## Context

Read `README.md` at the project root before this SKILL.md. The Repository Layout,
Page Types, Link Syntax, Cross-Reference Rules, and Constraints sections there are
authoritative. This skill operates within those conventions.

Key workspace paths:
- `wiki/<type>/<slug>.md` — the page you edit
- `_lumina/scripts/wiki.mjs` — engine (read-meta, set-meta, add-edge, dedup-edges)
- `_lumina/scripts/lint.mjs` — linter (--fix, --json)

## Instructions

### Step 1 — Understand the requested edit

Parse the user's message to identify:
- Which page to edit (slug or title; if ambiguous, ask)
- What kind of edit: update content, fix a link, add/remove a cross-reference, correct frontmatter

Do not expand scope. If the user says "fix the reverse link to concepts/lora", edit
only that relationship.

### Step 2 — Read current state

```bash
node _lumina/scripts/wiki.mjs read-meta <slug>
```

Returns `{ frontmatter, filePath }`. Then read the full file body:

```bash
# Read the file at the returned filePath
```

Read the page with the Read tool to see its current content.

### Step 3 — Read existing edges

```bash
node _lumina/scripts/wiki.mjs read-edges <slug>
```

Returns `{ outbound: [...], inbound: [...] }`. Review these before writing new ones;
this prevents duplicate edges (dedup-edges handles duplicates, but not writing them
to begin with is cleaner).

### Step 4 — Apply the edit

Use the Edit tool to modify the file. Follow these rules from README.md:
- Preserve `<!-- user-edited -->` annotated sections byte-for-byte; append your
  changes after them rather than modifying them.
- Maintain Obsidian wikilink syntax: `[[slug]]`.
- Keep slug convention: lowercase, hyphen-separated, no diacritics.
- Update the `updated` frontmatter field to today's ISO date.

### Step 5 — Re-derive edges

For every forward link you add or change, write the corresponding reverse edge in
the same operation. This is the load-bearing bidirectional invariant.

```bash
node _lumina/scripts/wiki.mjs add-edge <from-slug> <edge-type> <to-slug>
```

Example — source page gains a new concept link:
```bash
node _lumina/scripts/wiki.mjs add-edge sources/attention-revisited uses_concept concepts/softmax-temperature
node _lumina/scripts/wiki.mjs add-edge concepts/softmax-temperature used_in sources/attention-revisited
```

Both calls are idempotent: re-running them leaves the graph byte-identical (no
duplicate edges are written).

For a removed link, removing the wikilink from the body does not auto-remove the
edge. Call `dedup-edges` and then manually check if the old edge is still
appropriate. If not, edit `wiki/graph/edges.jsonl` directly (remove the line), then
re-run `dedup-edges` to verify consistency.

### Step 6 — Lint and fix

Run the linter with fix enabled:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

Read the JSON output. If `summary.errors > 0` after fix, address each remaining
error:
- L06 (missing reverse edge): add the reverse with `add-edge`
- L07 (duplicate symmetric edge): run `dedup-edges`
- Other errors: apply inline

L02 (orphan), L04 (missing key_sources), L05 (low-confidence claim), L08 (stale
date) are warnings — surface them to the user as advisory but do not block completion.

### Step 7 — Log the operation

```bash
node _lumina/scripts/wiki.mjs log edit "Updated <slug>: <brief description>"
```

## Output Format

Report to the user:
1. What changed (one sentence per change type)
2. Edges added or removed
3. Lint result (errors / warnings count)

Example:
```
Edited concepts/softmax-temperature.md:
- Added definition paragraph in ## Overview
- Linked back to sources/attention-revisited (used_in edge added)
Lint: 0 errors, 1 warning (L08: stale updated date — check if intentional)
```

## Examples

<example>
User: "The lint report says concepts/positional-encoding is missing a reverse link
from sources/attention-revisited."

Normal case — fix a missing reverse edge:
```bash
node _lumina/scripts/wiki.mjs read-edges concepts/positional-encoding
node _lumina/scripts/wiki.mjs add-edge concepts/positional-encoding used_in sources/attention-revisited
node _lumina/scripts/wiki.mjs add-edge sources/attention-revisited uses_concept concepts/positional-encoding
node _lumina/scripts/lint.mjs --fix --json
node _lumina/scripts/wiki.mjs log edit "Fixed missing reverse link: concepts/positional-encoding <-> sources/attention-revisited"
```
</example>

<example>
User: "Expand the ## Overview section of concepts/chain-of-thought."

Edge case — content-only update with no link changes:
Read the page, apply the expansion via Edit tool, update `updated` date in
frontmatter, run lint, log. No edge calls needed unless the edit introduces
a new `[[link]]`.
</example>

<example>
User: "Edit every concept page to add a new ## See Also section."

Refusal / escalation — multi-page bulk edit:
This is a multi-page operation. Process pages one at a time and confirm each
before proceeding, or ask the user if they want to proceed with the first page
as a template and confirm before continuing. Never silently expand scope.
</example>

## Guardrails

- Never modify files in `raw/`. This skill is wiki/-only.
- Never modify `wiki/graph/edges.jsonl` except by calling `add-edge` or `dedup-edges`.
- If the user asks to edit multiple pages, process them one at a time and confirm
  each before proceeding.
- If a page does not exist, do not create it — use `/lumi-ingest` instead.
- If you are unsure about scope, ask rather than expanding silently.

## Definition of Done

Before reporting done, verify:

(a) `node _lumina/scripts/lint.mjs --json` shows `summary.errors === 0`
(b) `wiki/log.md` has a new `## [YYYY-MM-DD] edit | ...` entry
(c) Running `/lumi-edit` again with the same instruction produces byte-identical
    `wiki/` output (idempotency — add-edge is a no-op on the second pass; Edit
    produces no diff if content unchanged)
