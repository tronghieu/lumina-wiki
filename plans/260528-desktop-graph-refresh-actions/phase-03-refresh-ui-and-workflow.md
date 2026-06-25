---
phase: 3
title: Refresh UI And Workflow
status: completed
priority: P2
effort: 1h
dependencies:
  - 2
---

# Phase 3: Refresh UI And Workflow

## Overview

Wire manual and post-action graph refresh through the app-level workspace state.

## Requirements

- Functional: toolbar and inspector expose `Refresh Graph`.
- Functional: successful check/import refreshes graph and note content.
- Functional: check details remain visible after a check-triggered refresh.
- Non-functional: no backend or workspace mutation changes.

## Architecture

`App.tsx` gets a shared refresh helper with options to set loading/success
messages and preserve/clear check result state. `AppShell` and `NodeInspector`
rename the current load callback to refresh semantics.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`

## Implementation Steps

1. Rename prop from `onLoadWorkspace` to `onRefreshGraph`.
2. Add shared `refreshWorkspaceGraph` helper in `App.tsx`.
3. Use helper for workspace open/manual refresh.
4. Refresh graph after successful `Run Check` while preserving check details.
5. Refresh graph after successful import while preserving import success message.

## Success Criteria

- [x] Manual refresh preserves selected node when possible.
- [x] Check-triggered refresh does not clear `lastCheckResult`.
- [x] Import-triggered refresh does not run ingest or mutate wiki data.

## Risk Assessment

Risk: refresh failure after import/check could hide the original success.
Mitigation: surface refresh error because graph state is the visible UI contract.
