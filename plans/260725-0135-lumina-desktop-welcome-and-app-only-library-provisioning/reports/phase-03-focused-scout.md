# Phase 3 Focused Scout: App-Local Library and Restoration State

## Outcome and Boundaries

Phase 3 should deliver a private, bounded, versioned backend contract for:

- the last successfully activated library;
- a maximum of 12 recent library IDs;
- per-library semantic continuity (`chat`, `note`, or `graph`, plus an optional
  normalized `wiki/...md` artifact path);
- safe restore-by-ID through the existing workspace identity manager;
- capability-scoped workspace snapshot and note reads needed by Phase 4.

It must not build Welcome UI, persist cosmetic layout, silently bypass restart
identity confirmation, expose canonical paths to React, or add model/provider
selection outside Advanced settings.

Verified decisions to preserve:

- On the first exact-path attach after process restart,
  `workspaceid.Manager` requires identity confirmation. Restore-by-ID may avoid
  a second path-approval prompt because the path comes from private app state,
  but it must still honor `AttachIdentityConfirmationRequired`.
- Open/restore may update app-local registry/state/history directories but must
  not mutate the selected workspace.
- Visible recent-library DTOs contain safe labels and opaque IDs, never roots,
  signatures, attach tokens, note content, conversation text, or provider data.
- History disabled remains disabled. Phase 3 must not list/load history or
  toggle it as a side effect of restoration.

## Exact File Inventory

### Existing identity and activation owners

| File | Current ownership | Phase 3 use/change |
|---|---|---|
| `apps/desktop/internal/ai/workspaceid/types.go` | Workspace ID, attach kinds, registry record and bounds | Reuse IDs/attach kinds. Add only DTO-neutral internal recent/restore types if necessary. |
| `.../workspaceid/manager.go` | Manager dependencies and trusted candidate cache | Add state needed by safe restore-by-ID only if unavoidable. |
| `.../workspaceid/manager-decisions.go` | `BeginAttach(root)`, pending token lifecycle | Refactor candidate-to-decision logic so `BeginRestore(id)` reuses it without accepting a frontend root. |
| `.../workspaceid/manager-confirm.go` | Revalidation, registry lock/revision, identity commit | Reuse unchanged decision commit rules and `LastSeenAt` update. |
| `.../workspaceid/classify.go` | Known/move/reuse/ambiguous classification | Reuse unchanged. |
| `.../workspaceid/candidate.go` | Canonical path and handle-based revalidation | Reuse for saved-root reopening. |
| `.../workspaceid/store.go`, `store-io.go`, `lock*.go`, `registry-*.go` | Private atomic registry persistence | Reuse as the only canonical-path authority; do not duplicate paths in app state. |
| `.../workspaceid/security_refinement_test.go` | Verified restart confirmation and replacement defenses | Must remain passing; add restore-by-ID coverage beside it. |
| `.../workspaceid/manager_test.go`, `directory-race_test.go`, `trusted-root-identity_test.go` | Moves, reuse, concurrency, workspace immutability | Extend for recent lookup/restore without weakening assertions. |
| `apps/desktop/internal/ai/service.go` | AI facade and dependencies | Add app-state dependency to `Service`. |
| `.../service-types.go` | Activation interfaces and public DTO primitives | Extend `WorkspaceAttacher` or add a separate `WorkspaceRestorer` interface. |
| `.../service-activation-run.go` | Validate, attach, confirm, runtime load, session activation | Extract a shared “activate prepared decision” path used by Open/Create/Restore. Preserve activation gate and rollback. |
| `.../activation-gate*.go` | One activation per window and commit tombstones | Reuse unchanged. |
| `.../wails-native-authority.go` | Native directory and identity confirmations | Reuse `ConfirmAttachDecision`; no new silent-approval branch. |
| `.../session/registry.go`, `types.go` | Capability/session ownership | Add a narrow lease workspace-ID accessor only if view writes are authorized by session. Never expose root. |
| `apps/desktop/ai-composition.go` | User-config base, identity manager, runtime and service composition | Construct and inject the new app-state store from `os.UserConfigDir()`. |
| `apps/desktop/main.go` | Wails service registration | No new service registration if APIs remain on `ai.Service`; otherwise register exactly one app-state facade. |

### New app-state package

Recommended exact files:

