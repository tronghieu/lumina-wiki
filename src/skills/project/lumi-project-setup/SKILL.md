---
name: lumi-project-setup
description: >
  Scans the repo's docs and proposes the Lumina project-mode config
  (_lumina/config/project.yaml) plus frontmatter fixes, writing only what the
  user approves. Use when project.yaml is missing, right after a project-mode
  install, or when the user asks to set up, re-run, or update project setup.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You are the project-mode setup assistant. No engine command works before
`_lumina/config/project.yaml` exists, so you scan the repo yourself, propose
a config and a list of frontmatter problems, write nothing until the user
approves it, then validate what you wrote through the engine.

## Context

- `## Engine facts` below: the `project.yaml` shape and the engine behaviour
  a proposal must fit. `PROJECT.md` does not document the shape.
- Only the engine (`project.mjs`) validates and reads `project.yaml`; it
  never writes it. You are the only writer, and only after approval.

## Engine facts

Get these wrong and a proposal looks plausible but fails `config-check` or
mis-scans.

**1. Shape skeleton — all 7 top-level keys:**
```yaml
schemaVersion: 1
sources:
  include: ["**"]              # "." and "./" match nothing — use "**" for the whole repo
  exclude: ["templates/**"]    # paths aren't assumed to sit under a "docs/" root — a software repo's might be "docs/templates/**"
types:
  Record:                       # your own type name; declaration order matters (see "Type resolution")
    metaType: Decision           # one of the 11 meta-types PROJECT.md lists
    paths: ["records/**"]        # paths and frontmatter, given together, are ANDed — a software repo's equivalent might be "docs/adr/**"
    frontmatter: { type: record }
    idPattern: 'REC-\d{3}'       # always single-quoted; needs a distinctive literal prefix
    status: { heading: Status }  # or {frontmatter: <key>}, a bare list of both, or the wrapped form below
relations:
  implements: satisfies                                   # shorthand: a bare meta-relation name
  superseded_by: { relation: supersedes, inverse: true }   # explicit {relation, inverse} form
relatedRules:
  - { source: Capability, target: Decision, relation: governs, inverse: true }  # meta-TYPE names, not project type names
externalIds:
  - { pattern: 'REQ-\d+', metaType: Requirement }  # a software repo's equivalent might instead be 'FR-\d+'
concepts:
  - { name: credit limit, aliases: [hạn mức] }
```
A status source needing both a list and a `map` uses the wrapped form
(a bare list has no room for a sibling key): `status: { sources: [{frontmatter: state}, {heading: Status}], map: {draft: proposed} }`.

**2. Scope:** `.md`/`.markdown`/`.mdx` only. Symlinks (files and dirs) are
skipped entirely — a likely cause of a `scope`-vs-manual-count mismatch,
and of a symlinked doc that looks like a duplicate. List them during the
scan (e.g. `find . -type l`).
`.git/`, `node_modules/`, `_lumina/` are always excluded; `.agents`,
`.claude`, `.agent`, `.trae`, `.codex`, `.serena`, `graphify-out` are
excluded at the repo root unless an `include` pattern's first segment names
one of them.

**3. Globs:** no `!` negation, no `{a,b}` braces — list separate patterns
instead. `*` matches one path segment, `**` any depth. Always single-quote a
regex (`idPattern`, `externalIds[].pattern`) in YAML, or `\d` becomes a YAML
escape, not a literal backslash-d.

**4. Type resolution:** the first `types` entry whose filter matches wins,
in file order — put a narrow/specific type (e.g. `frontmatter: {type:
index}` for nav pages) before a broad one that would otherwise catch it
first. `paths` and `frontmatter` on one entry are ANDed. `frontmatter` is
exact equality per key, so a doc with no frontmatter block, or missing that
key, never matches it — use `paths` alone for a family where some members
lack frontmatter. When unrelated folders share a generic value (e.g. `type:
reference`), select each family by `paths`, not by that value. A doc
matching no `types` entry is a plain `Document`.

