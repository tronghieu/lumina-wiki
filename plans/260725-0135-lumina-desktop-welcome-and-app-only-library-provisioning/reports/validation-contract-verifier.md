# Contract Verifier Report

Date: 2026-07-25  
Scope: current five-phase plan after red-team, fact-check, and scope edits  
Method: static producer/consumer and ownership review only; no builds or tests run

## Verdict

**FAIL — the plan is close, but not implementation-ready as written.**

The package layering can remain acyclic, and most persistence, privacy, DTO, and
evidence-lane contracts line up. Six contract failures remain:

1. Phase 1 requires `contract.Materialize` to consume a held verified root, but
   the only owner of the neutral `RootProof` type is Phase 2. That reverses the
   declared `Phase 1 -> Phase 2` construction dependency.
2. Phase 2's `PrepareActivation(window, runtime, workspaceID)` signature omits
   the display metadata and access mode required to construct the session and
   downstream Wails capability safely.
3. Phase 2 does not assign complete ownership for enforcing `read-only` at every
   registered mutation boundary.
4. Phase 3's native-confirmed reset token has no owning native-authority file or
   dependency change in that phase.
5. Phases 2–4 commit identity/session before Phase 4 finishes the fallible
   snapshot/history/note ready pipeline, contradicting the promise that A
   survives every cancellation/failure until B's atomic ready commit.
6. Phase 4's mutation-mode enforcement claim is broader than its file and test
   ownership.

Status totals across the 75 checks below: **57 PASS, 12 GAP, 6 FAIL**.

`PASS` means the producer, consumer, ownership, and ordering agree. `GAP` means
the direction is viable but a type, ownership point, or invariant is
underspecified. `FAIL` means two stated contracts cannot both hold as written.

## Phase 1 — Generated Contract and Core Payload

| # | Status | Interface/dependency claim | Evidence and assessment |
|---:|:---:|---|---|
| 1 | PASS | Installer and generator consume one workspace definition. | Phase 1 lines 24–28 and 51–56 assign the pure authority to `src/installer/workspace-definition.js`; `commands.js` and the generator are consumers. This is the correct direction and preserves lazy command imports. |
| 2 | PASS | Schema/lint ID authority has one producer. | Phase 1 lines 53–54 make pure `schemas.mjs` the owner and `lint.mjs` the consumer, matching the existing pure-schema contract in `docs/project-context.md`. |
| 3 | PASS | Generator output is a build artifact, not a runtime Node dependency. | Phase 1 lines 55–62 place generation in root scripts/CI and lines 77–81 end runtime dependency at the embedded Go loader. |
| 4 | PASS | Hidden payload entries reach Go embed. | Phase 1 lines 29–30 specify `//go:embed all:assets`; lines 97–100 explicitly test `.agents`, `.gitignore`, and `_lumina`. |
| 5 | PASS | Loader verification precedes payload exposure. | Phase 1 lines 72–75 make `Load` verify the boundary and expose payload only through a verified `Bundle`; Phase 2 lines 25–28 consumes only this API. |
| 6 | **FAIL** | `Bundle.Materialize` receives a held verified root without reversing phase dependencies. | Phase 1 lines 38–39 and 75 require held-root input, but `RootProof` is first created by Phase 2 lines 72 and 108–110. Phase 1 lines 79–81 declare the opposite dependency (`contract -> Phase 2`). The type owner must move to Phase 1/a pre-phase leaf, or Phase 1 must explicitly accept only a proof-derived immutable root descriptor. |
| 7 | PASS | Runtime-derived state is not embedded as a pre-rendered manifest. | Phase 1 lines 35–39 and 116–117 separate static/template inputs from target-derived README/config/manifest/CSV bytes. |
| 8 | PASS | Materialized inventory is the exact provisioner input. | Phase 1 line 75 returns target-ready inventory/state bytes; Phase 2 lines 95–107 names `VerifiedMaterializer` as the `Provisioner` dependency. |
| 9 | GAP | The exact `RuntimeInputs` shape is owned. | `Bundle.Materialize(RuntimeInputs)` is named at Phase 1 line 75, but the checklist does not define fields or ownership for name, instant, canonical root/proof descriptor, and limits. This is especially important to resolve check 6 without accepting a raw string. |
| 10 | PASS | Contract and checksum are independently bounded and verified. | Phase 1 lines 29–34 require strict versions, independent limits, per-file hashes, and root digest; hostile `fs.FS` tests are assigned at lines 89–92. |
| 11 | PASS | Deterministic check does not mutate the worktree. | Phase 1 lines 40–41 and interface line 71 both require temp generation and byte comparison. |
| 12 | PASS | Fixed fixture does not leak build paths into runtime state. | Phase 1 lines 42–43 and tests at 93–100 use fixed inputs, distinct roots, and assert no fixture/build path survives. |
| 13 | GAP | “Semantic parity” and byte parity have an explicit boundary. | Phase 1 lines 93–96 compare parsed YAML/JSON meaning while static bytes and CSV hashes are exact; success criterion line 142 says projection conforms. State which runtime-derived files are byte-identical versus semantically identical so Phase 2 hashes one canonical representation. |
| 14 | PASS | Root npm package includes the shared runtime definition but excludes Desktop assets. | Phase 1 lines 61 and 136 assign `package.json`/`ci-package.mjs`; current `package.json` lines 33–62 is an explicit allowlist and `ci-package.mjs` lines 71–115 has a required-file gate. |
| 15 | PASS | Contract package can stay below workspace/AI packages. | The planned Phase 1 files are confined to `internal/contract`; no contract file is assigned an import of `workspace`, `workspaceid`, `session`, or `ai`. Resolve check 6 with a neutral leaf rather than importing those higher packages. |

