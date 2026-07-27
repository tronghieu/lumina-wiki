---
date: 2026-07-27
session: welcome-provisioning-implementation
status: in-progress
type: work-history
---

# Journal: 2026-07-27 — Welcome and App-Only Provisioning Implementation

## Context

This entry records the implementation history for the Desktop Welcome and
app-only library provisioning slice. It is not current product or release
authority. Current status and acceptance boundaries remain in the
[focused plan](../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/plan.md),
[Phase 5](../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/phase-05-packaged-runtime-and-cross-platform-gates.md),
and the [sync-back report](../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/reports/project-manager-260727-1821-sync-back.md).

## Outcome

Phases 1–4 reached implementation and local-gate completion. Phase 5 reached
local engineering evidence but remains in progress: workflow definitions are
not native job results, local service tests are not installed-GUI acceptance,
and no release or signed-distribution claim was made.

The working change spans 107 tracked files with 4,379 insertions and 2,176
deletions, plus 74 new files. These figures describe the uncommitted working
tree at journal time, not a released artifact.

## What Happened

1. **Phase 1 — generated contract and payload.** A deterministic checked-in
   Desktop contract now derives the `core-generic-en` payload from shared
   installer authorities. The Go loader verifies versions, bounds, paths,
   hashes, and the root digest; materialization supplies runtime-specific
   values without requiring Node, npm, Python, or the CLI. Go 1.25.12 is pinned
   and checked before rooted Desktop work.
2. **Phase 2 — secure native provisioning.** Creation now classifies and
   reclassifies destinations under a cross-process lock, requires separate
   approval for an existing empty directory, stages on the target volume, and
   publishes with platform no-clobber primitives. A strict immutable journal
   and private pending-operation record support fail-closed recovery. Existing
   compatible libraries open read-only through backend-owned root proofs and
   access modes.
3. **Phase 3 — Welcome/Create/Open MVP A.** The renderer moved from raw paths
   and old root-taking bindings to an accessible Welcome state machine and
   opaque, window-bound, single-use preparation capabilities. Create and Open
   share a prepared snapshot/commit pipeline; empty libraries render honestly.
   Raw-root Check/Import and related renderer services remain unavailable.
4. **Phase 4 — recents and continuity MVP B.** Private bounded app state stores
   at most 12 opaque library IDs and a validated relative wiki-note locator.
   Restore revalidates identity, distinguishes history failure classes, and
   restores the latest conversation, supported note, and semantic focus without
   sending canonical roots to React.
5. **Phase 5 — engineering gates.** CI now pins the exact Go toolchain, checks
   generated contract drift, runs focused native lifecycle/filesystem gates,
   packages on all three operating systems, installs Windows/Linux artifacts,
   launches a copied macOS app, uses clean app config, and retains sanitized
   failure diagnostics. A composed native lifecycle test covers Unicode/space
   creation with external runtimes absent, process reconstruction and identity
   confirmation, note and history continuity, immutable existing-library Open,
   unavailable/replaced recents, and absence of raw renderer surfaces.

## TDD Review and Fixes

- Post-commit behavior was bounded so cleanup, advisory-marker, or prior-runtime
  close failures cannot report that an already committed library/session was
  rolled back. Pre-commit persistence failures still leave the prior session
  current, and replay/stale transitions fail closed.
- The provisioning and private-state paths verify held roots and current
  entries before commit, sync completed files before publication, commit the
  manifest last, and sync containing directories where the platform supports
  it. Tests distinguish a pre-commit failure from post-rename durability
  uncertainty; the identity registry treats unsupported post-commit directory
  sync as best effort rather than reversing a mandatory rename.
- Review called out note-read TOCTOU. Restoration now validates a bounded
  relative locator, reads through the staged trusted root, and carries that
  prepared note into the ready payload instead of giving React a root for a
  second read. This is not claimed as an atomic snapshot of a library being
  edited concurrently; individual note bytes may change after the bounded read.
- The CI matrix was expanded to exercise native app-private permissions,
  filesystem identity, locks, symlink/junction/reparse defenses, and lifecycle
  behavior on the owning OS. Windows owner+SYSTEM DACL and 128-bit identity
  evidence still require the Windows job result; YAML presence is not counted
  as execution.
- The lifecycle test was strengthened from create/open shape checks to write a
  real note and history record, reconstruct the service, confirm identity,
  restore both, and prove a later existing-library Open changes no name, type,
  mode, or byte.
- Frontend TDD added cross-library isolation and stale-token coverage. A newer
  activation aborts an older prepared token exactly once, stale reducer results
  cannot replace the current library, history is accepted only when its
  conversation ID still matches the prepared continuity result, and failed or
  stale restoration clears prior history instead of leaking it across
  libraries.

