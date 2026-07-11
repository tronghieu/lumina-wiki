---
phase: 6
title: "Reference-faithful workspace shell"
status: pending
priority: P1
effort: "3d"
dependencies: [3]
---

# Phase 06: Reference-Faithful Workspace Shell

## Overview

Port the approved `.dc.html` hierarchy and tokens into focused React components while preserving real workspace/graph/note/check/import behavior and removing sample/phantom production data.

## Context Links

- `brainstorm-summary.md` lines 132-191, 287-307
- `research/ui-fidelity-component-research.md`
- `reports/scout-phases-06-08-frontend-visual.md`
- Current hotspots: `frontend/src/App.tsx` 264 lines, `frontend/src/app.css` 842 lines, `frontend/src/app/app-shell.tsx` 181 lines.

## Requirements

- Match title region 38px, activity rail 46px, tree 228px, agent panel 344px, graph/note center, exact dark/light tokens and local fonts.
- Tree renders the phase-3 bounded real workspace DTO (`_lumina`, `raw`, `wiki`); graph stays React Flow; Open/Refresh/Source/Check/Import, selection, linked navigation, note states remain real.
- Medium/narrow tree and agent regions are reopenable drawers; no seeded messages, canned replies, hard-coded notes/counts, remote fonts, or custom fake graph.

## Architecture

```ts
export type AppShellProps = {
  graph: KnowledgeGraph; workspaceSummary: WorkspaceSummary | null; noteState: NoteContentState;
  workspaceTree: WorkspaceTreeNode[]; sourcePath: string; workspaceRoot: string;
  selectedNodeId: string; activeView: 'graph' | 'note'; theme: 'dark' | 'light';
  onSelectNode(id: string): void; onOpen(): void; onRefresh(): void; onCheck(): void;
  onChooseSourcePath(): void; onSourcePathChange(path: string): void; onWorkspaceRootChange(path: string): void; onImportSource(): void;
};
export function normalizeWorkspaceTree(nodes: WorkspaceTreeNode[]): WorkspaceTreeGroup[];
```

`AppShell` becomes composition only: title bar, rail/tree, artifact pane, compact/reopenable Agent placeholder. Pure tree and graph view-state modules carry deterministic behavior.

## Related Code Files

