---
phase: 3
title: Frontend Inspector Reader
status: completed
priority: P1
effort: 2h
dependencies:
  - 2
---

# Phase 3: Frontend Inspector Reader

## Overview

Wire selected node changes to backend note reads and display the result in the inspector.

## Requirements

- Functional: inspector shows loading/error/content states for selected node note.
- Non-functional: plain text only; no Markdown renderer; sample graph without workspace does not call backend.

## Architecture

`App.tsx` owns note state and calls generated `ReadNote`. `NodeInspector` receives note state and renders a scrollable plain-text panel.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/app.css`

## Implementation Steps

1. Regenerate Wails bindings after backend method is added.
2. Add frontend note state type.
3. Load selected note when workspace root and selected path are present.
4. Clear note content on workspace reload or missing root.
5. Display full note content in a bounded inspector panel.

## Success Criteria

- [ ] Selecting a node in loaded workspace fetches note content.
- [ ] Sample graph shows preview without backend read.
- [ ] Errors are visible without crashing inspector.