## Phase 2 — Secure Native Provisioning

| # | Status | Interface/dependency claim | Evidence and assessment |
|---:|:---:|---|---|
| 1 | PASS | `VerifiedMaterializer -> Provisioner` is the only payload boundary. | Phase 2 lines 25–28, 95, and 106–107 reject a raw payload subtree and require verified materialization before publication. |
| 2 | PASS | `rootproof` is a neutral leaf shared without a package cycle. | Phase 2 line 72 explicitly creates `internal/rootproof`; `workspace`, `workspaceid`, runtime validation, and AI coordination can import it while it imports only OS/platform primitives. |
| 3 | PASS | `ProvisionResult` keeps path/proof backend-only. | Phase 2 lines 97 and 108–110 keep canonical root and proof out of serialization; Phase 4 lines 31–35 and 91–93 expose only an opaque location capability. |
| 4 | GAP | Trusted validation preserves context cancellation. | Phase 2 line 101 specifies `Service.ValidateTrusted(root, proof)` without `context.Context`, while the current AI `WorkspaceValidator` contract at `internal/ai/service-types.go:90–92` is context-aware. Add `ctx` or explicitly document why this bounded read ignores cancellation. |
| 5 | **FAIL** | Staged activation can construct the same complete session as current activation. | Phase 2 line 103 declares `PrepareActivation(window, runtime, workspaceID)`, but current `session.Registry.Activate` at `internal/ai/session/registry.go:56–103` also requires `DisplayMetadata`, and Phase 4 requires access mode in ready state (lines 38–40, 99–102). The staged signature must include display metadata and backend-owned access mode, or accept a complete typed session descriptor. |
| 6 | GAP | Prepared attach has an unambiguous confirmation/commit API. | Phase 2 lines 102 and 128–136 return both `PreparedAttach` and `AttachDecision`, but do not name how a confirmation-required decision authorizes that prepared object. Existing decisions are single-use tokens (`workspaceid/manager-decisions.go:82–107`). Specify `Approve/Commit(token)` or an equivalent one-use transition. |
| 7 | PASS | Identity persistence is deferred until runtime/session staging succeeds. | Phase 2 lines 55–56 and 133–142 explicitly stage runtime/session first and persist only in the coordinated commit. This corrects current early `ConfirmAttach` ordering in `service-activation-run.go:68–91`. |
| 8 | GAP | Crash reconciliation defines the durable identity/session split. | `manager-transaction.go` owns “reconciliation” at Phase 2 line 84, but lines 139–142 persist identity before an in-memory swap. A process can die between them. Define the startup rule for a committed identity with no live session and prove it cannot clear or misclassify the pending-created record. |
| 9 | PASS | Pending-created is durable before fallible activation and cleared after coordinated success. | Phase 2 lines 57–65, 137–142 and integration tests at 167 establish the correct producer/consumer order. |
| 10 | **FAIL** | Every mutation boundary receives and enforces `read-only|writable`. | Phase 2 lines 53–54 make this universal, but its file list changes only activation/service types (line 87), not existing mutation facades such as history enable/delete and index build/clear in `internal/ai/service-management-runtime.go:21–33` and chat persistence. Assign the concrete enforcement owner and all affected files/tests. |
| 11 | PASS | Pending-created uses the same lower-level private-state primitive as Phase 3. | Phase 2 lines 78–80 create `appprivate`; Phase 3 lines 47–50 consume it. `appprivate` need not import `workspace` or `appstate`, so the direction is acyclic. |
| 12 | PASS | Creation lock is not held across native prompts or runtime load. | Phase 2 lines 130–132 release after publication/proof capture; dependency lines 146–149 place confirmation/runtime later. |
| 13 | PASS | Proof continuity survives release of the creation lock. | Phase 2 lines 108–110 and 128–132 require a held handle plus `SameFile` revalidation during identity transaction, not a canonical string fallback. |
| 14 | PASS | Atomic publication is no-clobber and platform-owned. | Phase 2 lines 35–43 and files at 75–77 assign hard-link/native exclusive rename strategies with a fail-closed fallback. |
| 15 | PASS | Legacy `Validate(string)` remains internal-compatible while renderer exposure can later be removed. | Phase 2 line 127 preserves graph/tools/importer behavior; Phase 4 lines 45–47 and 72–73 remove only Wails registration. These are compatible scopes. |

