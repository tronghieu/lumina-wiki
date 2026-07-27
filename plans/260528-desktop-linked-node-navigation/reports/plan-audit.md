# Plan Audit: Desktop Linked Node Navigation

## Audit Result

Status: approved with constraints.

## Checks

- Aligns with Lumina: yes. It improves local wiki browsing without changing workspace data.
- Preserves contracts: yes. Backend unchanged; no raw/wiki/graph writes.
- Avoids scope creep: yes. No graph panning, tabs, persistence, or new diagnostics.
- Testability: yes. Selection target derivation can be covered with existing Node test runner; TypeScript/build covers component wiring.

## Required Acceptance Evidence

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Audit Notes

- Linked rows must be `button type="button"` for keyboard behavior.
- Current selected node should not render as a linked action because `linkedNodes` only returns edge neighbors.
- Keep no-result state readable if a selected node has no links.

## Unresolved Questions

None.
