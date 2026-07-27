---
title: "Phase 2: Secure Native Provisioning"
status: completed
effort: "5-7d"
---

# Phase 2: Secure Native Provisioning

## Overview

Build a native, handle-relative provisioner and compatibility validator that
never overwrites existing entries, has an explicit interrupted state, and
carries the verified root proof into workspace identity and session activation.

Context: [focused scout](./reports/phase-02-focused-scout.md) and
[filesystem research](../reports/researcher-260725-0126-filesystem-safety.md).

## Requirements

- [x] Consume Phase 1's exact Go 1.25.12 pin and branch-aware preflight. No
      rooted evidence from local Go 1.26.1 or another rejected version counts.
- [x] Consume only Phase 1's verified immutable payload API; reject it before
      target access when invalid.
- [x] Materialize target-specific README/config/manifest/CSV bytes only after
      holding the proven root; verify final inventory/hashes before publication.
- [x] Classify absent, empty, existing legacy/supported/newer/malformed, unsafe,
      occupied, interrupted, committed-residue, and dirty/ambiguous targets
      under one app-local cross-process creation lock.
- [x] Treat absent as the normal Create target. An existing empty target
      requires a distinct native approval, then a fresh locked reclassification;
      approval is invalid if any entry or identity change appears.
- [x] Hold parent/target `*os.Root` capabilities, prove identity throughout,
      and reject links, junctions, reparse points, special entries, or root
      replacement.
- [x] Journal and stage on target volume; sync complete files, publish through
      the no-clobber strategy, state CSVs before manifest, manifest last.
- [x] Publish through an atomic no-clobber platform abstraction: hard link when
      supported, Linux `renameat2(RENAME_NOREPLACE)`, Darwin
      `renameatx_np(RENAME_EXCL)`, and Windows
      `SetFileInformationByHandle(FileRenameInfoEx)` relative to the held target
      directory without `REPLACE_IF_EXISTS`. Cross-volume user targets work
      because staging is in-target.
      No platform/storage ships Create without one proven safe strategy.
- [x] Recovery resumes only a matching immutable journal/inventory; never
      cleans unknown, corrupt, mismatched, or foreign state.
- [x] Existing compatible libraries open without workspace mutation. Missing
      manifest is legacy; schemas 1-4 are supported; >4 is newer. A present
      manifest also requires its expected CSV state set and consistency; a
      CLI-interrupted state fails closed without mutation.
- [x] Preserve current identity decisions and add trusted proof handoff.
      Windows uses versioned 128-bit `FileIdInfo` or fails closed and migrates a
      unique confirmed legacy signature without changing workspace ID.
- [x] Activation carries backend-owned `read-only|writable`; legacy/existing
      Open is read-only. A central session `WorkspaceWriteAuthorizer` guards
      workspace-byte mutations. App-local history/index/settings writes use
      their existing authorization and are not blocked by read-only mode.
- [x] Identity attach, runtime/session, and bounded readiness are staged; only
      then do registry and session commit. Abort leaves prior identity/session.
- [x] Before first target mutation, persist one minimal private
      `PendingLibraryOperation` with transaction ID, parent proof, child name,
      canonical backend path, contract digest, and phase
      `approved|mutating|committed`. Add target proof after creation and update
      phase atomically. Clear only after identity/session commit.
- [x] Startup exposes the pending operation as one safe recovery card. Retry
      revalidates the stored parent/target proof and matching journal; Remove
      deletes only the app-local reference and never target content.
- [x] Permit at most one pending operation. A later Create must first Retry or
      Remove it.
- [x] Pending-operation storage uses the same Unix private-mode and Windows
      owner+SYSTEM handle-DACL contract as other sensitive app-local state.

## Files

