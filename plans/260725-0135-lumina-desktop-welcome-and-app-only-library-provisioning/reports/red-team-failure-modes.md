# Red-Team Failure Modes: Welcome, Create, Open, and Restore

Scope: failure-mode analysis and full-tier tracing only. This review did not run
tests, lint, build, or package commands.

## Flow traces

- **Create:** native location choice -> provision lock/classification -> staged
  publication -> manifest commit -> trusted validation/identity attach -> runtime
  load -> session activation -> snapshot/continuity -> app-state activation
  record -> ready commit.
- **Open:** native picker -> validation/identity decision -> optional native
  confirmation -> identity commit -> runtime load -> session activation ->
  snapshot/continuity -> app-state activation record -> ready commit.
- **Restore:** app-state last ID -> identity registry path resolution -> optional
  native confirmation -> identity commit -> runtime/session activation ->
  snapshot -> history status/list/load -> note read -> focus resolution -> guarded
  ready commit -> converged view save.

## Findings

### 1. Critical — A committed Create can be reported only as activation failure and disappear from recovery

**Plan location:** Phase 2 lines 77-78 declares that cancellation after manifest
commit returns committed success; Phase 4 lines 70-74 exposes
`CreateAndActivateLibrary(...) -> ActivationResult`; Phase 3 lines 72-81 records
the library only after activation succeeds.

**Concrete failure:** The manifest commits, making a complete library visible on
disk, and then runtime loading, session activation, window closure, or app-state
recording fails. The proposed Wails result has no state for “library created but
not opened.” If activation fails before `RecordActivation`, the library is absent
from recents and the user receives a generic failure despite durable creation.
Retrying Create then reports a collision. This is a recoverability trap, not a
cosmetic error.

**Code evidence:** The current result contract has only `active` and `cancelled`
(`apps/desktop/internal/ai/service-types.go:32-37`, `:64-67`). Runtime and session
failures occur after identity confirmation and return errors
(`apps/desktop/internal/ai/service-activation-run.go:68-99`). Nothing in that
contract can carry a durable-provision outcome.

**Required fix:** Define a provision/activation result with disjoint durable
states, at minimum `cancelled_before_commit`, `created_and_active`, and
`created_not_active`. Persist an app-local pending-created locator/ID or otherwise
make the committed library immediately recoverable before attempting runtime
activation. Specify retry UX and tests for every failure hook after manifest
commit.

### 2. High — Identity state commits before runtime/session success, with no compensation contract

**Plan location:** Phase 2 lines 87-90 specifies
`ConfirmAttach -> loaded runtime -> session activation`; Phase 3 lines 87-90 then
places `record activation` after runtime/session success. Phase 2 lines 98-108
asks for rollback tests but does not define which earlier durable mutations are
rolled back.

**Concrete failure:** Open or Restore confirms a moved, reused, ambiguous, or new
identity. `ConfirmAttach` durably changes the registry, then runtime loading or
session activation fails. The app-state “last successful activation” remains old,
but the identity registry now has an updated path/`LastSeenAt`, a newly active ID,
or a deactivated prior path occupant. The next restore can classify the same
directory differently even though no usable session ever existed.

**Code evidence:** `ConfirmAttach` changes path/last-seen/active records and saves
the registry (`apps/desktop/internal/ai/workspaceid/manager-confirm.go:41-84`).
Only afterward does activation load the runtime and activate the session
(`apps/desktop/internal/ai/service-activation-run.go:68-99`). The error paths close
the runtime but do not reverse the registry save.

**Required fix:** Make this ordering an explicit, tested contract. Prefer a
two-phase identity operation whose durable commit occurs with successful session
activation. If registry-first is intentionally retained, add an idempotent
compensation/reconciliation record and test failures after registry save, runtime
load, session activation, and window tombstoning for every attach kind.

### 3. High — The global creation lock can be held across an unbounded native confirmation

**Plan location:** Phase 2 lines 24-26 requires one global cross-process creation
lock; lines 73-74 says to hold it “through activation handoff or safe abort”; lines
87-90 places identity confirmation and activation downstream without an exact
lock-release point.

**Concrete failure:** Create in process A publishes successfully and reaches an
identity-confirmation dialog while still owning the global creation lock. The
user leaves the dialog open. Every Create in every other app process blocks,
including recovery of a different interrupted target. A window-close/cancellation
path must also unwind both a dialog wait and a kernel lock, but the plan specifies
neither bounded acquisition nor the ownership transfer/release invariant.

**Code evidence:** Identity confirmation occurs synchronously inside activation
before `ConfirmAttach` (`apps/desktop/internal/ai/service-activation-run.go:42-56`).
The Wails question implementation waits until a callback or context cancellation
(`apps/desktop/internal/ai/wails-dialog-driver.go:65-90`). The existing activation
gate is per window, not global (`apps/desktop/internal/ai/activation-gate.go:10-19`,
`:37-66`), so it does not bound cross-process lock occupancy.

**Required fix:** State the exact lock boundary: release the creation lock after
durable publication/cleanup and proof handoff, before any native prompt or runtime
work. Carry a held-root proof independent of the lock and revalidate it at attach.
Add a bounded lock-busy result and process-level tests where the creator is
cancelled or killed while confirmation is outstanding.

