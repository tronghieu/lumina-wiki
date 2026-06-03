---
phase: 1
title: Brainstorm And Contracts
status: completed
priority: P2
effort: 30m
dependencies: []
---

# Phase 1: Brainstorm And Contracts

## Overview

Lock the feature scope and acceptance criteria for a read-only workspace
overview.

## Requirements

- Functional: define summary fields and UI placement.
- Non-functional: no workspace mutation and no new dependencies.

## Architecture

The feature extends the existing desktop workspace service with additive summary
data. Frontend state remains app-level and is passed to shell/inspector views.

## Related Code Files

- Create: `plans/260528-desktop-workspace-overview-status/brainstorm-summary.md`
- Create: `plans/260528-desktop-workspace-overview-status/reports/red-team-brainstorm.md`
- Create: `plans/260528-desktop-workspace-overview-status/reports/plan-audit.md`

## Implementation Steps

1. Scout existing desktop services and frontend state.
2. Brainstorm options and select narrow read-only summary API.
3. Red-team scope for mutation, symlink, and UI crowding risks.
4. Audit plan and required verification gates.

## Success Criteria

- [x] Brainstorm report exists.
- [x] Red-team report exists.
- [x] Plan audit exists.
- [x] Scope explicitly excludes watchers, ingest, and graph/wiki edits.

## Risk Assessment

Risk: dashboard grows into quality scoring.  
Mitigation: keep this slice to inventory only.
