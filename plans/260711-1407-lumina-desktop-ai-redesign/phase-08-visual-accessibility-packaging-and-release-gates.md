---
phase: 8
title: "Visual accessibility packaging and release gates"
status: pending
priority: P1
effort: "3d"
dependencies: [7]
---

# Phase 08: Visual, Accessibility, Packaging, and Release Gates

## Overview

Turn the approved visual and security claims into reproducible artifacts: pinned reference screenshots, structural measurements, accessibility checks, binding/storage scans, workspace immutability manifests, and packaged Wails smoke tests.

## Context Links

- `brainstorm-summary.md` lines 287-325
- `research/ui-fidelity-component-research.md`
- `reports/scout-phases-06-08-frontend-visual.md`
- `apps/desktop/README.md:22-61,88-107` documents current commands and Wails alpha caveat.

## Requirements

- Pin browser/renderer, OS, DPR, 1480x920 viewport, dark/light references, font readiness, masks, and 2% maximum differing pixels for non-dynamic shell; measure dynamic regions structurally.
- Verify 1180px/760px reopenable panels, keyboard/focus/dialog/tree/composer behavior, 4.5:1 normal text contrast, reduced motion, local fonts/licenses, every visible control handler.
- Scan bindings/frontend storage/log/error fixtures for secrets; pre/post content-hash workspace manifest for all read-only workflows; separate Import test permits exactly one `raw/sources/` addition.
- Build/package smoke on supported macOS/Windows/Linux CI where Wails prerequisites exist.

## Architecture

```ts
type VisualCase = { name: string; viewport: { width: number; height: number }; theme: 'dark'|'light'; maxDiff: number; masks: string[] };
type ControlInventory = { label: string; component: string; handler: string; state: string; keyboard: string }[];
```

Keep source-level Node tests for deterministic contracts and add an unconditional Playwright 1.61.1 + `@axe-core/playwright` 4.12.1 harness. A deterministic browser fixture supplies typed fake Wails bridge responses only to render accepted states; production code never receives canned chat/data. Playwright owns screenshot diffs, geometry, focus, keyboard, font readiness, and axe checks. Store references/metadata under the plan directory. Manual side-by-side approval remains required for graph/text/count/time/OS-control regions.

## Related Code Files

- Modify: `apps/desktop/frontend/src/styles/tokens.css`, `shell.css`, `graph.css`, `chat.css`, `dialog.css`, `app/app-shell-layout.test.mjs`, `package.json`, `package-lock.json`, `apps/desktop/README.md`.
- Create: `apps/desktop/frontend/src/app/accessibility-contract.test.mjs`, `apps/desktop/internal/ai/immutability_test.go`.
- Create: `apps/desktop/frontend/playwright.config.ts`, `tests/visual/desktop-shell.spec.ts`, `tests/visual/accessibility.spec.ts`, `tests/visual/fixtures/wails-bridge.ts`, and `.github/workflows/desktop.yml` jobs/artifacts.
- Create: `plans/260711-1407-lumina-desktop-ai-redesign/visual/visual-cases.json`, two pinned PNG references, and `visual/control-inventory.md`.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Finalize | `apps/desktop/frontend/src/styles/tokens.css` | exact themes/font faces | token/contrast tests |
| Finalize | `apps/desktop/frontend/src/styles/shell.css` | geometry/responsive drawers | measurement cases |
| Finalize | `apps/desktop/frontend/src/styles/graph.css` | React Flow states | screenshot masks |
| Finalize | `apps/desktop/frontend/src/styles/chat.css` | Agent messages/composer | keyboard/visual cases |
| Finalize | `apps/desktop/frontend/src/styles/dialog.css` | dialog/focus/error states | focus cases |
| Modify | `apps/desktop/frontend/src/app/app-shell-layout.test.mjs` | token/layout/control/no-fake scans | 12-18 tests |
| Create | `apps/desktop/frontend/src/app/accessibility-contract.test.mjs` | landmarks/labels/focus/reduced motion | 10-15 tests |
| Modify | `apps/desktop/frontend/package.json`, `package-lock.json` | pin Playwright/axe; `test:visual`, `test:a11y` scripts | dependency/package gate |
| Create | `apps/desktop/frontend/playwright.config.ts` | Chromium/version, OS, DPR, viewport, server, trace/artifact policy | runner gate |
| Create | `apps/desktop/frontend/tests/visual/fixtures/wails-bridge.ts` | deterministic typed UI states without production fake data | fixture contract |
| Create | `apps/desktop/frontend/tests/visual/desktop-shell.spec.ts` | screenshots, measurements, fonts, responsive controls | visual gate |
| Create | `apps/desktop/frontend/tests/visual/accessibility.spec.ts` | axe, focus, keyboard, dialog, reduced motion | a11y gate |
| Create | `apps/desktop/internal/ai/immutability_test.go` | pre/post workspace manifest and Import exception | 8 workflows |
| Create | `plans/260711-1407-lumina-desktop-ai-redesign/visual/visual-cases.json` | pinned viewport/DPR/masks/threshold | metadata gate |
| Create | `plans/260711-1407-lumina-desktop-ai-redesign/visual/reference-{dark,light}-1480x920.png` | approved references | pixel gate |
| Create | `plans/260711-1407-lumina-desktop-ai-redesign/visual/control-inventory.md` | visible control-to-handler proof | completion audit |
| Modify | `apps/desktop/README.md` | chat/profile/privacy/history/index/verification guidance | doc review |
| Create/modify | `.github/workflows/desktop.yml` | Node/Go gates, Playwright Chromium artifacts, macOS/Windows/Linux Wails build/smoke prerequisites | CI gate |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | 1480x920 dark/light | non-dynamic mask diff <=2%; fonts loaded before capture |
| Critical | read-only workflows manifest | zero changed workspace bytes; Import separately adds one allowed file |
| Critical | binding/storage/redaction scans | no secret getter/value/header/prompt/excerpt/transcript |
| High | 1180px/760px responsive | tree/Agent reopen; all primary actions reachable |
| High | keyboard/focus/contrast/motion | logical order, trap/restore, labels, 4.5:1, reduced motion honored |
| High | offline/stale/corrupt/cancel/history migration | stable real UI states and lexical fallback |
| High | packaged Wails smoke | launch, open workspace, graph/note, settings, stream cancel succeed |
| Medium | control inventory | every reference control maps to real handler/state or is intentionally absent |

