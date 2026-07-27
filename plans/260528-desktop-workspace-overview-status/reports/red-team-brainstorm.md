# Red-Team Brainstorm: Desktop Workspace Overview Status

## Concerns

- Do not make validation stricter. A workspace without `raw/sources` can still be
  a valid Lumina workspace; summary should report missing inventory only.
- Do not parse frontmatter or infer entity quality. That belongs to check tools.
- Do not count generated `wiki/graph/*.jsonl` as wiki notes.
- Do not follow symlinks or read outside workspace.
- Do not add automatic refresh/file watching; manual refresh already exists.
- Do not hide check details or action result behind a new dashboard.

## Required Constraints

- Summary API is read-only.
- Missing optional folders are represented as data, not errors.
- Existing `Validate`, `Load`, `RunCheck`, and import contracts stay stable.
- Frontend must keep sample graph usable before a workspace is loaded.
- Verification must include Go tests, frontend tests/build, Wails build, and
  diff whitespace check.

## Recommended Narrow Slice

Implement only workspace inventory summary:

- packs
- wiki markdown notes
- raw sources
- raw notes
- graph edges
- graph citations
- missing expected folders

Skip trends, timestamps, disk usage, file watching, and quality scores.

## Unresolved Questions

None.
