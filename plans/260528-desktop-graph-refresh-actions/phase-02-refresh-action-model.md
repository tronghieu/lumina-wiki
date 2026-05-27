---
phase: 2
title: Refresh Action Model
status: completed
priority: P2
effort: 45m
dependencies:
  - 1
---

# Phase 2: Refresh Action Model

## Overview

Add user-facing action formatting for graph refresh and cover it with the
existing frontend test runner.

## Requirements

- Functional: format a graph refresh success state with node/edge counts.
- Non-functional: no new test framework or dependency.

## Architecture

`workspace-actions.ts` owns the action summary formatter. Refresh uses the same
count formatting as workspace load.

## Related Code Files

- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs`

## Implementation Steps

1. Add failing test for `formatGraphRefreshed`.
2. Implement formatter using existing graph count shape.
3. Re-run frontend tests.

## Success Criteria

- [ ] Formatter test fails before implementation.
- [ ] Formatter test passes after implementation.

## Risk Assessment

Risk: duplicate count formatting.  
Mitigation: reuse existing private `formatCount`.