## Interface and Function Checklist

- [ ] `visual-cases.json` pins renderer/browser version, OS, DPR, viewport, fonts, masks, threshold.
- [ ] `npm run test:visual` uses Playwright screenshot comparison; `npm run test:a11y` runs axe plus interaction/focus assertions; both publish traces/diffs on CI failure.
- [ ] `control-inventory.md` names component, handler, state, keyboard operation for each visible control.
- [ ] Immutability helper hashes file contents/relative paths before and after workflows, excluding no workspace paths.
- [ ] Package scan confirms one canonical copy of each local font/license and rejects duplicate unreferenced binaries, root-level stale Inter assets, `@import`, `fonts.googleapis.com`, and remote font URLs.
- [ ] README states disclosure, local storage, clear/delete, fallback, cancellation, and zero chat workspace writes in plain language.

## Dependency Map

Phase 8 consumes all completed behaviors from phases 1-7. A failing security, accessibility, visual, packaging, or immutable-workspace gate returns ownership to the phase that introduced the behavior; no acceptance threshold is weakened.

## Tests Before

- RED: `cd apps/desktop/frontend && npm run test`
- Expected RED after adding final contracts: missing reference metadata/assets, incomplete token/responsive/focus/control assertions, or forbidden old settings/sample patterns.
- RED: `cd apps/desktop && go test ./internal/ai -run 'Immutability|ImportException|Redaction|Bindings' -count=1`
- Expected RED: missing manifest harness and completion scans before gate implementation.

## Refactor

Change only defects exposed by gates; keep reference metadata and masks narrow. Do not mask deterministic shell geometry, dialogs, panel boundaries, typography, or controls. Keep CSS modules focused and `app.css` import-only.

## Tests After

- Frontend: `cd apps/desktop/frontend && npm run test && npm run build && npm audit --omit=optional`
- Browser: `cd apps/desktop/frontend && npx playwright install --with-deps chromium && npm run test:visual && npm run test:a11y`
- Backend/race: `cd apps/desktop && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers ./internal/ai/retrieval ./internal/ai/index ./internal/ai/chat && go test -race ./internal/ai ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers ./internal/ai/retrieval ./internal/ai/index ./internal/ai/chat`
- Bind/package: `cd apps/desktop && wails3 generate bindings -clean=true -ts && wails3 build`
- Repository: `cd /Users/plateau/Project/lumina-wiki && git diff --check`

## Implementation Steps

- [ ] Write token/responsive/font/control contract tests; run RED; fix styles/components minimally; run GREEN.
- [ ] Add pinned Playwright/axe dependencies, config, deterministic Wails fixture, and CI artifact policy; write focus/keyboard/contrast/reduced-motion tests; run RED; fix semantics/styles; run GREEN.
- [ ] Commit: `fix(desktop): meet visual accessibility contracts`.
- [ ] Create pinned visual metadata/references/masks; run `npm run test:visual` for dark/light/three viewports and `npm run test:a11y`; fix unmasked regressions to <=2%.
- [ ] Write immutability/Import/redaction/binding scans; run RED; implement harness and remove leaks; run GREEN.
- [ ] Commit: `test(desktop): prove workspace and secret boundaries`.
- [ ] Run offline/stale/corrupt/cancel/history migration scenarios and complete control inventory.
- [ ] Update README in plain language; regenerate bindings; run frontend, Go, race, audit, Wails build, and diff gates.
- [ ] Commit: `docs(desktop): document AI chat and privacy controls`.
- [ ] Add/execute `.github/workflows/desktop.yml` on macOS/Windows/Linux with documented Wails prerequisites; retain Playwright traces/diffs and packaged smoke artifacts; record OS-specific exceptions as failed gates, not waived claims.

## Success Criteria

- [ ] Quantitative visual, responsive, accessibility, font, and control inventory gates pass.
- [ ] Secret scans and workspace manifests prove stated trust boundaries; Import matches its sole exception.
- [ ] All tests, builds, generated bindings, audits, packaged smoke, and diff check pass with committed evidence.

## Security, Risks, and Rollback

- Risk: source-string tests falsely imply rendered correctness. Mitigation: pinned screenshots, structural browser measurements, and human approval.
- Risk: OS rendering makes pixel output noisy. Mitigation: pin environment and mask only OS/dynamic regions.
- Rollback: block release and revert the failing phase checkpoint; never relax security, immutability, or accessibility acceptance.
