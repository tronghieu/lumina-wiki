---
title: Desktop Graph Refresh Actions
description: >-
  Add a clear read-only graph refresh action and refresh the graph after
  workspace check/import actions.
status: completed
priority: P2
branch: feat/lumina-desktop-wails
tags:
  - desktop
  - wails
  - graph
  - refresh
  - tdd
blockedBy: []
blocks: []
created: '2026-05-27T19:50:00.949Z'
createdBy: 'ck:plan'
source: skill
---

# Desktop Graph Refresh Actions

## Overview

Add a `Refresh Graph` action to the desktop shell and reuse it after successful
`Run Check` / `Import`. Refresh re-reads the workspace graph, preserves selected
node when possible, reloads note content, and does not mutate Lumina workspace
data.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)
Plan audit: [reports/plan-audit.md](./reports/plan-audit.md)

Out of scope: file watching, auto-ingest, linter auto-fix, backend API changes,
new dependencies, telemetry, direct workspace mutation.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Brainstorm And Contracts](./phase-01-brainstorm-and-contracts.md) | Completed |
| 2 | [Refresh Action Model](./phase-02-refresh-action-model.md) | Completed |
| 3 | [Refresh UI And Workflow](./phase-03-refresh-ui-and-workflow.md) | Completed |
| 4 | [Verification And Docs](./phase-04-verification-and-docs.md) | Completed |

## Dependencies

Depends on completed workspace graph loading and note reader plans.
