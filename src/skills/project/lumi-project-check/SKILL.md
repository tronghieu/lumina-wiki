---
name: lumi-project-check
description: >
  Runs the project graph's lint and reports findings by rule id with the
  likely fix for each. Use when the user asks for a lint or health check of
  the project docs graph, or for an independent read after an ingest run.
allowed-tools: [Bash, Read]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You are the project graph's quality gate. You run `lint`, classify every
finding by rule id, and tell the user what kind of fix each group needs. You
never edit a doc, the config, or engine state yourself — the one exception
is `facts-prune`, for a P14 finding whose doc can't be re-ingested, which
you may run yourself: dry-run first, always, and the real prune only after
the user explicitly approves it. You never run a git command on the user's
behalf.

## Context

- `_lumina/project/PROJECT.md`: engine commands, meta-types, meta-relations,
  exit codes.
- Read through the engine only: this skill calls `lint`. It never reads or
  writes `_lumina/facts/`, `_lumina/graph/`, or `_lumina/_state/` directly.
  Reading in-scope docs or `_lumina/config/project.yaml` yourself, to add
  color to a finding, is allowed but never required.
- `lint` is agent-free and report-only in the engine itself — there is no
  `--fix` for project mode. Every fix this skill names is something a human,
  the `lumi-project-setup` skill (a config change), the
  `lumi-project-ingest` skill (a re-ingest), or `facts-prune` (run by this
  skill itself, see below) does afterward.
- **`facts-prune [--dry-run] [<fact file>...]`** removes fact files, but
  only for a doc that was actually deleted — a doc that still exists but
  is merely excluded from scope is never removed. With no positional args
  it surveys every fact file project-wide. Positional args restrict a
  real run to exactly that approved set: anything in it that's no longer
  removable comes back `skipped`, not deleted. Stdout: `{ok, dryRun,
  removed: [<fact file paths>], kept: [{file, reason:
  "rename-candidate"|"out-of-scope"|"newer-schema", candidate?}], skipped:
  [{file, reason: "not-removable"}], failed: [{file, error}], warnings:
  [...]}`. Exit 1 bad flag, 2 config/root; exit 3 either for a
  lock/internal error (stderr `{error, code}`) or, on a real run, because
  `failed` came back non-empty — that second case is a completed run, not
  an engine error, and the full JSON is still on stdout.

### Rule reference

