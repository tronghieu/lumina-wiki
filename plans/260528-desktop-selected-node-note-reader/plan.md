---
title: Desktop Selected Node Note Reader
description: >-
  Let the Wails desktop inspector read and show the selected wiki note content
  through a safe read-only backend API.
status: completed
priority: P2
branch: feat/lumina-desktop-wails
tags:
  - desktop
  - wails
  - graph
  - notes
  - tdd
blockedBy: []
blocks: []
created: '2026-05-27T19:22:13.469Z'
createdBy: 'ck:plan'
source: skill
---

# Desktop Selected Node Note Reader

## Overview

Add a safe read-only note reader for selected graph nodes. The graph service reads Markdown files under `wiki/` using node paths from the loaded graph. The inspector displays full plain Markdown for the selected node once a workspace is loaded.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)  
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)  
Plan audit: [reports/plan-audit.md](./reports/plan-audit.md)

Out of scope: Markdown HTML rendering, note editing, frontmatter mutation, raw file preview, persistent note cache.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Brainstorm And Contracts](./phase-01-brainstorm-and-contracts.md) | Completed |
| 2 | [Backend Note Reader](./phase-02-backend-note-reader.md) | Completed |
| 3 | [Frontend Inspector Reader](./phase-03-frontend-inspector-reader.md) | Completed |
| 4 | [Verification And Docs](./phase-04-verification-and-docs.md) | Completed |

## Dependencies

Depends on completed live workspace graph plan: `plans/260528-desktop-workspace-picker-live-graph/`.