| Path | Action |
|---|---|
| `apps/desktop/internal/workspace/provision.go` | create orchestration/request/result |
| `apps/desktop/internal/rootproof/**` | consume Phase 1 neutral proof leaf; do not redefine it |
| `.../workspace/provision-classify.go` | create target/recovery classifier |
| `.../workspace/provision-journal.go` | create strict bounded immutable journal |
| `.../workspace/provision-root.go` | create rooted path, staging, link, sync helpers |
| `.../workspace/provision-publish-{link,linux,darwin,windows,fallback}.go` + native tests | create no-clobber publisher strategies; fallback fails closed |
| `.../workspace/provision-lock.go` and `provision-lock-{unix,windows,fallback}.go` | create persistent kernel lock |
| `.../workspace/provision-pending.go` + test | create private phased pending-operation record |
| `apps/desktop/internal/appprivate/{store,atomic,lock,protection}.go` with platform files/tests | create reusable private atomic-state primitive for pending operation and Phase 4 appstate |
| `.../workspace/manifest.go` | create bounded optional-manifest version inspection |
| `.../workspace/provision-*-test.go`, `manifest-test.go` | create classifier, crash, race, lock, proof tests |
| `.../workspace/service.go`, `tree-root.go`, `tree-safe.go` and tests | modify to share held-root validation without weakening callers |
| `apps/desktop/internal/ai/workspaceid/candidate.go`, `manager-decisions.go` and tests | add `BeginAttachTrusted` through existing decision logic |
| `.../workspaceid/manager-transaction.go` and tests | add prepare/commit/abort identity transaction and reconciliation |
| `.../ai/session/registry-transaction.go` and tests | add staged activation that does not retire A before coordinated commit |
| `.../ai/session/access-mode.go` + tests | create session-owned read-only/writable mode and central workspace-write authorization |
| `apps/desktop/internal/ai/workspace-write-authorizer.go` + tests | create reusable guard for every present/future workspace-byte write facade |
| `.../workspaceid/signature-windows.go` | use 128-bit Windows file identity or no reusable signature |
| `apps/desktop/internal/ai/workspace-validator-adapter.go`, `service-types.go`, `service-activation-run.go` and tests | carry proof through internal validation/activation without Wails leakage |
| `apps/desktop/ai-composition.go` and test | wire trusted validator/attacher |
| `apps/desktop/go.mod` | consume Phase 1 patched toolchain policy |
| `.github/workflows/desktop.yml` | consume exact pin and include workspace in race gate |

## Interface Checklist

```go
NewProvisioner(materializer VerifiedMaterializer, configBase string, options ProvisionOptions)
(*Provisioner).Classify(ctx context.Context, target string) (TargetClassification, error)
(*Provisioner).Provision(ctx context.Context, target string) (ProvisionResult, error)
(*Provisioner).PendingOperation(ctx context.Context) (PendingLibraryOperation, bool, error)
(*Provisioner).RetryPending(ctx context.Context, recoveryID string) (ProvisionResult, error)
(*Provisioner).RemovePending(ctx context.Context, recoveryID string) error
Service.ValidateTrusted(ctx context.Context, root string, proof RootProof) (WorkspaceShape, error)
Manager.BeginAttachTrusted(root string, proof RootProof) (*PreparedAttach, AttachDecision, error)
PreparedAttach.Approve(oneUseDecisionToken) error
session.Registry.PrepareActivation(SessionDescriptor) (StagedActivation, error)
```

- `VerifiedMaterializer` exposes verified inventory plus target-specific
  `Materialize`; passing a raw payload subtree is insufficient.
- `ProvisionResult` keeps canonical root and versioned `RootProof` backend-only.
  `RootProof` owns held-handle/SameFile evidence plus Unix signature or Windows
  volume + 128-bit FileIdInfo; it is never serialized.
- Operation hooks exist only for deterministic tests; production uses secure
  randomness and real I/O.
- Verify contract before lock/write; lock before classification; hold only
  through durable publication/recovery-evidence decision/proof capture or safe
  abort.
- Journal uses `O_EXCL`, strict decode and full inventory. Final files are
  absent or complete synced no-clobber publications; there is no partial
  replacement state.
- Manifest-last is a Desktop-journal commit rule only. Existing CLI libraries
  are classified from the complete required state-file set and canonical CSV
  consistency, not manifest presence alone. Version-aware obsolete residue such
  as legacy skills-manifest JSON is tolerated per canonical migrations, not
  treated as foreign corruption.
- Cancellation before manifest returns cancelled/recoverable. After manifest
  commit, finish validation and return committed success. If complete inventory
  or journal verification is not proven, preserve pending/journal/stage evidence
  and return the explicit committed-residue warning.
- Stable public errors never contain canonical paths, journal IDs, or raw OS
  errors.
- `Validate(string)` remains read-only and compatible for graph/tools/importer.
- Trusted attach opens its own handle and requires `os.SameFile` with the
  provision proof before issuing the normal identity decision token.
- Release the global creation lock after durable publication, recovery-evidence
  retention, and proof capture—before native confirmation or runtime load.
  Revalidate the held proof during the identity transaction.
- Do not delete recovery evidence through a check-then-unlink path. Until a
  supported platform supplies identity-atomic deletion for the held transaction
  root and journal, retain exact committed residue and surface the warning.
- `PreparedAttach.Commit()` persists identity only after the session activation
  can commit; `Abort()` closes handles and leaves registry/app-state unchanged.
- Prepared attach exposes a backend-only provisional workspace ID and trusted
  root lease needed to build a staged runtime/session before atomic commit.
- `SessionDescriptor` contains window ID, provisional workspace ID, display
  metadata, access mode, loaded runtime and trusted root lease.
- Confirmation-required attach calls `PreparedAttach.Approve(token)` exactly
  once after native confirmation; approval revalidates root/proof and consumes
  the token before runtime staging.
- Pending-operation persistence occurs durably before target mutation, has
  strict bounds/private permissions/lock, and is not the general recent/view
  store from Phase 4.
