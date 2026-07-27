---
title: "Phase 4: Recent Libraries and Continuity — MVP B"
status: completed
effort: "3-4d"
---

# Phase 4: Recent Libraries and Continuity — MVP B

## Overview

Add private recent-library state and restore the latest conversation, last
supported wiki note, and semantic Chat/Note/Graph focus through the Phase 3
capability pipeline. Absolute workspace paths never reach React.

Context: [state scout](./reports/phase-03-focused-scout.md),
[UX scout](./reports/phase-04-focused-scout.md), and
[restoration research](../reports/researcher-260725-0126-welcome-restore.md).

## Requirements

- [x] Store at most 12 recent workspace IDs and per-workspace
      `chat|note|graph` focus plus optional `ArtifactLocatorV1`.
- [x] `ArtifactLocatorV1` is exactly
      `{version:1, kind:"wiki_note", relativePath:"wiki/...md"}` with bounded,
      normalized, slash-relative validation. It restores only the last
      supported wiki note. Original-document/PDF/page restoration is outside
      this plan and must use a later locator version.
- [x] Canonical/absolute paths live only in the private identity registry.
      Recent DTOs contain no paths. The private view store may contain only the
      bounded relative locator; note-read responses may echo that locator but
      never a root.
- [x] Strict bounded JSON, private permissions, symlink rejection, atomic
      sync/rename, cross-process lock/revision, and deterministic eviction.
- [x] Windows applies/verifies an owner+SYSTEM DACL through opened handles for
      directory, lock, temp, backup, and final files.
- [x] Restore-by-ID reopens the backend path, revalidates identity and
      compatibility, and preserves restart confirmation.
- [x] Boot is `booting -> restoring -> ready|welcome`; no Welcome flash while a
      valid recent restore is in progress.
- [x] Open/restore may write app-local state but never workspace bytes.
- [x] History disabled means automatic restoration does not list/load/toggle.
      The explicit Advanced enable/disable control remains available.
- [x] Empty, deleted, unavailable, and corrupt history remain distinct.
- [x] Snapshot/note reads resolve staged or active session -> runtime -> trusted
      root; stale sessions and replaced roots fail safely.
- [x] Corrupt recent/view data remains preserved until the user chooses the
      visible action `Clear recent activity`. Internal APIs may retain
      `ResetRecentViewState`; reset quarantines one bounded backup and never
      repairs/deletes a library.
- [x] Latest history selection/load is one backend-locked operation with
      `off|empty|loaded|deleted_retry_exhausted|unavailable|corrupt`.

## Files

| Path | Action |
|---|---|
| `apps/desktop/internal/appstate/{types,store,store-read,coordinator}.go` | create bounded store over Phase 2 `appprivate` |
| `.../internal/appstate/{types,store,coordinator}_test.go` | create validation, atomicity, concurrency tests |
| `.../internal/appstate/reset.go` + test | create bounded recent/view quarantine/reset |
| `apps/desktop/internal/appprivate/**` | reuse Phase 2 private atomic owner |
| `apps/desktop/internal/ai/workspaceid/manager-decisions.go` + tests | add backend-only `ResolveRecent`/`BeginRestore` |
| `apps/desktop/internal/ai/service-library-types.go` | own recent/view, locator, `PreparedContinuityDTO`, history/note DTOs |
| `.../internal/ai/service-library.go` + tests | expose recent/restore/save/remove facade |
| `apps/desktop/internal/ai/history/store.go`, `latest.go` + tests | add one-lock latest select/load |
| `.../internal/ai/service-management.go`, history facade/tests | expose sanitized atomic history outcome |
| `.../internal/ai/service-types.go`, `wails-native-authority.go` + tests | add native Clear recent activity confirmation/token |
| `.../internal/ai/service-management-{types,runtime}.go` | add snapshot/note capability methods |
| `.../internal/ai/loaded-runtime-management.go`, `service-management.go` + tests | add staged/active trusted reads |
| `apps/desktop/internal/workspace/service.go`, `internal/graph/service.go` + tests | extract trusted-root read helpers |
| `apps/desktop/internal/ai/service.go`, `service-activation-run.go` + tests | inject appstate and reuse Phase 3 prepared activation |
| `apps/desktop/internal/ai/session/registry.go` + tests | add narrow workspace-ID accessor only if authorization needs it |
| `apps/desktop/ai-composition.go` + test | create store from trusted `UserConfigDir` |
| `apps/desktop/frontend/src/App.tsx` | insert restore-before-Welcome orchestration |
| `.../features/workspace/welcome-screen.tsx`, `welcome-state.ts` + tests | add recents, Find again, Remove, Clear recent activity |
| `.../features/workspace/workspace-restoration.ts` + test | validate locator/history/focus fallbacks |
| `.../features/workspace/ready-library-state.ts` + test | extend prepared state with continuity outcomes |
| `.../features/chat/{agent-panel,use-chat-history,chat-state}.tsx/ts` + tests | restore latest conversation truthfully |
| `.../app/{app-shell-state,app-shell}.tsx/ts` + tests | restore semantic focus only |
| `apps/desktop/frontend/bindings/**/internal/ai/**` | regenerate; never hand-edit |
| `frontend/tests/visual/{accessibility,desktop-shell}.spec.ts` + fixtures | recents/recovery/continuity gates |

## Interface Checklist

