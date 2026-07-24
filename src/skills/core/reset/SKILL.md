---
name: lumi-reset
description: >
  Scoped destructive reset with confirmation UX: show a dry-run plan, require
  explicit user confirmation in chat, then execute reset.mjs. Five scopes:
  wiki, raw, state, checkpoints, all. Always dry-runs first — never skips
  the plan step.
  Use this whenever the user says "reset the wiki", "clear everything", "start
  over", "delete all wiki pages", "wipe the raw folder", "clear stuck checkpoints",
  "the ingest got stuck and I want to restart", or any request to bulk-delete
  wiki or raw content. Also fires for: "I want a clean slate", "remove all
  ingested content", "clear the state files". When the scope is ambiguous,
  ask before running dry-run — "did you mean wiki/, raw/, or all (wiki + state)?"
allowed-tools:
  - Bash
  - Read
---

# /lumi-reset

## Role

You are the wiki's controlled demolition operator. You help the user clear wiki
content, raw sources, or operational state cleanly — with a plan-before-execute
discipline that makes irreversible actions visible before they happen.

This skill wraps `reset.mjs`, which enforces its own path-safety checks. Your
additional responsibility is the human gate: show the dry-run plan and require
an explicit "yes" from the user in the chat before calling `--yes`.

## Context

Read `README.md` at the project root before this SKILL.md. The Repository Layout
section defines which directories each scope targets. The Constraints section
reminds you that `raw/` is user-owned — resetting it is more irreversible than
resetting `wiki/`.

Key workspace paths:
- `_lumina/scripts/reset.mjs` — the only script this skill invokes
- `_lumina/_state/` — operational checkpoints (scope: `state`, `checkpoints`)
- `wiki/` — LLM-maintained pages (scope: `wiki`)
- `raw/` — user-owned sources (scope: `raw`)

## Scope Reference

| Scope | What is deleted | Recoverable? |
|-------|----------------|-------------|
| `wiki` | All files under `wiki/` (keeps directory structure) | Only from git |
| `raw` | All files under `raw/sources/`, `raw/notes/`, `raw/assets/` | Not from wiki |
| `state` | Everything under `_lumina/_state/`, including subfolders (saved reviewer prompts, feed state) | Yes — re-ingest regenerates |
| `checkpoints` | Every `<skill>-<phase>.json` file directly under `_lumina/_state/` — this is ANY checkpoint, not just ingest: resume points, research-discover shortlists, discovery-phase checkpoints, and saved `/lumi-verify` report files (`lumi-verify-<ts>.json`) | Yes for ingest/discover checkpoints — re-run regenerates. **No** for saved `/lumi-verify` reports — those are deleted too and are not regenerated automatically. |
| `all` | `wiki` + `state` — leaves `raw/` untouched | Only wiki from git |

The `checkpoints` scope is the lowest-risk reset in terms of what it targets
(no wiki content), but it is not scoped to "ingest only" — warn the user that
any saved `/lumi-verify` reports under `_lumina/_state/` are removed along with
stuck ingest checkpoints.

## Instructions

### Step 1 — Confirm scope with the user

If the user's message is ambiguous ("reset the wiki", "clear everything"), ask
which scope they intend before proceeding. Present the scope table above and ask
for the exact scope name.

Do not infer a destructive scope from an ambiguous request.

### Step 2 — Run dry-run plan

Show the user what will be deleted **before** asking for confirmation:

```bash
node _lumina/scripts/reset.mjs --scope <scope> --dry-run
```

The `--dry-run` flag makes `reset.mjs` print the deletion plan without deleting
anything and does not require `--yes`. `reset.mjs` reports aggregate
per-directory counts, not a per-file list. Example output:

```
Plan: --scope wiki --yes
Would delete:
  wiki/  (23 files, 45.2 KB)
Would recreate:
  wiki/index.md  (empty)
  wiki/log.md  (empty)
Total: 23 files, 45.2 KB
```

For the `checkpoints` scope, the deleted directory is labeled to make clear
only checkpoint files count toward the total, e.g.:

```
Plan: --scope checkpoints --yes
Would delete:
  _lumina/_state/ (checkpoints only)  (3 files, 1.8 KB)
Total: 3 files, 1.8 KB
```

Present the real aggregate plan to the user, and also translate it into one
plain sentence so a non-technical reader gets the point immediately, e.g.
"This will permanently delete 23 files under wiki/ — about 45 KB."

If the plan's final line reads `Total: 0 files, 0 B`, there is nothing to
delete. Skip Step 3 (confirmation) entirely — report "Nothing to delete for
scope `<scope>`; already clean." and stop. Do not ask for a "yes" that has
nothing to confirm.

### Step 3 — Require explicit confirmation

After showing the plan, ask:

"This will permanently delete <N> files. Type **yes** to proceed, or anything else
to cancel."

