---
phase: 2
title: Backend Note Reader
status: completed
priority: P1
effort: 2h
dependencies:
  - 1
---

# Phase 2: Backend Note Reader

## Overview

Add a read-only graph service method to return Markdown note content under `wiki/`.

## Requirements

- Functional: `ReadNote(root, notePath)` returns path and content for valid Markdown notes.
- Non-functional: reject invalid workspace, escape attempts, backslashes, non-md files, missing files, directories, and symlinks.

## Architecture

`ReadNote` validates root with workspace service, resolves `wiki/<notePath>` inside the validated root, checks file metadata with `Lstat`, then reads content.

## Related Code Files

- Modify: `apps/desktop/internal/graph/types.go`
- Modify: `apps/desktop/internal/graph/service.go`
- Modify: `apps/desktop/internal/graph/service_test.go`

## Implementation Steps

1. Write failing Go tests for valid note read and unsafe paths.
2. Add `NoteContent` model.
3. Implement `ReadNote` with workspace validation and file checks.
4. Run Go tests.

## Success Criteria

- [ ] Valid fixture note returns Markdown body content.
- [ ] Escape/backslash/non-md/symlink cases fail.
- [ ] Existing graph load tests still pass.
