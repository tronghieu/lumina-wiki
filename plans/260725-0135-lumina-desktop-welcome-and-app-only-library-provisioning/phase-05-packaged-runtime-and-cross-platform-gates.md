---
title: "Phase 5: Packaged Runtime and Cross-Platform Gates"
status: in-progress
effort: "2-3d engineering + external release acceptance"
---

# Phase 5: Packaged Runtime and Cross-Platform Gates

## Overview

Turn unit/integration confidence into packaged macOS, Windows, and Linux
evidence for first launch, create, open, close/relaunch, recovery, and absence
of external runtime dependencies. Synchronize durable product docs and the
umbrella plan only after evidence passes.

Context: [focused scout](./reports/phase-05-focused-scout.md).

## Requirements

- [x] Desktop quality runs contract generation/conformance, Go/race, frontend,
      build, visual, and accessibility gates under patched Go.
- [x] Package jobs build and launch the real application on each OS, not only
      cross-compile it. Windows/Linux install their produced installers;
      macOS copies the `.app` to a fresh Applications-like directory and
      launches that copy. DMG/signing/notarization remain release work.
- [x] Native composed lifecycle tests exercise clean app config, external
      runtimes absent, Unicode/space creation, process reconstruction,
      identity confirmation, continuity restoration, missing library, and Open
      immutability; real packaged artifacts separately prove installer-based or
      clean-location launch behavior defined by the platform row below.
- [x] Automated engineering gates are cook-owned. Manual installed-GUI
      Create/Open/close/relaunch is a separate human release-owner gate and is
      not included in the engineering estimate.
- [ ] The project release owner records one
      `reports/package-acceptance-<os>-<commit>-<artifact-digest>.md` per OS.
      Any source or artifact-digest change invalidates that OS result.
- [ ] Windows runner covers junction/reparse behavior, 128-bit identity and
      lock contention; Linux/macOS cover native symlink/permissions/durability
      semantics available to their filesystems.
- [x] Feature gates distinguish package/install/runtime correctness from the
      separate signed-distribution release gate.
- [x] Docs describe app-only user behavior in everyday language and retain
      canonical skill IDs where referenced.

## Files

| Path | Action |
|---|---|
| `.github/workflows/desktop.yml` | pin patched Go; add contract, race, packaged scenario and diagnostics gates |
| `apps/desktop/internal/workspace/*_test.go` | extend platform-native provision/recovery cases where build tags require |
| `apps/desktop/internal/ai/workspaceid/*_test.go` | extend Windows identity/reparse and restart cases |
| `apps/desktop/frontend/tests/visual/**` | retain deterministic UI/a11y evidence from Phase 4 |
| `apps/desktop/internal/integration/library-lifecycle_test.go` | create real composed lifecycle test using embedded assets and clean private config |
| `apps/desktop/README.md` | update user-visible app-only/create/restore scope and developer prerequisites |
| `docs/user-guide/{en,vi,zh}.md` | update first library, local/private state, recovery, read-only existing libraries, and temporary Check/Import limits in each maintained language |
| `README.md`, `README.vi.md`, `README.zh.md` | replace Desktop-as-future and CLI-only guidance consistently |
| `docs/desktop-app-roadmap.md` | mark only evidence-backed Welcome/provisioning outcomes |
| `plans/260725-0024-lumina-desktop-app-only-v192-sync/plan.md` | record focused-plan completion dependency/status; do not duplicate execution detail |
| `plans/260725-0135-.../reports/package-acceptance-<os>-<commit>-<digest>.md` | create human-owned digest-bound GUI evidence |

## Gate Matrix

### MVP A gate

Runs as soon as Phases 1-3 pass. Its automated gate
requires contract/conformance, containment/no-overwrite, composed Create/Open,
real package/clean-location launch, and empty-library visual/a11y. Human release
acceptance adds fresh digest-bound manual Create/Open evidence on macOS,
Windows, and Linux. It does not wait for recents or continuity.

### MVP B gate

Adds Phase 4 continuity: recents, restart confirmation, atomic
latest history, note/focus restore, missing/replaced recovery, and the full
matrix below.

