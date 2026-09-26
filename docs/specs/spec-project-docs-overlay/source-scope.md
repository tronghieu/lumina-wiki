# Source Scope

## Selection rules

- A file is in scope when it matches at least one include pattern and no exclude pattern. Exclude always wins; order does not matter. No `!` negation.
- Syntax is `*` (within one path segment) and `**` (any depth) only, with the same semantics as classic `matchGlob` in `src/scripts/lib/globs.mjs` (the project engine carries its own compiler, checked by a parity test). No `{a,b}`; list two patterns instead.
- A bare directory name means everything under it: `docs` = `docs/**`.
- Patterns are repo-relative and pass `safePath()`; `..`, absolute paths, and drive letters are rejected.
- Scanner, hook, and lint share one matcher, so they never disagree on scope.
- An include pattern matching zero files produces a warning.
- `.gitignore` is not consulted.

## Excludes

- Always excluded, not overridable: `.git/`, `node_modules/`, `_lumina/`.
- Excluded by default, overridable: `.agents/`, `.claude/`, `.agent/`, `.trae/`, `.codex/`, `.serena/`, `graphify-out/`.

## Default

`include: [docs]`. `_bmad-output/` and similar planning outputs are out of scope unless added, so requirement-to-story-to-QA-gate traceability needs those subfolders included explicitly.

## Status source

For docs whose status is not in frontmatter, the mapping can name a heading to read it from (Capigo ADRs keep status under `## Status`).

## Pilot configs

```yaml
# Seli
sources:
  include: [docs]

# Capigo
sources:
  include: [docs, "packages/*/docs"]
  exclude: [docs/user-guide, docs/templates]   # templates carry placeholder IDs
external_ids:
  - pattern: 'FR[\w.-]+'
```
