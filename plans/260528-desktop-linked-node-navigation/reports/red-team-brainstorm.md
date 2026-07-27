# Red-Team Brainstorm: Desktop Linked Node Navigation

## Verdict

Proceed with a narrow frontend-only slice.

## Challenges

- Do not add separate inspector state. That creates split-brain selection and stale note content.
- Do not add graph auto-pan yet. It is useful, but requires React Flow instance management and likely visual regression checks.
- Do not make linked rows look like decorative cards if they are interactive. Use semantic buttons.
- Watch the existing CSS file size debt. Touch only the linked-list selectors needed for this behavior.

## Accepted Constraints

- Existing `selectNode` already does app selection plus note loading. Reuse it.
- Existing graph highlight already follows `selectedNodeId`. No new graph contract needed.
- Existing tests are pure Node/TypeScript. Add a small helper test instead of bringing in a component testing framework.

## Required Evidence

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Unresolved Questions

None.
