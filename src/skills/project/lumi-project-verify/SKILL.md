---
name: lumi-project-verify
description: >
  Reports facts whose evidence quote no longer matches its doc, or whose
  source doc is gone, with a remedy for each. Use when the user asks to
  verify facts or evidence, or after editing or renaming an ingested doc.
allowed-tools: [Bash, Read]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You are project mode's evidence auditor. You run `verify-evidence`,
translate its findings into a plain report grouped by doc with a remedy
for each, and offer to run the ingest skill on the docs that need it. You
never edit a doc, the config, or the graph, and you never write a fact
file by hand — the one exception is `facts-prune`, which you may run
yourself: dry-run first, always, and the real prune only after the user
explicitly approves it.

## Context

- Engine behaviour this skill depends on, from `verify-evidence`:
  - Every committed fact file is checked against the current parse. Output
    is `{findings}`, each finding `{id, severity, file, line, message}`,
    sorted by file, then line, then id.
  - **P14 (error), broken evidence** fires three ways:
    - a fact's evidence quote no longer matches the doc's current text —
      reported at the fact's stored line, message
      `broken evidence for fact <id>: quote no longer found: "<quote>"`.
      The doc named is still in scope (its facts are simply stale).
    - the fact file itself is malformed, or its recorded source doesn't
      match its own path — reported at line 1. The named doc may or may
      not still be in scope.
    - the doc named is no longer in scope at all and no rename candidate
      matches it — `source gone: "<source>" is no longer in scope`, line 1.
  - **P15 (info), rename candidate** fires when a doc is gone but another
    in-scope doc's content matches that fact file exactly and has no
    committed facts of its own yet — one finding per candidate, line 1:
    `rename candidate: facts committed for "<old source>" match this doc's
    content`.
  - **`facts-prune`** (output shape and prune flow: PROJECT.md) is the one
    write this skill makes, only after the dry run and the user's explicit
    approval (Instructions §7). It scans the whole project, not just the
    docs a given report covers.
  - No findings means every remaining fact's quote still matches its doc —
    nothing more. `verify-evidence` never checks a doc's content hash, its
    config/ontology version, or whether a reference still resolves, so it
    is not a freshness check on its own. For real freshness (changed,
    stale, never-ingested counts), point to `status` or the check skill.
  - `verify-evidence` reports findings without ever failing on them; the
    only nonzero exits are engine errors (bad config, no project root, an
    internal or lock error), never a plain "exit 1 for findings".
  - The engine writes fact files only through ingest, and only for a doc
    still in scope: writing facts for a path no longer in scope is
    refused. `facts-prune` is the only engine command that deletes a fact
    file, and only one whose doc was actually deleted (see remedies
    below).

## Instructions

1. If ingest ran earlier in this same conversation, say so in one line and
   suggest running this check again in a fresh session or a subagent for
   an independent read, then proceed normally regardless.
2. Run:
   ```
   node _lumina/project/project.mjs verify-evidence
   ```
   On any engine error (nonzero exit with an `{error, code}` on stderr),
   report it verbatim and stop — do not guess a fix or touch any file.
3. If `findings` is empty, report that every fact's evidence still checks
   out, note that this is not a full freshness guarantee, point to
   `status` or the check skill for that, and stop.
4. Group `findings` by `file`. Within each doc, list P14 findings before
   any P15 finding naming it.
5. Give each finding its remedy:
   - **P14 broken evidence** (quote gone, doc still in scope): the doc's
     facts are stale. Remedy: re-ingest this doc.
   - **P14 malformed fact file / mismatched source, or source gone**: if
     the named doc is still in scope (check via `status` if unsure),
     re-ingest it — ingest overwrites a malformed file with a valid one
     and refreshes a mismatched source. If it is not in scope, there is no
     ingest remedy — the prune dry run decides (step 7): whatever it lists
     under `removed` is prunable; anything under `kept` gets its reason
     explained instead — `out-of-scope` means the doc still exists but is
     excluded by config (bring it back into scope, or leave the file);
     `rename-candidate` means see P15 below; `newer-schema` means the
     file's schema is newer than this engine build understands.
   - **P15 rename candidate**: re-ingest the new (candidate) doc first, so
     its facts are committed under the new path — once that lands, the old
     fact file stops being a rename candidate, and the next prune dry run
     reports it (`removed` if the old path is truly gone, step 7).
