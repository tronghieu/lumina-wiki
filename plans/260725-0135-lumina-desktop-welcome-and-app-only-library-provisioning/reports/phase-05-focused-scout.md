---
title: "Phase 5 Focused Scout: Packaged Runtime and Cross-Platform Gates"
created: 2026-07-25
status: complete
scope: "Quality, native packaging, packaged launch, platform filesystem evidence, and durable documentation"
---

# Phase 5 Focused Scout

## Evidence

- `.github/workflows/desktop.yml:13-57` runs frontend, visual, accessibility,
  Go, and race gates only on macOS.
- `.github/workflows/desktop.yml:70-194` packages on Ubuntu, macOS, and Windows,
  installs Linux/Windows artifacts, and proves only a five-second launch.
- Both jobs select floating `go-version: "1.25.x"` at
  `.github/workflows/desktop.yml:24,85`; the plan requires a reviewed patched
  release because GO-2026-4970 is fixed only in Go 1.25.12/1.26.5.
- `apps/desktop/frontend/playwright.config.ts:5-8` stores snapshots under an
  older plan directory; Phase 4 baselines must have one intentional owner.
- `apps/desktop/frontend/package.json:7-11` already owns type/unit/build,
  accessibility, and visual commands.
- `apps/desktop/README.md:67-82` still describes Desktop as a companion for
  existing workspaces and documents the Node-backed Check.
- `apps/desktop/README.md:120-126` accurately separates current package/launch
  evidence from signed distribution.

## Exact Inventory

| File | Change |
|---|---|
| `.github/workflows/desktop.yml` | Pin Go, install/check root contract inputs, extend race packages, add native scenario steps and privacy-safe diagnostics. |
| `apps/desktop/frontend/playwright.config.ts` | Move new accepted baselines to this plan or a durable frontend-owned visual directory; do not keep writing to an unrelated completed plan. |
| `apps/desktop/frontend/tests/visual/accessibility.spec.ts` | Run Welcome/recovery/empty/restore axe and keyboard gates. |
| `apps/desktop/frontend/tests/visual/desktop-shell.spec.ts` | Run dark/light and responsive snapshots. |
| `apps/desktop/frontend/tests/visual/fixtures/wails-bridge.ts` | Keep deterministic browser-only state; never use it as package evidence. |
| `apps/desktop/internal/workspace/provision-platform_test.go` | Add native OS link/junction/reparse, locking, permissions, and hard-link capability scenarios with build-tag helpers only where required. |
| `apps/desktop/internal/ai/workspaceid/signature-windows_test.go` | Prove 128-bit FileIdInfo or fail-closed behavior on a Windows runner. |
| `apps/desktop/internal/integration/library-lifecycle_test.go` | Exercise real composed contract/provision/activate/app-state/reopen services from a clean config base with external runtime PATH removed. |
| `apps/desktop/README.md` | Update shipped app-only behavior, development-only prerequisites, and deferred native Check/signing boundaries. |
| `docs/desktop-app-roadmap.md` | Mark only evidence-backed outcomes. |
| `plans/260725-0024-lumina-desktop-app-only-v192-sync/plan.md` | Synchronize dependency/status without copying phase detail. |

Do not add a production-only secret environment switch that bypasses Welcome,
identity confirmation, validation, or filesystem checks. The existing packaged
binary launch plus real composed lifecycle integration under the same source
and embedded assets is the smallest maintainable gate available without adding
a Wails desktop automation framework. Label this evidence honestly: it proves
native services and packaged launch, not full installed-GUI click automation.

## Interfaces and Flow

```text
quality:
  contract check -> Go/unit/race -> frontend unit/build -> axe/visual

native matrix:
  native platform integration -> Wails bindings -> package -> install where
  supported -> clean-config launch -> retain sanitized diagnostics
```

- Integration test creates a Unicode/space path under a test-owned temp parent,
  removes Node/npm/Python/CLI from `PATH`, closes and reconstructs stores and
  services, then proves identity-confirmed restore and semantic state.
- Existing-library tests take recursive names/types/bytes snapshots.
- Missing/replaced paths return safe typed states and never load old
  conversation/artifact data.
- Native OS tests, not cross-compiles, own filesystem assertions.
- Workflow logs may contain test-owned temporary paths but uploads must not
  include library content, credentials, prompts, or app-local history.

## TDD Matrix

| Gate | RED assertion |
|---|---|
| Contract | Drift or installer conformance failure stops quality before Go. |
| Toolchain | Workflow cannot float below patched Go. |
| Clean lifecycle | Composed services create/activate/reconstruct/restore with external tools absent. |
| Platform | Symlink/junction/reparse escape, hard-link unsupported, and lock contention fail closed. |
| Identity | Windows FileIdInfo is 128-bit or reusable signature is unavailable. |
| Package | Each native artifact installs where supported and stays running for launch smoke. |
| UX | Welcome/recovery/empty/restored states pass axe, keyboard and approved snapshots. |
| Privacy | Diagnostics exclude generated library/app-state content and secrets. |
| Documentation | README does not call Node-backed Check part of app-only runtime. |

## Commands

```sh
npm run test:all
npm run ci:idempotency
npm run ci:package
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go test ./internal/integration ./...
GOTOOLCHAIN=go1.25.12 go test -race ./internal/workspace ./internal/appstate ./internal/ai ./internal/ai/workspaceid
cd frontend
npm run test
npm run build
npm run test:a11y
npm run test:visual
```

Require successful native `Desktop / Package` jobs on Ubuntu, macOS, and
Windows. Cross-compilation is compile evidence only.

## Risks

- A five-second launch plus backend integration is not end-to-end installed-GUI
  automation; do not claim clicks, native dialog behavior, or focus restoration
  from that evidence.
- Floating Go versions can temporarily reintroduce a vulnerable `os.Root`.
- Browser fixtures can conceal binding or packaged-runtime failures; keep them
  visual-only.
- Signing, notarization, sandbox permissions, and distribution are release
  gates outside this feature plan.

Status: DONE_WITH_CONCERNS

Summary: Existing CI has strong source/visual/package-launch gates but no
packaged lifecycle scenario. Add native composed lifecycle and platform tests,
retain the real package/install/launch matrix, and describe their evidence
without overstating full GUI automation.

Concerns/Blockers: A true installed-GUI create/reopen test would require a new
desktop automation strategy. This plan should not add one solely to satisfy an
overbroad claim.
