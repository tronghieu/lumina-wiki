---
phase: 1
title: Brainstorm And Contracts
status: completed
priority: P2
effort: 30m
dependencies: []
---

# Phase 1: Brainstorm And Contracts

## Overview

Capture the narrow feature contract and document why the implementation should
reuse the existing selection path.

## Requirements

- Functional: linked nodes in the inspector can select their target node.
- Non-functional: no backend changes, no workspace writes, no new dependencies.

## Architecture

`NodeInspector` receives the same `onSelectNode` callback already used by
`GraphView`. Linked rows call that callback with the linked node id.

## Related Code Files

- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/graph-data.ts`
- Modify: `apps/desktop/frontend/src/features/graph/graph-data.test.mjs`
- Create: `plans/260528-desktop-linked-node-navigation/reports/*.md`

## Implementation Steps

1. Document brainstorm summary.
2. Red-team scope and reject wider graph focus behavior for this cycle.
3. Audit plan for Lumina workspace contract and test evidence.

## Success Criteria

- [ ] Brainstorm summary exists.
- [ ] Red-team report exists.
- [ ] Plan audit exists and approves narrow scope.

## Risk Assessment

Risk: scope expands into graph panning or tabbed inspector UI.  
Mitigation: keep this slice to callback wiring and semantic linked-row buttons.