6. After showing the full report, ask the user whether to run the ingest
   skill now on the docs the remedies name for re-ingest. Do not run it
   yourself — that is the ingest skill's job, never this skill's.
7. If any remedy points to the prune dry run (a P14 whose doc isn't in
   scope, or a P15 whose re-ingest the user just ran), follow PROJECT.md's
   prune flow: dry run first —
   ```
   node _lumina/project/project.mjs facts-prune --dry-run
   ```
   show `kept` reasons per step 5, get the user's approval, then run the
   real prune with exactly the dry run's `removed` paths as positional
   arguments, and remind the user to commit. On a stderr `{error, code}`,
   report it verbatim and stop.
   - `facts-prune` scans the whole project, not just the docs this report
     covers — call out any `removed`/`kept` entries for other docs before
     asking for approval.

## Output Format

```
Verify — <N> findings (<E> error, <I> info)

<doc path>
  [P14 error] line <n>: <message>
  remedy: <re-ingest this doc | the prune dry run decides>
  [P15 info]  line 1: <message>
  remedy: re-ingest <candidate path>; the next prune dry run then reports the old file

Re-ingest now for: <doc path>, <doc path>, ...? (yes/no)

Facts-prune dry run (project-wide):
  removed: <file>, ...
  kept: <file> (out-of-scope: doc still exists, excluded by config), <file> (rename-candidate: <candidate>), ...
  warnings: <warning>, ...
Run facts-prune now on the removed files? (yes/no)
```

After approval:
```
Facts-prune: removed <N> files.
  skipped: <file> (not-removable), ...
  failed: <file>: <error>, ...
Commit the removed fact files.
```

When there are no findings:
`Verify — 0 findings. Every fact's evidence still checks out (this does
not by itself mean the graph is fresh — see status or the check skill).`

## Examples

<example>
A quoted sentence is deleted from `docs/adr/0052-new.md` after ingest
committed a `supersedes` fact quoting it.

```
$ node _lumina/project/project.mjs verify-evidence
{"findings":[{"id":"P14","severity":"error","file":"docs/adr/0052-new.md","line":12,"message":"broken evidence for fact 7a08c1fc2aae0239: quote no longer found: \"Supersedes ADR-0009 in part.\""}]}
```

Report:
```
Verify — 1 finding (1 error, 0 info)

docs/adr/0052-new.md
  [P14 error] line 12: broken evidence for fact 7a08c1fc2aae0239: quote no
  longer found: "Supersedes ADR-0009 in part."
  remedy: re-ingest this doc

Re-ingest now for: docs/adr/0052-new.md? (yes/no)
```
</example>

<example>
`docs/adr/0052-new.md` (already ingested) is renamed to
`docs/adr/0052-renamed.md` with no content change.

```
$ node _lumina/project/project.mjs verify-evidence
{"findings":[{"id":"P15","severity":"info","file":"docs/adr/0052-renamed.md","line":1,"message":"rename candidate: facts committed for \"docs/adr/0052-new.md\" match this doc's content"}]}
```

Report:
```
Verify — 1 finding (0 error, 1 info)

docs/adr/0052-renamed.md
  [P15 info]  line 1: rename candidate: facts committed for
  "docs/adr/0052-new.md" match this doc's content
  remedy: re-ingest docs/adr/0052-renamed.md; the next prune dry run then
  reports _lumina/facts/docs/adr/0052-new.md.json

Re-ingest now for: docs/adr/0052-renamed.md? (yes/no)
```
After the user re-ingests, `facts-prune --dry-run` lists the old file
under `removed` (its doc path is genuinely gone, having moved to the new
one). On approval, the real prune runs with that path as its positional
argument and deletes it; the user then commits the removal.
</example>

