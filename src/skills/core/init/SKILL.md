---
name: lumi-init
description: >
  Bootstrap a fresh Lumina wiki workspace: verify config, materialize directory
  structure, seed wiki/index.md and wiki/log.md, and write the first log entry.
  Use this whenever the user says "initialize the wiki", "set up the wiki",
  "I just ran lumina install", "the wiki is empty", "start fresh", or "create
  the wiki structure". Also fires for: "wiki/index.md is missing", "the
  directories don't exist yet", or any first-run scenario after lumina install.
  Run once per workspace. Safe to re-run (idempotent).
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /lumi-init

## Role

You are the wiki bootstrapper. You turn a freshly installed workspace into a
working wiki: verified config, seeded core pages, correct directory structure,
and a lint-green starting state. After you finish, the user can immediately run
`/lumi-ingest` or `/lumi-ask`.

## Context

Read `README.md` at the project root before this SKILL.md. The Repository Layout
section there lists every directory that must exist. This skill materializes the
ones declared in the active pack set.

Key workspace paths:
- `_lumina/config/lumina.config.yaml` — pack selection and preferences
- `_lumina/manifest.json` — installed pack list (use this to know which packs are active)
- `_lumina/scripts/wiki.mjs` — engine (init subcommand)
- `_lumina/scripts/lint.mjs` — linter
- `wiki/index.md` — catalog of all pages (seeded empty, you add the header)
- `wiki/log.md` — append-only activity log (seeded empty, you add the first entry)

## Instructions

### Step 1 — Read the config

Read `_lumina/config/lumina.config.yaml` to confirm:
- `packs` list (which entity dirs to materialize)
- `languages.communication_language` (how to talk with the user)
- `languages.document_output_language` (how to write wiki content)
- `wiki.bidirectional_links.mode` (default: `exempt-only`)

Read `_lumina/manifest.json` to confirm which packs are recorded as installed.

If the config is missing or the manifest is absent, stop and ask the user to run
`lumina install` first.

### Step 2 — Initialize workspace directories via wiki.mjs

```bash
node _lumina/scripts/wiki.mjs init
```

For research pack (if installed):
```bash
node _lumina/scripts/wiki.mjs init --pack research
```

For reading pack (if installed):
```bash
node _lumina/scripts/wiki.mjs init --pack reading
```

Each call returns `{ ok: true, created: [...], skipped: [...] }`. Report which
directories were newly created and which already existed.

The `init` subcommand is idempotent: calling it again on an existing workspace
creates only missing directories and skips existing ones.

### Step 3 — Seed wiki/index.md

If `wiki/index.md` is empty or contains only the installer placeholder, write the
catalog header. Use the document output language from config.

Minimum content:
```markdown
---
id: index
title: Wiki Index
type: index
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Wiki Index

<!-- lumina:index -->
<!-- /lumina:index -->

_This catalog is updated automatically on every ingest._
```

The `<!-- lumina:index -->` markers are used by lint (L09) to verify the catalog
is present and up to date. Do not remove them.

### Step 4 — Seed wiki/log.md

If `wiki/log.md` is empty or a placeholder, write the header and the first entry:

```markdown
# Activity Log

_Append-only. Format: `## [YYYY-MM-DD] skill | details`_

## [YYYY-MM-DD] init | Wiki initialized. Packs: core{{, research, reading}}.
```

List only the packs that are actually installed.

### Step 5 — Run initial lint

```bash
node _lumina/scripts/lint.mjs --json
```

A fresh workspace with only the seeded pages should report 0 errors. If any
errors appear at this stage, fix them before proceeding — a green start is
part of this skill's contract.

Warnings (orphans, stale dates) on a brand-new wiki are expected and acceptable.

### Step 6 — Log the init

```bash
node _lumina/scripts/wiki.mjs log init "Wiki initialized. Packs: <list>. Created: <count> dirs, seeded index.md and log.md."
```

## Output Format

Report to the user:
1. Config values confirmed (packs, languages)
2. Directories created / already present
3. index.md and log.md status (seeded / already existed)
4. Lint result (errors count must be 0)
5. Next suggested action (e.g. "Drop a file into raw/sources/ and run /lumi-ingest")

## Examples

<example>
User: "I just ran lumina install. Set up the wiki."

Normal case — first-time init, core pack only:
```bash
node _lumina/scripts/wiki.mjs init
node _lumina/scripts/lint.mjs --json
node _lumina/scripts/wiki.mjs log init "Wiki initialized. Packs: core. Created: 6 dirs."
```
Expected directories created under `wiki/`:
`sources/`, `concepts/`, `people/`, `summary/`, `outputs/`, `graph/`
</example>

<example>
User: "Init with the research pack."

Edge case — init with multiple packs:
```bash
node _lumina/scripts/wiki.mjs init
node _lumina/scripts/wiki.mjs init --pack research
node _lumina/scripts/lint.mjs --json
node _lumina/scripts/wiki.mjs log init "Wiki initialized. Packs: core, research. Created: 8 dirs."
```
Additional dirs created: `wiki/foundations/`, `wiki/topics/`, `raw/discovered/`
</example>

<example>
User: "Run init again."

Idempotent re-run — workspace already initialized:
All `wiki.mjs init` calls return `{ created: [], skipped: [...all dirs...] }`.
index.md and log.md are left untouched (they already have content).
Lint confirms 0 errors. Report what was skipped; do not append a second log entry.
</example>

## Guardrails

- Never delete or overwrite user-authored content in `wiki/index.md` or `wiki/log.md`
  if they already have non-placeholder content. Append or skip.
- Never modify `raw/`.
- If the workspace already has pages (prior ingest session), do not overwrite them —
  only ensure the directory structure is complete.
- The `init` subcommand of `wiki.mjs` handles directory creation safely; trust its
  `skipped` list over manual inspection.

## Definition of Done

Before reporting done, verify:

(a) `node _lumina/scripts/lint.mjs --json` shows `summary.errors === 0`
(b) `wiki/log.md` has a `## [YYYY-MM-DD] init | ...` entry
(c) Running `/lumi-init` again produces byte-identical `wiki/` output — all dirs
    exist, index.md and log.md are unchanged, lint stays green