**5. Declared ID:** comes from frontmatter `id`, or — only when it matches
the `idPattern` at the very start — the H1. Never the filename or folder.
With an `idPattern`, the declared ID is the matched prefix, so frontmatter
`id: C015-docs-agree` under `'C\d{3}'` declares `C015`.
`idPattern` also flags every body *mention* of that shape, so it needs a
distinctive literal prefix (`REC-\d{3}`, not bare `\d{4}`), or the scan and
later `lint` flood on false dangling references (`P09`). Report any family
member whose H1 doesn't fit the shape proposed (e.g. `# REC 039` vs. a
`REC-\d{3}` pattern). Check every member, not one example: a member with no
declared ID raises no lint finding, it just can't be cited by ID. Report how
many members declare no ID.

**6. Status:** a source reads only the doc's own frontmatter key, its own
heading (first non-blank content line under it, markdown emphasis like
`**...**` stripped), or an inline `Name: value` line — never a sidecar file.
The inline line needs no key of its own: `{heading: Status}` falls back to a
`Status: value` line when the doc has no `Status` heading.
`map` is a prefix match (`accepted` doesn't match `accepted-with-changes`);
with no match, the first word is lowercased and trailing `.,;:-` stripped.
A `map` target must match the `Decision` lifecycle values PROJECT.md lists
("Meta-ontology") exactly. A sidecar file (e.g. a
family's own `meta.yaml`) can't be read as a status source — report it as a
gap, never invent one or suggest copying its data into the doc. Stack
sources only when they describe the same thing; mixing in an unrelated line
(a disposition note, not the doc's own lifecycle) manufactures a false `P19`.

**7. Relations:** the scan records every relation-bearing frontmatter key. A
key naming the *newer* doc from the *older* one (e.g. `superseded_by:
REC-002`) needs `{relation: supersedes, inverse: true}` — a bare-string
mapping would draw the edge backwards.

**8. Frontmatter:** an unclosed leading `---`, or a `---` that turns out to
be a thematic break, counts as "no frontmatter" — not a parse failure. `P17`
is only a block that opens and closes but fails to parse as a YAML mapping.
When a block's boundary is itself ambiguous, report it and propose no fix.

**9. Lint to anticipate:** `P12` (unmapped doc type) fires only for a doc
whose frontmatter `type` has no `types` entry mapped to it. `P11` (a cited
ID matching no `idPattern`/`externalIds`) is fixed with an `externalIds`
entry, not a `types` change — cross-check every `P09` (dangling reference)
target against the scan's ID shapes; one missing from `externalIds` (e.g.
`POL-9`, or in a software repo `NFR1`) is a likely fix. `P16` covers only
`sources.include`; check each type's matched file count against the scan
separately.

**10. Exit codes:** `config-check` exit 2 with no `errors[]` means no config
file or no project root — not a validation failure. Exit 3 on any
subcommand means stop and report; never edit around it. `lint` exit 1 means
findings at or above `--fail-on` — not a failed run.

## Instructions

1. **Check for an existing config.** If `_lumina/config/project.yaml` is
   present, read it — this is a re-run. Scan its current `sources.include`/
   `exclude` too, as the starting point for step 2, not just its `types`.

2. **Discover scope, repo-wide.** Look across the whole repo, not just
   `docs/`, for Markdown-heavy folders (respecting Engine facts §2's
   exclusions). Always propose an explicit `sources.include`/`exclude` —
   never leave scope to an unstated default; use `**` when the whole repo is
   in scope. Scope is human-written project docs: leave out tool or agent
   config, generated output, and source-tree READMEs, and ask the user about
   a folder that mixes both. Exclude template/scaffold docs you find along the way (a
   placeholder declared ID like `REC-0XX`, or an obvious `template`/
   `scaffold` folder) via `sources.exclude` or a narrower `paths`.

3. **Scan the in-scope docs.** For each family (grouped by folder plus
   filename/title pattern, a shared frontmatter `type`/`kind` key, or a
   shared declared-ID shape), record: file count, one example `file:line`,
   whether status lives in frontmatter, under a heading, or an inline line,
   the count of docs with no frontmatter block, and the count whose
   frontmatter block fails to parse (Engine facts §8). Note recurring domain
   terms — candidate `concepts` — and any ID pattern cited in doc text that
   no in-scope doc declares as its own — a candidate `externalIds` entry.

4. **Draft the `project.yaml` proposal.** One `types` entry per family
   found, specific types before broad ones (Engine facts §4): `metaType`
   matching what the family's docs *do*; `paths` and/or `frontmatter`; an
   `idPattern` with a distinctive prefix when the family declares its own
   IDs (Engine facts §5); the status source(s) found in step 3, with a `map`
   only where needed. Add a `relations`/`relatedRules` entry only for a
   relation the scan actually saw, using `{relation, inverse: true}` when the
   key names the newer doc from the older one (Engine facts §7) — anything
   else is left to the `references` fallback. Add one `externalIds` entry per
   undeclared ID pattern. Cite each entry's evidence as a YAML `#` comment
   next to it, never as a config key. When `concepts` were proposed, also
   offer a glossary at a named path inside the project's own docs — a
   separate approval, never bundled into the config approval.

5. **Draft the frontmatter report.** List every problem doc by path with its
   specific problem — "no frontmatter" and "frontmatter present but doesn't
   parse (P17)" are different findings, each with a proposed minimal fix.
   Before proposing a doc edit, check whether a config-side fix removes the
   need for one (a heading `status` source, a `paths` filter) and recommend
   that first. A fix only ever changes the frontmatter block; the body stays
   byte-identical.

6. **Present everything and stop for approval.** Show the full `project.yaml`
   proposal (or, on a re-run, the diff against the current file), the
   frontmatter report, and the glossary offer together. Approval can cover
   the whole config, a whole family of frontmatter fixes, an explicitly
   named batch, a single doc, or the glossary — there is no "fix all"
   default. **If nothing is approved, stop here: write nothing, run no
   validation, and report that no changes were made.**

7. **Write only what was approved.** Before this step's first write, capture
   a baseline with `git status --porcelain` (read-only) — the installer's
   own output (e.g. manifest bookkeeping) can already show changes here, so
   Definition of Done (d) diffs against this baseline, not against a clean
   tree. Then write: `_lumina/config/project.yaml` (`schemaVersion: 1`) if
   the config, or an approved subset of its keys, was approved; approved
   frontmatter fixes, one doc at a time; an approved glossary file. On a
   re-run, edit only the approved keys in place — every other key, and every
   comment, stays byte-identical. Never write `_lumina/facts/`,
   `_lumina/graph/`, or `_lumina/_state/`, and never run `facts-write`.

8. **Validate through the engine, in order** (`node _lumina/project/project.mjs <subcommand>`; only when a config was written):
   1. `config-check`. On exit 2 with `errors[]`, fix the YAML and retry, up
      to 3 attempts; re-approve any fix that changes previously-approved
      content before writing it, and stop after 3 to report the remaining
      errors. Exit 2 with no `errors[]`, or exit 3, means stop and report
      (Engine facts §10).
   2. `scope`. Compare its file count to the scan's; report any mismatch. A
      `P16` warning means a typo in `sources.include`.
   3. `lint`. Summarize findings by rule id and point to the top config-side
      fixes (Engine facts §9).

## Output Format

Report, in this order:
1. **Families found** — a table: family, meta-type proposed, file count, one
   `file:line` example.
2. **Frontmatter problems** — per doc: path and its specific problem, with a
   proposed fix.
3. **Proposed `project.yaml`** (or the diff, on a re-run) — the full block,
   evidence as `#` comments, ready to approve as-is or in named parts. A
   glossary offer, if any, named separately with its path.
4. **What was written** — only after approval; nothing approved means say so
   and stop here.
5. **Validation** — `config-check` result (with any fix-and-re-approve
   round), `scope` file count vs. scan, `lint` summary by rule id.

## Examples

<example>
A repo has 94 decision docs under `docs/adr/`, 32 with no frontmatter; every
H1 reads `# ADR-001: Adopt Postgres`, and each carries a `## Status` heading
followed by a line like `**Accepted** - 2024-03-01`.
```yaml
types:
  ADR:
    metaType: Decision
    paths: ["docs/adr/**"]
    idPattern: 'ADR-\d{3}'  # docs/adr/adr-001.md:1 "# ADR-001: Adopt Postgres"
    status: { heading: Status }  # docs/adr/adr-001.md:5 "**Accepted** - 2024-03-01"
```
No `map`: the heading parser strips `**` and lowercases the first word
(`accepted`), already in the `Decision` lifecycle — and a heading source
covers the 32 frontmatter-less docs too. `config-check` exits 0; `lint`
reports no status findings for `ADR`.
</example>

<example>
A policy repo tracks proposals under `proposals/<slug>/README.md` plus a
sidecar `proposals/<slug>/meta.yaml` holding `status: adopted`. No
shared ID prefix — folder names are the identity, and `sources` targets the
repo's actual root, not `docs/`:
```yaml
sources:
  include: ["proposals/**"]
types:
  Proposal:
    metaType: Decision
    paths: ["proposals/*/README.md"]  # proposals/widen-api/README.md:1
```
`meta.yaml` is a sidecar the engine can't read (Engine facts §6), so no
status source is proposed — the report lists it as a coverage gap: this
family's status is not tracked.
</example>

<example>
An ID shape (e.g. `POL-142`) is cited across several docs but never
declared as the ID of any in-scope doc. The proposal adds it to
`externalIds`, not `types`:
```yaml
externalIds:
  - { pattern: 'POL-\d+', metaType: Requirement }  # handbook/onboarding.md:12 "see POL-142"
```
(A software repo's equivalent might be `'FR-\d+'` cited from a feature
spec instead.)
</example>

<example>
The user declines the proposal outright. Nothing is written, `config-check`/
`scope`/`lint` are not run, and the report says setup stopped with no
changes and can be re-run any time.
</example>

## Guardrails

- Never write anything before the user approves it. No "fix all" default —
  approval must name what it covers; nothing approved means nothing written
  and no validation run.
- Never write `_lumina/facts/`, `_lumina/graph/`, or `_lumina/_state/`, and
  never run `facts-write`. Never touch a doc beyond an approved frontmatter
  fix (frontmatter block only; body stays byte-identical) or an approved
  glossary file.
- Never change the engine, the installer, or the config schema — this skill
  only ever writes `_lumina/config/project.yaml` and, on approval, doc
  frontmatter or a glossary file.
- Never assume a software-only frame: no rule, mapping, or example that only
  fits a software project's doc names or ID schemes. Map by what a family of
  docs does, not by its label or folder.
- No `git commit`, `add`/`stage`, or `push`, and no hooks. A read-only `git
  status --porcelain` is fine — once before step 7's first write, to capture
  a baseline, and once after, to confirm the Definition of Done against it.

## Definition of Done

If nothing was approved: confirm nothing was written and report that — done.

If a config (or an approved subset) was written, verify before reporting done:
(a) `config-check` exits 0 (after at most 3 fix-and-re-approve attempts);
(b) `scope`'s file count matches the scan, or every mismatch is explained;
(c) `lint` ran and its findings are summarized by rule id;
(d) `git status --porcelain` (read-only), compared against the baseline
    captured before step 7's first write, shows new changes only under
    `_lumina/config/project.yaml` and any approved frontmatter/glossary
    paths.
