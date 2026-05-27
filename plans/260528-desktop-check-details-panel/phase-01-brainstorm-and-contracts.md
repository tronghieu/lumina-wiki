---
phase: 1
title: Brainstorm And Contracts
status: completed
priority: P2
effort: 1h
dependencies: []
---

# Phase 1: Brainstorm And Contracts

## Overview

Lock the frontend-only check details scope and document risks before implementation.

## Requirements

- Functional: show last successful check details in inspector.
- Non-functional: no backend changes, no persistence, no telemetry.

## Architecture

`App.tsx` stores the last `CheckResult`; `NodeInspector` renders a bounded details panel. Formatting helpers live with workspace actions.

## Related Code Files

- Create: `plans/260528-desktop-check-details-panel/brainstorm-summary.md`
- Create: `plans/260528-desktop-check-details-panel/reports/red-team-brainstorm.md`
- Create: `plans/260528-desktop-check-details-panel/reports/plan-audit.md`

## Implementation Steps

1. Scout existing check runner backend and frontend formatting.
2. Compare frontend-only, backend verbose, and parser approaches.
3. Red-team stale details, raw output size, and sensitive local paths.
4. Audit plan constraints.

## Success Criteria

- [ ] Brainstorm summary exists.
- [ ] Red-team report exists.
- [ ] Plan audit exists.
- [ ] Scope excludes backend changes and auto-fix.
