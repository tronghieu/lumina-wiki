# Deep Scout: Phases 06-08 Frontend and Visual Gates

## Scope

Current frontend mapped against approved brainstorm and `.dc.html`. No implementation performed.

## Current Evidence

- `App.tsx`: 264 lines; owns workspace, graph, note, check, and import state.
- `app.css`: 842 lines; already exceeds modularization threshold.
- `app-shell.tsx`: 181 lines; hard-coded tree and current three-column composition.
- `node-inspector.tsx`: 162 lines; current selected-note/workspace/check surface.
- `ai-settings-panel.tsx`: 92 lines; non-functional provider/model settings in `localStorage`.
- Frontend runner: `tsc --noEmit` plus Node test with TypeScript stripping.
- Existing layout contract: 5 source-level tests in `app-shell-layout.test.mjs`.
- Existing graph/workspace pure modules already have focused tests and should remain the behavior seams.

## Phase 06: Reference-Faithful Workspace Shell

### File Inventory

| Action | File | Rough change | Test impact |
|---|---|---:|---|
| Modify | `frontend/src/app/app-shell.tsx` | split composition, remove phantom tree | layout contract |
| Create | `frontend/src/app/desktop-title-bar.tsx` | 80-120 lines | structural/window action tests |
| Create | `frontend/src/features/workspace/workspace-rail.tsx` | 120-170 lines | tree/rail tests |
| Create | `frontend/src/features/workspace/workspace-tree-data.ts` | 80-120 lines | pure grouping tests |
| Create | `frontend/src/features/workspace/workspace-tree.test.mjs` | 8-12 tests | new |
| Create | `frontend/src/features/graph/artifact-pane.tsx` | 140-190 lines | structural contract |
| Create | `frontend/src/features/graph/note-view.tsx` | 60-100 lines | note states |
| Modify | `frontend/src/features/graph/graph-view.tsx` | styling/accessibility props | graph tests |
| Modify | `frontend/src/features/graph/graph-data.ts` | dim/highlight semantics | graph-data tests |
| Split | `frontend/src/app.css` | tokens/shell/graph/components/theme files | token/layout contract |
| Add | `frontend/public/fonts/*` + licenses | exact local font assets | packaging/font-load check |

### Interface Checklist

- Preserve `AppShell` workspace action callbacks.
- Preserve `GraphView` selection callback and real `KnowledgeGraph` input.
- Preserve `NoteContentState` loading/error/loaded states.
- Add real `activeView`, theme, rail, and Agent panel state; no hard-coded content.
- Window controls call Wails runtime only after API verification.

### Test Matrix

| Severity | Scenario | Expected |
|---|---|---|
| Critical | Reference token/layout contract | exact required values and landmarks |
| Critical | Workspace tree grouping | only real graph paths, deterministic order |
| High | Graph/Note tab | real graph and selected note states |
| High | Search | unmatched nodes dim; selected/linked remain visible |
| High | Theme | dark/light persisted, no flash with wrong token set |
| Medium | Empty/disconnected workspace | reference shell remains usable |

### TDD Gate

- RED: `cd apps/desktop/frontend && npm run test` fails on new token/shell/tree expectations.
- GREEN: focused tests and TypeScript pass.
- Regression: existing Open/Refresh/Source/Check/Import contract stays reachable.

## Phase 07: Agent Chat and Settings Integration

### File Inventory

