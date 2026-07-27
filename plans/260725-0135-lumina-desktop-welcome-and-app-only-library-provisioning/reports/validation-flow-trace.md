# Validation Flow Trace

Scope: plan-only full-tier validation against the current source boundaries.
No tests, lint, builds, binding generation, or implementation edits were run.

## Result semantics

- **PASS** — the edited plan has a coherent owner, order, boundary, and validation
  hook. This does not mean the proposed code already exists.
- **FAIL** — the edited plan contains an internally incompatible lifecycle or
  cannot satisfy the claim with its stated contracts.
- **GAP** — the direction is sound, but a necessary interface, ordering rule, or
  recovery outcome is not specified enough to execute or verify.

## End-to-end traces

### Create

Proposed order:

1. React submits a friendly name to `BeginCreateLibrary`.
2. Backend selects/confirms the exact parent, binds parent identity + child name
   to a single-use/window-bound/expiring capability, and returns only the opaque
   capability.
3. `CreateAndActivateLibrary` consumes the capability.
4. Provisioner verifies contract, acquires the global create lock, classifies,
   materializes, journals/stages, publishes manifest last, cleans up, captures
   proof, and releases the create lock.
5. Trusted validation prepares identity without committing it.
6. Runtime loads; session activation is staged; identity and session commit.
7. A committed creation is recorded for recovery, snapshot is loaded, continuity
   is resolved, and ready state commits.

Validation: steps 1-6 are named across Phase 2 lines 83-108 and Phase 4 lines
79-101. Step 7 is not executable as written when activation fails before identity
commit: Phase 3 stores only workspace IDs, but the new library has no committed
workspace ID. See failures P4-07 and P4-08.

### Open

Proposed order:

1. `ChooseAndActivateWorkspace` acquires the per-window activation lease and owns
   the native picker.
2. Backend validates the selected library and prepares the identity decision.
3. Native identity confirmation occurs if required.
4. Runtime/session and identity commit through the Phase 2 transaction.
5. Capability-scoped snapshot and continuity flow run.
6. B commits atomically; app state records activation/view. On cancel/failure,
   veiled A returns unchanged.

Validation: backend picker authority and per-window cancellation already have
owners (`internal/ai/service.go:57-80`, `activation-gate.go:37-66`). The edited
plan correctly removes the current frontend picker/raw-root preloads. The staged
session half of step 4 remains undefined; see P3-18.

### Restore

Proposed order:

1. Boot reads private app state; no state yields Welcome.
2. Last workspace ID is resolved only through the identity registry.
3. `BeginRestore(id)` reopens and revalidates the saved backend path.
4. Restart identity confirmation is preserved.
5. Runtime/session + identity commit; activation record is saved non-blockingly.
6. `WorkspaceSnapshot(session)` reads through session -> runtime -> trusted root.
7. `LoadLatestHistory(session)` returns one tagged atomic outcome.
8. Saved note path is matched against the fresh graph, then read by capability.
9. Focus resolves; current-attempt/session guard atomically commits ready state;
   converged fallback view is saved.

Validation: the order is coherent after the edited atomic-history change. The
current code confirms why the new boundaries are needed: current history
List/Load are separate (`internal/ai/service-management.go:50-84`), and current
workspace/graph reads take renderer roots (`frontend/src/features/workspace/use-workspace.ts:91-95`,
`:225-238`).

### Switch and cancel

Proposed order: A remains mounted but non-interactive under a veil while B is
pending. B's attempt invalidates A-originated artifact/history/profile/citation
requests. Picker cancel, identity cancel, or activation failure removes the veil;
only a complete guarded B-ready commit discards A.

Validation: the semantics now reconcile “hide A” with “preserve A.” Current
request guards provide usable primitives (`session-request-guard.ts:15-35`;
`workspace-actions.ts:99-109`), but the atomic B-ready state container is not
specified; see P4-14.

### Created-not-active recovery

Proposed order: after manifest commit, record a recoverable committed library
before runtime activation; return `created_not_active` if activation fails; retry
must activate rather than collide.

