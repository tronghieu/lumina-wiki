# Adjudicated Lumina Desktop AI Plan Red-Team Review

## Summary

- **Tier:** Full; 8 phases.
- **Source findings:** 19 across three lens reports.
- **After deduplication/cap:** 15 findings: 3 Critical, 10 High, 2 Medium.
- **Proposed dispositions:** 15 Accept, 0 Reject.
- **Evidence filter:** all retained findings include actual codebase `file:line` evidence. Duplicate endpoint, corpus-navigation, visual-harness, and facade/binding findings were merged.
- **Scope:** plan review only. No plan, code, lint, build, or test changes.

## Findings

### 1. Caller-controlled workspace root is not an authorization capability — Critical

- **Source:** Security Adversary / Fact Checker.
- **Location:** Phase 5 Architecture.
- **Failure:** compromised frontend supplies any readable Lumina-shaped directory and causes retrieval/provider disclosure.
- **Evidence:** mutable frontend root is binding input (`apps/desktop/frontend/src/App.tsx:35-38`, `apps/desktop/frontend/src/App.tsx:166-186`); backend accepts any absolute root containing `README.md` and `wiki` (`apps/desktop/internal/workspace/service.go:22-40`).
- **Disposition:** **Accept.** Validation proves shape, not user authorization. Replace `WorkspaceRoot` in chat with a backend-issued active-workspace capability and test forged/stale/cross-window IDs.

### 2. DNS validation is not bound to the actual dial — Critical

- **Source:** Security Adversary + Failure Mode Analyst; merged duplicate.
- **Location:** Phase 2 Architecture/Inventory.
- **Failure:** validation resolves public IP, transport resolves again to private/metadata IP, credentials follow second resolution.
- **Evidence:** no existing HTTP transport guard exists; current backend’s only cancellable precedent is `exec.CommandContext` (`apps/desktop/internal/tools/service.go:55-67`) and current direct module surface is Wails (`apps/desktop/go.mod:5`).
- **Disposition:** **Accept.** Add planned pinned-dial transport, SNI/Host preservation, redirect revalidation, proxy policy, and dial-time rebinding tests.

### 3. History persistence has no concurrency owner — Critical

- **Source:** Assumption Destroyer / Scope Auditor.
- **Location:** Phases 1 and 5 history/concurrency contracts.
- **Failure:** concurrent append/delete/metadata replacement loses conversations or violates one-terminal-attempt semantics.
- **Evidence:** services are registered as process singletons (`apps/desktop/main.go:22-27`), but current call paths construct helpers ad hoc (`apps/desktop/internal/graph/service.go:56-65`, `apps/desktop/internal/tools/service.go:40-47`); no shared lock pattern exists.
- **Disposition:** **Accept.** Specify one workspace-keyed history coordinator, lock order, delete/append semantics, and cross-process policy; add race cases.

### 4. Editable workspace root can diverge from loaded graph identity — High

- **Source:** Failure Mode Analyst / Flow Tracer.
- **Location:** Phase 7 workspace/chat/citation flow.
- **Failure:** draft root points to workspace B while graph/note state remains A; chat and citations resolve across different workspaces.
- **Evidence:** editing root clears only summary (`apps/desktop/frontend/src/App.tsx:202-206`), while graph/selection persist (`apps/desktop/frontend/src/App.tsx:34-43`) and note navigation uses retained graph (`apps/desktop/frontend/src/App.tsx:214-229`).
- **Disposition:** **Accept.** Split draft path from atomic `loadedWorkspace {capability, root, ID, generation}` and bind chat/history/citations only to loaded identity.

### 5. Cancellation and terminal-event cleanup ordering is undefined — High

