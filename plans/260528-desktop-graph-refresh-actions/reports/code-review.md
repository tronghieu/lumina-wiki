# Code Review: Desktop Graph Refresh Actions

## Result

Status: pass after fixes, no blocking findings.

Subagent review found one high-severity stale async refresh risk, one remaining
stale note response path after the first fix, and one medium testing gap. The
stale graph/root and note paths are fixed; the testing gap is reduced with a
unit test for request staleness without adding a new test framework.

## Findings

- Fixed high: overlapping workspace operations could stale-write graph/root
  state after a newer workspace action. Fixed with a shared workspace request
  guard. Older check/import/refresh completions and stale errors are ignored.
- Fixed medium: stale selected-note responses could still commit after
  workspace invalidation. Starting any workspace request now invalidates pending
  note reads before they can update note state.
- Addressed medium: added unit coverage for request staleness. Full App-level
  click tests remain out of scope because the desktop frontend does not include
  a React UI test runner and this change must not add new dependencies.

## Evidence

- `workspace-actions.ts` defines `createWorkspaceRequestGuard` and tests older
  requests becoming stale.
- `App.tsx` starts a request token for manual load/refresh, check, import, and
  workspace-root edits.
- `App.tsx` ignores stale `RunCheck`, `ImportToRawSources`, `Validate`, `Load`,
  and stale error completions before state writes.
- `App.tsx` invalidates pending note reads when a workspace request starts, so
  stale `ReadNote` completions cannot update note content after workspace
  context changes.
- `App.tsx` stores check result, refreshes graph, and keeps `lastCheckResult`
  by using `clearCheckResult: false`.
- `App.tsx` imports source, refreshes graph, and keeps import success message
  when refresh succeeds.
- `App.tsx` re-validates workspace, reloads graph, preserves selected node via
  existing fallback, reloads note content, and only clears check state for
  explicit workspace load.
- `app-shell.tsx:89-93` exposes toolbar `Refresh Graph`.
- `node-inspector.tsx:98-103` exposes inspector `Refresh Graph` and removes the
  old `Load Graph` label.
- `workspace-actions.ts:71-77` formats refresh success without backend/API
  changes.

## Verification

- `cd apps/desktop/frontend && npm run test` passed, 14 tests.
- `cd apps/desktop/frontend && npm run build` passed.
- `cd apps/desktop && go test ./...` passed, existing macOS linker warnings.
- `cd apps/desktop && wails3 build` passed.
- `git diff --check` passed.

## Residual Risk

- No browser-level click test yet. Covered by TypeScript build, request-guard
  unit test, and local review of prop wiring.

## Unresolved Questions

None.