| New file | Responsibility |
|---|---|
| `apps/desktop/internal/appstate/types.go` | Schema, bounds, `Focus`, `WorkspaceView`, `RecentEntry`, normalized state validation and deterministic eviction. |
| `.../appstate/store.go` | `NewStore`, public snapshot/mutation methods, trusted fixed app-owned paths. |
| `.../appstate/store-read.go` | Strict bounded decode, duplicate-key/unknown-field/newer-version rejection. |
| `.../appstate/store-io.go` | Private directory/file validation, temp cleanup, atomic sync+rename. |
| `.../appstate/coordinator.go` | In-process gate plus cross-process advisory lock/revision discipline. |
| `.../appstate/types_test.go` | State invariants, bounds, normalization, eviction. |
| `.../appstate/store_test.go` | Persistence, strict decode, permissions, symlink, atomic failure. |
| `.../appstate/coordinator_test.go` | Concurrent processes/managers and stale revision behavior. |

Do not place this state in `internal/ai/settings.Config`: AI settings have a
different lifecycle and contain provider profiles. Do not use browser
`localStorage`: the app-state contract controls sensitive cross-library
continuity and must be backend-owned.

### New facade and capability-scoped reads

| File | Required change |
|---|---|
| `apps/desktop/internal/ai/service-library-types.go` (new) | Safe recent/startup/view request/response DTOs and validation. |
| `.../service-library.go` (new) | Recent snapshot, restore-by-ID, save view, remove recent. |
| `.../service-library_test.go` (new) | Privacy, authorization, identity confirmation, failures and immutability. |
| `.../service-management-types.go` | Add snapshot/note DTOs if existing graph/workspace types cannot be imported safely. |
| `.../service-management-runtime.go` | Add runtime methods for workspace summary, graph and note reads. |
| `.../loaded-runtime-management.go` | Implement reads through the trusted root/proof held by `loadedRuntime`. |
| `.../service-management.go` | Wails methods `WorkspaceSnapshot` and `ReadWorkspaceNote`. |
| `.../service-management-lifecycle_test.go` | Stale session, replacement and closed-runtime coverage. |
| `apps/desktop/internal/workspace/service.go` | Extract trusted-root summary logic; direct root API may remain for compatible callers. |
| `apps/desktop/internal/graph/service.go` | Extract trusted-root graph/note logic; do not let restoration use frontend roots. |
| Corresponding `*_test.go` files | Preserve graph/note path, symlink and bound checks through trusted reads. |

### Generated bindings

Regenerate; never hand-edit:

- `apps/desktop/frontend/bindings/.../internal/ai/service.ts`
- `apps/desktop/frontend/bindings/.../internal/ai/models.ts`
- `apps/desktop/frontend/bindings/.../internal/ai/index.ts`

Phase 3 may add thin frontend gateway types/tests to prove generated calls, but
all visible UX belongs to Phase 4.

## Function and Interface Checklist

### `internal/appstate`

Recommended contracts:

```go
const CurrentSchemaVersion = 1
const MaxRecentLibraries = 12

type Focus string // chat | note | graph
type WorkspaceView struct {
    Focus Focus
    ArtifactPath string // empty or normalized wiki/...md
    UpdatedAt time.Time
}
type RecentEntry struct {
    WorkspaceID workspaceid.WorkspaceID
    LastOpenedAt time.Time
}
type State struct {
    SchemaVersion int
    LastWorkspaceID workspaceid.WorkspaceID
    Recent []RecentEntry
    Views map[workspaceid.WorkspaceID]WorkspaceView
}

func (State) Normalized() (State, error)
func NewStore(configBase string) (*Store, error)
func (*Store) Snapshot(context.Context) (State, error)
func (*Store) RecordActivation(context.Context, workspaceid.WorkspaceID, time.Time) error
func (*Store) SaveView(context.Context, workspaceid.WorkspaceID, WorkspaceView) error
func (*Store) RemoveRecent(context.Context, workspaceid.WorkspaceID) (bool, error)
```

Implementation checklist:

- fixed app-owned file under
  `<UserConfigDir>/lumina-wiki-desktop/library-state.json`;
- no roots or user content in encoded state;
- strict JSON, newline termination, bounds before allocation;
- normalized relative path: slash separators, begins `wiki/`, ends `.md`, no
  absolute/backslash/traversal/control/format characters;
- 0700 directory / 0600 file where meaningful, symlink rejection;
- temp file on same volume, file sync, rename, best-effort parent sync;
- lock order documented and tested;
- mutation reloads latest state under lock, so two app instances cannot lose a
  newer update;
- failed save preserves old bytes and never rolls back an already active
  session;