## Phase 3 — App-Local Library and Restoration State

| # | Status | Interface/dependency claim | Evidence and assessment |
|---:|:---:|---|---|
| 1 | PASS | `appstate -> appprivate` is one-way reuse. | Phase 3 lines 47–50 explicitly build the store over Phase 2 `appprivate` and forbid duplication. |
| 2 | PASS | Canonical paths remain owned by workspace identity. | Phase 3 lines 20–24 store only IDs/views in appstate; dependency lines 105–108 route IDs through the identity registry. |
| 3 | PASS | Restore-by-ID reuses normal identity decisions. | Phase 3 lines 30–31, 72–76, and 96–97 require `BeginRestore` to return normal attach decisions and preserve restart confirmation. |
| 4 | PASS | App-state activation recording occurs after a usable session exists. | Phase 3 lines 98–99 makes save failure a non-blocking warning; dependency line 107 orders record activation after runtime/session. |
| 5 | PASS | View writes authorize from session capability, not a caller workspace ID. | Phase 3 lines 70, 76, and 87–88 state this explicitly; current session resolution is window-scoped in `service-management-runtime.go:36–63`. |
| 6 | PASS | Snapshot/note reads follow session -> runtime -> trusted root. | Phase 3 lines 35–36, 80–81, and 108 specify the chain; current runtime already retains root proof in `loaded-runtime-factory.go:26–35,93–103`. |
| 7 | GAP | `WorkspaceSnapshot` has one owned DTO/schema. | Phase 3 line 80 names the method and Phase 4 line 88 says it returns summary + graph + tree, but no Phase 3 file explicitly owns the aggregate DTO and its bounds. Assign it to `service-library-types.go` or another exact file. |
| 8 | PASS | Latest history selection and load share one backend lock. | Phase 3 lines 40–41, 54–55, 82, and 142–144 add a separate atomic operation rather than composing existing `List` then `Load`. Current methods are separate lock acquisitions (`history/store.go:70–149`), so the new owner is necessary and correctly identified. |
| 9 | GAP | Latest-history comparator is identical in Phases 3 and 4. | Phase 4 lines 41–42 requires max `updatedAt`, then ID; Phase 3 only says “latest” and tagged result. Put that comparator in `history/latest.go` and its tests to avoid frontend/backend disagreement. |
| 10 | PASS | Tagged history outcomes preserve meaningful failure classes. | Phase 3 lines 33–34 and 40–41 enumerate off, empty, loaded, deleted retry exhaustion, unavailable, and corrupt. |
| 11 | GAP | “History disabled means no … toggle” is scoped. | Phase 3 line 33 says disabled means no list/load/toggle, while current public management includes `SetHistoryEnabled` (`service-management.go:38–47`). Clarify that restoration does not toggle history, rather than unintentionally removing the Advanced user control. |
| 12 | PASS | Corrupt recent/view state is preserved until explicit reset. | Phase 3 lines 37–39 and 78–79 specify quarantine, fresh state, bounded backup, and an explicit one-use token. |
| 13 | **FAIL** | Native-confirmed reset has an owning native-authority change in Phase 3. | Phase 3 lines 78–79 and 91–95 require a window-native confirmation, but the Phase 3 file list does not modify `wails-native-authority.go` or the `NativeAuthority` interface. Current authority methods at `service-types.go:73–78` have no reset confirmation. Assign that producer here (or explicitly to Phase 4 and make Phase 3 backend-only). |
| 14 | PASS | Store locks are not nested across identity/history/native work. | Phase 3 lines 110–113 defines snapshot-and-release ordering and prohibits prompts/runtime/frontend waits while locked. |
| 15 | GAP | Phase 3's “share prepared activation” extends staging through readiness. | Phase 3 line 135 reuses prepared activation, but its dependency line 107 says activate then record and Phase 4 performs additional fallible reads after activation. The staging lifetime must be made explicit to resolve the Phase 4 failure below. |

