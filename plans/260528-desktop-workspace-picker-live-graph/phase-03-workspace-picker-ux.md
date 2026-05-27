---
phase: 3
title: Workspace Picker UX
status: completed
priority: P1
effort: 2h
dependencies:
  - 2
---

# Phase 3: Workspace Picker UX

## Overview

Add native Open Workspace and Choose Source controls to the existing shell so users no longer type primary paths manually.

## Requirements

- Functional: `Open Workspace` opens a directory picker; `Choose Source` opens a file picker; Run Check and Import use selected paths.
- Non-functional: no persistent recent list; no root package changes; UI remains compact and work-focused.

## Architecture

Use `@wailsio/runtime` `OpenFile` in `App.tsx`. Pass event handlers into `AppShell` and `NodeInspector`. Keep the path inputs as editable fallback.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/app.css`

## Implementation Steps

1. Add directory picker for workspace with `CanChooseDirectories`.
2. Add file picker for source import with document filters.
3. Add buttons in topbar/action panel.
4. Update copy so initial state is clearly sample until a workspace is loaded.
5. Keep text inputs as fallback/editable paths.

## Success Criteria

- [ ] User can open workspace without typing path.
- [ ] User can choose source file without typing path.
- [ ] UI indicates selected workspace and node count.
- [ ] Text remains contained on desktop/mobile widths.
