---
phase: 2
title: Live Graph State
status: completed
priority: P1
effort: 2h
dependencies:
  - 1
---

# Phase 2: Live Graph State

## Overview

Replace fixed `sampleGraph` app state with loadable graph state that can validate a workspace and show real graph data without losing current data on failure.

## Requirements

- Functional: load graph from selected workspace root; maintain selected node consistency after graph changes; show loading/success/error state.
- Non-functional: no direct filesystem reads in frontend; use generated Wails bindings only.

## Architecture

`App.tsx` keeps `graph`, `workspaceRoot`, `selectedNodeId`, and `actionState`. `openWorkspace(root)` calls `Validate(root)`, then `Load(root)`, then swaps state only after success.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs`

## Implementation Steps

1. Add frontend helper tests for workspace load success/error messages and selected-node normalization.
2. Import `Validate` and `Load` bindings in `App.tsx`.
3. Add graph state initialized to `sampleGraph`.
4. Add a load workflow that validates before graph load.
5. Keep old graph if validation/load fails.

## Success Criteria

- [ ] Tests cover workspace load formatting.
- [ ] Empty/failed load does not clear current graph.
- [ ] Selected node falls back to first loaded node when needed.