| Action | File | Rough change | Test impact |
|---|---|---:|---|
| Modify | `frontend/src/App.tsx` | delegate chat/settings/theme hooks; reduce below 200 lines | app integration |
| Replace | `frontend/src/features/graph/node-inspector.tsx` | narrow compatibility or delete after Agent port | layout contract |
| Create | `frontend/src/features/chat/agent-panel.tsx` | 160-200 lines | structural contract |
| Create | `frontend/src/features/chat/chat-state.ts` | 120-180 lines | pure reducer tests |
| Create | `frontend/src/features/chat/chat-state.test.mjs` | 10-15 tests | new |
| Create | `frontend/src/features/chat/use-chat-stream.ts` | 100-160 lines | listener/cancel tests via pure adapter |
| Create | `frontend/src/features/chat/chat-types.ts` | under 100 lines | typecheck |
| Refactor | `frontend/src/app/ai-settings-panel.tsx` | dialog shell only | settings contract |
| Create | `frontend/src/features/settings/ai-settings.ts` | normalization/view state | pure settings tests |
| Create | `frontend/src/features/settings/ai-settings.test.mjs` | 8-12 tests | new |
| Modify | generated Wails bindings | AI service DTOs/methods | binding verification |

### Interface Checklist

- Event subscription completes before `Chat` call.
- Reducer filters `requestId` and monotonic `seq`.
- Exactly one terminal state; stale/duplicate events ignored.
- Cancel signal reaches generated cancellable binding.
- Settings never receive a secret back from Go.
- Citation click maps allowlisted note path to graph node selection.
- History opt-out/delete affects local app storage only.

### Test Matrix

| Severity | Scenario | Expected |
|---|---|---|
| Critical | Secret save | ephemeral input clears; no serialization |
| Critical | Stream ordering/race | stale and duplicate events ignored |
| Critical | Cancel | one cancelled terminal state, listener cleanup |
| High | Retry | linked attempt; no duplicate user message |
| High | Citation | valid navigates; unknown remains inert |
| High | Missing provider/index | actionable state; lexical fallback |
| Medium | New chat/history | settings/workspace preserved |

### TDD Gate

- RED: replace current `agent panel does not expose fake chat controls` test with real-chat/no-canned-response contract.
- GREEN: pure state/settings tests, structural test, `tsc --noEmit`.
- Regression: graph/note/workspace actions remain functional.

## Phase 08: Visual, Accessibility, Packaging, Release Gates

### File Inventory

| Action | File | Purpose |
|---|---|---|
| Create | `frontend/src/styles/tokens.css` | exact dark/light tokens/fonts |
| Create | `frontend/src/styles/shell.css` | reference geometry/responsive drawers |
| Create | `frontend/src/styles/graph.css` | React Flow reference styling |
| Create | `frontend/src/styles/chat.css` | Agent panel/messages/composer |
| Create | `frontend/src/styles/dialog.css` | Settings and menus |
| Modify | `frontend/src/app.css` | import-only compatibility entry, under 80 lines |
| Modify | `frontend/package.json` | visual command only if existing tools suffice |
| Modify | `apps/desktop/README.md` | chat/config/privacy/index workflow |
| Create | plan/reference visual metadata/assets | viewport, DPR, masks, screenshots |

### Dependency Map

`Phase 06 shell -> Phase 07 Agent integration -> Phase 08 visual/a11y/package gates`.
Phase 08 also requires phases 01-05 bindings and real states so screenshots contain no fake data.

### Test Matrix

| Severity | Scenario | Expected |
|---|---|---|
| Critical | 1480x920 dark/light | non-dynamic shell <=2% pixel difference |
| Critical | control inventory | every visible control has real handler/state |
| High | 1180px/760px | tree/chat reopenable drawers; actions reachable |
| High | keyboard/focus | dialog trap/restore, tree, composer, graph fallback |
| High | contrast/reduced motion | 4.5:1 text; motion disabled correctly |
| High | font/package | local fonts/licenses present; no remote import |
| High | packaged Wails smoke | bindings/assets/stream/settings launch correctly |

### TDD and Regression Commands

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 generate bindings -clean=true -ts`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Risks

- Structural source tests cannot prove rendering; retain screenshot gate.
- Reference inline CSS contains remote fonts and fake states; local assets and real fixtures must be pinned.
- Wails window controls differ by OS; mask OS-rendered areas and verify semantics separately.
- `App.tsx` and `app.css` must be reduced, not expanded.

## Unresolved Questions

None.