<example>
A doc is deleted outright with no replacement (no content-alike doc left
in scope): `verify-evidence` reports `P14 source gone: "docs/adr/old.md"
is no longer in scope`. The report names no ingest remedy — there is
nothing left to ingest — remedy is the prune dry run.

```
$ node _lumina/project/project.mjs facts-prune --dry-run
{"ok":true,"dryRun":true,"removed":["_lumina/facts/docs/adr/old.md.json"],"kept":[],"skipped":[],"failed":[],"warnings":[]}
```

Report: "Facts-prune dry run: removed=[_lumina/facts/docs/adr/old.md.json].
Run facts-prune now to delete it? (yes/no)" On yes, run
`node _lumina/project/project.mjs facts-prune _lumina/facts/docs/adr/old.md.json`,
report the result, and remind the user to commit the removal.
</example>

<example>
A doc is excluded from scope by a config change (for example a narrowed
`sources.include`), but the file still exists on disk. `verify-evidence`
reports the same `P14 source gone: "docs/notes/draft.md" is no longer in
scope`, but the doc isn't actually deleted.

```
$ node _lumina/project/project.mjs facts-prune --dry-run
{"ok":true,"dryRun":true,"removed":[],"kept":[{"file":"_lumina/facts/docs/notes/draft.md.json","reason":"out-of-scope"}],"skipped":[],"failed":[],"warnings":[]}
```

Report: "Facts-prune dry run: nothing removable — kept:
_lumina/facts/docs/notes/draft.md.json (out-of-scope: the doc still
exists but is excluded by config). Bring it back into scope if you want
its facts current, or leave the file as is; there's nothing to prune
here." Do not offer the real prune — there is nothing in `removed`.
</example>

## Guardrails

- Report-only except for one write: `facts-prune`. Never run
  `facts-write`, never edit a doc, never touch a fact file by hand, the
  graph, or engine state directly.
- Always dry-run `facts-prune` first and show `removed`, `kept` (with
  reasons), and `warnings` verbatim; run the real prune only after the
  user explicitly approves it — never on your own initiative.
- The real prune's positional arguments are always exactly the dry run's
  `removed` list — never pass a `kept` file, and never invent a path that
  wasn't in `removed`.
- `facts-prune` is project-wide; when the user only asked about specific
  docs, say so before asking for approval on entries outside that set.
- Never run the ingest skill yourself — offer it, and only after the user
  agrees.
- No git operations. After a real prune, remind the user to commit the
  removal themselves — do not run `git` for them.
- Read only `verify-evidence`'s and `facts-prune`'s JSON output; never
  parse fact files by hand to "double-check" a finding.
- On an engine error, report it verbatim and stop — never edit the config
  or retry with a guessed fix.

## Definition of Done

- `verify-evidence` ran; either every finding is shown with a remedy, or
  an engine error was reported verbatim and the skill stopped.
- The "no findings" report, if given, says this covers evidence only, not
  full freshness.
- Every P14/P15 finding carries the correct remedy (re-ingest when the doc
  is in scope, otherwise the prune dry run), and the user was asked
  whether to run the ingest skill on the docs that need it.
- If the prune dry run applied, it ran and its `removed`/`kept`/`warnings`
  were shown before any real prune; any entries outside the docs the user
  asked about were called out; the real prune, if run, used exactly the
  dry run's `removed` paths as its positional arguments, ran only on
  explicit approval, reported `skipped`/`failed` verbatim, and the user
  was reminded to commit the removal.
- Nothing was written except an approved `facts-prune`: no fact file
  touched by hand, no doc, no config.
