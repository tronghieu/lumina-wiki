# Brainstorm Summary: Desktop Linked Node Navigation

## Codebase Findings

- Desktop app is Wails 3 with Go backend and React/TypeScript frontend under `apps/desktop`.
- `App.tsx` already owns `selectedNodeId` and has `selectNode(nodeId)` which loads note content.
- `GraphView` already receives `onSelectNode` and updates selection through React Flow node clicks.
- `NodeInspector` already computes linked nodes with `linkedNodes(graph, selectedNode.id)` but renders them as static articles.
- No backend or workspace write contract is needed for linked-node navigation.

## Exact Requirements

- Expected output: each row in inspector `Linked Nodes` is clickable and selects that linked node.
- Acceptance: clicking a linked row updates inspector title/path/type/preview, triggers existing note loading path through `selectNode`, and keeps graph selection state in sync.
- Scope boundary: no new tab system, no graph auto-pan/focus, no backend changes, no persistence, no new dependency.
- Non-negotiable constraints: Wails 3, React/TypeScript, no root package changes, no telemetry, no direct wiki/graph writes.
- Touchpoints: `App.tsx`, `app-shell.tsx`, `node-inspector.tsx`, `app.css`, frontend tests.

## Approaches Considered

### A. Pass `onSelectNode` into `NodeInspector`

Render linked rows as buttons and call the existing app-level selection handler.

Pros: smallest change, reuses note loading behavior, keeps one source of truth.  
Cons: does not auto-center the graph viewport.

### B. Add inspector-local selection state

Make the inspector choose a linked node without involving app-level graph state.

Pros: isolated to one component.  
Cons: forks selection state and can desync graph highlight/note loading.

### C. Add a graph focus command

Expose a richer selection/focus contract that selects and pans React Flow to a node.

Pros: stronger navigation experience.  
Cons: needs React Flow instance plumbing and broader UI behavior; not needed for this slice.

## Recommendation

Use approach A. It makes linked rows act like graph nodes while preserving existing state ownership and note loading behavior.

## Success Metrics

- Linked node rows are keyboard-accessible buttons.
- Clicking a linked row uses the same selection path as clicking a graph node.
- TypeScript and frontend tests prove the callback contract.
- No backend files or workspace mutation contracts change.

## Unresolved Questions

None.