## Verification

| Gate | Local evidence |
|---|---:|
| Desktop contract tests | 23/23 |
| Desktop workflow contract tests | 4/4 |
| Contract drift check | Passed |
| Exact Go 1.25.12 preflight | Passed |
| Go package tests | `go test ./...` passed |
| Focused Go race gate | Passed |
| Frontend tests | 109/109 |
| Frontend production build | Passed |
| Accessibility | 9/9 |
| Visual | 8/8 |
| Focused plan checklist | 83/90; 4/5 phases complete |

Local macOS linker deployment-version warnings were non-fatal. The verification
counts above come from the reconciled implementation, reviewer, tester, and
project-management evidence; they do not imply the pending native package jobs
ran successfully.

## Final macOS Package Evidence

Later on 2026-07-27, Wails `v3.0.0-alpha.78` with Go `1.25.12` successfully
packaged the dirty local worktree. The app passed strict deep ad-hoc code-sign
verification, and a copy placed in a fresh temporary Applications-like
directory remained alive for the five-second smoke window. Its binary SHA-256
was `4276b3bd55a9687f0ec35ff6a015d4e0c287fc3ccb46c4b76cda4093b532f1bf`;
the captured runtime log was empty (0 bytes). The full local record is the
[automated macOS package smoke report](../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/reports/automated-macos-package-smoke-260727-1837.md).

This proves local macOS packaging, ad-hoc signature integrity, copied-app
launch, and bounded process survival only. Existing Desktop configuration was
present, so clean first launch was not proven. The worktree was uncommitted, so
the digest is not eligible for release acceptance. GitHub Actions run
`30112439821` was green at the older base commit
`f429421e0b66541ed6f622fb38363e7237419e7b`; it is invalid as evidence for the
current source state.

## Decisions and Impact

| Decision | Impact |
|---|---|
| Share a generated Desktop contract with installer authorities | Packaged Create has CLI payload parity without an external runtime dependency |
| Keep roots, proofs, and write authority native | React cannot choose or reuse arbitrary workspace paths |
| Publish no-clobber with manifest last and recover from immutable state | Collisions and interruption fail safely without merge, overwrite, or cleanup of unknown content |
| Stage readiness before the session swap | A failed preparation leaves the current library active |
| Keep recents/history private and workspace-scoped | Relaunch continuity does not expose paths or cross library boundaries |
| Separate local engineering, native package execution, human GUI acceptance, and signing | Completion claims remain tied to the evidence each gate actually proves |

## Next

- Obtain successful macOS, Windows, and Linux native package-job results,
  including their platform filesystem, lock, identity, permission, and clean
  launch rows.
- Have the release owner perform installed-GUI Create/Open/relaunch acceptance
  and add one commit-and-artifact-digest-bound report per operating system.
- Reconcile the remaining Phase 5 documentation checks, then handle
  signing/notarization as a separate distribution gate.
- AgentWiki publishing was skipped: no already-configured noninteractive
  AgentWiki CLI or MCP capability was available, and none was installed or
  configured.

## Unresolved Questions

None. The remaining work is evidence and release execution, not an unresolved
product decision.

## 2026-07-28 Native Candidate Addendum

Candidate `83d7e076156e40ff197867081ed744635bea53e6` passed Desktop run
[`30291654296`](https://github.com/nguyennguyenit/lumina-wiki/actions/runs/30291654296):
Quality plus Ubuntu, macOS, and Windows package jobs all succeeded.

Windows-native TDD exposed and fixed three concrete issues without weakening
the gates:

- active Administrators ownership is accepted only when the process token has
  the enabled, non-deny-only Administrators group, while exact DACL entries
  remain current-user+SYSTEM;
- app-private lock files are hardened and validated while holding the exact
  kernel lock, including the paused-creator/winning-contender schedule;
- settings and history no longer rewrite the shared app directory with
  incompatible Windows ACLs; both delegate to the same handle-based
  protect-and-final-validate policy.

The composed lifecycle now proves immutable Open in a child test process while
the parent remains alive after service shutdown, so leaked parent handles still
fail the gate. The package jobs separately prove package/install or
clean-location copy and bounded launch. Artifact API digests and inner package
hashes are recorded in the
[automated native package report](../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/reports/automated-native-package-gates-260728-0105.md).

Automated cook work is complete. Phase 5 and this journal remain in progress
because the release owner has not yet supplied the three candidate- and
artifact-digest-bound installed-GUI Create/Open/relaunch reports. Signing and
notarization remain separate.
