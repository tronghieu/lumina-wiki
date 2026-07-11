---
phase: 1
title: "Local settings secrets and history foundation"
status: completed
priority: P1
effort: "3d"
dependencies: []
---

# Phase 01: Local Settings, Secrets, and History Foundation

## Overview

Create versioned, user-only application storage and backend-only credential handling. Establish stable workspace identity and opt-in history semantics before any provider receives content.

## Context Links

- `brainstorm-summary.md` lines 201-224, 252-264
- `research/chat-backend-security-research.md` lines 68-76, 105-126
- `reports/scout-phases-01-02-foundations-providers.md`
- `apps/desktop/frontend/src/app/ai-settings-panel.tsx:17-49` currently uses `localStorage`; phase 7 removes it after bindings exist.

## Requirements

- Functional: independent chat/embedding profiles; save/replace/delete/status credentials; settings migration; workspace-scoped history enable/list/load/append/delete-one/delete-all.
- Non-functional: atomic replace, directory `0700` and file `0600` where supported; unknown schema versions fail closed; no plaintext secret fallback; disabling history retains prior records.
- Fixed state: keyring locked/denied/missing/unsupported is explicit; session-only fallback requires a short-lived backend challenge plus explicit confirmation; retry links attempts without duplicating the user message.
- Concurrency: one process-wide history coordinator owns workspace-keyed locks; append/delete/delete-all use one documented lock order and cross-process lock-file policy.
- Identity: persist a versioned user-config workspace registry so rename, alias, and path reuse require an explicit attach decision instead of silently inheriting history/cache.

## Architecture

```go
type Profile struct { SchemaVersion int; ID, Kind, Label, Model, BaseURL, CredentialRef string; TimeoutMS, MaxInputChars, MaxHistoryChars, MaxEvidenceChars, MaxOutputTokens int }
type SecretStore interface { Put(context.Context, string, []byte) error; Get(context.Context, string) ([]byte, error); Delete(context.Context, string) error; Status(context.Context, string) SecretStatus }
type HistoryStore interface { Append(context.Context, WorkspaceID, ConversationRecord) error; List(context.Context, WorkspaceID) ([]ConversationMeta, error); Delete(context.Context, WorkspaceID, string) error; DeleteAll(context.Context, WorkspaceID) error }
type HistoryCoordinator interface { WithWorkspace(context.Context, WorkspaceID, func(HistoryStore) error) error }
type SessionChallenge struct { Nonce string; ExpiresAt time.Time }
```

`WorkspaceID` hashes OS-normalized canonical path plus stable filesystem identity when available. Config metadata points to opaque credential references; only Go resolves secret bytes.

## Related Code Files

- Create: `apps/desktop/internal/ai/settings/types.go`, `apps/desktop/internal/ai/settings/store.go`, `apps/desktop/internal/ai/secrets/store.go`, `apps/desktop/internal/ai/secrets/keyring.go`.
- Create: `apps/desktop/internal/ai/history/types.go`, `apps/desktop/internal/ai/history/store.go`, `apps/desktop/internal/ai/history/coordinator.go`, `apps/desktop/internal/ai/workspaceid/identity.go`, `registry.go` and colocated `*_test.go` files.
- Modify: `apps/desktop/go.mod`, `apps/desktop/go.sum`. Phase 5 alone owns the Wails facade and `main.go` registration.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Modify | `apps/desktop/go.mod`, `apps/desktop/go.sum` | add `github.com/zalando/go-keyring@v0.2.8` | module/build gate |
| Create | `apps/desktop/internal/ai/settings/types.go` | versioned DTOs, validation, fingerprints | 120 + 12 cases |
| Create | `apps/desktop/internal/ai/settings/store.go` | atomic user-config persistence/migration | 180 + 12 cases |
| Create | `apps/desktop/internal/ai/secrets/store.go` | interface/status/session fallback | 100 + 10 cases |
| Create | `apps/desktop/internal/ai/secrets/keyring.go` | OS keyring adapter | 120 + mock conformance |
| Create | `apps/desktop/internal/ai/history/types.go` | conversation schema/state | 90 + schema cases |
| Create | `apps/desktop/internal/ai/history/store.go` | JSONL + atomic metadata | 190 + 15 cases |
| Create | `apps/desktop/internal/ai/history/coordinator.go` | workspace locks, lock order, cross-process policy | 150 + race/process cases |
| Create | `apps/desktop/internal/ai/workspaceid/identity.go` | canonical identity/path-reuse checks | 160 + platform table |
| Create | `apps/desktop/internal/ai/workspaceid/registry.go` | versioned path/signature registry and attach decisions | 170 + lifecycle table |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | serialized settings/bindings | no key, secret, auth header, or secret getter |
| Critical | keyring locked/unsupported | typed status; no disk fallback; confirmed session path only |
| Critical | alias, case-fold, rename, path reuse | no cross-workspace history/cache attachment without confirmation |
| Critical | concurrent append/delete/delete-all | serialized workspace mutation, deterministic result, no corrupt JSONL |
| Critical | second process owns workspace lock | stable busy/retry result; no interleaved mutation |
| High | unknown/malformed config | actionable fail-closed error; original file unchanged |
| High | interrupted append/retry | one terminal record; linked attempt; no duplicate user turn |
| Medium | disable/delete | disable stops writes and retains data; explicit delete purges scope |

