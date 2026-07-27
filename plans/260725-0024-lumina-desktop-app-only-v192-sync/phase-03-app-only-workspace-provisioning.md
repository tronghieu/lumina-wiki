---
phase: 3
title: "App-only workspace provisioning"
status: todo
priority: P1
effort: "3-4d"
dependencies: [2]
---

# Phase 3: App-only workspace provisioning

## Context Links

- [Phase 2](./phase-02-generated-workspace-contract.md)
- [`apps/desktop/internal/workspace/service.go`](../../apps/desktop/internal/workspace/service.go)
- [`apps/desktop/frontend/src/features/workspace/use-workspace.ts`](../../apps/desktop/frontend/src/features/workspace/use-workspace.ts)

## Overview

Let a user select or create a folder and have Desktop provision, validate,
activate, remember, and reopen a Lumina workspace without a CLI or terminal.

This Welcome/provisioning subset is executed by
`../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/`.
Its authoritative decisions are `core-generic-en`, user-entered friendly name,
opaque recent IDs with roots only in the private identity registry, explicit
native location approval, and restart identity confirmation. Do not reapply the
older folder-name/OS-locale/recent-root assumptions below.

## Requirements

- Functional: distinguish empty, valid Lumina, and unsafe non-empty folders;
  provision an empty folder with core defaults; activate it immediately; remember
  recent workspaces; reopen the last valid workspace at launch.
- Non-functional: atomic creation, crash-safe rollback, Unicode/cross-platform
  paths, and no overwrite of existing content.

## Architecture

A native provisioner extracts the verified embedded payload into a staging area,
commits managed files atomically, writes state last, and hands the canonical root
to the capability-bound session. The private identity registry alone retains
canonical roots; bounded app state retains only opaque workspace IDs and
semantic continuity.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/provisioner/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/provisioner/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workspace/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/main.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/workspace/use-workspace.ts`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/workspace/workspace-rail.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/app/app-shell.tsx`

## Implementation Steps

1. Write RED table tests for cancellation, empty/non-empty folders, valid
   existing workspaces, spaces/Unicode, permission errors, symlinks, interrupted
   commits, and rollback.
2. Implement native folder selection and create-folder requests with explicit
   result states rather than treating cancellation as an error.
3. Follow the focused plan's materialized `core-generic-en` profile and
   user-entered friendly name; later locale profiles remain a separate product
   decision.
4. Validate the completed workspace, activate it through the existing session
   capability, and refresh the tree/graph.
5. Persist bounded opaque recent IDs/view state without duplicating roots; reopen
   only after private identity and structure validation.

## Tests Before

- [ ] Selecting an empty folder currently cannot create a working workspace.
- [ ] Non-empty non-Lumina folders and symlink escapes are rejected.
- [ ] A simulated mid-commit failure leaves no partially trusted workspace.

## Refactor

Share canonical-root and workspace-identity checks between open and provision
flows; keep filesystem mutation isolated in the provisioner.

## Tests After

- [ ] One folder choice produces and opens a valid core workspace.
- [ ] Existing Lumina workspaces open without mutation.
- [ ] Missing or changed roots resolved from recent opaque IDs return to Welcome safely.
- [ ] Provisioning passes with external runtimes unavailable.

## Regression Gate

Run provisioner/workspace Go tests and workspace frontend tests before the full
Desktop Go and frontend suites.

## Success Criteria

- [ ] First-run user needs only the Desktop app and a folder choice.
- [ ] No pre-existing file is overwritten or deleted.
- [ ] Reopening the app restores the last valid workspace.

## Risk Assessment

Cross-volume renames and Windows file locking can weaken atomicity. Stage on the
target volume and keep a rollback journal with explicit recovery tests.

## Security Considerations

Canonicalize roots, reject traversal and escaping symlinks, set private state
permissions, and never trust a stored recent path without revalidation.