## Phase 4 — Welcome, Create, Open, and Restore UX

| # | Status | Interface/dependency claim | Evidence and assessment |
|---:|:---:|---|---|
| 1 | PASS | Wails removes raw-root Workspace/Graph/Tools/Importer services at registration. | Phase 4 lines 45–47 and 72–73 own the change. Current `main.go:22–31` registers all four, so changing registration—not only buttons—is the correct boundary. |
| 2 | PASS | Frontend migrates from raw roots to session-scoped methods. | Phase 4 lines 60 and 65–66 assign the consumers. Current `use-workspace.ts:91–106,141–145,235` passes roots to Workspace/Graph and demonstrates why this replacement is required. |
| 3 | PASS | Create authorization is opaque, one-use, window-bound, and name-bound. | Phase 4 lines 28–35 and interfaces 81–83 keep path selection/confirmation in native backend and require capability replay/cross-window tests at line 135. |
| 4 | GAP | Repeated `name` cannot diverge from the approved capability. | `BeginCreateLibrary(name)` and `CreateAndActivateLibrary(name, capability)` at lines 81–82 repeat the name. The text says the token is child-name-bound, but the interface should state equality is revalidated or remove the second name. |
| 5 | PASS | Pending-created recovery exposes only a safe ID/card. | Phase 4 lines 83–85 consume Phase 2’s private record through recovery ID, never canonical path/proof. |
| 6 | PASS | Wails activation results distinguish cancel, active, and committed-not-active. | Phase 4 lines 94–96 and 185–189 define the safe status boundary and map Phase 2 pending recovery into UI behavior. |
| 7 | PASS | `ReadyLibraryState` is a single reducer-owned commit payload. | Phase 4 lines 59 and 99–102 put capability, snapshot, note, chat outcome, focus, mode, and warnings in one guarded dispatch. |
| 8 | **FAIL** | A remains current until all fallible B readiness work succeeds. | Phase 4 lines 107–110 and race tests at 138 promise this, but Phase 2 lines 139–142 commits identity/session before Phase 4 then runs snapshot/history/note. Current registry activation immediately swaps and retires A (`session/registry.go:88–98`). A later snapshot/history/note cancellation cannot restore A under the stated backend contract. |
| 9 | GAP | Restore order has a commit point compatible with the reducer. | Phase 4 line 109 says `activate -> snapshot -> history -> note -> ... -> guarded commit`. Change it to stage B, perform capability-scoped reads against the staged runtime, then commit backend identity/session and return one ready payload (or define another reversible transaction spanning those reads). |
| 10 | PASS | Atomic latest history is consumed as one operation. | Phase 4 lines 41–42 and 109 consume Phase 3's `LoadLatestHistory`; no frontend list-then-load race is required. |
| 11 | PASS | Note restoration is checked against the fresh graph. | Phase 4 lines 41–42 and 109–112 order graph/snapshot before note match/read and provide Graph fallback. |
| 12 | PASS | `FindRecentLibrary` binds picker result to intended identity. | Phase 4 lines 87 and 116–118 preserve ID only for a uniquely confirmed move and fail closed for ambiguous/replaced evidence. |
| 13 | **FAIL** | All renderer-reachable mutations enforce access mode. | Phase 4 lines 38–40 make this universal, but files/tests focus on registration, provision, and display. Existing AI Wails methods include history enable/delete and index mutations (`service-management-runtime.go:21–33`), and chat can persist history. The plan must enumerate and test every remaining registered mutation or centralize enforcement in session/runtime. |
| 14 | GAP | MVP A has a clean API subset independent of Phase 3. | Phase 4 lines 122–124 and 147–149 allow MVP A without Phase 3, but the same ready pipeline and state payload include history/note/focus. Define the Phase 2-only snapshot/result subset and the Phase 3 extension so bindings compile at the A gate. |
| 15 | PASS | Raw-root API removal is reflected in generated bindings and hostile calls. | Phase 4 lines 72–74, 139, 144, and 176–179 require service unregistration, binding regeneration, and direct-call tests. |

