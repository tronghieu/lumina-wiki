---
phase: 5
title: "Docs and Release Gates"
status: pending
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Docs and Release Gates

## Context Links

- [Development guide](../../docs/DEVELOPMENT.md)
- [Roadmap](../../docs/project-roadmap.md)
- [Changelog](../../CHANGELOG.md)

## Overview

Document the desktop MVP, update roadmap/changelog if warranted, run full verification, complete code review, then open the requested PR.

## Requirements

- Functional: contributors can run the desktop app locally and understand MVP limits.
- Non-functional: root CI gates remain green; plan status reflects actual implementation; PR has clean summary and test evidence.

## Architecture

Docs stay split:

- `apps/desktop/README.md`: desktop developer run/test guide.
- `docs/project-roadmap.md`: mark desktop app from proposed to MVP in progress/shipped as appropriate.
- `CHANGELOG.md`: user-visible unreleased note if app is included in package/repo change.

## Related Code Files

- Modify: `apps/desktop/README.md`
- Modify: `docs/project-roadmap.md`
- Modify: `CHANGELOG.md`
- Modify: plan files status via `ck plan` commands.

## Implementation Steps

1. Update desktop README with prerequisites, dev, test, and known alpha caveat.
2. Update roadmap/changelog only for actual shipped scope.
3. Run desktop tests/build plus root test/package gates.
4. Run code-review workflow and fix blockers.
5. Sync plan statuses.
6. Commit phase.
7. Push branch and open PR to `tronghieu/lumina-wiki`.

## Success Criteria

- [ ] Desktop README is accurate.
- [ ] Roadmap/changelog updated or docs impact explicitly marked none.
- [ ] Desktop Go tests pass.
- [ ] Desktop frontend tests/build pass.
- [ ] Root `npm run test:all`, `npm run ci:idempotency`, and `npm run ci:package` pass or any failure is documented and fixed before PR.
- [ ] Code review completed with no critical unresolved findings.
- [ ] PR opened against `tronghieu/lumina-wiki`.
- [ ] Phase 5 commit created.

## Risk Assessment

- Full root tests can be slow but required before PR.
- PR creation may require GitHub auth; if unavailable, document exact command and blocker after three failed/blocked attempts.
