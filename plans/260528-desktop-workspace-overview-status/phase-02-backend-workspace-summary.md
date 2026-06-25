---
phase: 2
title: Backend Workspace Summary
status: completed
priority: P2
effort: 1h
dependencies:
  - 1
---

# Phase 2: Backend Workspace Summary

## Overview

Add a read-only workspace summary method to the Go workspace service.

## Requirements

- Functional: count packs, wiki notes, raw sources, raw notes, graph edges, graph
  citations, and missing expected folders.
- Functional: missing optional folders are data, not validation errors.
- Non-functional: do not follow symlinks or mutate files.

## Architecture

`workspace.Service` gains a `Summary(root)` method and `WorkspaceSummary` model.
It calls `Validate(root)` for root normalization and pack detection, then counts
regular files under known workspace folders.

## Related Code Files

- Modify: `apps/desktop/internal/workspace/service.go`
- Modify: `apps/desktop/internal/workspace/service_test.go`
- Generated: `apps/desktop/frontend/bindings/.../workspace/models.ts`
- Generated: `apps/desktop/frontend/bindings/.../workspace/service.ts`

## Implementation Steps

1. Write failing Go tests for counts and missing optional folders.
2. Implement `WorkspaceSummary` and `Summary`.
3. Count regular files only; skip symlinks.
4. Count non-empty JSONL rows for graph edges/citations.
5. Regenerate Wails bindings through `wails3 generate bindings` or build.

## Success Criteria

- [x] Go tests cover fixture summary counts.
- [x] Go tests cover missing optional folders.
- [x] Summary does not fail when `raw/sources`, `raw/notes`, or `wiki/graph` are missing.
- [x] Generated frontend bindings expose the summary method/model.

## Risk Assessment

Risk: symlink traversal or accidental broad reads.
Mitigation: use `WalkDir`; count only regular files; ignore symlinked entries.