## Interface and Function Checklist

- [x] `settings.ValidateProfile`, `settings.Profile.Fingerprint`, `ConfigStore.Load/Save`.
- [x] `SecretStore.Put/Get/Delete/Status`; phase-5 facade exposes status/write/delete plus `BeginSessionCredential` and nonce-consuming `ConfirmSessionCredential`, never a getter.
- [x] `HistoryStore.Append/List/Load/Delete/DeleteAll/SetEnabled` with injected clock and ID generator.
- [x] History coordinator owns all reads/mutations with process gates, kernel advisory locks, and documented lock ordering.
- [x] Workspace identity manager records durable evidence and requires explicit confirmation across restart/rename/path reuse ambiguity.
- [x] Atomic writers fsync temp files, rename, and enforce user-only Unix modes plus owner/SYSTEM Windows DACL for private history.

## Dependency Map

`workspaceid -> settings/history/index paths`; `settings -> secrets profile refs`; phase 1 contracts block provider auth in phase 2, cache paths in phase 4, orchestration persistence in phase 5, and UI settings in phase 7.

## Tests Before

- RED: `cd apps/desktop && go test ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid -count=1`
- Expected RED: Go reports the four named `internal/ai` packages missing before production files exist; after package creation, focused assertions fail on absent migration, status, atomicity, and isolation behavior.
- Baseline protection: `cd apps/desktop && go test ./internal/workspace ./internal/graph ./internal/importer ./internal/tools` must remain green.

## Refactor

No frontend migration yet. Keep `workspace.Service.Validate/ResolveInside`, graph reads, check, and Import signatures unchanged; inject filesystem roots/keyring/clock through constructors so tests never touch real user storage.

## Tests After

- GREEN: `cd apps/desktop && go test ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid -count=1`
- Race: `cd apps/desktop && go test -race ./internal/ai/settings ./internal/ai/history ./internal/ai/workspaceid`
- Regression: `cd apps/desktop && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid`

## Implementation Steps

- [x] Write profile validation/fingerprint tests; run the focused RED command and record the missing-symbol failure.
- [x] Implement version/base-URL/model/budget validation; rerun focused tests GREEN.
- [x] Commit: `feat(desktop): add versioned AI profile settings` (`4f506d41`).
- [x] Write atomic store/permission/migration tests; implement bounded temp-fsync-rename storage; run GREEN/race/vet.
- [x] Write keyring status/session-challenge tests; add nonce expiry/single-use/restart-invalidated flow without a secret-returning API; run GREEN/race/vet.
- [x] Commit: `feat(desktop): secure provider credentials` (`7cfb51ca`).
- [x] Write workspace identity/registry and history lifecycle/concurrency/cross-process tests; implement and pass RED/GREEN/race gates.
- [x] Commit identity: `feat(desktop): add durable workspace identity` (`45567649`).
- [x] Commit history: `feat(desktop): add workspace scoped chat history` (`397d578c`).
- [x] Export constructor-ready stores/interfaces only; no Wails facade or `main.go` registration; run full Go regression.

## Success Criteria

- [x] All storage and identity matrix cases pass locally, under race/vet, and package cross-compilation for Windows/Linux/Darwin/FreeBSD.
- [x] Secret bytes never serialize, log, enter errors, or persist outside OS/session storage.
- [x] Config/history writes are atomic and workspace files remain byte-identical.

## Completion Evidence

- Completed: 2026-07-11.
- Reviews: per-slice spec compliance and code quality approved after all findings were fixed and re-reviewed.
- Final phase gate: settings, secrets, workspace identity, history, full desktop tests, race tests, vet, diff checks, and four-platform package cross-compilation passed.
- Platform note: Windows protected-DACL runtime test is build-tagged and cross-compiles here; it runs on Windows CI. Native macOS tests emit pre-existing linker target-version warnings with exit status zero.

## Security, Risks, and Rollback

- Risk: Linux Secret Service unavailable. Mitigation: explicit session-only state, never plaintext.
- Risk: filesystem identity differs by OS/network mount. Mitigation: injected platform probe, durable versioned registry, and confirmation on ambiguity.
- Rollback: unregister facade and remove app-config/history files; keyring entries remain deletable by opaque profile ID; no workspace recovery is needed.
