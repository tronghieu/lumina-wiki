# Brainstorm Summary: Desktop Graph Refresh Actions

## Codebase Findings

- Desktop app already loads a workspace graph through `Validate` + `Load` in `App.tsx`.
- The inspector has a `Load Graph` button that reuses workspace loading, but the label does not communicate refreshing an already-open graph.
- `Run Check` and `Import` do not reload the graph after they finish.
- Import only copies one file into `raw/sources`; it does not ingest or mutate `wiki/`.
- The safe refresh path is read-only: re-run existing graph `Load`, preserve current selection when possible, and reload note content.

## Exact Requirements

- Expected output: user has a clear `Refresh Graph` action, and successful `Run Check` / `Import` refresh the in-memory graph from the current workspace.
- Acceptance: refresh preserves selected node if it still exists, falls back through existing `resolveSelectedNodeId` if removed, reloads the selected note content, and does not clear check details after a check.
- Scope boundary: no file watching, no auto-ingest, no linter fix, no backend API changes, no graph mutation, no new dependency.
- Non-negotiable constraints: Wails 3, React/TypeScript, existing Go backend contracts, no direct `wiki/` or `graph/` writes, no telemetry.
- Touchpoints: `App.tsx`, `app-shell.tsx`, `node-inspector.tsx`, `workspace-actions.ts`, `workspace-actions.test.mjs`.

## Approaches Considered

### A. Read-only graph refresh helper in `App.tsx`

Create a shared frontend helper that validates the workspace, reloads graph data, preserves selection, and optionally preserves check details.

Pros: no backend change, one selection path, easy to use after import/check/manual action.  
Cons: app-level function grows a bit.

### B. Backend refresh endpoint

Add a Go method that validates and loads graph in one backend call.

Pros: frontend gets simpler.  
Cons: duplicates existing service composition and increases backend API surface for no new capability.

### C. File watcher

Watch workspace `wiki/` or graph files and refresh automatically.

Pros: best live experience.  
Cons: larger cross-platform scope, more edge cases, easy to refresh while files are mid-write.

## Recommendation

Use approach A. It fits current Wails bindings, keeps the desktop app read-only for graph state, and improves user workflow immediately.

## Success Metrics

- Manual refresh is visible in both toolbar and inspector action panel.
- Successful check/import refreshes graph without losing check detail state.
- Existing workspace open/load behavior still works.
- Full desktop test/build gates pass.

## Unresolved Questions

None.
