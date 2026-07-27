---
phase: 1
title: Scaffold Isolated Wails App
status: completed
priority: P1
effort: 0.5d
dependencies: []
---

# Phase 1: Scaffold Isolated Wails App

## Context Links

- [Brainstorm](./brainstorm-summary.md)
- [Red-team brainstorm](./reports/red-team-brainstorm.md)
- [System architecture](../../docs/system-architecture.md)
- Wails v3 docs: https://v3.wails.io/

## Overview

Create the isolated desktop app skeleton under `apps/desktop/` without changing root npm CLI dependencies. Establish Wails 3, Go module, frontend package, baseline scripts, and a smoke build/test path.

## Requirements

- Functional: app shell starts and displays Lumina Desktop layout frame.
- Non-functional: no root `package.json` dependency bloat; Wails code isolated; no telemetry.

## Architecture

`apps/desktop/` owns the desktop app:

- Go backend in `apps/desktop/internal/...`
- React frontend in `apps/desktop/frontend/`
- Wails config under `apps/desktop/`
- Desktop-specific npm dependencies under `apps/desktop/frontend/package.json`

Root CLI remains unchanged except optional docs in later phase.

## Related Code Files

- Create: `apps/desktop/go.mod`
- Create: `apps/desktop/main.go`
- Create: `apps/desktop/build/config.yml`
- Create: `apps/desktop/frontend/package.json`
- Create: `apps/desktop/frontend/src/*`
- Create: `apps/desktop/README.md`
- Modify: none expected outside `apps/desktop/`

## Implementation Steps

1. Generate or hand-create minimal Wails 3 app structure under `apps/desktop/`.
2. Pin app-local frontend dependencies: React, TypeScript/Vite, React Flow, minimal test runner only inside desktop package.
3. Add a simple Lumina Desktop frame matching screenshot layout at skeleton level.
4. Add Go smoke test and frontend smoke test.
5. Run `wails3 doctor`, desktop build/test commands, and root package check.
6. Commit phase with conventional message.

## Success Criteria

- [x] `apps/desktop/` exists with Go/Wails + frontend structure.
- [x] Root `package.json` has no new desktop dependencies.
- [x] `go test ./...` passes from `apps/desktop`.
- [x] Frontend smoke test passes from `apps/desktop/frontend`.
- [x] Wails dev/build command reaches compile or documented platform dependency failure.
- [x] Phase 1 commit created.

## Risk Assessment

- Wails 3 alpha template changes: prefer explicit small scaffold over large generated boilerplate.
- Dependency sprawl: keep package boundaries local to desktop app.
