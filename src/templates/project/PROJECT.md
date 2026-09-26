# Lumina Project Mode

This repo uses Lumina **project mode**: a typed graph over this project's
own docs, not a second wiki. Lumina writes no markdown pages and never edits
your docs, except frontmatter fixes, or a new glossary file, you explicitly
approve during setup.

Installed by lumina-wiki {{package_version}}.

## Rules

- **Docs are read-only.** The engine never writes an in-scope doc. The only
  doc edits are made by a skill after you approve them (setup's frontmatter
  fixes, or a new file such as a glossary).
- **Only the engine writes `_lumina/facts/`, `_lumina/graph/`, and
  `_lumina/_state/`.** Nothing else — not a skill, not you by hand — should
  create or edit files there. When verify reports a fact file whose source
  doc is gone, run `facts-prune` (dry run first) to remove it, then commit
  the deletion — never delete it by hand.
- **Skills call the engine through Bash, never by importing it.** Every
  `lumi-project-*` skill runs `node _lumina/project/project.mjs <subcommand>`
  and reads its JSON output; none of them `import` engine code.
- **Exit codes:** `0` success · `1` bad arguments · `2` invalid config,
  missing root, or a path-safety violation · `3` internal error, lock
  timeout, a newer `schemaVersion` than this engine knows, or (`facts-prune`
  only) one or more files it could not delete (listed in `failed`). Every
  nonzero exit other than that last `facts-prune` case, and except `lint`
  exit 1, prints `{error, code}` to stderr, with nothing usable on stdout.
  `lint` exit 1 means findings at or above `--fail-on` — not a run
  failure — and its full findings report is still printed on stdout.

## What's committed vs. gitignored

- **Committed:** `_lumina/project/` (this engine tree), `_lumina/config/`
  (your approved scope and mapping), `_lumina/facts/` (one file per source
  doc — the agent-extracted facts your team paid tokens for).
- **Gitignored:** `_lumina/graph/` (the viewer file `view` writes),
  `_lumina/_state/` (the write lock), `_lumina/manifest.json` (local install
  bookkeeping). Never hand-edit any of the three; Lumina (engine or
  installer) is their only writer, and they are rebuilt or reacquired on
  demand.

## Engine commands

Run each of these from anywhere inside the repo — `project.mjs` finds the
repo root by walking up to the nearest `_lumina/config/project.yaml` (exit 2
if none is found). Every subcommand prints one JSON object to stdout.

```
node _lumina/project/project.mjs scope
node _lumina/project/project.mjs config-check
node _lumina/project/project.mjs build
node _lumina/project/project.mjs status
node _lumina/project/project.mjs facts-write <<'JSON'
{ "source": "...", "sourceHash": "...", "facts": [] }
JSON
node _lumina/project/project.mjs verify-evidence
node _lumina/project/project.mjs lint [--fail-on error|warning]
node _lumina/project/project.mjs query node <ref>
node _lumina/project/project.mjs query list --meta-type <T> [--status <S>]
node _lumina/project/project.mjs query neighbors <ref> --direction in|out [--relation <R>]
node _lumina/project/project.mjs query resolve <citing-doc> <object>
node _lumina/project/project.mjs view
node _lumina/project/project.mjs facts-prune [--dry-run] [<fact file>...]
```

