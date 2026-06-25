---
title: 'Complete PR #24 desktop companion MVP'
type: 'feature'
created: '2026-06-24'
status: 'in-review'
baseline_commit: '214644f82972c28deda9e4bf4a4a4dcceb87af2c'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/DEVELOPMENT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR #24 contains a substantial Wails desktop MVP, but it is behind `main`, currently conflicts, has no desktop CI coverage, and its filesystem boundary checks do not consistently prevent symlink-mediated reads, execution, or writes outside the selected workspace. These gaps make the PR unsafe to merge and difficult to maintain.

**Approach:** Bring the existing MVP onto current `main`, retain its narrow graph/check/import scope, harden workspace filesystem handling, add automated desktop verification, and resolve integration/documentation drift so the result is reviewable and merge-ready.

## Boundaries & Constraints

**Always:** Preserve the root npm CLI contracts and package allowlist; keep desktop dependencies isolated under `apps/desktop`; treat selected workspaces as untrusted filesystem input; reject symlink escapes before reading notes/graphs, executing scripts, or importing files; preserve existing user data and refuse import overwrites; keep Wails-specific code contained under `apps/desktop`.

**Ask First:** Expanding beyond MVP into installer lifecycle UI, real AI/provider calls, persisted secrets/settings, direct wiki/graph editing, release signing/notarization, or changing the root package’s supported runtimes.

**Never:** Run Lumina installation inside this repository; add desktop dependencies to the root `package.json`; execute arbitrary workspace commands; silently follow symlinks outside a workspace; claim cross-platform readiness without CI evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open workspace | Valid installed Lumina workspace | Validate, summarize, load graph and notes | Surface a clear validation error |
| Untrusted workspace | `wiki`, `_lumina`, `raw`, entity directory, note, or script path crosses a symlink | Refuse the operation without external read/write/execute | Return a stable service error |
| Import source | Regular source file and absent destination | Atomically copy into real `raw/sources/` | Refuse source symlinks, destination symlinks, and overwrites |
| Run check | Real workspace lint script and Node available | Execute only `_lumina/scripts/lint.mjs --summary` with timeout | Preserve stdout/stderr and reject invalid script paths |
| CI verification | Pull request changes desktop code | Go tests and frontend install/test/build run automatically | Failing desktop gates block merge |

</frozen-after-approval>

## Code Map

- `apps/desktop/internal/workspace/` -- workspace validation, safe path resolution, and summary boundaries.
- `apps/desktop/internal/graph/` -- graph/note reads from the selected workspace.
- `apps/desktop/internal/importer/` -- the only MVP filesystem write path.
- `apps/desktop/internal/tools/` -- controlled execution of installed Lumina checks.
- `apps/desktop/frontend/` -- Wails React UI and generated service bindings.
- `.github/workflows/ci.yml` -- authoritative pull-request verification.
- `package.json` and `scripts/ci-package.mjs` -- root npm package isolation and publish safety.

## Tasks & Acceptance

**Execution:**
- [x] Merge current `origin/main` into the PR branch and resolve conflicts without dropping either released CLI work or desktop MVP functionality.
- [x] Harden workspace path handling against symlink traversal and TOCTOU-prone destination setup; add focused Go regression tests for every matrix boundary.
- [x] Align graph loading, note reading, check execution, and import behavior with the hardened workspace contract.
- [x] Add isolated desktop CI jobs for supported Go/Wails backend tests and frontend install/test/build while leaving npm package contents unchanged.
- [x] Reconcile desktop documentation, generated bindings, repository metadata, and stale planning artifacts with the implemented MVP state.
- [x] Run root and desktop release gates; fix failures attributable to the PR.

**Acceptance Criteria:**
- Given current `main` and PR #24, when merged locally, then the branch has no unresolved conflicts and retains all released root CLI behavior.
- Given any symlinked workspace boundary covered by the matrix, when a desktop service is invoked, then no data is read, written, or executed outside the selected real workspace.
- Given a PR touching desktop files, when GitHub Actions runs, then backend and frontend desktop gates execute and can block merge.
- Given root package validation, when `npm run ci:package` runs, then desktop files and dependencies remain excluded from the published npm package.
- Given all prescribed gates, when executed on the completed branch, then they pass or any platform-only limitation is explicitly documented with evidence.

## Spec Change Log

## Design Notes

Use one workspace-owned path helper as the security boundary instead of scattered lexical `filepath.Rel` checks. Read operations may require real-path validation of every existing component; the import path additionally needs a verified real parent plus exclusive destination creation. Desktop CI should be a separate job so the existing Node/Python matrix remains unchanged and root npm installs do not pull frontend dependencies.

## Verification

**Commands:**
- `npm run test:all` -- root installer, script, and Python tests pass.
- `npm run ci:idempotency` -- repeated workspace installation remains stable.
- `npm run ci:package` -- npm package remains desktop-free and publish-safe.
- `cd apps/desktop && go test ./...` -- backend and filesystem regression tests pass.
- `cd apps/desktop/frontend && npm ci && npm test && npm run build` -- frontend typecheck, tests, and production build pass.
- `git diff --check origin/main...HEAD` -- no whitespace errors.

**Results (2026-06-24):**
- Root `test:all`, idempotency, and package gates passed.
- Desktop frontend test/build and `npm audit --omit=optional` passed after upgrading Vite to 8.1.0.
- Desktop `go test ./...` and pinned Wails 3 alpha.78 native build passed.
- Wails binding generation and `go mod tidy` produced no tracked drift.
