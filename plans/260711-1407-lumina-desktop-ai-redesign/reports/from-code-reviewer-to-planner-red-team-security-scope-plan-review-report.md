# Security, Scope, Fact, and Contract Red-Team Plan Review

## Summary

Seven evidence-backed findings. Review covers Security Adversary + Fact Checker and Scope/Complexity Critic + Contract Verifier. No code, plan, lint, build, or test changes performed.

## Finding 1: Frontend workspace path is treated as an authorization capability

- **Severity:** Critical
- **Location:** Phase 5, Architecture and Interface Checklist
- **Flaw:** `ChatRequest` carries `WorkspaceRoot`, and the proposed facade only validates that caller-provided root. A compromised webview can request retrieval/chat over any filesystem location shaped like a Lumina workspace, not only the workspace chosen through the native dialog.
- **Failure scenario:** Injected frontend code supplies another readable directory containing `README.md` and `wiki/`; backend validates it and sends its notes to the configured provider.
- **Evidence:** Phase 5 lines 33-39 and 78 make the root caller-controlled. Today React owns a mutable root and passes it into every binding (`apps/desktop/frontend/src/App.tsx:35-38`, `apps/desktop/frontend/src/App.tsx:166-186`, `apps/desktop/frontend/src/App.tsx:219-230`). Backend validation is only `filepath.Abs` plus `README.md`/`wiki` existence (`apps/desktop/internal/workspace/service.go:22-40`).
- **Suggested fix:** Make backend workspace activation return an opaque session capability/ID; `Chat` accepts that ID and resolves the backend-held canonical root. Add forged/stale/cross-window capability tests.

## Finding 2: Pre-resolution does not prevent DNS rebinding

- **Severity:** Critical
- **Location:** Phase 2, Architecture and Deep File Inventory
- **Flaw:** `EndpointPolicy.Validate` resolves before credentials attach, but the planned inventory has no transport/dialer that connects to the validated address. Standard `net/http` will resolve the hostname again at dial time.
- **Failure scenario:** First resolution returns a public IP and passes policy; dial-time resolution returns loopback/private metadata IP, carrying the credential to a forbidden target.
- **Evidence:** Phase 2 lines 37, 41, 49 and 72 promise per-hop resolution but inventory only `endpoint.go`; current desktop has no HTTP client abstraction or dial policy—the only direct dependency is Wails (`apps/desktop/go.mod:5`) and existing cancellable backend work is process execution (`apps/desktop/internal/tools/service.go:59-67`).
- **Suggested fix:** Add an explicit `transport.go`/dial-policy file and contract: resolve once per hop, validate all addresses, pin `DialContext` to an approved address while preserving SNI/Host, revalidate redirects, and test rebinding at dial time.

## Finding 3: The documented frontend test gate omits nested feature tests

- **Severity:** High
- **Location:** Phases 6-8, Tests Before/After
- **Flaw:** Every frontend phase relies on `npm run test`, whose shell glob is not a recursive, quoted discovery mechanism across all nested feature directories.
- **Failure scenario:** New chat/settings tests or existing graph/workspace tests are committed under deeper folders but never execute, while the phase reports GREEN.
- **Evidence:** Test script is `src/**/*.test.mjs` (`apps/desktop/frontend/package.json:6-10`). Existing nested suites live at `apps/desktop/frontend/src/features/graph/graph-data.test.mjs:13-22` and `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs:17-25`, while the shallower structural suite is `apps/desktop/frontend/src/app/app-shell-layout.test.mjs:10-17`.
- **Suggested fix:** Phase 6 first changes discovery to an explicit recursive file list or quoted Node-supported glob and adds a test-count/sentinel assertion; all later gates use that corrected command.

## Finding 4: AI facade ownership conflicts between phases 1 and 5

