# Use project mode on your project's docs

Project mode builds a typed graph over the docs your project already has — decisions, requirements, rules, processes — instead of building a new wiki.
Lumina writes no markdown pages and never edits your docs, except two things you approve during setup: frontmatter fixes, and a glossary file.
There is no `raw/` and no `wiki/`: your docs stay where they are, and the graph rebuilds from them on every read.

Use the classic wiki when you're collecting outside material: papers, books, articles, research notes.
Use project mode when your project already has its own docs.
You can then ask questions across them, or catch inconsistencies, without writing a second copy of anything.

## Install

From your project's repo root:

```bash
npx lumina-wiki install --mode project
```

Answer the install prompts, or run non-interactively with `--yes`. Project mode installs into one or more of three targets, chosen with `--ide-targets`:

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex and other `AGENTS.md`-compatible CLIs
- `antigravity` — Antigravity

With `--yes` and no `--ide-targets`, project mode installs for `claude_code` only. `--mode project` cannot combine with `--packs`, `--agents`, or a profile — those are classic-mode-only flags. Combining them exits with an error.

## Set it up

Run `lumi-project-setup` next. It scans your in-scope docs and proposes a scope, a type/relation mapping, and a concept vocabulary. It writes nothing until you approve it. Once you approve and it writes the config, it reports how many docs need ingesting and offers to start ingest right away.

Answer yes: if your coding agent can start another skill from inside setup, it ingests every one of them with no second command or approval. Otherwise setup tells you to run `/lumi-project-ingest ingest all` yourself, and ingest asks once more for approval when there are more than 20 docs. Answer no: setup ends and gives you the command to run later.

If you'd rather ingest later, confirm the setup worked first:

```bash
node _lumina/project/project.mjs status
```

A fresh setup, with nothing ingested yet, looks like this (trimmed):

```json
{
  "docs": [
    { "path": "docs/adr/0001-use-postgres.md", "hash": "b00b80fe0172...", "metaType": "Decision", "type": "ADR", "state": "never-ingested" },
    { "path": "docs/adr/0002-cache-layer.md", "hash": "629cdbcc2c71...", "metaType": "Decision", "type": "ADR", "state": "never-ingested" }
  ],
  "summary": { "fresh": 0, "changed": 0, "stale": 0, "neverIngested": 2 }
}
```

Every doc appears with a state. `never-ingested` for every doc, right after setup, is expected — nothing has been read into the graph yet. Each doc also carries a `metaType` (its project role, or `Document` when nothing narrower applies) and, once it matches a type rule, a `type`.

## Ingest and ask

Run `lumi-project-ingest` to read your docs into the graph. On the first run, with nothing ingested yet, it offers every doc. Past 20 docs, it shows the count and waits for your approval before continuing.

When there are more than 20 docs to ingest and your coding agent supports subagents (Claude Code does), ingest runs them in parallel: docs are sorted by type and split into batches of at most 25, one subagent per batch, all started at once under the single approval above — the coding agent runs as many at a time as it can. A batch that fails doesn't stop the others, and any doc still missed once they're all done gets one automatic retry. Without subagent support, it ingests one doc at a time, as before. Either way it's safe: each doc's facts are written to their own file under a lock, and the graph rebuilds from docs and facts on every read, so write order can't change it.

Ingest ends by regenerating the graph view and printing its `file://` link. Run `lumi-project-view` any time you want to regenerate it again.

After that, ask a question:

> "What does ADR-0001 decide about the datastore?"

`lumi-project-ask` answers from the graph and the doc text it cites, pointing to `file:line` for every claim.
It ends each answer with a freshness note: how many docs are stale, changed, or never ingested project-wide, with the stale ones named by path.

## Keep it fresh

There's no hook, and nothing runs on save. Edit an already-ingested doc, and it becomes `changed`; the next default `lumi-project-ingest` run picks it up automatically.

A newly added doc starts `never-ingested`. The default run skips it — name the doc, or say "ingest all", to include it. The report always states how many `never-ingested` docs remain.

## Fix common problems

### An orphaned fact file

`lumi-project-check` or `lumi-project-verify` reports a fact file whose source doc was deleted.