Validation: **FAIL**. Phase 2 defers identity registry commit until session
activation, while Phase 3's durable state model accepts only workspace IDs.
Neither phase defines a pending-provision identity/locator, so there is no durable
key with which to record the committed-but-not-active library. See P4-07/P4-08.

### Corrupt-state repair

Proposed order: keep corrupt bytes, allow manual activation, obtain explicit
window confirmation, quarantine at most one bounded app-state backup under the
app-state lock, create fresh state, then record the active library.

Validation: store isolation, repair file ownership, scenarios, and post-repair
recording are present. The confirmation request/response and crash-state outcome
contract are not defined; see P3-15.

### Latest-history flow

Proposed order: after snapshot, query history status; if off, make no list/load/
toggle calls. If enabled, select max `updatedAt` with ID tie-break and load records
inside one history-store lock, returning a tagged result.

Validation: **PASS as a proposed replacement**. Existing `List` and `Load` each
lock independently (`internal/ai/history/store.go:70-99`), and missing Load becomes
an untagged empty slice (`:78-91`). Phase 3 lines 40-41, 54, 80, 118, and 132-134
now consistently require one backend atomic operation.

## Phase 3 claim validation

| ID | Claim and plan location | Result | Evidence and validation |
|---|---|---|---|
| P3-01 | App state stores at most 12 IDs plus focus and optional normalized note path (20-21). | PASS | Exact data owner and tests are named at 47-48, 66-70, and 109-114. Existing workspace IDs are bounded/validated types (`internal/ai/workspaceid/types.go:33-37`, `:60-68`). |
| P3-02 | Canonical paths remain solely in the identity registry (22-24). | PASS | Current registry record owns `CanonicalPath` (`internal/ai/workspaceid/types.go:60-68`); Phase 3 app-state interfaces accept workspace IDs/views only (65-80). |
| P3-03 | Strict bounded JSON, symlink rejection, atomic sync/rename, cross-process lock/revision (25-26). | PASS | Files and hostile scenarios cover each property (47-50, 109-119). The existing registry provides the intended strict snapshot/atomic-write model (`internal/ai/workspaceid/store.go:76-95`, `:107-128`). |
| P3-04 | Windows owner+SYSTEM DACL covers directory, lock, temp, backup, and final handles (27-29). | PASS | A dedicated platform owner and native tests are named (49-50), and the package gate explicitly includes private ACL evidence (Phase 5 lines 69-72). |
| P3-05 | Restore-by-ID reopens backend path and revalidates identity/workspace (30-31). | PASS | `ResolveRecent`/`BeginRestore` have explicit owners and interfaces (51-53, 71-76). Current `BeginAttach` demonstrates handle-backed candidate creation and registry snapshot classification (`internal/ai/workspaceid/manager-decisions.go:9-24`). |
| P3-06 | Restart exact match still requires identity confirmation (30-31, 91-92). | PASS | Existing regression proves the restarted manager returns `AttachIdentityConfirmationRequired` and retains the ID (`internal/ai/workspaceid/security_refinement_test.go:14-41`). Native confirmation is already an activation step (`internal/ai/service-activation-run.go:42-56`). |
| P3-07 | Open/Restore may mutate app-local state but never workspace bytes (32). | PASS | Immutability scenarios and regression gate are explicit (117, 155). Current direct identity commit writes only the app-local registry (`internal/ai/workspaceid/manager-confirm.go:41-84`), establishing the correct owner to preserve. |
| P3-08 | History off performs no list/load/toggle (33-34). | PASS | The requirement and history scenario are explicit (118); Phase 4 order uses history status before latest (100-101). Existing runtime exposes Status/List/Load separately (`internal/ai/loaded-runtime-management.go:19-29`, `:45-68`), so the no-call assertion is observable. |
| P3-09 | Empty/deleted/unavailable/corrupt history remain distinct (33-34). | PASS | Tagged outcomes are enumerated at 40-41 and atomic facade at 54/80. This directly replaces current missing-as-empty behavior (`internal/ai/history/store.go:78-91`). |
| P3-10 | Latest selection and load occur under one history lock (40-41, 132-134). | PASS | The plan names the existing lock and a separate atomic operation. The current advisory lock is per workspace ID (`internal/ai/history/lock.go:12-64`) and can enclose both selection and read. |
| P3-11 | Snapshot/note resolve active session -> runtime -> trusted root (35-36, 102-103). | PASS | Service/runtime/helper owners are named (55-58). Existing management resolution already verifies window+session and returns a runtime lease (`internal/ai/service-management-runtime.go:36-63`); existing tree reads then use trusted root/proof (`internal/ai/loaded-runtime-management.go:10-17`). |
| P3-12 | Stale session/replaced root fails safely (35-36). | PASS | Authorization scenarios explicitly cover stale/other-window and replaced root (116). Current session resolution rejects non-current capability generations (`internal/ai/session/registry.go:105-117`, `:145-148`). |
| P3-13 | `SaveWorkspaceView` derives workspace ID from the active capability (85-86). | PASS | The facade and session accessor owner are named (52-59); current capability already contains backend workspace ID (`internal/ai/session/types.go:52-57`). |
| P3-14 | Removing a recent clears only recent/view/last pointers (87-88). | PASS | Store/facade methods and tests are explicit (69-76, 114); identity, history, index, and workspace stores remain separate packages in the dependency map (100-103). |
| P3-15 | Repair is explicit, confirmed, serialized, bounded, and can record the active library (37-39, 77, 89-90). | GAP | Store file/test owners and crash scenarios exist (49-50, 119), but `RepairLibraryState(ctx, confirmedRequest)` does not define whether confirmation is a backend-native prompt, a single-use token, or a renderer boolean. Current native authority exposes explicit native questions, not trustworthy renderer confirmation (`internal/ai/service-types.go:73-78`; `wails-native-authority.go:134-144`). Specify the authority sequence and typed crash outcomes. |
| P3-16 | Activation success plus state-save failure keeps the session usable (93-94). | PASS | The outcome is explicit and Phase 4 consumes nonblocking recovery. Current session activation returns a capability independently of app-state, providing a separable commit point (`internal/ai/session/registry.go:88-98`). |
| P3-17 | Lock ordering across appstate/identity/history is safe (169-170). | GAP | The risk says to “document order,” but no actual order is stated in requirements, interface checklist, or dependency map. Existing identity and history each have independent kernel locks (`internal/ai/workspaceid/manager-confirm.go:23-35`; `internal/ai/history/lock.go:12-64`). Add a normative order and a prohibition on native prompts/runtime calls while any store lock is held. |
| P3-18 | Prepared identity and staged session commit atomically, preserving A on failure (dependency on Phase 2 lines 47-48, 100-108). | GAP | Phase 2 names `PreparedAttach`, but no staged-session interface/file is listed. Current `SessionRegistry.Activate` immediately installs B and retires A (`internal/ai/session/registry.go:88-98`), so an identity commit failure afterward cannot restore A. Add `PrepareActivation/Commit/Abort` (or reverse-safe equivalent), ownership, and failure-hook tests before Phase 3 restore relies on it. |

