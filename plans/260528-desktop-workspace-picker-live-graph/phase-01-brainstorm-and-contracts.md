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

Document the feature decision, red-team the scope, and lock concrete acceptance criteria before implementation.

## Requirements

- Functional: define how workspace selection, validation, graph load, and source import picker behave.
- Non-functional: preserve local-first behavior, root package isolation, and Lumina workspace write boundaries.

## Architecture

Frontend owns native picker calls through Wails runtime. Backend services keep domain validation and graph loading authority.

## Related Code Files

- Create: `plans/260528-desktop-workspace-picker-live-graph/brainstorm-summary.md`
- Create: `plans/260528-desktop-workspace-picker-live-graph/reports/red-team-brainstorm.md`
- Create: `plans/260528-desktop-workspace-picker-live-graph/reports/plan-audit.md`

## Implementation Steps

1. Scout desktop services, frontend state, and current plan docs.
2. Compare approaches: runtime dialog, Go dialog service, manual path only.
3. Red-team likely failure modes.
4. Audit the implementation plan before code edits.

## Success Criteria

- [ ] Brainstorm summary exists.
- [ ] Red-team report exists.
- [ ] Plan audit exists.
- [ ] Scope explicitly excludes chat/editing/persistence.
