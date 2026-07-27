---
title: "Worker Report: Session Access Mode, Staged Activation, and Workspace Write Authorization"
date: 2026-07-27
status: complete
---

# Result

Implemented the isolated Phase 2 access-mode slice:

- session-owned validated `read-only|writable` modes;
- additive backend-only `SessionDescriptor` activation;
- legacy `Registry.Activate` defaults to read-only without changing its signature;
- central fail-closed `WorkspaceWriteAuthorizer`;
- authorization lease pins runtime cleanup until the workspace mutation finishes;
- app-local history, semantic-index, and AI-settings writes remain outside the
  workspace-byte authorizer.

Follow-up implementation added the staged activation transaction:

- `PrepareActivation(SessionDescriptor)` reserves validated session identity
  and runtime without replacing the active session;
- copy-safe `StagedActivation.Commit` performs one guarded in-memory swap and
  retires the prior session only afterward;
- `Abort` and stale commit paths close only staged resources;
- a private per-window revision invalidates stages after activation,
  deactivation, window close, or competing commit;
- replay, double terminal calls, concurrent commit/abort, registry shutdown,
  cleanup failure, and cross-window isolation fail closed.

# Files

- `apps/desktop/internal/ai/session/access-mode.go`
- `apps/desktop/internal/ai/session/access-mode_test.go`
- `apps/desktop/internal/ai/session/registry.go`
- `apps/desktop/internal/ai/session/registry-transaction.go`
- `apps/desktop/internal/ai/session/registry-transaction_test.go`
- `apps/desktop/internal/ai/session/cleanup.go`
- `apps/desktop/internal/ai/session/types.go`
- `apps/desktop/internal/ai/workspace-write-authorizer.go`
- `apps/desktop/internal/ai/workspace-write-authorizer_test.go`

# Verification

Tests-first evidence:

- RED: pinned focused tests failed on the intentionally absent access-mode,
  descriptor, and authorizer symbols.
- GREEN: `GOTOOLCHAIN=go1.25.12 go test ./internal/ai/session ./internal/ai`
- RACE: `GOTOOLCHAIN=go1.25.12 go test -race ./internal/ai/session ./internal/ai`
- REGRESSION: `GOTOOLCHAIN=go1.25.12 go test ./internal/graph ./internal/tools ./internal/importer`
- VET: `GOTOOLCHAIN=go1.25.12 go vet ./internal/ai/session ./internal/ai`
- FULL DESKTOP: `GOTOOLCHAIN=go1.25.12 go test ./...`
- FORMAT: `git diff --check`

An independent tester repeated focused/race/vet checks and a ten-run session
race test. macOS emitted existing linker-version warnings.

# Review

- Existing activation signature and lifecycle semantics are preserved.
- Invalid modes close the incoming runtime, do not replace the current session,
  and do not consume a generation.
- Read-only, stale, forged, cross-window, nil, and resolver-error cases all
  return the same sanitized error.
- No canonical path, root proof, Wails DTO, frontend, provisioning, or
  app-private state was introduced or modified.
- Staged handles share terminal state, so copied or concurrent Commit/Abort
  calls cannot swap or close a runtime twice.

# Unresolved Questions

None for this isolated slice. Provisioning composition must later call
`ActivateDescriptor` with writable mode for newly created libraries.