1. Run `node _lumina/project/project.mjs facts-prune --dry-run`.
2. Review the `removed` and `kept` lists it shows you. `out-of-scope` means the doc still exists but fell out of scope. `rename-candidate` means the doc moved and hasn't been re-ingested at its new path yet.
3. Approve the removal.
4. Run `node _lumina/project/project.mjs facts-prune` with the approved paths.
5. Commit the removal.

For a rename candidate, ingest the new path first — pruning the old file only works once the new one has its own committed facts.

### A stale doc

Its committed facts no longer match the current text. Run `lumi-project-ingest` on that doc.

### A `config-check` error

`_lumina/config/project.yaml` is invalid. Run `node _lumina/project/project.mjs config-check` to see the exact problem. Fix the file yourself, or re-run `lumi-project-setup` to fix it for you. Then run `config-check` again to confirm.

### A mode conflict

`Project mode (detected or --mode project) cannot be combined with --packs, --agents, or a profile` means you passed a classic-mode-only flag alongside `--mode project`, or in a repo already set up in project mode. Drop that flag, or drop `--mode project` if you wanted the classic wiki.

## Uninstall

```bash
npx lumina-wiki uninstall
```

This removes everything under `_lumina/` except `_lumina/facts/` and `_lumina/config/`, plus the six skills, the `.claude/skills` links, and the marker blocks from `CLAUDE.md`, `AGENTS.md`, and `.gitignore`. `_lumina/facts/` and `_lumina/config/` are handled separately: `uninstall --yes` always keeps them; without `--yes`, it asks first and deletes them only if you confirm.

## Reference

### What the install writes

Project mode never creates `raw/` or `wiki/`. It writes:

- `_lumina/project/` — the engine (`project.mjs` and its libraries). Committed.
- `_lumina/config/` — your approved scope and type/relation mapping (`project.yaml`), written later by setup. Committed.
- `_lumina/facts/` — one file per source doc, holding the facts an agent extracted from it. Committed.
- `_lumina/graph/` — the graph viewer file. Gitignored, rebuilt after every ingest that commits a doc, and on every `lumi-project-view` run.
- `_lumina/_state/` — the engine's write lock. Gitignored.
- `_lumina/manifest.json` — local install bookkeeping. Gitignored.
- `.agents/skills/lumi-project-*` — the six skills below, for every selected target.
- `.claude/skills/lumi-project-*` — symlinks to the same skills, only when `claude_code` is a selected target.
- A short block between `<!-- lumina:project -->` markers in `CLAUDE.md` (for `claude_code`) and/or `AGENTS.md` (for `codex` or `antigravity`), pointing your AI app at `_lumina/project/PROJECT.md`.
- A short block between `# >>> lumina` markers in `.gitignore`, covering the three gitignored paths above.

### Skills

How you invoke a skill depends on your AI app (for example a slash command in Claude Code, `$name` in Codex) — check your app's own convention.

- **lumi-project-setup** — scans your in-scope docs and proposes scope, a type/relation mapping, and a concept vocabulary; writes nothing until you approve it. Example: "set up project mode for this repo."
- **lumi-project-ingest** — reads what your docs say beyond their structure — how they relate to each other, and what status a section states — and commits it per doc, defaulting to docs that changed or went stale. Example: "ingest the docs I just edited in docs/adr/."
- **lumi-project-ask** — answers a project question from the graph and the doc text it cites, with a doc-search fallback when nothing matches. Example: "what does ADR-0052 decide about the cost book?"
- **lumi-project-check** — runs the graph's lint and reports findings by rule id with a likely fix for each. Example: "check the project docs graph for problems."
- **lumi-project-verify** — checks every committed fact's evidence and reports any that no longer match their doc, or whose source doc is gone. Example: "check whether any committed facts are stale or broken."
- **lumi-project-view** — opens a browsable, filterable view of the graph. Example: "show me the project graph."

### Doc states

- `fresh` — its committed facts still match the current text.
- `changed` — the doc changed since its facts were committed.
- `stale` — the committed facts no longer hold: a quoted sentence is gone, a reference no longer resolves, the config or ontology changed since that doc was ingested, or its fact file is malformed.
- `never-ingested` — no facts have been committed for it yet.
