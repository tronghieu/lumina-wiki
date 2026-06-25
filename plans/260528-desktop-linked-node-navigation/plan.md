---
title: Desktop Linked Node Navigation
description: >-
  Make linked nodes in the desktop inspector selectable through the existing
  graph selection and note loading path.
status: completed
priority: P2
branch: feat/lumina-desktop-wails
tags:
  - desktop
  - wails
  - graph
  - navigation
  - tdd
blockedBy: []
blocks: []
created: '2026-05-27T19:36:58.758Z'
createdBy: 'ck:plan'
source: skill
---

# Desktop Linked Node Navigation

## Overview

Add linked-node navigation to the inspector. Each linked row becomes an
accessible button that calls the existing app-level node selection handler, so
the inspector, graph highlight, and note reader stay synchronized.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)
Plan audit: [reports/plan-audit.md](./reports/plan-audit.md)

Out of scope: graph auto-pan, inspector tabs, backend changes, persistence, new
dependencies, telemetry, direct workspace mutation.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Brainstorm And Contracts](./phase-01-brainstorm-and-contracts.md) | Completed |
| 2 | [Inspector Linked Node Selection](./phase-02-inspector-linked-node-selection.md) | Completed |
| 3 | [Verification And Docs](./phase-03-verification-and-docs.md) | Completed |

## Dependencies

Depends on completed selected note reader in
`plans/260528-desktop-selected-node-note-reader/`.
