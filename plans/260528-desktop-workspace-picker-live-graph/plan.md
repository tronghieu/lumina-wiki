---
title: Desktop Workspace Picker And Live Graph
description: >-
  Wire the Wails desktop UI to existing workspace validation and graph loading
  so users can open a real Lumina workspace instead of viewing only sample graph
  data.
status: completed
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
created: '2026-05-27T19:13:07.760Z'
createdBy: 'ck:plan'
source: skill
---

# Desktop Workspace Picker And Live Graph

## Overview

Add a session-only workspace open flow to the existing Wails app. The user chooses a Lumina workspace with a native directory picker, the app validates it through the existing Go workspace service, loads real graph data through the existing graph service, and keeps check/import actions bound to that root.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)  
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)  
Plan audit: [reports/plan-audit.md](./reports/plan-audit.md)

Out of scope: chat, wiki editing, direct graph writes, persistent recents, installer/root package changes.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Brainstorm And Contracts](./phase-01-brainstorm-and-contracts.md) | Completed |
| 2 | [Live Graph State](./phase-02-live-graph-state.md) | Completed |
| 3 | [Workspace Picker UX](./phase-03-workspace-picker-ux.md) | Completed |
| 4 | [Verification And Docs](./phase-04-verification-and-docs.md) | Completed |

## Dependencies

Depends on completed Wails MVP plan: `plans/260527-lumina-desktop-wails/`.
