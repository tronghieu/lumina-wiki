# Project mode

Project mode is a separate way of installing Lumina-Wiki. Instead of building a new wiki from documents you add, it builds a typed graph directly over the docs your project already has.

## What project mode is

Project mode reads your project's existing docs — decisions, requirements, rules, processes — and turns them into a typed graph: documents, fragments, and concepts, connected by typed relations such as `supersedes`, `governs`, or `depends-on`. Lumina writes no markdown pages and never edits your docs, except frontmatter fixes you explicitly approve during setup. There is no `raw/` and no `wiki/`: your docs stay exactly where they are, and the graph is rebuilt from them on every read.

## When to use it instead of the classic wiki

Use the classic wiki (`raw/` + `wiki/`) when you are collecting and summarizing outside material: papers, books, articles, research notes.

Use project mode when your project already has its own docs — ADRs, specs, requirements, process pages — and you want to ask questions across them, or catch inconsistencies (a superseded decision still being cited, a requirement nothing satisfies, a broken cross-reference) without writing a second copy of anything.

## Install

From your project's repo root:

```bash
npx lumina-wiki install --mode project
```

Answer the setup prompts, or run non-interactively with `--yes`. Project mode installs into one or more of three targets, chosen with `--ide-targets`:

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex and other `AGENTS.md`-compatible CLIs
- `antigravity` — Antigravity

With `--yes` and no `--ide-targets`, project mode installs for `claude_code` only. `--mode project` cannot be combined with `--packs` or `--agents` — those are classic-mode-only flags; combining them exits with an error.

## What the install writes

Project mode never creates `raw/` or `wiki/`. It writes:

- `_lumina/project/` — the engine (`project.mjs` and its libraries). Committed.
- `_lumina/config/` — your approved scope and type/relation mapping (`project.yaml`), written later by setup. Committed.
- `_lumina/facts/` — one JSON file per source doc, holding the facts an agent extracted from it. Committed — this is the output your team paid tokens for.
- `_lumina/graph/` — the graph viewer file. Gitignored, rebuilt on every `lumi-project-view` run.
- `_lumina/_state/` — the engine's write lock. Gitignored.
- `_lumina/manifest.json` — local install bookkeeping. Gitignored.
- `.agents/skills/lumi-project-*` — the six skills below, for every selected target.
- `.claude/skills/lumi-project-*` — symlinks to the same skills, only when `claude_code` is a selected target.
- A short block between `<!-- lumina:project -->` markers in `CLAUDE.md` (for `claude_code`) and/or `AGENTS.md` (for `codex` or `antigravity`), pointing your AI app at `_lumina/project/PROJECT.md`.
- A short block between `# >>> lumina` markers in `.gitignore`, covering the three gitignored paths above.

## The six skills

How you invoke a skill depends on your AI app (for example a slash command in Claude Code, `$name` in Codex) — check your app's own convention. In workflow order:

- **lumi-project-setup** — scans your in-scope docs and proposes scope, a type/relation mapping, and a concept vocabulary; writes nothing until you approve it. Example: "set up project mode for this repo."
- **lumi-project-ingest** — commits relations and fragment status per doc, extracted from prose the parser can't see, defaulting to `changed`/`stale` docs only. Example: "ingest the docs I just edited in docs/adr/."
- **lumi-project-ask** — answers a project question from the graph, reading the doc text it cites when the question needs the content itself, with a doc-search fallback when nothing matches. Example: "what does ADR-0052 decide about the cost book?"
- **lumi-project-check** — runs the graph's lint and reports findings by rule id with a likely fix for each. Example: "check the project docs graph for problems."
- **lumi-project-verify** — checks every committed fact's evidence project-wide and reports any that no longer match their doc, or whose source doc is gone. Example: "check whether any committed facts are stale or broken."
- **lumi-project-view** — opens a browsable, filterable view of the graph. Example: "show me the project graph."

## Keeping it fresh

There is no hook, and nothing runs on file save. Every read parses your docs live, so the graph's structure is always current; only the agent-extracted facts in `_lumina/facts/` can go stale, because they were committed at a specific point in time.

Each doc has one of four states, reported by `node _lumina/project/project.mjs status`:

- `fresh` — its committed facts still match the current text.
- `changed` — the doc changed since its facts were committed.
- `stale` — the committed facts no longer hold: a quoted sentence is gone, a reference no longer resolves, the config or ontology changed since that doc was ingested, or its fact file is malformed.
- `never-ingested` — no facts have been committed for it yet.

Editing an already-ingested doc turns it `changed`, and the next default `lumi-project-ingest` run picks it up automatically. A newly added doc starts out `never-ingested`, and the default run skips it — name the doc, or say "ingest all", to have it included; the report always states how many never-ingested docs still remain.

`lumi-project-ask` also ends every answer with a freshness note, but it is project-wide, not per doc: counts of how many docs are stale, changed, and never ingested, plus the stale ones named by path — not the fresh/changed/stale/never-ingested state `status` reports per doc.

## Common fixes

- **An orphaned fact file.** `lumi-project-check` or `lumi-project-verify` reports a fact file whose source doc was deleted. Both skills run `node _lumina/project/project.mjs facts-prune --dry-run` first and show you the `removed`/`kept` lists; only once you approve do they run `node _lumina/project/project.mjs facts-prune`, which deletes exactly that approved list — commit the removal afterwards. `facts-prune` only ever removes facts for a doc actually gone from disk: a doc still on disk but excluded from scope keeps its facts (`kept: out-of-scope`), and so does a renamed doc until its new path is re-ingested (`kept: rename-candidate` — ingest the new path first, then prune removes the old file).
- **A stale doc.** Its committed facts no longer match the current text. Run `lumi-project-ingest` on that doc.
- **A `config-check` error.** `_lumina/config/project.yaml` is invalid. Fix the reported problem and re-run `lumi-project-setup`, or run `node _lumina/project/project.mjs config-check` again directly to confirm.
- **A mode conflict.** `--mode project cannot be combined with --packs, --agents, or a profile` means you passed a classic-mode-only flag alongside `--mode project`. Drop that flag, or drop `--mode project` if you actually wanted the classic wiki.

## Uninstall

```bash
npx lumina-wiki uninstall
```

This removes the engine, the six skills, and the marker blocks from `CLAUDE.md`, `AGENTS.md`, and `.gitignore`. `_lumina/facts/` and `_lumina/config/` are handled separately: `uninstall --yes` always keeps them; run it without `--yes` and it asks first, deleting them only if you confirm.