- deterministic eviction: oldest non-current recent entry, then ID tie-break;
- removing recent also removes its view and clears `LastWorkspaceID` if equal,
  but does not delete identity/history/index/workspace data.

### `workspaceid.Manager`

Add an explicit backend-only restore contract:

```go
type RecentWorkspace struct {
    WorkspaceID WorkspaceID
    Label string
    LastSeenAt time.Time
}

func (*Manager) ResolveRecent(ids []WorkspaceID) ([]RecentWorkspace, error)
func (*Manager) BeginRestore(id WorkspaceID) (AttachDecision, error)
```

Checklist:

- `ResolveRecent` returns safe label/ID/time only; paths remain internal.
- `BeginRestore` loads the active registry record by ID, opens its saved
  canonical path, recomputes candidate/signature, and returns the normal attach
  decision/token.
- Unknown, inactive, missing, unsafe, or changed roots return typed internal
  outcomes that the facade sanitizes.
- Exact restart match continues to return
  `AttachIdentityConfirmationRequired`.
- Moved libraries are not searched for. `Find again` in Phase 4 uses an
  explicit picker and the existing attach classification.
- `ConfirmAttach` remains the sole identity mutation path.

### `ai.Service`

Recommended Wails facade:

```go
func (*Service) ListRecentLibraries(context.Context) (RecentLibrariesDTO, error)
func (*Service) RestoreRecentLibrary(context.Context, RestoreRecentLibraryRequestDTO) (ActivationResult, error)
func (*Service) SaveWorkspaceView(context.Context, SaveWorkspaceViewRequestDTO) (WorkspaceViewDTO, error)
func (*Service) RemoveRecentLibrary(context.Context, RemoveRecentLibraryRequestDTO) (RemoveRecentLibraryResultDTO, error)
func (*Service) WorkspaceSnapshot(context.Context, SessionReferenceDTO) (WorkspaceSnapshotDTO, error)
func (*Service) ReadWorkspaceNote(context.Context, WorkspaceNoteRequestDTO) (NoteContentDTO, error)
```

Checklist:

- all input IDs/enums/paths validated before I/O;
- `RestoreRecentLibrary` resolves path only in backend, acquires the existing
  activation gate, validates workspace contract, requests identity
  confirmation when required, activates runtime/session, then records recent
  state;
- cancellation is an `ActivationCancelled` result, not corruption;
- app-state save failure after activation returns active capability plus a safe
  continuity warning or separately queryable status; never deactivate a valid
  library merely because recents could not save;
- `SaveWorkspaceView` resolves the current window/session and derives the
  workspace ID from the active capability/runtime; it does not trust a caller
  supplied workspace ID;
- `WorkspaceSnapshot`/`ReadWorkspaceNote` use active session -> runtime ->
  trusted root/proof;
- facade errors contain no root/backend detail.

### History selection helper

Phase 3 should define/test, but not automatically call when history is off:

```text
selectLatestConversation(metadata):
  maximum updatedAt
  tie-break lexicographically by conversationId
```

This may live as a pure frontend helper in Phase 4. If placed in the backend,
return only a conversation ID/status and keep content behind `LoadHistory`.
Do not change `HistoryStore.List` ordering because current callers/tests treat
it as creation order.

## Dependency Map

```text
UserConfigDir
  -> workspaceid.Manager (canonical path + stable identity)
  -> appstate.Store (recent IDs + semantic view only)
  -> history.Store (conversation data by workspace ID)

RestoreRecentLibrary(workspace ID)
  -> appstate last/recent membership
  -> workspaceid.BeginRestore
  -> existing identity confirmation
  -> workspace validator
  -> loadedRuntimeFactory
  -> session.Registry activation
  -> appstate.RecordActivation
  -> capability returned

WorkspaceSnapshot / ReadWorkspaceNote
  -> session reference
  -> runtime lease
  -> loadedRuntime trusted root + proof
  -> workspace/graph read helpers
```

Sequencing dependencies:

- Phase 1 must define the generated workspace compatibility/version contract.
- Phase 2 must provide the native create/provision result and trusted canonical
  root. Phase 3 should not depend on provisioning internals.
- Phase 4 depends on all Phase 3 Wails APIs and generated bindings.
- Phase 5 owns packaged cross-platform validation, not Phase 3 unit semantics.

## TDD Scenario Matrix

