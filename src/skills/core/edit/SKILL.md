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
- `_lumina/scripts/wiki.mjs` — engine (read-meta, set-meta, add-edge, remove-edge,
  replace-edge, dedup-edges)
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

For every cross-reference you add or change, call `add-edge` once for the forward
relationship. `add-edge`, `remove-edge`, and `replace-edge` are the supported
graph mutation paths — all three go through `wiki.mjs` and write the required
reverse edge automatically unless the edge is terminal, exempt, or symmetric.

```bash
node _lumina/scripts/wiki.mjs add-edge <from-slug> <edge-type> <to-slug>
```

Example — source page gains a new concept link:
```bash
node _lumina/scripts/wiki.mjs add-edge sources/attention-revisited uses_concept concepts/softmax-temperature
```

The call is idempotent: re-running it leaves the graph byte-identical (no
duplicate edges are written).

For a removed link, removing the wikilink from the body does not auto-remove the
edge — page bodies do not encode relation type, so the removal is not automatic.
Use `wiki.mjs remove-edge <from> <type> <to>` to drop the stale relationship
(both directions, respecting the terminal/exempt/symmetric gate; `--dry-run`
previews first). It emits an `advisories` note if the page body still contains
the corresponding wikilink, since remove-edge does not touch page content
itself. To correct a wrong relation type instead of removing it outright, use
`wiki.mjs replace-edge <from> <old-type> <to> <new-type>` — because bodies list
cross-references in a generic, type-agnostic section, a type-only correction
needs no page edit at all. Never hand-edit `wiki/graph/edges.jsonl` directly.

### Step 6 — Lint and fix

Run the linter with fix enabled:

```bash
node _lumina/scripts/lint.mjs --fix --json
```

Read the JSON output. If `summary.errors > 0` after fix, address each remaining
error:
- L06 (missing reverse edge): re-run the forward `add-edge`; it auto-adds reverse
- L07 (duplicate symmetric edge): run `dedup-edges`
- L17 (dangling edge): an edge still points at a slug that no longer resolves
  to a wiki file — a common side effect of renaming or deleting a page. Run
  `remove-edge <from> <type> <to>` to drop it, or recreate the missing page
- Other errors: apply inline

Warnings are advisory, but errors block completion until fixed or surfaced as
manual follow-up.

### Step 7 — Log the operation

```bash
node _lumina/scripts/wiki.mjs log edit "Updated <slug>: <brief description>"
```

After logging, suggest the user run `/lumi-check` in a fresh session or via a
sub-agent. Blank context catches bias from the reasoning chain that just made
this edit.

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
Links check out — one advisory note: this page has no inbound links yet (L04)
```

## Examples

<example>
User: "The lint report says concepts/positional-encoding is missing a reverse link
from sources/attention-revisited."

Normal case — fix a missing reverse edge:
```bash
node _lumina/scripts/wiki.mjs read-edges concepts/positional-encoding
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
- Never hand-edit `wiki/graph/edges.jsonl`; graph mutation goes through
  `wiki.mjs` (`add-edge`, `remove-edge`, `replace-edge`).
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