Phase 3 tally: **15 PASS, 0 FAIL, 3 GAP**.

## Phase 4 claim validation

| ID | Claim and plan location | Result | Evidence and validation |
|---|---|---|---|
| P4-01 | Boot is booting -> restoring -> ready or booting -> welcome, without Welcome flash (21-22). | PASS | `App.tsx`, a pure reducer, and boot tests are named (55-58, 120). Current `App` renders the ready shell immediately (`frontend/src/App.tsx:24-35`, `:110-151`), so ownership of the required replacement is unambiguous. |
| P4-02 | Welcome uses plain language and never raw backend errors (23-25). | PASS | Copy owner/tests are named (56-60, 127, 185-186). This replaces current raw `Error.message` rendering (`frontend/src/features/workspace/workspace-actions.ts:133-138`). |
| P4-03 | Welcome offers Create/Open and at most 12 path-free recents (26-27). | PASS | `WelcomeScreen`, Phase 3 safe DTO, and 1/12-card tests cover the boundary (56-58, 94-95, 124). |
| P4-04 | Backend owns picker/path/proof and React receives no root (31-32, 86-88). | PASS | Backend coordinator/native authority and binding owners are explicit (67-73, 79-88). This correctly replaces the current frontend `Dialogs.OpenFile` and root-bearing state (`frontend/src/features/workspace/use-workspace.ts:1-13`, `:35-40`, `:60-72`). |
| P4-05 | Exact destination is shown natively before mutation (28-30, 87-88). | PASS | `BeginCreateLibrary` and native authority own the interaction (69, 79-88). Current native layer already resolves a calling window before a dialog (`internal/ai/wails-native-authority.go:64-79`, `:134-159`). |
| P4-06 | Every Create requires a single-use/window-bound/expiring parent+name capability (33-35). | PASS | Interface, hostile token scenarios, and implementation step are explicit (79-82, 123, 133). The existing identity token lifecycle supplies a suitable single-use/expiry precedent (`internal/ai/workspaceid/manager-decisions.go:26-54`, `:82-107`). |
| P4-07 | Results distinguish cancelled-before-commit, created-active, and created-not-active (89-91). | PASS | `ProvisionActivationResult`, coordinator owner, scenarios, and success gate are all named (67-68, 81, 89-91, 123, 176-177). Current two-state result demonstrates why a separate DTO is necessary (`internal/ai/service-types.go:32-37`, `:64-67`). |
| P4-08 | A committed-but-not-active library is durably recorded before runtime activation (89-91). | FAIL | Phase 2 defers identity persistence until session commit (Phase 2 lines 47-48, 100-108). Phase 3 app state stores only workspace IDs and exposes no pending-provision record (Phase 3 lines 20-24, 65-81). Before activation there is neither committed workspace ID nor path-capable app-state field, so the recovery record has no key. Add a bounded app-local pending-provision record keyed by an opaque transaction ID, or reserve/commit a recoverable identity with explicit compensation semantics. |
| P4-09 | Retry of created-not-active never becomes an unexplained collision (89-91, 176-177). | FAIL | The provisioner will classify the target as an existing committed library, but no proposed API resolves the pending creation back to that target: `CreateAndActivateLibrary` consumes a one-time location capability, and app state cannot store its path/proof. Define `RetryCreatedLibrary(recoveryID)` or a recent-like recovery DTO and its lifecycle/expiry/removal rules. |
| P4-10 | Existing/legacy Open is backend-enforced read-only (38-40). | PASS | Access mode is introduced in Phase 2 requirements 45-46 and carried into activation at Phase 2 implementation step 7; Phase 4 removes renderer mutation surfaces (45-47, 71-72, 132). Current Import mutates workspace bytes from raw roots (`internal/importer/service.go:25-85`), confirming why unregistering it is required. |
| P4-11 | Raw-root Workspace/Graph/Check/Import calls are unavailable, not merely hidden (45-47). | PASS | `main.go` registration tests and hostile calls are explicit (71-72, 127, 132, 166-167). Current app registers all four services (`apps/desktop/main.go:22-31`), current frontend imports them (`frontend/src/features/workspace/use-workspace.ts:9-13`), and Check spawns Node (`internal/tools/service.go:36-40`, `:62-74`). |
| P4-12 | Create/Open use one snapshot/ready pipeline with true empty state (36-37, 142-143). | PASS | `WorkspaceSnapshot(session)` and the shared refactor rule are explicit (83, 142). Current flow splits Summary/Graph before activation and Tree/History after it (`frontend/src/features/workspace/use-workspace.ts:91-108`), so the replacement boundary is correctly targeted. |
| P4-13 | Cancellation while ready preserves A (96-99). | PASS | The edited veil rule and race tests explicitly cover picker/confirmation/failure and return to A (96-99, 126, 168-169). Current backend activation gate is per window and cancellation-aware (`internal/ai/activation-gate.go:37-66`, `:114-148`). |
| P4-14 | Only an atomic B-ready commit discards A (98-101). | GAP | The plan names a Welcome reducer and attempt ID, but no single `ReadyLibraryState` owner/reducer that atomically contains capability, graph, tree, note, history, focus, and warnings. Current implementation commits these through multiple independent setters (`frontend/src/features/workspace/use-workspace.ts:101-124`) and App owns chat/history separately (`frontend/src/App.tsx:24-50`). Specify the atomic commit payload/state owner and post-commit effects. |
| P4-15 | Late A requests cannot commit after B starts (92-93, 126). | PASS | Monotonic attempt ID plus existing session request guards provide both activation and session dimensions (`frontend/src/features/shared/session-request-guard.ts:15-35`; `use-workspace.ts:84-96`, `:214-217`). Citation reads also already combine session and artifact guards (`frontend/src/App.tsx:79-101`). |
| P4-16 | Restore order is activate -> snapshot -> latest history -> note -> focus -> guarded commit -> save fallback (100-101). | PASS | Phase 3 now exposes atomic `LoadLatestHistory` and capability note/snapshot APIs (Phase 3 lines 73-80); Phase 4 tests enumerate history/note/focus/race outcomes (120-126). |
| P4-17 | Latest history is max updatedAt with ID tie-break and handles delete atomically (41-42, 100-101). | PASS | Phase 3 owns one locked tagged operation (Phase 3 lines 40-41, 54, 80, 118, 132-134). This closes the current independent List/Load window (`internal/ai/service-management.go:50-84`). |
| P4-18 | Note restoration matches normalized saved path against fresh graph before capability read (41-42, 100-103). | PASS | Phase 3 validates normalized `wiki/...md`, exposes `ReadWorkspaceNote`, and uses trusted-root reads (Phase 3 lines 20-21, 35-36, 78-79). Current graph note validation establishes existing path constraints to preserve (`internal/graph/service.go:42-83`). |
| P4-19 | Focus resolves independently; Chat opens Agent, stale Note falls to Graph (102-103). | PASS | `app-shell-state.ts`, restoration helper, and continuity scenarios own the behavior (58, 61-65, 125). Existing panel state and responsive mutual exclusion are localized in `app-shell.tsx:100-105`, `:122-143`. |
| P4-20 | Find again explicitly re-associates the intended stale recent without searching (26-27, 124). | GAP | The only Open interface is generic `ChooseAndActivateWorkspace()` (82); neither it nor Phase 3 exposes `FindRecentLibrary(workspaceID)`. Current identity classification can infer a move only from a unique signature and otherwise creates/asks for a new identity (`internal/ai/workspaceid/classify.go:17-38`). Add an intended-ID picker flow and define allowed reassociation outcomes, especially when signatures are missing/ambiguous. |
| P4-21 | Corrupt-state repair is explicitly confirmed and records the active library (105-106). | GAP | UI behavior is stated, but it inherits P3-15's undefined confirmation authority and response states. Define which ready/Welcome states expose repair, how focus returns, and how a successful manual activation is passed to the backend repair transaction without trusting a renderer workspace ID. |
| P4-22 | No Create/Open/Restore network request or telemetry occurs (48-49). | PASS | Product-rule tests explicitly instrument no network (127); provisioning, identity, history, and appstate owners are local. Current runtime composition's provider client exists for AI (`apps/desktop/ai-composition.go:42-49`), so tests must scope the assertion to the lifecycle calls as written. |

Phase 4 tally: **17 PASS, 2 FAIL, 3 GAP**.

## Blocking corrections

1. Define a durable pending-provision recovery record that exists before identity
   commit and contains no renderer-visible path. Add retry/remove/expiry APIs and
   reconcile it after successful activation.
2. Define the staged-session half of the Phase 2 identity/session transaction;
   current `SessionRegistry.Activate` cannot roll back to A after retiring it.
3. Specify one normative appstate -> identity -> history lock order, plus the
   rule that no native prompt/runtime call occurs under those store locks.
4. Define backend-native authority and typed crash outcomes for app-state repair.
5. Define one atomic frontend ready-state payload/owner rather than relying on
   multiple React setters across `useWorkspace`, App, and chat history.
6. Add `FindRecentLibrary(workspaceID)` or equivalent intended-ID picker contract.

