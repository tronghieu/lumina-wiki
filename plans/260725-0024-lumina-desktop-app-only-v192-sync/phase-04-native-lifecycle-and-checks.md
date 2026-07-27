---
phase: 4
title: "Native lifecycle and checks"
status: todo
priority: P1
effort: "4-5d"
dependencies: [3]
---

# Phase 4: Native lifecycle and checks

## Context Links

- [Phase 3](./phase-03-app-only-workspace-provisioning.md)
- [`src/scripts/lint.mjs`](../../src/scripts/lint.mjs)
- [`src/installer/commands.js`](../../src/installer/commands.js)
- [`apps/desktop/internal/tools/service.go`](../../apps/desktop/internal/tools/service.go)

## Overview

Replace the Node-backed check path and expose v1.8 lifecycle choices as native,
safe Desktop operations.

## Requirements

- Authorization: consume the focused plan's session-owned
  `read-only|writable` access mode; every lifecycle mutation rejects read-only
  sessions in backend code regardless of UI state.
- Functional: native summary checks through L17; Quick update; Modify
  installation packs/settings; repair/reset only within explicitly confirmed
  scope.
- Non-functional: preserve `wiki/` and `raw/`, preserve changed managed files,
  and conform to CLI-produced fixtures without invoking CLI at runtime.

## Architecture

A native checker consumes the generated contract. The provisioner owns managed
file lifecycle and compares installed hashes to embedded hashes before replacing
files. Node CLI executions are confined to test-time conformance fixtures in
temporary directories outside the repository.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/checker/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/checker/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/tools/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/provisioner/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workspace/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/workspace/workspace-rail.tsx`

## Implementation Steps

1. Write RED checker tests for L01-L17, stable issue identifiers, summary counts,
   cancellation, malformed inputs, and CLI fixture parity.
2. Implement native read-only checks and make `tools.Service` delegate to them;
   remove executable-path and process-spawn dependencies.
3. Write RED lifecycle tests for clean/modified/missing managed files, pack
   changes, interrupted upgrades, repeated upgrades, repair, and each reset scope.
4. Implement Quick update and Modify installation from embedded assets, with
   state files committed last and recovery on failure.
5. Add preview plus explicit confirmation for destructive repair/reset actions;
   refresh active session state after success.

## Tests Before

- [ ] Check fails when Node is absent, proving the runtime dependency.
- [ ] Modified managed files and `wiki/`/`raw/` are protected by lifecycle tests.
- [ ] L17 detects dangling edge endpoints in v1.9.2 fixtures.

## Refactor

Consolidate atomic writes, workspace locking, and managed-file hash decisions
behind internal APIs shared with provisioning and later mutation phases.

## Tests After

- [ ] Native and CLI fixture summaries match through L17.
- [ ] Quick update is idempotent.
- [ ] Modify installation changes only accepted managed pack content.
- [ ] No lifecycle action touches user data outside its confirmed scope.

## Regression Gate

Run checker, provisioner, and tools tests; CLI fixture conformance; Desktop full
tests; root idempotency tests.

## Success Criteria

- [ ] Packaged Desktop performs checks and lifecycle actions without Node.
- [ ] Upgrade choices match v1.8 intent and preserve user ownership.

## Risk Assessment

Duplicating checker algorithms can drift. Generated rules plus bidirectional
conformance fixtures make behavioral differences visible in CI.

## Security Considerations

Hold a per-workspace lock, revalidate root identity before commit, restrict reset
to enumerated scopes, and never execute files from the opened workspace.
