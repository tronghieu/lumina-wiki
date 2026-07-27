---
title: "Phase 3: Welcome, Create, and Open — MVP A"
status: completed
effort: "4-5d"
---

# Phase 3: Welcome, Create, and Open — MVP A

## Overview

Replace the technical raw-folder flow with one accessible Welcome, Create, and
Open state machine. MVP A ends in a real empty or populated library shell and
does not depend on recents, history restoration, or other Phase 4 continuity.

Context: [focused scout](./reports/phase-04-focused-scout.md), demo
`/Users/plateau/Desktop/Lumina Desktop.dc.html`, supplied light/dark
screenshots, the accepted roadmap, and the Phase 2 staged-activation contract.

## Requirements

- [x] Boot is `booting -> welcome` or `booting -> ready`; Phase 4 later inserts
      automatic restoration without changing these base states.
- [x] Welcome uses library, document, note, topic, and relationship. It never
      shows CLI/runtime/filesystem/root/schema/pack/state or raw internal errors.
- [x] Offer `Create library` and `Open existing library`; recents are absent
      until Phase 4.
- [x] Create proposes `Documents/Lumina Library` or home fallback, shows the
      exact destination in a native pre-mutation confirmation, and supports
      native `Change location`.
- [x] A destination child should be absent. An already existing empty directory
      is accepted only after a distinct native “Use this empty folder”
      confirmation and a fresh classification while the creation lock is held.
      Any entry, link, special file, journal mismatch, or reclassification race
      is a collision; never merge, overwrite, delete, or auto-number.
- [x] Backend owns pickers, paths, proof, provisioning, and activation. React
      receives no canonical root.
- [x] The location approval and prepared-library capabilities are opaque,
      single-use, expiring, window-bound, attempt-generation-bound, and tied to
      the approved parent identity and child name.
- [x] Commit and abort resolve the calling window natively. Replay,
      cross-window use, stale generation, abort-after-commit, and
      commit-after-abort fail closed without changing the current session.
- [x] Create/Open share the snapshot/ready pipeline. Zero-node libraries render
      a real empty graph/tree with Note unavailable and no fake data.
- [x] Existing/legacy Open is read-only. Every workspace-byte write uses the
      Phase 2 central authorizer; app-local history/index/settings remain usable.
- [x] A pre-commit or committed-but-not-active operation is recoverable from
      one safe Welcome card backed by the private Phase 2 operation record.
- [x] Model/provider controls remain only in Advanced settings; no simplified
      Fast/Balanced/Deep modes.
- [x] Unregister/fail-close renderer-callable raw-root Workspace/Graph/Check/
      Import services. Check and Import remain unavailable until native
      session-capability replacements ship.
- [x] Create/Open makes no network request or telemetry call and requires no
      blanket Welcome consent.

## Files

| Path | Action |
|---|---|
| `apps/desktop/frontend/src/App.tsx` | replace raw-root orchestration with base Welcome/ready state |
| `.../features/workspace/welcome-screen.tsx` | create accessible Create/Open/recovery screen |
| `.../features/workspace/welcome-state.ts` + test | create pure base reducer and attempt generation |
| `.../features/workspace/ready-library-state.ts` + test | create capability-free prepared and committed-state combiner |
| `.../features/workspace/use-workspace.ts` | replace frontend picker and raw-root reads |
| `.../features/workspace/workspace-actions.ts` + test | use safe outcome codes and friendly copy |
| `.../app/app-shell-state.ts` + test | add base `chat|note|graph` semantic focus |
| `.../app/app-shell.tsx`, `desktop-title-bar.tsx` | remove root props and visible Workspace copy |
| `.../features/workspace/workspace-rail.tsx` | add library switch/Welcome action without paths |
| `.../features/graph/artifact-pane.tsx`, `node-inspector.tsx`, `note-content.ts`, `graph-data.ts`, `note-view.tsx` + tests | remove raw-root/old binding DTOs, Check/Import, and raw errors |
| `.../features/chat/agent-panel.tsx` + tests | preserve Chat focus and safe base empty state |
| `.../app/ai-settings-panel.tsx` + test | enforce Advanced-only model/provider controls |
| `apps/desktop/internal/ai/service-provision-types.go` | own bounded `WorkspaceSnapshotDTO`, base `PreparedLibraryDTO`, token and commit/result DTOs |
| `.../internal/ai/service-provision.go` + tests | coordinate provision/proof/stage/snapshot/commit/recovery |
| `.../internal/ai/service-types.go`, `wails-native-authority.go` + tests | add location/empty-folder authority and calling-window resolution |
| `apps/desktop/ai-composition.go` + test | inject Phase 1/2 dependencies |
| `apps/desktop/main.go` + registration tests | unregister raw-root Workspace/Graph/Tools/Importer surfaces |
| `apps/desktop/internal/{tools,importer}/service.go` + tests | retain internal helpers only where still needed |
| `apps/desktop/frontend/bindings/**` | regenerate; never hand-edit |
| `frontend/src/styles/{shell,chat,tokens}.css` | add Welcome/recovery/empty/responsive styles |
| `frontend/tests/visual/fixtures/wails-bridge.ts`, `accessibility.spec.ts`, `desktop-shell.spec.ts` | deterministic MVP-A UX/a11y/visual gates |

