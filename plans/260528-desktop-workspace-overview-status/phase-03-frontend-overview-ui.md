---
phase: 3
title: Frontend Overview UI
status: completed
priority: P2
effort: 1h
dependencies:
  - 2
---

# Phase 3: Frontend Overview UI

## Overview

Load workspace summary in the frontend and render compact overview UI.

## Requirements

- Functional: opening/refreshing a workspace updates overview.
- Functional: sample state shows no real workspace counts.
- Functional: missing expected folders are visible but non-blocking.
- Non-functional: preserve check details, note loading, import flow, and refresh
  stale-response guard.

## Architecture

`App.tsx` stores `workspaceSummary` next to graph state. `refreshWorkspaceGraph`
loads summary and graph under the same workspace request guard. `AppShell`
renders overview stats; `NodeInspector` renders packs/missing inventory.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs`
- Modify: `apps/desktop/frontend/src/app.css`

## Implementation Steps

1. Add frontend formatter for summary stats and missing folder text.
2. Add TDD coverage for formatter behavior.
3. Import generated `Summary` binding and summary model type.
4. Load summary in the guarded workspace refresh path.
5. Render overview strip and inspector inventory details.

## Success Criteria

- [x] Workspace overview appears only for real loaded workspace summary.
- [x] Counts format consistently for singular/plural cases.
- [x] Missing folder message is visible when summary reports missing paths.
- [x] Existing refresh/check/import behavior is preserved.

## Risk Assessment

Risk: adding too much UI in an already dense shell.  
Mitigation: compact stat strip and restrained inspector details.
