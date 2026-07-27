---
phase: 6
title: "Native graph correction operations"
status: todo
priority: P1
effort: "3-4d"
dependencies: [4, 5]
---

# Phase 6: Native graph correction operations

## Context Links

- [Phase 4](./phase-04-native-lifecycle-and-checks.md)
- [Phase 5](./phase-05-v19-knowledge-read-compatibility.md)
- [`src/scripts/wiki.mjs`](../../src/scripts/wiki.mjs)
- [`apps/desktop/internal/graph/service.go`](../../apps/desktop/internal/graph/service.go)

## Overview

Add native, reviewed correction actions equivalent to v1.9.1
`remove-edge`/`replace-edge` and v1.9.2 `remove-citation`.

## Requirements

- Authorization: consume the focused plan's session-owned
  `read-only|writable` access mode and reject every apply operation for
  read-only sessions before mutation.
- Functional: dry-run and apply each operation with CLI-equivalent reverse,
  symmetric, terminal, exemption, confidence, and advisory behavior.
- Non-functional: atomic, idempotent, capability-bound, serialized per
  workspace, and recoverable after partial failure.

## Architecture

A native knowledge mutation service parses graph records, plans an exact change,
returns a preview, then commits through a workspace lock and atomic replacement.
The service revalidates session/root identity and runs native checks before the
frontend refreshes.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/knowledge/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/knowledge/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/main.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/graph-view.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/ai/immutability_test.go`

## Implementation Steps

1. Write RED conformance tests from CLI-generated fixtures for present/absent,
   reverse, symmetric, terminal, exempt, citation, confidence, and surviving
   wikilink cases.
2. Implement strict request validation and a side-effect-free preview plan.
3. Implement atomic JSONL mutation with per-workspace locking, cancellation
   boundaries, rollback, and idempotent no-op results.
4. Register capability-bound Wails methods and show exact affected records plus
   advisories before enabling confirmation.
5. Run native checks and refresh graph/retrieval generation after commit.

## Tests Before

- [ ] Desktop has no native correction operations.
- [ ] Mutations fail for stale session capability or changed workspace identity.
- [ ] Concurrent writers cannot lose records.

## Refactor

Share record parsing and atomic commit primitives across edge and citation
operations while leaving their validation rules explicit.

## Tests After

- [ ] Native dry-run/apply results match CLI fixtures.
- [ ] Repeating an operation converges without extra changes.
- [ ] Cancellation before commit is clean; cancellation after commit reports the
  committed result.
- [ ] Graph/check state refreshes after success.

## Regression Gate

Run knowledge/checker/graph Go tests, correction frontend tests, CLI conformance,
then the full Desktop suite.

## Success Criteria

- [ ] All three correction actions work inside the app without CLI.
- [ ] No mutation occurs without a visible preview and explicit confirmation.

## Risk Assessment

Line-based rewrites can drop concurrent updates. Use one cross-process lock,
re-read immediately before commit, and atomically replace only after validation.

## Security Considerations

Never accept a filesystem path from the frontend; authorize against the active
session, cap file sizes/record counts, and escape all displayed page content.