- Create: `apps/desktop/frontend/src/app/desktop-title-bar.tsx`, `features/workspace/workspace-rail.tsx`, `workspace-tree-data.ts`, `features/graph/artifact-pane.tsx`, `note-view.tsx` and focused tests.
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`, `features/graph/graph-view.tsx`, `graph-data.ts`, `frontend/src/app.css`.
- Add: `apps/desktop/frontend/src/styles/tokens.css`, `shell.css`, `graph.css`, `chat.css`, `dialog.css`, plus `frontend/public/fonts/` assets/licenses.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Modify | `apps/desktop/frontend/src/app/app-shell.tsx` | composition and semantic zones | reduce below 160; 8 tests |
| Create | `apps/desktop/frontend/src/app/desktop-title-bar.tsx` | title/window controls | 100 + structural tests |
| Create | `apps/desktop/frontend/src/features/workspace/workspace-rail.tsx` | activity rail/real tree/drawers | 160 + 12 cases |
| Create | `apps/desktop/frontend/src/features/workspace/workspace-tree-data.ts` | normalize real backend tree DTO/order/filter | 110 + 10 cases |
| Create | `apps/desktop/frontend/src/features/graph/artifact-pane.tsx` | Graph/Note tabs/stats/controls | 170 + structural cases |
| Create | `apps/desktop/frontend/src/features/graph/note-view.tsx` | loading/error/loaded Markdown | 90 + state cases |
| Modify | `apps/desktop/frontend/src/features/graph/graph-view.tsx` | styling/a11y/highlight input | under 60 change |
| Modify | `apps/desktop/frontend/src/features/graph/graph-data.ts` | remove production sample fallback; dim/link state | under 80 + existing tests |
| Split | `apps/desktop/frontend/src/app.css` | imports into `src/styles/*.css` | 842 -> under 80 entry |
| Move/add | `apps/desktop/frontend/public/fonts/` and license files | move root Inter asset/license; add Source Serif 4 and JetBrains Mono canonically | package/font gate |
| Delete after move | `apps/desktop/frontend/public/Inter-Medium.ttf`, `apps/desktop/frontend/Inter Font License.txt` | eliminate stale duplicate font paths | duplicate-font scan |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | unloaded/empty workspace | no phantom tree, note, count, graph, or message |
| Critical | action inventory | Open/Refresh/Source/Check/Import keep real callbacks and states |
| High | tree grouping/order | real bounded backend hierarchy only; deterministic groups, caps, and empty state |
| High | Graph/Note selection/link | selected note loads and linked navigation remains current-request safe |
| High | dark/light/local fonts | exact token variables; no remote URL/import |
| Medium | 1180px/760px | drawers reopen; center action remains reachable |

## Interface and Function Checklist

- [ ] Preserve `KnowledgeGraph`, `NoteContentState`, `sourcePath`, `workspaceRoot`, `onChooseSourcePath`, `onSourcePathChange`, `onWorkspaceRootChange`, `onImportSource`, other workspace callbacks, and React Flow selection.
- [ ] `normalizeWorkspaceTree`, `resolveArtifactView`, `resolveResponsivePanels` are pure/tested.
- [ ] Desktop window controls call verified Wails runtime actions and remain masked in pixel tests.
- [ ] Semantic landmarks, button labels, `aria-expanded`, selected state, and fallback list exist.
- [ ] `App.tsx` still owns real backend orchestration until phase 7 extracts chat/settings hooks.

## Dependency Map

Phase 3 stabilizes the real tree DTO. Phase 6 runs independently of phases 2/4/5, does not edit `main.go` or AI bindings, and joins phase 5 to block phase 7; phase 8 owns final pixel/a11y/package gates.

## Tests Before

- RED: `cd apps/desktop/frontend && npm run test`
- Expected RED after adding new shell/tree contract tests: missing components/functions/tokens and current source still contains sample fallback/hard-coded tree.
- Baseline protection: existing `graph-data`, `note-content`, `workspace-actions`, and action-label tests stay green.

## Refactor

Split by visible responsibility before styling. Keep `App.tsx`, each component, and each CSS module near or below 200 lines; make `app.css` import-only. Do not change Go workspace/graph/import/tools contracts.

## Tests After

- GREEN: `cd apps/desktop/frontend && npm run test`
- Build: `cd apps/desktop/frontend && npm run build`
- Backend regression: `cd apps/desktop && go test ./...` (does not assume parallel phases 2/4/5 have already landed).

## Implementation Steps

- [ ] First fix `package.json` test discovery to `tsc --noEmit && node --test --experimental-strip-types`; add a nested sentinel and test-count proof; run all existing nested suites.
- [ ] Write real-tree normalization/no-phantom-data tests; run RED; implement pure tree data; run GREEN.
- [ ] Write shell landmarks/action/tab/drawer tests; run RED; extract title/rail/artifact/note components; run GREEN.
- [ ] Commit: `refactor(desktop): compose reference workspace shell`.
- [ ] Write token/theme/font-source tests; run RED; split CSS, move the existing Inter binary/license into canonical font paths, add licensed local fonts, and reject duplicates; run GREEN.
- [ ] Style React Flow and note states from real data; run graph/note/workspace tests and build.
- [ ] Commit: `feat(desktop): apply reference shell design system`.
- [ ] Verify empty, disconnected, and loaded fixtures manually at three viewports; run Go regression.

## Success Criteria

- [ ] Shell structure/tokens match reference contract without fake data or inert controls.
- [ ] Existing workspace actions, graph selection, note read, and stale-request guards pass unchanged.
- [ ] CSS/component modularization thresholds and frontend build pass.

## Security, Risks, and Rollback

- Risk: literal prototype port reintroduces fake data/inline styles. Mitigation: source scans and real-data tests.
- Risk: native window action differences. Mitigation: isolate adapter and verify per OS in phase 8.
- Rollback: restore old shell imports while retaining pure tree/token modules; no backend or workspace migration is involved.
