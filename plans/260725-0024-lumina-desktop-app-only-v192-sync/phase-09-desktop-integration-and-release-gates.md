---
phase: 9
title: "Desktop integration and release gates"
status: todo
priority: P1
effort: "2-4d"
dependencies: [7, 8]
---

# Phase 9: Desktop integration and release gates

## Context Links

- [Main plan](./plan.md)
- [`apps/desktop/README.md`](../../apps/desktop/README.md)
- [`.github/workflows/desktop.yml`](../../.github/workflows/desktop.yml)
- [`docs/project-roadmap.md`](../../docs/project-roadmap.md)

## Overview

Integrate the app-only flows into a coherent non-technical UX and prove the
packaged application works without external runtimes on macOS, Windows, Linux.

The focused Welcome/provisioning plan
`../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/`
owns only first-run/Create/Open/restore UI and its quality/package evidence.
This phase retains check/fix, filing, ranking, long-source, and final combined
release integration. Track those acceptance subsets independently.

## Requirements

- Functional: clear create/open/manage/check/correct/file/rank/process actions,
  progress/cancel/recovery states, regenerated Wails bindings, and current docs.
- Non-functional: accessibility, zero telemetry, release-package integrity,
  cross-platform installation/launch, and no runtime Node/npm/Python dependency.

## Architecture

Frontend actions call only capability-bound native services. CI first verifies
the generated contract, then runs unit/conformance/integration tests, packages
each target, and launches smoke scenarios with external runtimes removed from
`PATH`.

## Related Code Files

- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/App.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/app/accessibility-contract.test.mjs`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/bindings/`
- Modify: `/Users/plateau/Project/lumina-wiki/.github/workflows/desktop.yml`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/README.md`
- Modify: `/Users/plateau/Project/lumina-wiki/docs/project-roadmap.md`
- Modify: `/Users/plateau/Project/lumina-wiki/docs/system-architecture.md`

## Implementation Steps

1. Write RED journey tests for first launch/create, reopen, update, check/fix,
   answer filing, ranking, long-source cancellation/resume, and failure recovery.
2. Integrate actions and state transitions into the current shell; regenerate
   bindings and provide keyboard/focus/status semantics.
3. Split the existing immutability contract into read-only operations and
   explicitly approved transactional writes with exact allowed-file assertions.
4. Add contract-drift and conformance gates. Until a packaged desktop
   automation boundary exists, use composed native lifecycle tests plus real
   package install/launch plus commit/digest-bound manual GUI evidence for each
   OS; do not call that an automated packaged creation smoke.
5. Update only affected user/setup/architecture/roadmap docs; synchronize
   languages wherever the root user guides describe changed behavior.

## Tests Before

- [ ] Packaged app fails create/check/process smoke when external runtimes vanish.
- [ ] Journey tests expose disconnected controls or unclear recovery paths.
- [ ] Approved write workflows have exact mutation-boundary assertions.

## Refactor

Remove obsolete Node-path settings, dead bridge methods, and duplicated UI state
only after replacement journeys and bindings are green.

## Tests After

- [ ] All first-run and returning-user journeys pass.
- [ ] Screen-reader labels, focus order, keyboard actions, progress, and error
  recovery pass accessibility tests.
- [ ] macOS, Windows, and Linux evidence distinguishes composed lifecycle,
      package install/launch, fresh digest-bound manual GUI journeys, and later
      native Check; no evidence class is used to claim another.
- [ ] No network occurs without an explicitly enabled AI/research action.

## Regression Gate

Run `npm run test:all`, `npm run ci:idempotency`, `npm run ci:package`,
`cd apps/desktop && go test ./...`, frontend tests/build, contract/conformance
checks, and cross-platform package smoke jobs.

## Success Criteria

- [ ] The accepted v1.7-v1.9.2 capability matrix is fully green.
- [ ] A non-technical user can operate Lumina entirely through Desktop.
- [ ] Release artifacts are self-contained, documented, and recover safely.

## Risk Assessment

Cross-platform dialogs, locking, permissions, and packaging can differ despite
unit tests. Require real packaged smoke jobs rather than development-mode proof.

## Security Considerations

Verify package provenance/signing requirements, retain zero telemetry, prevent
secret leakage, and audit every native mutation boundary before release.