- `scope` — list in-scope docs.
- `config-check` — validate `project.yaml` alone.
- `build` — parse the in-scope docs and build the graph; never cached.
- `status` — freshness per doc: `fresh` / `changed` / `stale` / `never-ingested`.
- `facts-write` — takes JSON on stdin, `{source, sourceHash, facts: []}`
  (never a TTY — it exits 1 if stdin isn't piped); replaces that one doc's
  entire fact set, canonicalizes references, and re-checks every evidence
  quote before writing `_lumina/facts/<source>.json`.
- `verify-evidence` — re-checks every committed fact's quote against the
  current doc text; report-only, always exits 0 unless config/root itself
  is invalid, or an internal/lock error exits 3.
- `lint` — cross-doc checks P01-P21, report-only, agent-free. `--fail-on`
  (default `error`) sets the severity that makes it exit 1.
- `query` — four fixed operations, no path search or full-text: `node
  <ref>` resolves an ID/path/concept alias and returns it with its edges —
  for a doc node, also its `frags` (every heading anchor in that doc,
  whether or not any edge cites it yet); `list --meta-type <T> [--status
  <S>]` filters nodes; `neighbors <ref> --direction in|out [--relation
  <R>]` walks one hop; `resolve <citing-doc> <object>` resolves `<object>`
  exactly as `facts-write` would (a doc-relative path from the citing doc,
  an existing out-of-scope doc, a configured concept, a declared ID, or a
  heading anchor) and reports `resolution`: `resolved`, `dangling`,
  `ignored`, or `rejected` (carrying `facts-write`'s own error, e.g. an
  anchor the in-scope target lacks). Every returned item carries
  `file:line` and its evidence quote (including the evidence's `scope`);
  every response carries a `freshness` summary.
- `view` — writes `_lumina/graph/view.html` (gitignored), a self-contained
  page you open with `file://`, no network, no server; stdout includes
  `url`, that page's `file://` URL.
- `facts-prune` — removes only the committed fact files whose doc was
  actually **deleted**. It never removes one for a doc that still exists but
  fell out of scope (a scope edit or a typo) — that would lose facts you
  paid tokens for; those are `kept` with reason `out-of-scope` instead, same
  as a newer-schema file (`newer-schema`, never touched) and a rename
  candidate (`rename-candidate`, with the new path — re-ingest it first,
  then prune removes the old file). Stdout: `{ok, dryRun, removed: [<fact
  file paths>], kept: [{file, reason:
  "rename-candidate"|"out-of-scope"|"newer-schema", candidate?}], skipped:
  [{file, reason: "not-removable"}], failed: [{file, error}], warnings:
  [...]}`; `--dry-run` prints the same shape without deleting anything. A
  scope-shaped warning (for example an include-pattern-matches-nothing
  warning) can mean the doc scope itself is misconfigured, not just a
  deleted or renamed doc.

  **Prune flow:** dry-run first, show `removed`/`kept`/`warnings` to the
  user, get explicit approval, then run the real prune passing exactly the
  dry run's `removed` paths as positional arguments — anything on that
  list no longer removable by the time of the real run comes back in
  `skipped`, not deleted; anything removable but left off the list is
  untouched; no positionals deletes the whole removable set. A per-file
  delete error lands in `failed` and makes the run exit `3` (a completed
  run, not an engine error — the full JSON is still on stdout), without
  stopping the rest. Remind the user to commit the removed fact files
  afterward — `facts-prune` deletes, it never commits.

## Meta-ontology

Every project type and relation resolves to one of these — lint and queries
key only on these names, never on your project's own type or relation names.

**Meta-types** (`Decision` also carries a status lifecycle: `proposed` ->
`accepted` -> `partially-superseded` / `superseded` / `deprecated`, or
`proposed` -> `rejected`):

- `Decision` (governance)
- `Requirement` (governance)
- `Rule` (governance)
- `Capability`
- `Process`
- `Structure`
- `Concept`
- `Actor`
- `Issue`
- `Evidence`
- `Document`

**Meta-relations** (`references` is the fallback for any relation with no
mapping):

- `supersedes`
- `satisfies`
- `governs`
- `depends-on`
- `part-of`
- `contradicts`
- `justified-by`
- `owned-by`
- `mentions`
- `references`

## Setup

If `_lumina/config/project.yaml` is missing, run the `lumi-project-setup`
skill — it scans your in-scope docs and proposes scope, a type/relation
mapping, and a concept vocabulary. Nothing is written until you approve it.
