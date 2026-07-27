# Desktop Simple Handdrawn Redesign Plan

Date: 2026-06-04

## Status

In progress.

## Goal

Redesign `apps/desktop` frontend to match the user's hand-drawn three-zone app shell:

- left graph menu,
- central graph artifact view,
- right agent panel with chat composer.

## Phase 1: Contract Test

Status: complete.

Steps:

1. Add a lightweight source-level layout contract test.
2. Confirm it fails before implementation.

Success:

- Test detects missing new shell regions.

## Phase 2: Shell Markup

Status: complete.

Steps:

1. Update `app-shell.tsx` to use compact left graph rail.
2. Keep center `GraphView`.
3. Reframe `NodeInspector` as right agent panel.
4. Keep all existing action callbacks wired.

Success:

- All existing behavior remains reachable.

## Phase 3: Agent Panel Markup

Status: complete.

Steps:

1. Update `node-inspector.tsx` with agent-panel header, scroll body, workspace controls, linked nodes, check details.
2. Add bottom composer with model selector and input.
3. Do not add real chat backend.

Success:

- Matches mockup structure without new backend scope.

## Phase 4: Styling

Status: complete.

Steps:

1. Replace dashboard CSS with quiet three-zone desktop shell.
2. Use restrained neutral palette and blue ink accent.
3. Add responsive fallbacks.
4. Avoid adding dependencies.

Success:

- Layout resembles sketch and avoids overlap.

## Phase 5: Verification and Ship

Status: complete.

Commands:

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

Ship:

- Code review.
- Stage code plus ignored plan files.
- Commit and push.
- Restart app on `http://localhost:9245/`.

## Open Questions

None.