- Staged activation completes all fallible work before commit. In one
  coordinated critical section, persist prepared identity then perform an
  infallible in-memory session swap; any earlier failure aborts both and leaves
  A current. Post-commit cleanup failure is a warning, not rollback.
- If the process dies after identity persistence but before session swap, no B
  session survives and the pending operation remains. Startup reconciles matching
  identity/proof and retries; clear pending only after swap so either crash
  side converges idempotently.

## Dependency Map

Phase 1 `contract.Bundle` -> workspace Provisioner -> held `os.Root`/neutral RootProof ->
journal/stage/no-clobber publication -> manifest-last -> release create lock ->
`ValidateTrusted` -> prepared identity attach -> loaded runtime -> staged
session -> Phase 3 prepared-library readiness -> identity/session commit. No
runtime edge points to Node.

## TDD Execution

### Tests Before

Write the classifier table and red tests first:

| Area | Required failing scenarios |
|---|---|
| Toolchain/root | patched version assertion; terminal final symlink plus trailing slash cannot escape root |
| Request/parent | empty/relative/unclean/invalid/oversize; missing/file/link/replaced parent |
| Target | absent race, empty, file/special/link/junction, dirty, foreign/corrupt journal |
| Manifest/state | missing legacy; schema 1-4/5; malformed; CLI crash after manifest/skills/files boundaries; CSV mismatch |
| Stage/publish | short read, hash/sync failure, destination appears, directory/root replaced; hard-link and native no-replace strategies |
| Crash/replay | hook after journal, each stage, directory, link, CSV, manifest, validation, retained-residue verification |
| Concurrency | two independent processes; owner crash; malicious lock entry |
| Proof/identity | root replacement; move/copy/path reuse; legacy Windows signature migration; ambiguous fail-closed |
| Integration/privacy | pre-mutation pending record -> journal -> prepare -> runtime -> staged session -> coordinated identity/session commit -> clear; Retry/Remove at every phase; no private DTO |

### Implement

1. Re-run Phase 1 patched-toolchain preflight.
2. Refactor validator to held-root operations and implement manifest classifier.
3. Implement pre-mutation pending operation, global lock, and immutable journal.
4. Implement staged verified writes and proven no-clobber publishers per OS.
5. Implement deterministic recovery; release create lock before user/runtime work.
6. Add two-phase trusted identity handoff and Windows versioned migration.
7. Carry access mode into runtime/session and integrate activation; no Wails create method yet.

### Refactor

- Reuse/generalize nearby rooted tree proof helpers, but do not refactor all
  app lock packages.
- Never use `ResolveInside` string containment or replacing `Root.Rename`.
- Preserve public `Validate` and existing attach kinds; share internal logic.

### Tests After

```sh
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go test ./internal/workspace
GOTOOLCHAIN=go1.25.12 go test ./internal/ai/workspaceid ./internal/ai
GOTOOLCHAIN=go1.25.12 go test -race ./internal/workspace ./internal/ai/workspaceid ./internal/ai
GOTOOLCHAIN=go1.25.12 go test ./internal/graph ./internal/tools ./internal/importer
GOTOOLCHAIN=go1.25.12 go test ./...
GOTOOLCHAIN=go1.25.12 GOOS=windows GOARCH=amd64 go test -exec=true ./internal/workspace ./internal/ai/workspaceid # compile-only
```

### Regression Gate

- Recursive snapshots prove Open of legacy/supported workspaces changes no
  names, types, or bytes.
- Graph/tools/importer callers of `Validate` retain current behavior.
- Simulated interruption never yields a trusted partial workspace; retry
  converges or fails closed without deleting foreign data.
- Fixtures interrupted at each canonical CLI state-file write boundary are
  never mistaken for Desktop-committed transactions.
- The `GOOS=windows ... -exec=true` command is compile-only. Real Windows CI
  alone covers junction, identity, DACL, lock, and filesystem behavior.

## Success Criteria

- [x] New core payload provisions into an absent target, or an explicitly
      re-confirmed still-empty target, through the same activation boundary as Open.
- [x] No pre-existing entry is replaced or deleted under collision, race,
      cancellation, crash, or retry.
- [x] Manifest is the last trust marker and recovery behavior is deterministic.
- [x] Compatible existing libraries remain byte-identical.
- [x] Patched rooted-containment and Windows identity requirements are enforced.
- [x] Post-publication activation failure remains discoverable and retryable
      without corrupting the prior identity/session.

## Risks and Rollback

- Native no-clobber APIs vary by OS/filesystem; each strategy needs same-target
  collision/race/crash tests. If no safe strategy exists, block implementation
  readiness and request a product decision rather than silently restricting
  user storage.
- Portable sync is strongest-effort; promise deterministic process-crash
  recovery, not universal hardware guarantees.
- If proof continuity cannot be maintained, do not fall back to a canonical
  string; block activation and retain recoverable state.
- Roll back provisioner, identity seam, and validator refactor together; never
  leave a new manifest classifier partially wired.
