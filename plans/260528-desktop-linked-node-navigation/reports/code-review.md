# Code Review: Desktop Linked Node Navigation

## Findings

No blocking findings.

## Resolved Findings

1. Active search could hide the linked node after inspector navigation.
   - Original locations: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`, `apps/desktop/frontend/src/features/graph/graph-view.tsx`
   - Resolution: `GraphView` now passes `selectedNodeId` into `searchGraph`, and `searchGraph` keeps a valid selected node in the filtered visible set.
   - Evidence: `apps/desktop/frontend/src/features/graph/graph-data.test.mjs` covers search for `AI Social Impact` with selected `privacy`; both nodes and the connecting edge stay visible.

## Scope

- Files reviewed: pending frontend diff plus linked plan files.
- Focus: spec compliance, callback/state path, accessibility semantics, security/privacy boundaries, and production-risk edge cases.
- Backend changes: none.
- Dependencies: none added.
- Workspace writes/telemetry: none added.

## Spec Compliance

- Inspector linked rows are semantic `button type="button"` elements: pass.
- Linked rows call the existing app-level selection callback: pass.
- Note loading path is reused via `App.selectNode`: pass.
- No backend/dependency/telemetry/workspace-write change: pass.
- Graph visual selection remains synchronized under active search: pass.

## Verification

- `cd apps/desktop/frontend && npm run test`: pass, 12 tests, 0 failures.
- `cd apps/desktop/frontend && npm run build`: pass.
- `cd apps/desktop && go test ./...`: pass with existing macOS linker warnings.
- `cd apps/desktop && wails3 build`: pass.
- `git diff --check`: pass.

## Residual Risk

- CSS file remains over the soft 200-line target from prior desktop UI work; no split in this feature to avoid unrelated churn.

## Unresolved Questions

None.