```go
appstate.NewStore(configBase)
Store.Snapshot(ctx)
Store.RecordActivation(ctx, workspaceID, at)
Store.SaveView(ctx, workspaceID, view)
Store.RemoveRecent(ctx, workspaceID)
workspaceid.Manager.ResolveRecent(ids)
workspaceid.Manager.BeginRestore(id)
Service.ListRecentLibraries(ctx)
Service.PrepareRestoreRecentLibrary(ctx, request) -> PreparedContinuityDTO
Service.PrepareFindRecentLibrary(ctx, request) -> PreparedContinuityDTO
Service.SaveWorkspaceView(ctx, request)
Service.RemoveRecentLibrary(ctx, request)
Service.BeginResetRecentViewState(ctx) -> one-use native-confirmed token
Service.ResetRecentViewState(ctx, token)
Service.ReadWorkspaceNote(ctx, request) -> NoteContentDTO
Service.LoadLatestHistory(ctx, sessionReference) -> LatestHistoryDTO
```

- `WorkspaceSnapshotDTO` and the base commit pipeline are owned by Phase 3.
  `PreparedContinuityDTO` embeds/reuses the base prepared library result and
  adds bounded history/artifact/focus outcomes.
- `SaveWorkspaceView` derives workspace ID from the active capability and
  stores only the validated `ArtifactLocatorV1`.
- `RecentLibraryDTO` contains opaque ID, safe label, time, and coarse status;
  no root, locator, signature, token, or backend error.
- `RemoveRecent` clears recent/view/last references only; never identity,
  history, index, credentials, or workspace content.
- Reset confirmation resolves the calling window and returns a one-use token.
  Results are `reset|already_reset|unavailable|failed_preserved`; visible copy
  maps these to everyday language.
- `history/latest.go` owns greatest `updatedAt`, then lexicographically greatest
  conversation ID.
- Activation success plus app-state failure returns a usable session with a
  non-blocking continuity warning.

## Dependency Map

Phase 3 MVP A snapshot/prepared pipeline -> private recents/view store ->
restore-by-ID -> staged snapshot/latest-history/wiki-note -> capability-free
prepared continuity -> Phase 3 atomic commit -> one guarded dispatch.

Locks are never nested: snapshot appstate and release, perform identity work and
release, then perform history/note work against staged activation. No native
prompt, runtime load, Wails callback, or frontend wait occurs while a store lock
is held. Abort before commit leaves the current library unchanged.

## TDD Execution

### Tests Before

| Area | Required failing scenarios |
|---|---|
| Store | empty, round-trip, 13 entries, invalid ID/focus/time/locator, duplicate/newer/trailing/oversize JSON |
| Privacy | no absolute/canonical root in encoded state, DTOs, props, errors, or diagnostics |
| Recent | deterministic order/eviction; remove current clears only pointers |
| Identity | unknown/missing/permission/replaced/moved, restart confirmation/cancel |
| Locator | valid wiki note; traversal/backslash/absolute/unsupported kind/version; stale note fallback |
| History | atomic latest; concurrent delete retry; off/empty/deleted/corrupt distinct |
| Restore race | slow restore/no Welcome flash; A veil; cancel/fail returns A; B atomic commit |
| Reset | native confirm, one-use token, crash points, bounded backup, concurrency, record active afterward |
| UX | 1/12 recent cards, Find again unique/ambiguous/replaced, friendly Clear recent activity |

### Implement

1. Build and prove the private app-state store and locator validation.
2. Add identity restore-by-ID through existing decisions.
3. Add atomic latest-history and trusted wiki-note reads.
4. Extend Phase 3 prepared activation with continuity payloads.
5. Add recents/restore/Find again/remove/reset UI.
6. Regenerate bindings and prove generated diff is intentional.

### Tests After

```sh
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go test ./internal/appstate
GOTOOLCHAIN=go1.25.12 go test ./internal/ai/workspaceid ./internal/ai/session
GOTOOLCHAIN=go1.25.12 go test ./internal/ai -run 'Recent|Restore|Latest|Artifact|WorkspaceView'
GOTOOLCHAIN=go1.25.12 go test -race ./internal/appstate ./internal/ai/workspaceid ./internal/ai/session ./internal/ai
GOTOOLCHAIN=go1.25.12 go test ./internal/workspace ./internal/graph ./...
wails3 generate bindings -clean=true -ts
cd frontend && npm run test && npm run build && npm run test:a11y && npm run test:visual
```

### Regression Gate

- Workspace bytes/types/names do not change during existing Open/restore.
- Old library data is veiled during activation; delayed requests cannot commit
  across session generations.
- The visible UI contains no raw root, raw backend error, or internal reset
  terminology.

## Success Criteria

- [x] Recent and view state persists privately with deterministic limits.
- [x] Relaunch restores latest conversation, last valid wiki note, and semantic
      focus after required identity confirmation.
- [x] Missing/replaced libraries and stale locators fall back safely.
- [x] History/app-state failures do not block a valid library.
- [x] Original-document/PDF restoration is neither claimed nor silently faked.

## Risks and Rollback

- Lock ordering can deadlock: use documented order and operation hooks, not
  sleeps, in concurrency tests.
- Strict corruption handling can strand recents: preserve corrupt bytes and
  retain manual Create/Open.
- Rollback removes continuity facade/store/UI together while retaining the
  Phase 3 MVP A ready pipeline.