- **Source:** Failure Mode Analyst / Flow Tracer.
- **Location:** Phases 5 and 7 stream lifecycle.
- **Failure:** cancellable promise rejects, `finally` removes listener, backend emits `cancelled` afterward; UI never observes its sole terminal event.
- **Evidence:** generated bindings return cancellable promises (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:6-25`); current async guards discard late results rather than handshake terminals (`apps/desktop/frontend/src/App.tsx:173-183`, `apps/desktop/frontend/src/App.tsx:229-236`).
- **Disposition:** **Accept.** Pick one authoritative terminal protocol and listener teardown rule; test promise-rejection-before-terminal ordering.

### 6. Corpus and navigable graph cover different note sets — High

- **Source:** Failure Mode Analyst + Assumption Destroyer; merged duplicate.
- **Location:** Phases 3, 5, and 7 citations.
- **Failure:** broad corpus cites `wiki/<custom>/note.md`, but graph cannot contain/read it, so a valid citation becomes inert.
- **Evidence:** graph scans only fixed entity directories (`apps/desktop/internal/graph/service.go:103-139`), rejects other first-level directories (`apps/desktop/internal/graph/service.go:42-54`, `apps/desktop/internal/graph/service.go:86-100`), and frontend selection searches loaded graph nodes (`apps/desktop/frontend/src/App.tsx:219-229`).
- **Disposition:** **Accept.** Keep broad corpus but define safe citation-note opening independent of graph membership, or explicitly narrow corpus; fixed broad-corpus decision favors the former.

### 7. Session-only secret fallback lacks confirmation-bearing API — High

- **Source:** Failure Mode Analyst / Flow Tracer.
- **Location:** Phases 1 and 7 credential flow.
- **Failure:** keyring unavailable leaves backend unable to distinguish confirmed session fallback from silent downgrade/retry.
- **Evidence:** current settings contain provider/model only (`apps/desktop/frontend/src/app/ai-settings-panel.tsx:3-11`, `apps/desktop/frontend/src/app/ai-settings-panel.tsx:53-58`); generated services use plain positional calls with no challenge pattern (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`).
- **Disposition:** **Accept.** Specify typed challenge/nonce and explicit confirmation method with expiry/restart-loss tests.

### 8. Frontend test command does not reliably discover nested suites — High

- **Source:** Scope/Complexity Critic / Contract Verifier.
- **Location:** Phases 6-8 test gates.
- **Failure:** deeper chat/settings/graph tests may not execute while `npm run test` reports GREEN.
- **Evidence:** script uses shell-expanded `src/**/*.test.mjs` (`apps/desktop/frontend/package.json:6-10`); suites exist deeper at `apps/desktop/frontend/src/features/graph/graph-data.test.mjs:13-22` and `apps/desktop/frontend/src/features/workspace/workspace-actions.test.mjs:17-25`.
- **Disposition:** **Accept.** Fix discovery in phase 6 and add a nested-suite sentinel/test-count guard before relying on later frontend gates.

### 9. AI facade ownership and public binding contract are incomplete — High