## Phase 5 — Packaged Runtime and Cross-Platform Gates

| # | Status | Interface/dependency claim | Evidence and assessment |
|---:|:---:|---|---|
| 1 | PASS | Contract generation/conformance runs before Go consumers. | Phase 5 lines 20–21, 47, and 113–116 assign root dependency installation plus contract gates to Desktop quality CI. |
| 2 | PASS | Patched toolchain policy is shared by quality and package jobs. | Phase 5 lines 20–21, 47, 113–114, and 135–136 align with Phase 2's branch-aware policy. Current workflow uses broad `1.25.x` at lines 22–25 and 83–86, so exact pinning is a real owned change. |
| 3 | PASS | Composed lifecycle and packaged launch prove different boundaries. | Phase 5 lines 24–30 and 90–93 explicitly separate service lifecycle, artifact install/launch, and manual GUI evidence. |
| 4 | PASS | Native composed lifecycle uses real embedded assets and clean config. | Phase 5 lines 24–27, 51, and 115–117 assign the integration test and sanitized environment. |
| 5 | PASS | External runtime absence is an explicit scenario, not inferred from embedding. | Phase 5 lines 25–27, 79, 106–107, and 152–154 require sanitized PATH/environment and lifecycle evidence. |
| 6 | PASS | Package jobs install and launch on all three native OSes. | Phase 5 lines 22–23 and gate row 76 require this. Current workflow already packages all three and launches installed/native artifacts at lines 70–186, providing a compatible base. |
| 7 | PASS | Manual GUI acceptance cannot be mistaken for the 5-second launch smoke. | Phase 5 lines 28–30 and 90–93 state the lane distinction. |
| 8 | PASS | Manual evidence is commit- and artifact-digest-bound per OS. | Phase 5 lines 31–34 and 56 invalidate evidence on either source or digest change. |
| 9 | PASS | Platform filesystem claims are proven only on their native OS. | Phase 5 lines 35–37, matrix rows 83–86, and refactor lines 123–124 reject cross-compilation as native proof. |
| 10 | PASS | Windows identity and DACL consumers match Phase 2/3 producers. | Phase 5 rows 85–86 consume Phase 2 `FileIdInfo`/appprivate protections and Phase 3 private appstate without adding a second policy. |
| 11 | PASS | Direct raw-root/Check/Import absence is a package acceptance gate. | Phase 5 row 87 and tests 106–109 consume Phase 4 registration changes, rather than treating hidden buttons as proof. |
| 12 | PASS | UI visual/a11y evidence is not overstated across OSes. | Phase 5 row 88 labels Chromium quality separately while package/manual lanes cover native OS behavior. |
| 13 | PASS | Failure diagnostics have a privacy contract. | Phase 5 lines 108–109 and success criterion 164 prohibit workspace content, secrets, and absolute paths in uploaded diagnostics. |
| 14 | PASS | User docs update all maintained languages from evidence-backed behavior. | Phase 5 lines 40–41, 52–55, and 119 assign English, Vietnamese, and Chinese guides; all three files currently exist. |
| 15 | PASS | Signed distribution remains a separate release gate. | Phase 5 lines 38–39, 125, and 155 prevent feature/package evidence from claiming signing/notarization completion. |