## Interface and Component Checklist

```text
BeginCreateLibrary(name) -> native-approved LocationCapability
PrepareCreateLibrary(locationCapability) -> PreparedLibraryDTO
ListPendingLibraryOperation() -> safe recovery card or none
PreparePendingLibraryOperation(recoveryID) -> PreparedLibraryDTO
RemovePendingLibraryOperation(recoveryID) -> removed reference only
PrepareChooseWorkspace() -> PreparedLibraryDTO
CommitPreparedLibrary(preparationToken) -> ReadyCommitDTO
AbortPreparedLibrary(preparationToken) -> cancelled
WorkspaceSnapshot(sessionReference) -> WorkspaceSnapshotDTO
```

- `LocationCapability` and `preparationToken` contain random opaque IDs only in
  renderer DTOs; backend records own window, attempt generation, expiry,
  operation kind, proof, and consumption state.
- `WorkspaceSnapshotDTO` is owned here and contains bounded display metadata,
  summary, graph, tree, access mode, and safe warnings. It contains no absolute
  path, proof, raw OS error, provider data, prompt, or secret.
- `PreparedLibraryDTO` contains token plus `WorkspaceSnapshotDTO`; it contains
  no active session capability.
- `ReadyCommitDTO` returns the committed session capability/access identity.
  Pure synchronous `finalizeReadyState(prepared, commit)` constructs and
  dispatches one `ReadyLibraryState`; it performs no I/O or fallible parsing.
- Results distinguish `cancelled_before_commit`, `created_and_active`, and
  `created_not_active`. The private operation record exists before first target
  mutation, so every crash stage is discoverable without renderer paths.
- Cancellation from Welcome is neutral. Cancellation while a library is ready
  preserves the current session. Permission failure is not called corruption.
- While B is pending, keep A mounted under a non-interactive activation veil.
  Cancel/failure removes the veil; only atomic commit discards A.
- Internal reset API names may use “state”; visible copy uses “Clear recent
  activity” with a consequence statement.

## Dependency Map

Phase 1 verified contract + Phase 2 provisioner/staged activation -> native
authority -> prepared snapshot -> atomic commit -> ready shell. Phase 3 is the
independently cookable and acceptable MVP A boundary. Phase 4 consumes its
snapshot DTO and prepared/commit pipeline.

## TDD Execution

### Tests Before

| Flow | Required failing scenarios |
|---|---|
| Boot | first launch, pending operation, no Welcome flash after commit |
| Create authority | unapproved, replayed, expired, cross-window, stale generation, abort-after-commit |
| Target | absent; explicitly confirmed empty; empty changed before lock; occupied/link/special/mismatch |
| Recovery | crash before target creation, during journal/publication, after manifest, during activation; Retry/Remove |
| Open | cancel from Welcome/ready, success, read-only, byte-identical, no raw root |
| Ready race | A activation veil; cancel/fail returns A; atomic B commit; late A request ignored |
| Empty | zero-node tree/graph, Note unavailable, no fake data |
| Product rules | no model selector outside Advanced; raw-root/Check/Import unavailable; no network |
| Migration | `node-inspector` and `note-content` compile without old services; no raw backend error copy |
| Responsive/a11y | 1480, 1180, 760, 200% zoom, keyboard, live regions, reduced motion, axe |

### Implement

1. Write registration, token, target, and reducer RED tests.
2. Unregister raw-root services and migrate every direct frontend consumer.
3. Add native location/empty-folder approval and recovery-card authority.
4. Implement one prepared snapshot and atomic ready commit pipeline.
5. Build Welcome/Create/Open/empty/recovery UI and friendly outcomes.
6. Regenerate bindings; add deterministic visual/accessibility gates.
7. Accept MVP A before starting Phase 4.

### Tests After

```sh
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go test ./internal/ai ./internal/workspace ./internal/graph
wails3 generate bindings -clean=true -ts
GOTOOLCHAIN=go1.25.12 go test ./...
cd frontend
npm run test
npm run build
npm run test:a11y
npm run test:visual
```

### Regression Gate

- Binding regeneration has no semantic diff after committed generated output.
- Direct renderer calls cannot reach raw-root reads/writes or spawn Node.
- No frontend state, prop, status, or error contains a canonical root.
- Advanced settings is the only model/provider selector.

## Success Criteria

- [x] First launch and recovery are understandable without technical setup.
- [x] Create and Open converge on one real ready shell.
- [x] Every renderer token is window/attempt/expiry bound and replay safe.
- [x] Interruption remains discoverable without deleting or trusting foreign data.
- [x] Existing libraries are read-only and byte-identical after Open.
- [x] MVP A passes keyboard, axe, dark/light, responsive, and empty-state gates.

## Risks and Rollback

- Service removal can strand old binding consumers: the explicit inventory and
  TypeScript compile gate own the migration.
- If Create fails, retain secure Open and Welcome recovery; never expose Phase 2
  raw paths or provisioner methods.
- Rollback the facade, bindings, and UI state machine together while retaining
  Phase 1/2 internal contracts.
