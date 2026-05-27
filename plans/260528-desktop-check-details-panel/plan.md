---
title: Desktop Check Details Panel
description: >-
  Show detailed Lumina check results in the desktop inspector using the existing
  RunCheck backend result.
status: completed
priority: P2
branch: feat/lumina-desktop-wails
tags:
  - desktop
  - wails
  - check
  - diagnostics
  - tdd
blockedBy: []
blocks: []
created: '2026-05-27T19:30:08.664Z'
createdBy: 'ck:plan'
source: skill
---

# Desktop Check Details Panel

## Overview

Add a check details panel to the inspector. After `Run Check`, the app keeps the last `CheckResult` and displays status, exit code, summary counts, per-check counts, stdout, and stderr. This is frontend-only and uses the existing backend contract.

Brainstorm: [brainstorm-summary.md](./brainstorm-summary.md)  
Red-team: [reports/red-team-brainstorm.md](./reports/red-team-brainstorm.md)  
Plan audit: [reports/plan-audit.md](./reports/plan-audit.md)

Out of scope: auto-fix, backend changes, rule documentation, persistence, telemetry.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Brainstorm And Contracts](./phase-01-brainstorm-and-contracts.md) | Completed |
| 2 | [Frontend Check Detail Model](./phase-02-frontend-check-detail-model.md) | Completed |
| 3 | [Inspector Check Details UI](./phase-03-inspector-check-details-ui.md) | Completed |
| 4 | [Verification And Docs](./phase-04-verification-and-docs.md) | Completed |

## Dependencies

Depends on completed desktop MVP check runner in `plans/260527-lumina-desktop-wails/`.