- **Severity:** High
- **Location:** Phase 1, Related Files/Implementation; Phase 5, Related Files
- **Flaw:** Phase 1 says register a settings facade but creates no facade file; phase 5 later creates `internal/ai/service.go` and again owns registration. Constructor lifetime and generated binding surface are undefined for phases 1-4.
- **Failure scenario:** Phase 1 either cannot register anything, creates an unplanned service later overwritten by phase 5, or exposes phase-1 methods under a different generated binding contract that phase 7 cannot consume.
- **Evidence:** Phase 1 lines 41-43, 57 and 108 omit the facade implementation while requiring registration. Phase 5 lines 44-45, 56-59 creates/registers it. Current registration is centralized in one service slice (`apps/desktop/main.go:19-27`), and every current package has one explicit constructor (`apps/desktop/internal/workspace/service.go:16-20`, `apps/desktop/internal/graph/service.go:16-20`).
- **Suggested fix:** Assign `internal/ai/service.go` and composition-root ownership to one phase. Either create the stable facade in phase 1 and extend it in phase 5, or defer registration/bindings entirely to phase 5.

## Finding 5: Proposed shell contract drops existing Source/import/root callbacks

- **Severity:** High
- **Location:** Phase 6, Architecture and Interface Checklist
- **Flaw:** The proposed `AppShellProps` lists `onImport` but omits source selection/path state and workspace-root change state required by current real flows, despite promising contract preservation.
- **Failure scenario:** The visual refactor keeps a visible Source/Import button but cannot choose/persist a source path, or silently folds two-step source selection/import into an incompatible callback.
- **Evidence:** Current shell contract includes `sourcePath`, `workspaceRoot`, `onChooseSourcePath`, `onSourcePathChange`, `onWorkspaceRootChange`, and `onImportSource` (`apps/desktop/frontend/src/app/app-shell.tsx:11-30`); buttons call distinct handlers (`apps/desktop/frontend/src/app/app-shell.tsx:139-144`); `App` supplies all callbacks (`apps/desktop/frontend/src/App.tsx:240-260`) and performs separate native choose/import flows (`apps/desktop/frontend/src/App.tsx:81-99`, `apps/desktop/frontend/src/App.tsx:129-149`).
- **Suggested fix:** Inventory the exact preserved props/flows or define a deliberate view-model replacement with an explicit caller migration list and tests for choose-then-import.

## Finding 6: Visual and packaged release gates have no executable harness or CI owner

- **Severity:** High
- **Location:** Phase 8, Architecture, Inventory, and Tests After
- **Flaw:** The plan promises browser pixel comparison and three-OS packaged smoke, but inventories only metadata/PNGs and conditionally adds a harness “if” tooling exists. It names no runner, script, workflow, or environment setup.
- **Failure scenario:** PNG references and a control inventory are committed, but no automated command computes the 2% diff or launches packages; release claims remain manual and non-reproducible.
- **Evidence:** Current frontend dependencies contain no browser/visual runner (`apps/desktop/frontend/package.json:13-24`) and scripts expose only dev/test/build/preview (`apps/desktop/frontend/package.json:6-11`). Repository CI runs installer/CLI jobs only (`.github/workflows/ci.yml:11-68`) and has no desktop/Wails job. Current task surface exposes build/package/run/dev but no visual or smoke gate (`apps/desktop/Taskfile.yml:14-33`).
- **Suggested fix:** Add exact harness files, command, dependency decision, committed diff algorithm, CI workflow/jobs and OS prerequisites to phase 8; do not make the acceptance gate conditional.

## Finding 7: Phase 6 is unnecessarily serialized behind backend phase 5

- **Severity:** Medium
- **Location:** Plan Dependencies; Phase 6, Dependency Map
- **Flaw:** The plan claims shell work waits on backend/window construction conflict, but phase 6 owns frontend shell/styles only and can proceed against existing bindings while phase 5 develops a new AI binding directory.
- **Failure scenario:** A three-day independent shell slice sits idle after phases 1-4, extending the critical path and concentrating integration risk in phases 7-8.
- **Evidence:** Phase 6 lines 42-61 lists no `main.go` or AI binding modification. Current shell imports existing graph/tools/workspace models (`apps/desktop/frontend/src/app/app-shell.tsx:1-9`); phase 5 adds a separate `internal/ai` binding path while current backend services remain separately registered (`apps/desktop/main.go:22-27`).
- **Suggested fix:** Let phase 6 depend on the approved visual contract/current public services, run it parallel with phases 2-5, then make phase 7 the explicit integration join.

## Unresolved Questions

- None.
