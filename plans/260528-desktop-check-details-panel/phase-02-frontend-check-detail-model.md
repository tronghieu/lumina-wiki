---
phase: 2
title: Frontend Check Detail Model
status: completed
priority: P1
effort: 1h
dependencies:
  - 1
---

# Phase 2: Frontend Check Detail Model

## Overview

Add tested frontend helpers that turn `CheckResult` into display rows and raw output blocks.

## Requirements

- Functional: format status, exit code, summary counts, per-check counts, stdout, and stderr.
- Non-functional: deterministic ordering for per-check counts.

## Architecture

Extend `workspace-actions.ts` with `CheckDetailsView` and `formatCheckDetails`.

## Related Code Files

- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs`

## Implementation Steps

1. Add failing tests for check detail formatting.
2. Implement formatter and empty output placeholder.
3. Keep existing summary formatter unchanged.

## Success Criteria

- [ ] Tests cover by-check sorting.
- [ ] Empty stdout/stderr use readable placeholders.
- [ ] Existing workspace action tests still pass.
