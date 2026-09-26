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
never write anything yourself: not a fact file, not a doc, not the graph
or engine state.

## Context

- `_lumina/project/PROJECT.md`: engine commands, exit codes, meta-ontology.
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
    refused. There is no engine command that deletes a stale fact file —
    that is a manual, git-tracked step (see remedies below).

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
   - **P14 malformed fact file / mismatched source**: if the named doc is
     still in scope, re-ingest it — ingest overwrites the malformed file
     with a valid one. If it is not (check via `status` if unsure), treat
     it like "source gone" below.
   - **P14 source gone**: the engine cannot write facts for a path that's
     no longer in scope, so there is no ingest remedy. Tell the user to
     delete the stale fact file themselves (the path named after
     `_lumina/facts/`, with a `.json` suffix) and commit that deletion —
     this is the one case where a person, not the engine, removes a fact
     file.
   - **P15 rename candidate**: re-ingest the new (candidate) doc first, so
     its facts are committed under the new path, then delete the old fact
     file the same manual, git-tracked way.
6. After showing the full report, ask the user whether to run the ingest
   skill now on the docs the remedies name for re-ingest. Do not run it
   yourself and do not delete any fact file yourself — both are the
   user's call (the deletion) or the ingest skill's job (the re-ingest),
   never this skill's.

## Output Format

```
Verify — <N> findings (<E> error, <I> info)

<doc path>
  [P14 error] line <n>: <message>
  remedy: <re-ingest this doc | delete _lumina/facts/<path>.json and commit>
  [P15 info]  line 1: <message>
  remedy: re-ingest <candidate path>, then delete _lumina/facts/<old path>.json

Re-ingest now for: <doc path>, <doc path>, ...? (yes/no)
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
  remedy: re-ingest docs/adr/0052-renamed.md, then delete
  _lumina/facts/docs/adr/0052-new.md.json and commit that deletion

Re-ingest now for: docs/adr/0052-renamed.md? (yes/no)
```
</example>

<example>
A doc is deleted outright with no replacement (no content-alike doc left
in scope): `verify-evidence` reports `P14 source gone: "docs/adr/old.md"
is no longer in scope`. The report names no ingest remedy — there is
nothing left to ingest — and instead tells the user to delete
`_lumina/facts/docs/adr/old.md.json` and commit that deletion.
</example>

## Guardrails

- Report-only. Never run `facts-write`, never edit a doc, never touch
  fact files, the graph, or engine state directly.
- Never delete, move, or rename a fact file yourself, even for a "source
  gone" or rename-candidate remedy — that deletion is always the user's
  own, git-tracked action; this skill only names the path.
- Never run the ingest skill yourself — offer it, and only after the user
  agrees.
- No git operations.
- Read only `verify-evidence`'s JSON output; never parse fact files by
  hand to "double-check" a finding.
- On an engine error, report it verbatim and stop — never edit the config
  or retry with a guessed fix.

## Definition of Done

- `verify-evidence` ran; either every finding is shown with a remedy, or
  an engine error was reported verbatim and the skill stopped.
- The "no findings" report, if given, says this covers evidence only, not
  full freshness.
- Every P14/P15 finding carries the correct remedy (re-ingest, or a manual
  fact-file deletion with a commit), and the user was asked whether to
  run the ingest skill on the docs that need it.
- Nothing was written: no fact file, no doc, no config.
