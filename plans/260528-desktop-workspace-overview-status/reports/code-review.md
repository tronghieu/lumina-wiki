# Code Review: Desktop Workspace Overview Status

## Result

Status: pass after fixes, no blocking findings.

## Findings

- Fixed high: summary initially could follow symlinked inventory parents or
  graph JSONL files. Added symlink tests and changed summary counting to require
  real workspace-local directories/files with `Lstat`.
- Fixed medium: missing-folder reporting initially used `Stat`, so symlinked
  folders looked present. It now uses the same real-directory path check.

## Evidence

- `workspace.Service.Summary` is additive and read-only.
- Summary counts are limited to packs, wiki notes, raw sources, raw notes, graph
  edges, graph citations, and missing expected folders.
- `countMarkdownNotesInside`, `countRegularFilesInside`, and
  `countNonEmptyLinesInside` check workspace-local path components before
  walking/opening.
- Tests cover fixture counts, missing optional folders, symlinked inventory
  folders, and symlinked graph files.
- Frontend loads summary in the guarded workspace refresh path and renders a
  compact overview plus inspector inventory details.

## Verification

- `cd apps/desktop && go test ./internal/workspace` passed.
- `cd apps/desktop/frontend && npm run test` passed, 16 tests.
- `cd apps/desktop/frontend && npm run build` passed.
- `cd apps/desktop && go test ./...` passed, existing macOS linker warnings.
- `cd apps/desktop && wails3 build` passed.
- `git diff --check` passed.
- Code reviewer re-review: symlink-safety finding resolved.

## Residual Risk

- No browser-level visual regression test. Covered by TypeScript build, Wails
  build, formatter tests, Go service tests, and code review.

## Unresolved Questions

None.
