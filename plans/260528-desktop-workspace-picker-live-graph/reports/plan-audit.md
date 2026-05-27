# Plan Audit: Desktop Workspace Picker + Live Graph

## Audit Result

Status: approved with constraints.

## Checks

- Scope matches current Lumina capabilities: yes. It makes existing workspace graph services visible in UI.
- Preserves workspace contract: yes. Reads only graph/wiki notes; import still writes only `raw/sources` through importer.
- Avoids root package impact: yes. All changes remain under `apps/desktop/` plus plan docs.
- TDD path exists: yes. Frontend helper tests cover graph load state formatting and selection normalization; existing Go graph/workspace tests cover backend contracts.
- UX scope is not overbuilt: yes. Session-only workspace selection, no recents.

## Required Acceptance Evidence

- `cd apps/desktop && go test ./...`
- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && wails3 build`

## Audit Notes

- Do not treat native file dialogs as security boundaries.
- Do not erase current graph on failed load.
- Keep generated Wails bindings generated; do not hand-edit them.
- Update `apps/desktop/README.md` to remove stale MVP limit that says graph is sample-only.