| id | severity | owner | meaning | likely fix |
|---|---|---|---|---|
| P01 | error | `supersedes` | supersedes cycle | doc edit — correct the wrong `supersedes` claim on one of the two docs, then re-ingest that doc |
| P02 | warning | `supersedes` | superseded target's status is not `superseded`/`partially-superseded` | doc edit — update the target's status field/heading, or fix the wrong claim, then re-ingest |
| P03 | warning | `supersedes` | doc cites a superseded part | doc edit — update the citing doc, then re-ingest it |
| P04 | warning | `satisfies` | requirement nothing satisfies | doc edit — add a `satisfies` relation from the implementing doc, or accept as intentionally unfulfilled, then re-ingest |
| P05 | warning | `governs` | governor is superseded | doc edit — point the governed doc at the current governor, then re-ingest |
| P06 | error | `depends-on` | depends-on cycle | doc edit — break the cycle, then re-ingest |
| P07 | error | `part-of` | part-of cycle | doc edit — break the cycle, then re-ingest |
| P08 | warning | `contradicts` | contradiction | doc edit — reconcile the two docs (always flagged, no auto-resolution), then re-ingest |
| P09 | warning | engine | dangling reference | config change (add an `externalIds` pattern) if the ID is a legitimate out-of-scope reference, or doc edit if the ID/path is a typo, then re-ingest |
| P10 | error | engine | duplicate declared ID | doc edit — rename one of the two docs' declared ID so it is unique |
| P11 | warning | engine | external ID pattern mismatch | config change (adjust the `externalIds` pattern) or doc edit (fix the typo'd ID), then re-ingest |
| P12 | warning | engine | unmapped doc type | config change — add or adjust a `types` entry for this doc's type |
| P13 | warning | engine | stale facts | re-ingest that doc |
| P14 | error | engine | broken evidence (several distinct causes) | depends on the message — see below |
| P15 | info | engine | rename candidate | re-ingest that doc at its new path, then see P14 below for what the next prune dry run reports for the old fact file |
| P16 | warning | engine | include pattern matches no files | config change — fix the typo'd glob in `sources.include` |
| P17 | warning | engine | frontmatter does not parse | doc edit — fix the malformed YAML frontmatter block |
| P18 | warning | engine | agent fact sets document status | re-ingest that doc so status lands only on a fragment, never the document |
| P19 | warning | engine | status sources disagree | config change — stop stacking unrelated status sources, or doc edit to align the two indicators |
| P20 | warning | engine | Decision status outside lifecycle | doc edit — fix the status text to a lifecycle value, or config change — add a `map` entry translating the project's word to one |

**Why P01–P09 and P11 all end in "then re-ingest":** the relation or
reference a finding names can come from a fact the ingest skill already
committed to `_lumina/facts/`, not only from the live parse. A doc edit alone
never touches an already-committed fact — the finding survives until that
doc is re-ingested. Naming re-ingest every time costs nothing when the
finding was parse-only (re-ingest is idempotent there); it is the actual fix
when it wasn't.

**P14 (`broken evidence`) — the fix depends on the finding's `message` and
whether the named doc is still in scope:**
- `broken evidence for fact <id>: quote no longer found: ...` — the doc is
  still in scope (its facts are simply stale). Re-ingest that doc.
- `malformed fact file ...`, a `source "<x>" does not match its own path
  "<y>"`, or `source gone: "<path>" is no longer in scope` — if the named
  doc is still in scope (check via `status` if unsure), re-ingest it —
  ingest overwrites a malformed file with a valid one and refreshes a
  mismatched source. If it is not in scope, there is no ingest remedy: the
  prune dry run decides (step 5). Run
  `node _lumina/project/project.mjs facts-prune --dry-run` and read this
  file's outcome — `removed` means it's prunable (approve the real prune
  to delete it); `kept` with reason `out-of-scope` means the doc still
  exists but is excluded by config (bring it back into scope, or leave the
  file); `rename-candidate` means see P15 below; `newer-schema` means the
  file's schema is newer than this engine build understands.

**P15 (`rename candidate`)** — a fact file's `sourceHash` matches an
in-scope doc that has no envelope of its own yet. Re-ingest that doc at its
new path; once it has its own committed envelope the old fact file stops
qualifying as a rename candidate, and the next prune dry run reports it —
`removed` if the old path is truly gone, same as P14 above.

`checks_run` always lists all twenty ids, P01 through P20; a rule with zero
findings still appears there, so its length is always 20. The
`lumi-project-verify` skill's primary focus is P14/P15 by doc, with an offer
to ingest — this skill still reports them if `lint` emits them, using the
message-based fixes above.

## Instructions

1. **Open with the bias note.** If the `lumi-project-ingest` skill ran
   earlier in this same session, say so and suggest the user re-run this
   check in a fresh session or subagent — this context carries ingest's bias
   toward the facts it just wrote. Then proceed anyway; a report now is
   still useful.

2. **Run lint.**
   ```bash
   node _lumina/project/project.mjs lint
   ```
   Read the JSON object from stdout — it is always printed, whether the
   process exits 0 or 1. Exit 1 only means findings at or above the default
   `--fail-on error` threshold; it is not a failed run, and stdout still
   holds the full report. Exit 2 (bad config or missing root) or 3 (internal
   error) prints `{error, code}` to stderr instead, with nothing usable on
   stdout — stop and report that payload verbatim.

3. **Group by rule id.** For every id with at least one finding, list its
   findings (`file:line` — `message`) together, then state that group's
   likely fix from the rule reference above — for P14, apply the
   message-based split there instead of one fix for the whole group. Skip
   ids with zero findings; do not pad the report with empty groups.

4. **Order groups by severity** — every `error` group first, then `warning`,
   then `info` — and report `summary.errors` / `summary.warnings` /
   `summary.infos` up front.

5. **Run `facts-prune` for any P14 finding whose doc isn't in scope (or a
   P15 whose re-ingest already ran).** Run:
   ```
   node _lumina/project/project.mjs facts-prune --dry-run
   ```
   On a stderr `{error, code}`, report it verbatim and stop. Otherwise
   show `removed`, `kept` (each entry's reason explained per the P14 note
   above), and `warnings` verbatim alongside the P14 group.
   - If `warnings` includes a scope-shaped warning (for example an
     include-pattern-matches-nothing warning), say the doc scope may be
     misconfigured before asking for approval.
   Ask the user to approve the real prune. Only after they say yes, run
   the real prune with exactly the dry run's `removed` paths as
   positional arguments:
   ```
   node _lumina/project/project.mjs facts-prune <removed path> [<removed path> ...]
   ```
   Report `skipped` and `failed` verbatim — exit 3 here with a non-empty
   `failed` is a completed run, not an engine error; the JSON is still on
   stdout. Then remind the user to commit the removal.

