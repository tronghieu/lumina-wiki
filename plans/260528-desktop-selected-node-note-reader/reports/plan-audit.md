# Plan Audit: Desktop Selected Node Note Reader

## Audit Result

Status: approved with constraints.

## Checks

- Fits Lumina current model: yes. It reads generated `wiki/` notes without changing them.
- Preserves write boundaries: yes. No `wiki/` or `graph/` mutation.
- Avoids new dependencies: yes. Plain text display only.
- Testability: yes. Backend safety rules are covered by Go tests; frontend state formatting remains simple.
- Scope discipline: yes. No editor, renderer, recents, or raw preview.

## Required Acceptance Evidence

- `cd apps/desktop && go test ./...`
- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && wails3 build`

## Audit Notes

- Do not hand-edit generated bindings; regenerate with Wails.
- Do not silently expand to note editing.
- If frontend race appears, store selected path with loaded content before display.
