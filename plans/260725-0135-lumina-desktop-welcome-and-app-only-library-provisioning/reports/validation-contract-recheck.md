# Contract Recheck

> Historical checkpoint: the two corrections requested here were applied and
> passed the final recheck. See [Final Validation Log](./validation-log.md).

Date: 2026-07-25  
Scope: only the 6 FAIL and 12 GAP items from
`validation-contract-verifier.md`, checked against the current edited plan  
Method: static contract review only; no builds or tests run

## Verdict

**NOT READY**

Fifteen of the eighteen prior items are resolved. Three remain: one DTO
ownership gap and one underlying readiness/commit contradiction represented by
the prior Phase 4 FAIL and its associated ordering GAP.

## Prior FAIL Items

| Prior item | Result | Exact current evidence |
|---|:---:|---|
| Phase 1 #6 — held-root proof was owned only by Phase 2 | **RESOLVED** | Phase 1 files now create `internal/rootproof/{proof,proof-unix,proof-windows}.go` as a neutral leaf (Phase 1 lines 59–61). Phase 2 consumes rather than redefines it (Phase 2 line 74). `RuntimeInputs` directly names `rootproof.RootProof` (Phase 1 lines 78–80), preserving `Phase 1 -> Phase 2`. |
| Phase 2 #5 — staged activation omitted display metadata/access mode | **RESOLVED** | The interface is now `PrepareActivation(SessionDescriptor)` (Phase 2 line 108), and the descriptor explicitly contains window ID, provisional workspace ID, display metadata, access mode, runtime, and trusted root lease (lines 142–143). |
| Phase 2 #10 — universal read-only enforcement lacked ownership | **RESOLVED** | The claim is now correctly narrowed to workspace-byte mutations, while app-local history/index/settings retain their existing authorization (Phase 2 lines 53–56). Exact owners are `session/access-mode.go` and `ai/workspace-write-authorizer.go` with tests (lines 88–89). |
| Phase 3 #13 — reset confirmation lacked native-authority ownership | **RESOLVED** | Phase 3 now assigns `service-types.go`, `wails-native-authority.go`, and tests to native reset confirmation/token authority (Phase 3 line 56), matching the interface and behavior at lines 79–80 and 92–96. |
| Phase 4 #8 — backend committed B before fallible readiness completed | **REMAINS** | The broad staging lifetime is corrected in Phase 2 lines 57–58 and 160–164, Phase 3 lines 120–123, and Phase 4 lines 114–119. However, Phase 4 still says to build complete `ReadyLibraryState` before `CommitPreparedLibrary` (lines 116–118), while `ReadyLibraryState` requires a capability (lines 106–108), `PreparedLibraryDTO` does not list one (lines 100–103), and `CommitPreparedLibrary` is the operation returning `ReadyCommitDTO` (line 89). The complete state cannot exist at the stated pre-commit step. Specify a capability-free `PreparedReadyState`, then combine it with `ReadyCommitDTO.capability` in one pure synchronous construction/dispatch after commit. |
| Phase 4 #13 — mutation-mode enforcement exceeded file/test ownership | **RESOLVED** | Phase 4 now consistently scopes the rule to workspace-byte writes and explicitly keeps app-local history/index/settings available (lines 38–40). Its test matrix asserts exactly that boundary (line 149), consuming the Phase 2 central authorizer owners. |

## Prior GAP Items

