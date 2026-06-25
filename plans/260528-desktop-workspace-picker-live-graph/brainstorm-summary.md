# Brainstorm Summary: Desktop Workspace Picker + Live Graph

## Codebase Findings

- Desktop app is isolated under `apps/desktop/` with Wails 3, Go services, React, TypeScript, and React Flow.
- Go services already exist for workspace validation, graph loading, tool runner, and import.
- Frontend still renders `sampleGraph` and asks the user to type workspace/source paths manually.
- Generated Wails bindings already expose `graph.Load`, `workspace.Validate`, `tools.RunCheck`, and `importer.ImportToRawSources`.
- Root npm package remains clean; desktop dependencies live only in `apps/desktop/frontend`.

## Exact Requirements

- Expected output: user can choose an existing Lumina workspace, app validates it, loads real `wiki/` graph data, and shows that graph in the existing canvas.
- Acceptance: valid workspace loads nodes/edges; invalid workspace shows an error and leaves current state intact; empty selection is ignored; selected node remains valid after graph reload; check/import use the selected workspace root.
- Scope boundary: no chat, no wiki editing, no direct graph writes, no persistent recent workspace list, no installer changes.
- Constraints: Wails 3 + Go backend + React frontend; no root package dependency changes; no telemetry; graph/wiki writes remain owned by existing Lumina tools.
- Touchpoints: `apps/desktop/frontend/src/App.tsx`, `app-shell.tsx`, `node-inspector.tsx`, `workspace-actions.ts`, `graph-data.ts`, desktop README, tests.

## Approaches Considered

### A. Runtime dialog + existing services

Use `@wailsio/runtime` `OpenFile` from React to choose directories/files, then call generated backend bindings.

Pros: smallest change, no new Go service, uses existing Wails runtime, keeps tests focused.
Cons: file dialog behavior is mostly integration-tested via build/dev run, not unit-tested deeply.

### B. New Go dialog service

Add a backend service wrapping `application.Get().Dialog.OpenFile()`.

Pros: Go-owned API shape, can centralize dialog options.
Cons: more framework coupling, harder to unit-test, extra generated bindings for no real domain logic.

### C. Manual path only + live graph button

Keep text input, add a `Load Graph` button.

Pros: simplest technically.
Cons: does not solve the main UX gap from the MVP and still feels like a debug panel.

## Recommendation

Choose approach A. It turns the MVP into a usable desktop companion while staying additive and local-first. Native dialogs are UI plumbing; validation and graph loading stay in the existing backend services.

## Success Metrics

- First useful action is "Open Workspace", not typing paths.
- Graph canvas reflects real fixture/workspace data after selecting a valid workspace.
- Existing check/import flows work against selected root.
- Go tests, frontend tests, frontend build, Wails build pass.
