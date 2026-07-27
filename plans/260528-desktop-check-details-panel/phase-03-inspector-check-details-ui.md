---
phase: 3
title: Inspector Check Details UI
status: completed
priority: P1
effort: 2h
dependencies:
  - 2
---

# Phase 3: Inspector Check Details UI

## Overview

Render the last check details in the inspector after `Run Check`.

## Requirements

- Functional: after check completes, details panel shows current result; workspace reload clears old details.
- Non-functional: bounded scroll for raw output; no modal; no extra dependencies.

## Architecture

`App.tsx` keeps `lastCheckResult`. `AppShell` passes it to `NodeInspector`. `NodeInspector` uses `formatCheckDetails` for display.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/app.css`

## Implementation Steps

1. Store `RunCheck` result before formatting action state.
2. Clear details when loading a workspace.
3. Pass check result into inspector.
4. Render summary, per-check rows, stdout, stderr.

## Success Criteria

- [ ] Details appear after successful `Run Check`.
- [ ] Details clear on workspace reload.
- [ ] Long output is scrollable.
