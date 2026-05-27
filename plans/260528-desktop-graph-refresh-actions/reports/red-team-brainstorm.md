# Red-Team Brainstorm: Desktop Graph Refresh Actions

## Verdict

Proceed with read-only refresh only.

## Challenges

- Do not imply Import creates wiki nodes. It only copies raw input. Refresh should make external changes visible, not pretend ingestion happened.
- Do not add file watching yet. It can conflict with agents writing notes and needs debounce/error UI.
- Do not clear `lastCheckResult` when refreshing after `Run Check`; the check detail panel is useful evidence.
- Do not add backend API until a frontend-only composition becomes clearly awkward.

## Accepted Constraints

- Refresh uses existing `Validate` + `Load`.
- Note content reload uses existing `ReadNote` path.
- If selected node disappears, `resolveSelectedNodeId` decides fallback.
- If refresh fails after check/import, surface the refresh error because graph state may be stale.

## Required Evidence

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Unresolved Questions

None.
