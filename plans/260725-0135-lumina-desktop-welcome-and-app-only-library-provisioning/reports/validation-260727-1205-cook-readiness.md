---
title: "Correction Validation: Welcome and App-Only Provisioning"
created: 2026-07-27
status: ready
scope: "corrected plan contracts and executable cook boundary"
---

# Correction Validation

## Outcome

The corrected plan is ready for automated cook. Its executable order is
`1 -> 2 -> 3 (MVP A) -> 4 (MVP B) -> 5`; installed-GUI release acceptance is
a separate human-owned gate and does not pretend to be an automated test.

This report supersedes the 2026-07-25 validation log as the current readiness
authority. Earlier audit and red-team reports remain historical evidence.

## Corrections Verified

- Phase 3 now owns independently shippable Welcome/Create/Open and the base
  `WorkspaceSnapshotDTO`; Phase 4 adds recents and continuity without a cycle.
- Phase 1 starts with an exact `go1.25.12` preflight, owns the Desktop
  `go.mod`/CI pin, defines the fixed-clock seam, and confines installer
  conformance to a verified external temporary directory.
- Phase 1 names every focused JavaScript and Go gate and adopts existing
  worktree tests in place.
- An existing empty destination requires a separate native confirmation after
  a fresh locked reclassification; collisions still never merge or overwrite.
- `PendingLibraryOperation` is persisted before target mutation and remains
  discoverable through a safe recovery card.
- Location and preparation capabilities are expiring, one-use, calling-window
  and attempt-generation bound, with replay and stale-token coverage.
- Canonical and absolute paths stay backend-only. MVP B permits only a bounded
  private `wiki/...md` locator and restores the last supported wiki note.
- Visible recovery copy is “Clear recent activity”; original-document and PDF
  page restoration remain explicitly deferred.
- The renderer migration owns the previously missing raw-root consumers and
  keeps Check/Import unavailable until native capability replacements exist.
- Automated packaging gates are distinct from per-OS human GUI reports.
  macOS uses a copied app in a fresh Applications-like location; Windows and
  Linux exercise their installers. Signing and notarization remain later.
- Root English, Vietnamese, and Chinese README guidance is included in the
  evidence-backed documentation synchronization set.
- Effort is reconciled to 18–24 engineering days plus external release
  acceptance.

## Verification Evidence

- `ak plan validate ... --json --no-interactive`: valid, no errors.
- `ak plan status ... --json`: five pending phases, 90 unchecked tasks.
- All five phase links and both current review links resolve.
- Active-plan stale-term sweep: no old phase filenames, dependency wording,
  pending-created API names, obsolete estimates, or technical recovery copy.
- Every planned Go test/build command is explicitly pinned to
  `GOTOOLCHAIN=go1.25.12`.
- Focused current baseline:
  `node --test scripts/generate-desktop-contract.test.mjs
  src/installer/workspace-definition.test.js src/scripts/schemas.test.mjs`
  passed 24/24.
- `git diff --check` for this plan directory: pass.
- Local `go version` is `go1.26.1 darwin/arm64`. No rooted Go test was run
  because this version is within the affected range addressed by the Phase 1
  preflight.

## Cook Boundary

Cook starts at Phase 1 and must pass the exact Go toolchain check before any
rooted Go test. It preserves and reviews existing worktree tests rather than
recreating them. Automated completion ends after Phase 5 evidence; the release
owner separately signs the installed-GUI reports on available macOS, Windows,
and Linux machines.

## Unresolved Questions

None.