- **Source:** Security/Scope + Assumption Destroyer; merged related findings.
- **Location:** Phases 1, 4, 5, and 7.
- **Failure:** phase 1 registers an un-inventoried facade, phase 5 creates/registers it again, and phase 7 expects settings/history/index methods never specified.
- **Evidence:** current Wails registration is centralized (`apps/desktop/main.go:19-27`), and bindings expose each exported service method explicitly (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`).
- **Disposition:** **Accept.** Assign one phase ownership of `internal/ai/service.go` and add complete method/request/response/cancellation/secret-direction contracts before phase 7.

### 10. Proposed shell interface drops current Source/import/root flow — High

- **Source:** Scope/Complexity Critic / Contract Verifier.
- **Location:** Phase 6 Architecture.
- **Failure:** redesigned shell cannot preserve two-step choose-source/import and editable workspace flow from its proposed props.
- **Evidence:** current contract includes `sourcePath`, root, choose/change/import callbacks (`apps/desktop/frontend/src/app/app-shell.tsx:11-30`); buttons call distinct handlers (`apps/desktop/frontend/src/app/app-shell.tsx:139-144`); `App` supplies them (`apps/desktop/frontend/src/App.tsx:240-260`).
- **Disposition:** **Accept.** Inventory exact preserved callbacks or an explicit view-model migration with caller/test impact.

### 11. Real workspace tree has no backend data source — High

- **Source:** Assumption Destroyer / Scope Auditor.
- **Location:** Phase 6 workspace tree.
- **Failure:** removing hard-coded `_lumina`/`raw`/folder rows leaves only graph entity paths; reference hierarchy cannot be real without an unplanned listing API.
- **Evidence:** current tree is hard-coded (`apps/desktop/frontend/src/app/app-shell.tsx:89-119`); graph nodes expose note metadata only (`apps/desktop/internal/graph/types.go:8-14`), and summary exposes counts rather than a tree (`apps/desktop/internal/workspace/summary.go:10-20`).
- **Disposition:** **Accept.** Decide note-only tree versus bounded no-symlink workspace-tree DTO; update inventory and visual gate without phantom entries.

### 12. Visual/accessibility/package gates have no executable harness or CI owner — High

- **Source:** Security/Scope + Failure Mode Analyst; merged duplicate.
- **Location:** Phase 8.
- **Failure:** references/metadata exist but no command renders, diffs, measures focus, launches packages, or fails CI.
- **Evidence:** frontend scripts/dependencies have no browser/image runner (`apps/desktop/frontend/package.json:6-24`); current layout tests are source regex scans (`apps/desktop/frontend/src/app/app-shell-layout.test.mjs:1-8`, `apps/desktop/frontend/src/app/app-shell-layout.test.mjs:10-41`); repository CI has no desktop job (`.github/workflows/ci.yml:11-68`).
- **Disposition:** **Accept.** Make the harness unconditional and inventory runner, scripts, diff algorithm, reference provenance, Wails launch, OS prerequisites, workflow jobs, and artifacts.

### 13. Workspace rename/path-reuse behavior needs a durable registry — High

- **Source:** Assumption Destroyer / Scope Auditor.
- **Location:** Phase 1 WorkspaceID.
- **Failure:** path+filesystem hash changes on rename or reattaches history after path reuse because no durable path-signature state exists.
- **Evidence:** current validation returns root/valid/packs only and persists nothing (`apps/desktop/internal/workspace/service.go:10-14`, `apps/desktop/internal/workspace/service.go:22-40`); root currently lives only in React state (`apps/desktop/frontend/src/App.tsx:32-38`).
- **Disposition:** **Accept.** Inventory/version a workspace registry and confirmation API with atomic rename/reuse transitions.

### 14. Shell phase is unnecessarily serialized behind backend phase 5 — Medium

- **Source:** Scope/Complexity Critic / Contract Verifier.
- **Location:** Plan dependency chain and Phase 6.
- **Failure:** independent frontend shell work waits three days, extending critical path and deferring integration risk.
- **Evidence:** shell currently imports stable existing models (`apps/desktop/frontend/src/app/app-shell.tsx:1-9`), while backend service registration is isolated in `apps/desktop/main.go:22-27`; phase 6 inventories no `main.go` or new AI binding edits.
- **Disposition:** **Accept.** Run phase 6 parallel to backend phases against current contracts, then make phase 7 the explicit join; preserve fixed scope and visual decision.

### 15. Existing Inter assets are unowned in the font migration — Medium

- **Source:** Assumption Destroyer / Scope Auditor.
- **Location:** Phases 6 and 8 font/package inventory.
- **Failure:** new `public/fonts/` assets coexist with stale root-level Inter binary/license, creating duplicate packaging and unclear canonical licensing.
- **Evidence:** current files are `apps/desktop/frontend/public/Inter-Medium.ttf` and `apps/desktop/frontend/Inter Font License.txt`; package scripts expose no asset allowlist/cleanup (`apps/desktop/frontend/package.json:6-11`).
- **Disposition:** **Accept.** Add exact move/delete/retain actions and reject duplicate unreferenced font binaries in the package gate.

## Deduplication and Rejections

- Merged: DNS rebinding (2 reports), corpus-to-citation mismatch (2), visual harness/CI gap (2), facade ownership/public methods (2).
- Rejected for missing codebase evidence: 0.
- Trivial/style-only findings retained: 0.

## Proposed Planner Action

Apply all 15 accepted findings to the relevant phase files, then run a whole-plan consistency sweep over `plan.md` and all eight phases. Do not mark implementation-ready until active workspace authority, cancellation ordering, and the executable visual harness have concrete contracts.

## Unresolved Questions

- Which backend-issued workspace capability lifecycle is selected (per window or app session)?
- Which terminal protocol is authoritative on cancellation: terminal event handshake or binding settlement?
- Which pinned browser/image-diff and packaged-app driver will phase 8 use?
