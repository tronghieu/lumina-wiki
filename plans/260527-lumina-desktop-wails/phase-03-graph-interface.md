---
phase: 3
title: Graph Interface
status: completed
priority: P1
effort: 1.5d
dependencies:
  - 2
---

# Phase 3: Graph Interface

## Context Links

- [Screenshot-driven brainstorm](./brainstorm-summary.md)
- React Flow docs: https://reactflow.dev/

## Overview

Build the graph-first UI matching the provided screenshot: left nav, top toolbar, React Flow canvas, search/filter controls, minimap/zoom, and right inspector tabs.

## Requirements

- Functional: user can load graph data, search nodes, select a node, and view details/links.
- Non-functional: polished app surface, stable layout dimensions, no overlapping UI at desktop sizes.

## Architecture

Frontend structure:

- `AppShell`: layout and navigation.
- `GraphView`: React Flow adapter and canvas state.
- `NodeInspector`: details/chat/linked/media tabs.
- `WorkspaceStore`: current workspace, graph, selected node, errors/loading.
- `fixtures`: frontend graph data for unit tests.

## Related Code Files

- Create/modify: `apps/desktop/frontend/src/app/*`
- Create/modify: `apps/desktop/frontend/src/features/graph/*`
- Create/modify: `apps/desktop/frontend/src/features/workspace/*`
- Create/modify: `apps/desktop/frontend/src/styles/*`
- Create tests under frontend source tree.

## Implementation Steps

1. Write frontend tests for graph transform/search/selection behavior.
2. Implement graph state and React Flow rendering.
3. Build screenshot-aligned layout with responsive constraints.
4. Add right inspector with selected node details and linked list.
5. Run frontend tests and visual smoke via local dev server/browser.
6. Commit phase.

## Success Criteria

- [x] Graph renders sample nodes/edges.
- [x] Search filters visible nodes by label/path/type.
- [x] Node selection updates right panel.
- [x] Layout resembles screenshot at desktop viewport.
- [x] Frontend tests pass.
- [x] Browser screenshot/manual smoke confirms nonblank graph.
- [x] Phase 3 commit created.

## Risk Assessment

- UI polish can consume time: match structure and professional quality first, defer animation.
- React Flow in WebView: add fallback empty/error state if canvas fails.