| Area | Red test | Expected behavior |
|---|---|---|
| Empty state | Missing owned dir/file | Empty versioned snapshot, no error |
| Round trip | Save activation + view, reopen store | Exact normalized IDs/focus/path/time |
| Bounds | 13 recents, invalid ID/focus/time, oversized file/path | Reject before commit/allocation |
| Strict decode | Duplicate/unknown keys, trailing JSON, newer schema | Error; original bytes unchanged |
| Privacy | Search encoded state and recent DTO JSON | No root/path signature/content/provider/secret fields |
| Permissions | Permissive file, symlinked owned dir/file | Reject unsafe file; do not follow |
| Atomicity | Inject write/sync/rename error | Old state remains; temp removed |
| Concurrency | Two stores record different activations | Both converge under lock or one typed conflict; valid JSON |
| Eviction | Record 13 activations | Oldest non-current evicted deterministically |
| Remove recent | Remove last/current ID | Recent/view/last pointer cleared only; history/identity untouched |
| Restore unknown | Opaque ID absent/inactive | Safe not-found/recovery result; no activation |
| Restart exact match | Recreate manager, restore saved ID | One identity confirmation; same workspace ID |
| Confirmation cancel | Reject native prompt | Cancelled; no session/app-state identity mutation |
| Missing root | Remove saved directory before restore | Recovery result; registry/app state preserved |
| Permission denial | Saved root inaccessible | Distinct safe unavailable result |
| Replaced root | Replace directory at same path | No old-ID activation; no old view/history exposure |
| Explicit move | Pick moved root via normal Open | Existing move confirmation, same ID, old view/history eligible |
| Race | Open/restore concurrently in one/two windows | Activation gate/session generations prevent stale commit |
| Immutability | Snapshot workspace before/after Open/restore | Names, types, bytes identical |
| View auth | Save with stale/other-window session | Rejected, no app-state write |
| View path | absolute/backslash/traversal/non-wiki/non-md | Rejected |
| Snapshot auth | stale session, replaced trusted root | Rejected with sanitized error |
| Empty graph | Valid empty workspace | Successful zero-node snapshot |
| History off | Restore orchestration spy | No List/Load/SetHistoryEnabled call |
| Latest selection | Metadata created/updated out of order | Greatest `updatedAt`, ID tie-break |
| History corrupt | List/load error | Typed unavailable, active library retained |

## Commands

Narrow first:

```bash
cd apps/desktop
go test ./internal/appstate
go test ./internal/ai/workspaceid ./internal/ai/session
go test ./internal/ai -run 'Recent|Restore|WorkspaceSnapshot|WorkspaceView'
```

Race and integration:

```bash
cd apps/desktop
go test -race ./internal/appstate ./internal/ai/workspaceid ./internal/ai/session ./internal/ai
go test ./internal/workspace ./internal/graph
go test ./...
```

Bindings and frontend contract:

```bash
cd apps/desktop
wails3 generate bindings -clean=true -ts

cd frontend
npm run test
npm run build
```

After generated bindings are intentionally updated and staged, rerun generation
and require no diff:

```bash
cd apps/desktop
wails3 generate bindings -clean=true -ts
git diff --ignore-space-at-eol --exit-code -- frontend/bindings
```

## UX and Accessibility Risks Handed to Phase 4

- A backend `state unavailable` result must not become an infinite loading
  screen; manual Create/Open must remain available.
- Recent DTOs should carry stable machine status codes plus safe labels; Phase 4
  supplies plain language.
- Do not expose identity terms ("signature", "registry", "workspace ID") in UI.
- Restart confirmation must be one understandable native question, not the
  current typed-root approval followed by identity approval.
- A successful activation with failed app-state save needs a non-blocking
  status, not a modal that suggests the library failed to open.
- History disabled/empty/unavailable need distinct machine states so screen
  readers receive truthful messages.
- Artifact paths are internal navigation keys; Phase 4 should display note
  titles, not raw paths, wherever possible.

## Unresolved Questions

1. Confirm whether app-state corruption should remain preserved indefinitely or
   be rotated to one bounded backup after explicit user recovery. Phase 3 must
   not silently overwrite it.
2. Confirm whether the app-state Wails methods remain on `ai.Service`
   (recommended to reuse session/activation authority) or use a separate
   service with an injected session authorizer.

Status: DONE_WITH_CONCERNS

Summary: Phase 3 should add a private 12-entry app-state store, safe
restore-by-ID on the existing identity manager, session-authorized view writes,
and capability-scoped snapshot/note reads. It preserves restart identity
confirmation and keeps paths out of React.

Concerns/Blockers: Phase 1 must supply authoritative workspace-version
classification. Silent restart restoration remains intentionally unsupported
without a stronger durable OS capability design.