| Prior item | Result | Exact current evidence |
|---|:---:|---|
| Phase 1 #9 — `RuntimeInputs` shape was undefined | **RESOLVED** | Phase 1 lines 78–80 define exactly `ProjectName`, `Now`, and `rootproof.RootProof`, and exclude paths, locale, packs, and arbitrary substitutions. |
| Phase 1 #13 — semantic versus byte parity boundary was unclear | **RESOLVED** | Phase 1 lines 82–85 now distinguish exact static/rendered Markdown/schema bytes, semantic YAML/manifest parity with canonical Go serialization whose actual bytes are hashed, and exact CSV ordering/quoting/hashes. |
| Phase 2 #4 — `ValidateTrusted` omitted cancellation context | **RESOLVED** | Phase 2 line 105 now declares `Service.ValidateTrusted(ctx context.Context, root string, proof RootProof)`. |
| Phase 2 #6 — prepared attach confirmation transition was ambiguous | **RESOLVED** | Phase 2 line 107 adds `PreparedAttach.Approve(oneUseDecisionToken)`. Lines 144–146 define native-confirmation ordering, root/proof revalidation, and exact single-use token consumption before runtime staging. |
| Phase 2 #8 — crash between identity persistence and session swap lacked reconciliation | **RESOLVED** | Phase 2 lines 153–156 define the crash state: no B session, pending-created remains, startup reconciles matching identity/proof and retries, and pending clears only after swap. `manager-transaction.go` owns reconciliation at line 86. |
| Phase 3 #7 — aggregate workspace snapshot DTO lacked an exact owner | **REMAINS** | Phase 4 assigns `PreparedLibraryDTO` to `service-provision-types.go` (Phase 4 line 68) and says it contains bounded summary/graph/tree (lines 100–103). Phase 3 says `service-library-types.go` reuses the MVP-A snapshot DTO (Phase 3 line 52). But the still-public `WorkspaceSnapshot(session) -> summary + graph + tree` interface (Phase 4 line 91; Phase 3 line 81) has no named return DTO or explicit owning file. Name the return type (for example `WorkspaceSnapshotDTO`) and state that `PreparedLibraryDTO` embeds/reuses it. |
| Phase 3 #9 — latest-history comparator differed by phase | **RESOLVED** | Phase 3 `history/latest.go` now owns greatest `updatedAt`, then lexicographically greatest conversation ID (lines 97–98), matching Phase 4 lines 41–42. |
| Phase 3 #11 — “history disabled means no toggle” was overbroad | **RESOLVED** | Phase 3 lines 99–100 explicitly scope “does not toggle” to automatic restoration and retain the Advanced enable/disable control. |
| Phase 3 #15 — prepared activation did not clearly span continuity reads | **RESOLVED** | Phase 3 lines 120–123 say continuity reads target the staged runtime and identity/session commit waits for the bounded continuity payload. Phase 2 dependency lines 162–164 carries the staged session into Phase 4 readiness before commit. |
| Phase 4 #4 — friendly name was repeated after approval | **RESOLVED** | Phase 4 now uses `BeginCreateLibrary(name)` followed by `PrepareCreateLibrary(locationCapability)` (lines 81–82). The second call cannot supply a divergent renderer-controlled name; the capability remains name-bound by requirements lines 33–35. |
| Phase 4 #9 — restore ordering lacked a compatible commit point | **REMAINS** | Phase 4 lines 116–119 correctly move all fallible snapshot/history/note reads before backend commit, but incorrectly place construction of the capability-bearing `ReadyLibraryState` before the commit that returns `ReadyCommitDTO` (lines 89, 106–108). This is the same remaining incompatibility as prior FAIL #8. Split prepared data from committed capability and state the post-commit combination is pure/synchronous and cannot fail. |
| Phase 4 #14 — MVP A bindings were not separable from Phase 3 | **RESOLVED** | Phase 4 lines 100–103 define base `PreparedLibraryDTO` for MVP A and a separate optional Phase 3 `PreparedContinuityDTO`; they explicitly state base bindings compile and run without continuity. Dependency lines 131–133 retain the A/B split. |

## Required Final Corrections

1. Replace the pre-commit “build `ReadyLibraryState`” step with construction of
   a capability-free prepared payload. Define `ReadyCommitDTO` to return the
   committed capability/access identity, then combine both values in one pure
   synchronous reducer dispatch.
2. Name and own the bounded `WorkspaceSnapshotDTO`, including whether
   `PreparedLibraryDTO` embeds it, and use that type in
   `WorkspaceSnapshot(session)`.

After those two edits, all eighteen previously non-passing producer/consumer
contracts would be resolved at plan level.