Wait for the user's reply in chat. Do not interpret "ok", "sure", or "go ahead"
as confirmation — require the literal word **yes**.

If the user types anything other than "yes", stop and report "Reset cancelled."
Do not proceed.

### Step 4 — Execute (only after explicit yes)

```bash
node _lumina/scripts/reset.mjs --scope <scope> --yes
```

`reset.mjs` will:
- Refuse paths containing `..` or absolute paths outside the project root
- Print what it deleted
- Exit 0 on success, 2 on path-safety violation

If `reset.mjs` exits with code 2, report the error message verbatim and stop.
Do not retry with modified paths.

### Step 5 — Log the operation

After a successful reset:

```bash
node _lumina/scripts/wiki.mjs log reset "Scope: <scope>. <N> files deleted."
```

If the scope was `wiki` or `all`, `wiki/log.md` itself was deleted. Recreate it
with a minimal header and the log entry:

```markdown
# Activity Log

_Append-only. Format: `## [YYYY-MM-DD] skill | details`_

## [YYYY-MM-DD] reset | Scope: <scope>. <N> files deleted.
```

Then suggest `/lumi-init` if the wiki scope was reset (to re-seed index.md and
re-verify directory structure).

## Output Format

**Before execution:**
```
Plan: --scope <scope> --yes
Would delete:
  wiki/  (23 files, 45.2 KB)
Would recreate:
  wiki/index.md  (empty)
  wiki/log.md  (empty)
Total: 23 files, 45.2 KB

This will permanently delete 23 files under wiki/ — about 45 KB.
Type yes to confirm, anything else to cancel.
```

**After successful execution:**
```
Reset complete. <N> files deleted.
Log entry written.
Next: run /lumi-init to re-seed the wiki, then /lumi-ingest to rebuild content.
```

## Examples

<example>
User: "The ingest for attention-revisited got killed. Start it over."

Safest reset — clear a single stuck checkpoint. `--scope checkpoints` deletes
every checkpoint file under `_lumina/_state/`, not just this one — check the
count before confirming:
```bash
node _lumina/scripts/reset.mjs --scope checkpoints --dry-run
# shows:
#   Plan: --scope checkpoints --yes
#   Would delete:
#     _lumina/_state/ (checkpoints only)  (1 files, 0.4 KB)
#   Total: 1 files, 0.4 KB
# Only one checkpoint exists right now, so this is safe.
# User confirms: yes
node _lumina/scripts/reset.mjs --scope checkpoints --yes
node _lumina/scripts/wiki.mjs log reset "Scope: checkpoints. 1 file deleted."
```
Suggest: "Now run `/lumi-ingest raw/sources/attention-revisited.pdf` to restart."
Checkpoint scope is lower-risk than `wiki` or `raw` (no wiki content touched),
but if other checkpoints exist (other stuck ingests, saved `/lumi-verify`
reports) they are deleted too — the dry-run count is the only way to know.
</example>

<example>
User: "I want to start the wiki over. Delete all wiki pages."

Normal case — full wiki scope reset:
Show dry-run (may be 30+ files). User types "yes".
```bash
node _lumina/scripts/reset.mjs --scope wiki --yes
```
After reset, log.md is gone — recreate it with the reset entry, then suggest
`/lumi-init` to re-seed index.md and verify directory structure.
</example>

<example>
User: "Reset everything." (then reconsiders after seeing the plan)

Escalation / reconsideration — user sees the dry-run plan for `all` scope:
Show the aggregate deletion plan for `wiki/` and `_lumina/_state/` only.
Explicitly state: "`all` does not delete raw/; use `--scope raw` only when you
intend to remove user-owned sources." User replies "cancel". Report: "Reset
cancelled. No files were deleted."
Never execute without the
literal word "yes" — ambiguous confirmations like "ok" or "sure" do not count.
</example>

## Guardrails

- Always run dry-run before execution, without exception. There is no fast path.
- Always require the literal word **yes** in chat before executing. Any other
  confirmation phrasing is not sufficient.
- Never construct or modify paths passed to reset.mjs. Pass the scope name only;
  let reset.mjs resolve the paths. This prevents path traversal.
- The `all` scope deletes wiki/ and state only. `raw/` is deleted only by
  `--scope raw` with confirmation; warn that raw files are not recoverable from
  the wiki and may not be in git.
- If reset.mjs exits 2 (path safety violation), do not retry. Report the error and
  stop. This is a signal that something unexpected is being targeted.

## Definition of Done

Before reporting done, verify:

(a) `reset.mjs` exited 0 (success)
(b) `wiki/log.md` has a new `## [YYYY-MM-DD] reset | ...` entry (recreate
    log.md first if scope was `wiki` or `all`)
(c) Running `/lumi-reset` again with the same scope and user confirmation produces
    the expected dry-run plan showing 0 files to delete (all already gone)
