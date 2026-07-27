---
phase: 2
title: Inspector Linked Node Selection
status: completed
priority: P2
effort: 1h
dependencies:
  - 1
---

# Phase 2: Inspector Linked Node Selection

## Overview

Wire the inspector linked-node list into app-level node selection with semantic
interactive rows.

## Requirements

- Functional: clicking a linked row calls `onSelectNode(linkedNode.id)`.
- Functional: linked rows remain readable and keyboard accessible.
- Non-functional: existing graph click selection and note loading behavior stay unchanged.

## Architecture

`AppShell` passes `onSelectNode` to `NodeInspector`. `NodeInspector` renders
linked nodes as `button type="button"` entries. A tiny pure helper can derive
the selection id for tests without adding a UI test framework.

## Related Code Files

- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/graph-data.ts`
- Modify: `apps/desktop/frontend/src/features/graph/graph-data.test.mjs`
- Modify: `apps/desktop/frontend/src/app.css`

## Implementation Steps

1. Add/cover a pure helper for linked-row selection target.
2. Pass `onSelectNode` from `AppShell` into `NodeInspector`.
3. Render linked entries as buttons and call the helper/callback.
4. Add empty linked-list copy for nodes with no links.
5. Update CSS selectors from static article cards to button rows.

## Success Criteria

- [ ] Frontend test fails before implementation for linked-row selection target.
- [ ] Linked row click selects the linked node through existing callback.
- [ ] No new dependency or backend API is introduced.

## Risk Assessment

Risk: CSS change causes visual regression in inspector cards.  
Mitigation: keep existing linked-list dimensions/colors and only adjust selector names for buttons.
