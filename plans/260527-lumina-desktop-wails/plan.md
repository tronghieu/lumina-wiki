---
title: Lumina Desktop Wails MVP
description: >-
  Build an isolated Wails 3 desktop companion app for Lumina workspaces: graph
  browser, workspace validation, node inspector, check runner, and controlled
  raw import. TDD-first, no root CLI regression.
status: pending
priority: P2
branch: feat/lumina-desktop-wails
tags:
  - desktop
  - wails
  - react
  - graph
  - tdd
blockedBy: []
blocks: []
created: '2026-05-27T10:56:47.404Z'
createdBy: 'ck:plan'
source: skill
---

# Lumina Desktop Wails MVP

## Overview

Build `apps/desktop/` as a Wails 3 + React + React Flow companion app. It opens an existing Lumina workspace, validates the local folder contract, reads wiki graph/note data, renders a graph-first UI like the provided screenshot, and runs existing Lumina tools through a controlled backend service.

This does not replace the npm CLI or agent skills. Desktop writes are intentionally narrow: import files into `raw/sources` without overwrite and run existing tools for checks. Graph/wiki mutation remains owned by existing scripts.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scaffold Isolated Wails App](./phase-01-scaffold-isolated-wails-app.md) | Completed |
| 2 | [Workspace Services TDD](./phase-02-workspace-services-tdd.md) | Completed |
| 3 | [Graph Interface](./phase-03-graph-interface.md) | Completed |
| 4 | [Tool Runner and Import](./phase-04-tool-runner-and-import.md) | Pending |
| 5 | [Docs and Release Gates](./phase-05-docs-and-release-gates.md) | Pending |

## Dependencies

- No blocking active plans. Existing relevant plans in `plans/` are completed.
- External tooling: Wails 3 alpha, Go, npm, native WebView dependencies.
- Internal contracts: `src/scripts/wiki.mjs`, `src/scripts/lint.mjs`, `src/scripts/schemas.mjs`, workspace layout documented in `README.md` and `docs/system-architecture.md`.

## Locked Decisions

| Topic | Decision |
|---|---|
| App location | `apps/desktop/` inside this repo, isolated from root npm CLI package. |
| Stack | Wails 3 + Go backend + React/TypeScript + React Flow. |
| Root package | Do not add frontend dependencies to root `package.json`. |
| Graph writes | Out of scope. Read graph/note data; use existing scripts for mutations/checks. |
| Chat | UI shell/context panel only in MVP; no bundled provider API. |
| Import | Copy into `raw/sources` only when target is absent. |
| Tests | TDD per phase: Go tests for services, frontend tests for state/transform/UI logic, existing repo tests remain green. |
| Commits | Commit after each completed phase. |

## Success Criteria

- [ ] Wails desktop app scaffold exists under `apps/desktop/` and builds locally.
- [ ] App opens/validates a Lumina workspace without running install inside this repo.
- [ ] Graph view renders fixture workspace nodes/edges and supports search/select.
- [ ] Right panel shows selected node details and linked nodes.
- [ ] Check runner calls existing Lumina tooling and reports summary safely.
- [ ] Raw import copies files without overwrite.
- [ ] Existing root tests and package gates still pass.
- [ ] Phase commits exist and final PR is opened to `tronghieu/lumina-wiki`.

## Out of Scope

- Provider-backed AI chat.
- Automatic ingest workflow from desktop.
- Editing graph edges or wiki notes.
- Cloud sync, accounts, telemetry, auto-updater.
- Release signing/notarization pipeline.
