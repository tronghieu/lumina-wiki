---
phase: 4
title: "Tool Runner and Import"
status: pending
priority: P2
effort: "1d"
dependencies: [2, 3]
---

# Phase 4: Tool Runner and Import

## Context Links

- [Workspace service phase](./phase-02-workspace-services-tdd.md)
- [Project context invariants](../../docs/project-context.md)

## Overview

Add controlled actions: run Lumina check tooling from desktop and import files into `raw/sources` without overwriting. This is the first write-capable phase, so tests must prove path and overwrite safety.

## Requirements

- Functional: user can run a check and import a file to `raw/sources`.
- Non-functional: no shell injection, no raw overwrite, no graph/wiki direct writes, clear error surfaces.

## Architecture

Go services:

- `ToolService`: execute Node scripts with argument arrays and workspace cwd; parse JSON where available.
- `ImportService`: copy selected files to `raw/sources`, reject existing target, return imported path.

Frontend:

- Toolbar/status button for checks.
- Import command in toolbar/sidebar.
- Result panel in right inspector.

## Related Code Files

- Create: `apps/desktop/internal/tools/*`
- Create: `apps/desktop/internal/importer/*`
- Modify: `apps/desktop/frontend/src/features/workspace/*`
- Modify: `apps/desktop/frontend/src/features/graph/*`

## Implementation Steps

1. Write Go tests for tool command construction, missing Node/tool errors, import success, overwrite rejection, path safety.
2. Implement services using `exec.CommandContext` with argv arrays.
3. Add frontend actions and status rendering.
4. Test against fixture workspace and a sandbox workspace generated outside repo.
5. Commit phase.

## Success Criteria

- [ ] Check runner uses existing Lumina scripts, not duplicated logic.
- [ ] Tool command receives args as arrays, no shell interpolation.
- [ ] Import copies into `raw/sources` and refuses overwrite.
- [ ] Errors render in UI without crashing.
- [ ] Go and frontend tests pass.
- [ ] Phase 4 commit created.

## Risk Assessment

- Running tools can be slow or absent: use timeouts and actionable error messages.
- Raw file import is write-capable: keep overwrite refusal strict for MVP.
