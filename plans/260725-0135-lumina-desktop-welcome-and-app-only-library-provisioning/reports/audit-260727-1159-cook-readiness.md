---
title: "Cook-Readiness Audit: Welcome and App-Only Provisioning"
created: 2026-07-27
status: resolved
scope: "plan, current worktree, roadmap, architecture, and executable gates"
---

# Cook-Readiness Audit

## Summary

This report records the pre-correction audit. All 16 findings were applied to
the plan on 2026-07-27 and revalidated in
[the correction validation](./validation-260727-1205-cook-readiness.md).

The two existing Phase 1 RED test files were run as a diagnostic and failed for
their expected missing implementations. No Go test was run because the local
toolchain is Go 1.26.1, which is inside the affected range for the rooted-path
vulnerability the plan itself intends to block.

## Findings

- The dependency graph cannot be executed as written. The master says MVP B is
  `2 -> 3 -> Phase 4`, while Phase 3 imports `WorkspaceSnapshotDTO` from a file
  explicitly owned by Phase 4 MVP A. Record the real sequence as
  `1 -> 2 -> 4A -> 3 -> 4B -> 5`, and make Phase 4A an independently trackable
  phase or subphase rather than a prose gate.

- The plan no longer reflects the current worktree. Phase 1 RED artifacts now
  exist at `scripts/generate-desktop-contract.test.mjs`,
  `src/installer/workspace-definition.test.js`,
  `apps/desktop/internal/contract/testdata/core-generic-en.json`, and
  `src/scripts/schemas.test.mjs`, but the master still reports all five phases
  pending and 0/80 tasks complete. Cook must adopt and review these user-owned
  tests, not recreate or overwrite them, and the plan should mark the precise
  RED-test checkpoint.

- Phase 1's advertised test gate does not execute all Phase 1 tests. Root
  `npm test` runs only the installer suite; it does not discover
  `workspace-definition.test.js`, and it does not run
  `src/scripts/schemas.test.mjs`. Add explicit commands or update the owning npm
  scripts, then prove the CI job invokes the same gate.

- The fixed-clock installer conformance test has no defined injection seam.
  Phase 1 says it will install `core-generic-en` at a fixed instant, but the
  implementation steps only describe pure composers and preserve the public
  CLI clock. Specify the internal/test-only clock boundary and the exact
  canonical installer entry point used by the comparison.

- The installer-conformance step does not repeat the repository's highest-risk
  safety rule: installation must happen only in a dedicated external temporary
  directory. Add an explicit test harness precondition that refuses the repo
  root and all descendants before any installer invocation.

- The patched-Go gate lands too late. Phase 1 creates and tests platform
  `rootproof` code before Phase 2 pins the toolchain. The current local
  toolchain is Go 1.26.1, `go.mod` declares only `go 1.25`, and Desktop CI uses
  the floating selector `1.25.x`. Move the exact toolchain assertion/pin to the
  start of Phase 1 or a preflight phase, and make every rooted Go command use
  it. Official Go data marks versions before 1.25.12 and 1.26.0 through 1.26.4
  as affected:
  https://pkg.go.dev/vuln/GO-2026-4970

- The target policy contradicts itself for an existing empty directory. The
  master says collisions never merge, while Phase 2 explicitly provisions into
  an absent or empty target. Define whether an existing empty directory is an
  accepted destination, and if it is, require a distinct native confirmation
  after a fresh locked reclassification.

- Pre-manifest interruption is recoverable on disk but not discoverable from
  Welcome after restart. The app-local pending-created pointer is written only
  after manifest commit; an earlier crash leaves only an in-target journal.
  Define the user path back to that transaction—such as repeating the same
  Create destination, choosing the folder again, or persisting a bounded
  pre-commit recovery pointer before mutation.

- Phase 3 simultaneously allows an optional `wiki/...md` path and says its
  state/DTOs contain no paths and that all restoration DTOs are path-free.
  Replace this with one explicit rule: canonical/absolute paths stay backend
  only, while a bounded normalized workspace-relative artifact locator is
  allowed only in the private view store and in the minimum response that needs
  it.

- The promised “reading context” is broader than the stored contract. The
  master and roadmap promise the content or document being read, but Phase 3
  persists only one Markdown note path plus `chat|note|graph`; it defines no
  document/artifact kind, raw source identity, PDF page, or safe fallback.
  Either narrow the acceptance language to the last wiki note or define a
  versioned artifact locator covering every supported reading surface.

- The proposed visible recovery label violates the plan's own plain-language
  rule. `Reset recent-view state` exposes the banned internal term “state”.
  Keep that phrase only as an internal operation name and specify friendly copy
  such as “Clear recent activity” with a short consequence statement.

- The renderer-visible preparation token is not explicitly window-bound,
  expiring, single-use, or generation-bound. Those protections are defined for
  the location approval capability, but not for
  `CommitPreparedLibrary(preparationToken)` or
  `AbortPreparedLibrary(preparationToken)`. Bind both operations to the calling
  window and attempt generation, consume them once, and add replay,
  cross-window, stale-generation, and abort-after-commit tests.

- Phase 4's file inventory misses current raw-root and old-binding consumers.
  `node-inspector.tsx` imports Workspace/Tools DTOs and renders the root;
  `note-content.ts` imports Graph DTOs and passes raw backend error text into the
  UI. Both must be owned by the migration and covered by the no-root/no-raw-error
  gate; otherwise unregistering services will leave TypeScript breakage or
  stale technical UI behavior.

- Phase 5's one-to-two-day estimate does not cover three native package jobs,
  platform-specific security tests, three-language documentation, and fresh
  installed-GUI acceptance on macOS, Windows, and Linux. Separate automated
  engineering completion from human/device acceptance, name the acceptance
  owner and available machines, and estimate waiting/retry time independently.

- “Install and launch on every OS” is undefined for macOS. The current workflow
  launches the built `.app` in place, while Linux and Windows install packages.
  Define the macOS artifact and installation action that satisfy the gate, or
  rename the matrix row to package-and-launch where installation is not
  actually proven.

- Documentation ownership is incomplete. Phase 5 updates Desktop README and
  the three user guides, but the root English/Vietnamese/Chinese READMEs still
  advertise Desktop as future work. The English user guide also states that
  Lumina-Wiki is not a separate chat app. Add all three root READMEs to the
  evidence-backed synchronization set and explicitly replace conflicting
  guidance.

## Verification Performed

- `ak plan validate ... --json --no-interactive`: pass.
- `ak plan status ... --json`: five pending phases, 80 unchecked tasks.
- `go version`: `go1.26.1 darwin/arm64`; version check only.
- Phase 1 RED tests: two expected failures caused by the missing generator and
  workspace-definition modules.
- Source review: roadmap, project context, architecture, all five phase files,
  umbrella plan, current Wails registration/composition, frontend consumers,
  package scripts, Go module, and Desktop workflow.

## Applied Disposition

The executable order is now `1 -> 2 -> 3 (MVP A) -> 4 (MVP B) -> 5`.
Cook resumes Phase 1 from the existing RED artifacts, pins the patched Go
toolchain before rooted work, and uses the corrected test and acceptance gates.

## Unresolved Questions

None. This plan restores the last supported wiki note; original-document/PDF
page restoration remains later. An existing empty folder requires distinct
native confirmation and locked reclassification. Automated cook evidence and
human release acceptance are separate; the project release owner signs the
per-OS GUI reports when candidate machines are available.
