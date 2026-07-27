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

Document the refresh behavior contract and reject larger live-sync ideas for
this cycle.

## Requirements

- Functional: define manual refresh and post-action refresh semantics.
- Non-functional: no workspace writes, no new backend API, no file watcher.

## Architecture

Refresh composes existing frontend calls to `Validate`, `Load`, and `ReadNote`.

## Related Code Files

- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs`

## Implementation Steps

1. Record codebase findings.
2. Red-team scope and reject file watching/auto-ingest.
3. Audit plan against Lumina workspace contract.

## Success Criteria

- [ ] Brainstorm summary exists.
- [ ] Red-team report exists.
- [ ] Plan audit exists.

## Risk Assessment

Risk: import refresh might imply ingestion happened.  
Mitigation: keep action text focused on copied file and graph refresh only.
