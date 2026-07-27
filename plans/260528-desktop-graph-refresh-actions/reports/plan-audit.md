# Plan Audit: Desktop Graph Refresh Actions

## Audit Result

Status: approved with constraints.

## Checks

- Aligns with Lumina: yes. It reloads local graph view without mutating workspace data.
- Preserves contracts: yes. Existing backend methods only; no direct graph/wiki writes.
- Avoids scope creep: yes. No file watcher, no ingest, no auto-fix.
- Testability: yes. Formatter and TypeScript wiring can be covered with existing frontend test/build gates.

## Required Acceptance Evidence

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Audit Notes

- Manual button label should say `Refresh Graph`.
- Keep check details after check-triggered refresh.
- Refresh after import should preserve the import action success message when reload succeeds.

## Unresolved Questions

None.