### 4. High — “Hide A immediately” and “preserve A on cancel” are contradictory lifecycle rules

**Plan location:** Phase 3 lines 135-141 requires old workspace data to be hidden
synchronously when a new activation begins; Phase 4 lines 79-86 requires
cancellation while ready to preserve the current session; Phase 4 lines 145-152
again requires A to disappear before B can render.

**Concrete failure:** While library A is ready, the user chooses Open, beginning
activation of B. If A’s UI state is cleared immediately to satisfy the Phase 3
gate and the native picker or identity confirmation is cancelled, backend session
A remains active but its graph, note, tree, chat, selection, and focus have been
discarded. If A remains rendered instead, the stated synchronous-hide gate fails.
The plan has no pending overlay or rollback snapshot to satisfy both rules.

**Code evidence:** The current picker cancellation merely updates action state and
returns (`apps/desktop/frontend/src/features/workspace/use-workspace.ts:60-75`).
Loaded workspace state is committed through several independent React setters
only after activation (`apps/desktop/frontend/src/features/workspace/use-workspace.ts:101-124`).
Chat is reset only when the session key actually changes
(`apps/desktop/frontend/src/features/chat/chat-state.ts:25-37`). There is no
transactional saved copy that could restore a pre-emptively cleared A.

**Required fix:** Keep A’s state mounted under a non-interactive activation veil
while B is pending; do not relabel it as B. Commit B’s capability and all guarded
ready data atomically, then discard A. On cancellation, remove the veil without
changing A. Replace the ambiguous “hidden synchronously” assertion with tests for
no A-as-B leakage, cancelled picker, cancelled identity prompt, and B failure
after A was ready.

### 5. High — Latest-history restore is a two-call race that erases the “deleted” outcome

**Plan location:** Phase 3 lines 30-31 requires empty, deleted, unavailable, and
corrupt history to remain distinct; lines 94-105 requires deterministic latest
selection. Phase 4 lines 35-36 and 83-86 restores latest history through a
multi-step pipeline.

**Concrete failure:** Restore lists conversations and selects the latest. Another
process deletes that conversation before Load. Load returns an empty record list,
which is accepted as a normal DTO. The frontend can therefore replace chat with
an empty conversation even though an older saved conversation still exists, and
cannot distinguish deletion from genuine empty history. The latest-selection
guarantee is violated under an ordinary cross-process history mutation.

**Code evidence:** List and Load are separate facade calls
(`apps/desktop/internal/ai/service-management.go:50-84`). Each store call acquires
its own lock; `Load` converts a missing file into `[]` without an error
(`apps/desktop/internal/ai/history/store.go:70-91`), while deletion is independently
locked and removes that file (`apps/desktop/internal/ai/history/mutations.go:86-114`).
The DTO converter accepts zero records (`apps/desktop/internal/ai/service-management-convert.go:117-139`),
and the frontend treats the returned list as a loadable conversation
(`apps/desktop/frontend/src/features/chat/use-chat-history.ts:60-70`).

**Required fix:** Add a backend `LoadLatestHistory` operation that selects and
loads under one history lock and returns a tagged outcome (`off`, `empty`,
`loaded`, `deleted_retry_exhausted`, `unavailable`, `corrupt`). Alternatively,
perform one bounded re-list/reselect on missing and never commit an empty chat
state for a deleted ID.

### 6. Medium — Preserving corrupt app state makes continuity permanently unwritable

**Plan location:** Phase 3 lines 25-26 requires strict decode and atomic
cross-process writes; lines 34-35 and 151-156 preserve corrupt state and defer
rotation/reset to a later action. Yet lines 80-81 and Phase 4 lines 85-86 require
post-activation state/view saves.

**Concrete failure:** A corrupt app-state file forces Welcome, and manual Open or
Create succeeds. The subsequent `RecordActivation`/`SaveWorkspaceView` must reload
the corrupt file under the planned lock/revision discipline, so it fails again.
Every launch returns to Welcome forever, including after a successful manual
recovery, and no current-phase control can repair the condition. Deferring the
only recovery action outside the plan defeats the stated “return later” outcome.

**Code evidence:** The existing private registry store illustrates the strict
store pattern the plan proposes: decode failure is returned from snapshot loading
(`apps/desktop/internal/ai/workspaceid/store.go:76-95`) and saves replace the owned
file only after validation (`apps/desktop/internal/ai/workspaceid/store.go:107-128`).
There is no `internal/appstate` implementation or quarantine/reset surface in the
current tree, while the plan’s interface checklist (Phase 3 lines 56-70) likewise
contains no repair method.

**Required fix:** Include an explicit, confirmed app-state repair action in this
slice. Quarantine the exact corrupt file under the app-local lock, create fresh
empty state, and then record the already-active library; never touch identity,
history, credentials, or workspace bytes. Test crash points around quarantine and
fresh-state commit, plus concurrent repair attempts.

## Required plan changes before implementation

1. Add durable “created but not active” semantics and recovery.
2. Specify identity commit/compensation boundaries.
3. Release the creator lock before native/user interaction.
4. Resolve the ready-to-open cancellation state contradiction.
5. Make latest-history selection/load atomic or explicitly retryable.
6. Bring app-state corruption repair into the delivered slice.