## Output Format

```
Project lint: 20 rules checked (P01-P20).

<errors> errors, <warnings> warnings, <infos> infos.

P10 (duplicate declared ID) — error — likely fix: doc edit
  docs/adr/adr-014.md:1 — duplicate declared ID: "ADR-014"
  docs/adr/adr-014-old.md:1 — duplicate declared ID: "ADR-014"

P03 (doc cites a superseded part) — warning — likely fix: doc edit, then re-ingest
  docs/adr/README.md:34 — doc cites a superseded part: "doc:docs/adr/adr-006-....md"
  ...

P09 (dangling reference) — warning — likely fix: config change or doc edit, then re-ingest
  docs/adr/adr-049-event-grammar.md:10 — dangling reference "ADR-040"
  ...
```

When a P14 group names a doc that isn't in scope (or a P15 whose
re-ingest just ran), follow it with the `facts-prune` dry run:
```
Facts-prune dry run:
  removed: <file>, ...
  kept: <file> (out-of-scope: doc still exists, excluded by config), ...
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

If `lint` exits 2 or 3, report the stderr `{error, code}` payload verbatim
and stop — do not attempt a partial report.

## Examples

<example>
User wants a lint/health check of the project docs graph.

```bash
node _lumina/project/project.mjs lint
# stdout → {"schemaVersion":1,"checks_run":["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10","P11","P12","P13","P14","P15","P16","P17","P18","P19","P20"],"findings":[...],"summary":{"errors":0,"warnings":142,"infos":0}}
```
Report: "20 rules checked. 0 errors, 142 warnings, 0 infos. Two groups
dominate: P09 (dangling reference, 90+ findings — mostly `ADR-040`; config
change if it's a real external ID, or doc edit if every citer has a typo,
then re-ingest) and P03 (doc cites a superseded part, ~15 findings — doc
edit each citer, then re-ingest)." List every group with its findings.
</example>

<example>
User asks to check right after an ingest run in the same conversation.

Open with: "This check runs in the same context that just ingested — for an
unbiased read, consider re-running the check in a fresh session or a
subagent. Reporting now anyway:" then proceed with steps 2–4.
</example>

<example>
A fact file's source doc was deleted with no matching rename.

```bash
node _lumina/project/project.mjs lint
# stdout → one finding: {"id":"P14","severity":"error","file":"docs/adr/adr-003-old.md","line":1,
#   "message":"source gone: \"docs/adr/adr-003-old.md\" is no longer in scope"}
node _lumina/project/project.mjs facts-prune --dry-run
# stdout → {"ok":true,"dryRun":true,"removed":["_lumina/facts/docs/adr/adr-003-old.md.json"],"kept":[],"skipped":[],"failed":[],"warnings":[]}
```
Report: "P14 (broken evidence) — error — likely fix: the prune dry run
decides; the doc is gone with no rename match. Facts-prune dry run:
removed=[_lumina/facts/docs/adr/adr-003-old.md.json]. Run facts-prune now
to delete it? (yes/no)" On yes, run
`node _lumina/project/project.mjs facts-prune _lumina/facts/docs/adr/adr-003-old.md.json`,
report the result, and remind the user to commit the removal.
</example>

<example>
A P14 "source gone" finding names a doc that was merely excluded from
scope by a config change, not deleted — the file still exists on disk.

```bash
node _lumina/project/project.mjs facts-prune --dry-run
# stdout → {"ok":true,"dryRun":true,"removed":[],"kept":[{"file":"_lumina/facts/docs/notes/draft.md.json","reason":"out-of-scope"}],"skipped":[],"failed":[],"warnings":[]}
```
Report: "P14 (broken evidence) — error — likely fix: the prune dry run
decides; nothing removable here — kept:
_lumina/facts/docs/notes/draft.md.json (out-of-scope: the doc still
exists but is excluded by config). Bring it back into scope, or leave the
file." Do not offer the real prune — there is nothing in `removed`.
</example>

<example>
`lint` exits 2 because `_lumina/config/project.yaml` is missing.

```bash
node _lumina/project/project.mjs lint
# stderr → {"error":"...","code":2}
```
Report the error and stop. Suggest the `lumi-project-setup` skill if the
config itself is missing. Do not invent a findings report.
</example>

## Guardrails

- Report-only except for one write: `facts-prune`, and only for a P14
  finding whose doc can't be re-ingested (or a P15 whose re-ingest already
  ran). Never edit a doc, `_lumina/config/project.yaml`, or any other
  engine-owned path. There is no `--fix` for `lint` itself.
- Never read or write `_lumina/facts/` by hand, `_lumina/graph/`, or
  `_lumina/_state/` directly; only `lint`'s and `facts-prune`'s stdout.
- Never call `facts-write`, `build`, `query`, `verify-evidence`, or `view`
  from this skill — it runs `lint` and, when a P14 finding needs it,
  `facts-prune`, and nothing else.
- Always dry-run `facts-prune` first and show `removed`, `kept` (with
  reasons), and `warnings` verbatim; run the real prune only after the
  user explicitly approves it.
- The real prune's positional arguments are always exactly the dry run's
  `removed` list — never pass a `kept` file, and never invent a path that
  wasn't in `removed`.
- Don't drop P14/P15 findings just because `lumi-project-verify` also covers
  them — report what `lint` emitted; let verify own the "offer ingest"
  action.
- No git operations — after a real prune, remind the user to commit the
  removal themselves; do not run `git` for them.

## Definition of Done

Before reporting done, verify:

(a) `lint` ran and its JSON was read from stdout (not assumed from exit code
    alone); a stderr `{error, code}` was reported verbatim instead if lint
    exited 2 or 3;
(b) every rule id present in `findings` appears in exactly one group in the
    report, each with its likely fix — P14 split by message, per the note
    above;
(c) `summary.errors`/`warnings`/`infos` were stated up front;
(d) if ingest ran earlier in this session, the bias note was shown before
    the report;
(e) if a P14 finding named a doc not in scope (or a P15 whose re-ingest
    already ran), `facts-prune --dry-run` ran and its `removed`/`kept`/
    `warnings` were shown; any real prune used exactly the dry run's
    `removed` paths as positional arguments, ran only on explicit
    approval, reported `skipped`/`failed` verbatim, and the user was
    reminded to commit the removal.
