---
phase: 1
title: "Local settings secrets and history foundation"
status: pending
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

- [ ] `settings.ValidateProfile`, `settings.Profile.Fingerprint`, `ConfigStore.Load/Save`.
- [ ] `SecretStore.Put/Get/Delete/Status`; phase-5 facade exposes status/write/delete plus `BeginSessionCredential` and nonce-consuming `ConfirmSessionCredential`, never a getter.
- [ ] `HistoryStore.Append/List/Load/Delete/DeleteAll/SetEnabled` with injected clock and ID generator.
- [ ] `HistoryCoordinator.WithWorkspace` owns all mutations with one lock order and explicit cross-process busy policy.
- [ ] `workspaceid.Resolve` plus `Registry.Attach` record signatures and require confirmation for ambiguous rename/path reuse.
- [ ] Atomic writer fsyncs temp file, renames, and enforces best-effort user-only modes.

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

- [ ] Write profile validation/fingerprint tests; run the focused RED command and record the missing-symbol failure.
- [ ] Implement `types.go` minimum schema/version/base-URL/model/budget validation; rerun focused tests GREEN.
- [ ] Commit: `feat(desktop): add versioned AI profile settings`.
- [ ] Write atomic store/permission/migration tests; run RED; implement temp-fsync-rename storage; run GREEN.
- [ ] Write keyring status/session-challenge tests; run RED; add nonce expiry/single-use/restart-invalidated flow without a secret-returning API; run GREEN.
- [ ] Commit: `feat(desktop): secure provider credentials`.
- [ ] Write workspace alias/reuse/registry and history lifecycle/concurrency/cross-process tests; run RED; implement identity registry, coordinator, and history records; run GREEN and race gate.
- [ ] Commit: `feat(desktop): add workspace scoped chat history`.
- [ ] Export constructor-ready stores/interfaces only; do not create/register a Wails facade in this phase; run full Go regression.

## Success Criteria

- [ ] All storage and identity matrix cases pass on supported CI OSes.
- [ ] Secret bytes never serialize, log, enter errors, or persist outside OS/session storage.
- [ ] Config/history writes are atomic and workspace files remain byte-identical.

## Security, Risks, and Rollback

- Risk: Linux Secret Service unavailable. Mitigation: explicit session-only state, never plaintext.
- Risk: filesystem identity differs by OS/network mount. Mitigation: injected platform probe, durable versioned registry, and confirmation on ambiguity.
- Rollback: unregister facade and remove app-config/history files; keyring entries remain deletable by opaque profile ID; no workspace recovery is needed.
