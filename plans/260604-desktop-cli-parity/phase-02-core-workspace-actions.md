---
phase: 2
title: "Core workspace actions"
status: pending
priority: P1
effort: "1-2d"
---

# Phase 2: Core workspace actions

## Overview

Implement direct, runnable core workspace actions that do not require an LLM backend.

## Requirements

- Functional: desktop can run migrate/check/reset/discover dry-run style commands against selected workspace.
- Non-functional: command runner must validate workspace, resolve scripts inside workspace, enforce timeouts, and return stdout/stderr/exit code.

## Architecture

Extend desktop backend command execution with a shared safe runner:

- Validate root with `workspace.Service`.
- Resolve `_lumina/scripts/<script>.mjs` inside workspace.
- Run Node with timeout.
- Return structured result to frontend.

## Related Code Files

- Modify: `apps/desktop/internal/tools/service.go`
- Modify: `apps/desktop/internal/tools/service_test.go`
- Modify: frontend workspace action formatting/tests.

## Implementation Steps

1. Extract safe Node script runner from `RunCheck`.
2. Add `RunMigrateLegacy(root)` for `wiki.mjs migrate --add-defaults`.
3. Add reset only with explicit confirmation in a later slice.
4. Add frontend command buttons/results.

## Success Criteria

- [ ] Migrating legacy defaults runs against a real workspace.
- [ ] Existing check behavior unchanged.
- [ ] Tests cover timeout, missing script, non-zero exit.