## Acyclic Package and Runtime Shape

The following dependency direction is viable and should be made explicit in the
phase files:

```text
internal/rootproof       internal/appprivate       internal/contract
        |                       |                         |
        +----------+------------+-------------------------+
                   v
            internal/workspace
                   |
        +----------+------------------+
        v                             v
internal/ai/workspaceid        internal/appstate
        |                             |
        +-------------+---------------+
                      v
             internal/ai/session
                      |
                      v
                 internal/ai
                      |
                      v
              main composition/Wails
```

Required constraints:

- `rootproof`, `appprivate`, and `contract` must not import `workspace`,
  `workspaceid`, `session`, `appstate`, or `ai`.
- `workspaceid` must not import `session` or `appstate`.
- `session` may import `workspaceid` for the opaque ID, but `workspaceid` must
  not import `session`.
- `appstate` may consume `appprivate` and opaque workspace-ID types, but
  `appprivate` must not consume `appstate`.
- The `ai` package is the transaction coordinator. Neither persistence package
  should call Wails or wait for frontend work.
- `main` owns construction/registration only; it must not become a second
  lifecycle coordinator.

The diagram requires moving the neutral proof owner earlier than Phase 2 (or
changing the Phase 1 materializer boundary), as identified in Phase 1 check 6.

## Required Corrections Before Implementation

1. **Resolve materializer proof ownership.** Prefer creating the neutral
   `internal/rootproof` leaf in Phase 1 and defining the complete
   `contract.RuntimeInputs` there. Keep proof acquisition/revalidation in
   workspace/identity code.
2. **Define one complete staged session descriptor.** It must include window,
   provisional workspace ID, display metadata, access mode, runtime, and trusted
   root lease. Its commit must be infallible after staging.
3. **Extend staging through readiness.** Build snapshot/latest-history/note/focus
   against B's staged runtime while A remains current. Then commit
   identity/session and deliver one bounded ready payload. Do not promise
   rollback of durable identity after a process crash; specify reconciliation.
4. **Centralize access-mode enforcement.** Add the mode to session/runtime
   authorization and enumerate tests for every registered mutating Wails method,
   including chat persistence, history settings/deletes, index build/clear, and
   any future write facade.
5. **Assign missing DTO/native owners.** Name the aggregate
   `WorkspaceSnapshotDTO`, latest-history comparator/result, reset-confirmation
   authority method, and MVP-A/MVP-B binding split in exact files.