| Gate | macOS | Windows | Linux |
|---|---:|---:|---:|
| Build/package/clean-location 5s launch | copied `.app` | installer | installer |
| Clean first launch Welcome | required | required | required |
| Create `core-generic-en` at Unicode/space path | required | required | required |
| External Node/npm/Python/CLI unavailable | required | required | required |
| Close/relaunch and continuity restore | required | required | required |
| Missing/replaced recent recovery | required | required | required |
| Existing Open byte/type/name snapshot | required | required | required |
| Symlink/junction/reparse escape | symlink | junction/reparse | symlink |
| Cross-process creator/lock crash | required | required | required |
| 128-bit filesystem identity | n/a | required or fail closed | n/a |
| App-state private ACL | platform mode | owner+SYSTEM DACL | platform mode |
| Direct raw-root/Check/Import calls unavailable | required | required | required |
| Axe/visual/responsive | Chromium quality job | compile/package | compile/package |

Do not ship hidden production bypasses, fake libraries, or test-only trust
flags. Browser fixtures prove visuals only; composed native tests prove service
lifecycle; package jobs prove package/clean-location launch; human evidence
covers the remaining installed-GUI interaction gap.

## Dependency Map

MVP A: `1 + 2 + 3 -> automated A gate`. MVP B: `A + 4 -> automated full
matrix`. Human release acceptance follows each desired release candidate.
Failed evidence reopens the owning phase; tests are not weakened in Phase 5.

## TDD Execution

### Tests Before

1. Extend workflow/harness contract tests so a launch-only artifact is
   insufficient.
2. Add scenario failures for external runtime discovery, partial trusted
   library, path disclosure, cross-library restore, and mutated existing Open.
3. Prove each platform job uploads logs/screenshots/app state diagnostics on
   failure without uploading workspace content, secrets, or absolute paths.

### Implement

1. Pin patched Go in quality/package jobs and add root contract dependency
   installation/cache when required.
2. Add composed native lifecycle integration using real app services and
   embedded assets.
3. Run the matrix with clean app config and sanitized PATH/environment; on
   macOS copy the bundle to a fresh temp Applications-like directory first.
4. Add platform-native security/recovery cases and artifact retention.
5. Update docs and umbrella plan only from verified outcomes.

### Refactor

- Share scenario definitions without pretending cross-compilation proves native
  filesystem behavior.
- Keep signing/notarization as an explicit later release gate.
- Keep generated asset drift in quality, not every package job.

### Tests After

```sh
npm run test:all
npm run ci:idempotency
npm run ci:package
GOTOOLCHAIN=go1.25.12 node scripts/check-desktop-go-version.mjs
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go test ./...
GOTOOLCHAIN=go1.25.12 go test -race ./internal/workspace ./internal/appstate ./internal/ai ./internal/ai/workspaceid
cd frontend
npm run test
npm run build
npm run test:a11y
npm run test:visual
```

Record automated MVP A independently when its three package jobs pass. Record
automated MVP B only after continuity/full-matrix evidence also passes.
Installed-GUI release acceptance remains visibly pending until a human release
owner signs all three digest-bound reports.

Local macOS package construction, strict ad-hoc signature verification, fresh
Applications-like copy, and five-second process survival passed on 2026-07-27.
This is not clean-first-launch or release-owner evidence because the machine
already had app configuration and the worktree was uncommitted. See
[automated macOS package smoke](./reports/automated-macos-package-smoke-260727-1837.md).

### Regression Gate

- Root npm package contents remain unchanged except the intentional shared
  installer definition.
- Installer idempotency still does not touch generated `wiki/` or `raw/`.
- Composed lifecycle proves create/restore with external runtimes unavailable;
  native clean-location launch and human digest-bound GUI evidence cover
  explicitly separate boundaries.
- Signed distribution is not claimed complete by these feature gates.

## Success Criteria

- [ ] Quality and three native package jobs pass under a non-vulnerable Go
      toolchain.
- [ ] Automated cook completion records composed lifecycle and clean-location
      package launch separately on all three platforms.
- [ ] Release acceptance remains pending until fresh digest-bound human GUI
      evidence covers Create/Open/relaunch on all three platforms.
- [x] Failure diagnostics are useful without leaking user paths/content.
- [x] Roadmap, Desktop README, and umbrella plan match actual behavior.

## Risks and Rollback

- GUI automation can become flaky: prefer bounded service-level package hooks
  plus a small user-path smoke, and retain diagnostics.
- OS sandbox/signing may alter directory access: record as release blockers,
  not silently weaken provisioning.
- If a platform cannot prove a safe no-clobber publisher or identity
  requirements, block implementation readiness and request a product decision;
  do not ship an unsafe fallback.
