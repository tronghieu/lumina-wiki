---
phase: 7
title: "Agent chat and settings integration"
status: pending
priority: P1
effort: "4d"
dependencies: [5, 6]
---

# Phase 07: Agent Chat and Settings Integration

## Overview

Connect the reference Agent panel and Settings dialog to generated backend contracts: ordered streaming, cancellation, retry, citations, history controls, provider profiles, credentials, consent, and index lifecycle.

## Context Links

- `brainstorm-summary.md` lines 167-191, 226-266, 270-307
- `research/ui-fidelity-component-research.md` lines 90-160
- `reports/scout-phases-06-08-frontend-visual.md`
- Replace current frontend settings persistence in `frontend/src/app/ai-settings-panel.tsx`; keep current stale workspace/note request guards in `frontend/src/App.tsx:42-43,173-199,219-237`.

## Requirements

- Subscribe before invoking `Chat`; filter workspace session/request ID and strictly increasing sequence. Cancel calls `CancelChat`, keeps the listener alive until the matching terminal event, and only then cleans up; a bounded timeout handles a lost terminal. Binding promise settlement is not terminal truth.
- Keep editable `draftWorkspaceRoot` separate from atomic `loadedWorkspace { sessionID, root, workspaceID, generation }`; chat/history/index/tree/citations use only the loaded session.
- Open calls backend `ChooseAndActivateWorkspace`; activating an edited draft calls backend `ConfirmAndActivateWorkspace` and changes loaded state only after native confirmation succeeds.
- Render actual user/provider events only; cancel/retry/new chat/history enable-disable-delete; valid citations navigate to real graph nodes and unknown citations remain inert.
- Settings normalizes independent chat/embedding profiles, never receives secret values, clears ephemeral credential input, defaults semantic mode off, and requires matching disclosure consent.

## Architecture

```ts
type ChatState = { requestId: string | null; phase: 'idle'|'starting'|'streaming'|'completed'|'failed'|'cancelled'; lastSeq: number; messages: ChatMessage[]; citations: Citation[] };
type ChatAction = { type: 'submit'; requestId: string; text: string } | { type: 'event'; event: StreamEvent } | { type: 'reset' };
export function reduceChat(state: ChatState, action: ChatAction): ChatState;
export interface ChatBridge { onStream(cb: (event: StreamEvent) => void): () => void; chat(req: ChatRequest): Promise<ChatCompletion>; cancelChat(workspaceSessionId: string, requestId: string): Promise<void>; }
```

`useChatStream` owns subscribe/start/explicit-cancel/terminal-handshake cleanup. Pure reducer enforces state and sequence. Settings view-model maps backend DTOs to forms; credential text exists only in component state until save or nonce confirmation completes.

## Related Code Files

- Create: `apps/desktop/frontend/src/features/chat/chat-types.ts`, `chat-state.ts`, `use-chat-stream.ts`, `agent-panel.tsx`, and focused tests.
- Create: `apps/desktop/frontend/src/features/settings/ai-settings.ts`, `ai-settings.test.mjs`.
- Modify: `apps/desktop/frontend/src/App.tsx`, `app/ai-settings-panel.tsx`, `app/app-shell.tsx`; verify generated `apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/`.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Modify | `apps/desktop/frontend/src/App.tsx` | delegate chat/settings/theme; citation-to-node bridge | reduce below 200; integration cases |
| Create | `apps/desktop/frontend/src/features/chat/chat-types.ts` | UI event/message/citation types | 90 + type gate |
| Create | `apps/desktop/frontend/src/features/chat/chat-state.ts` | pure stream reducer/retry/reset | 170 + 15 cases |
| Create | `apps/desktop/frontend/src/features/chat/use-chat-stream.ts` | Wails subscribe/cancel/cleanup | 150 + adapter cases |
| Create | `apps/desktop/frontend/src/features/chat/agent-panel.tsx` | messages/composer/history/collapse | 200 + structural cases |
| Create | `apps/desktop/frontend/src/features/chat/chat-state.test.mjs` | ordered/race/cancel/retry tests | 15 cases |
| Refactor | `apps/desktop/frontend/src/app/ai-settings-panel.tsx` | accessible dialog shell | under 150 + source contract |
| Create | `apps/desktop/frontend/src/features/settings/ai-settings.ts` | normalize profiles/status/consent | 180 + 12 cases |
| Create | `apps/desktop/frontend/src/features/settings/ai-settings.test.mjs` | secret/default/compatibility cases | 12 cases |
| Modify | `apps/desktop/frontend/src/app/app-shell.tsx` | mount Agent panel/dialog props | under 50 change |
| Verify | `apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/` | generated service/models/events | scan + typecheck |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | early delta and subscribe ordering | listener registered before backend call; first delta retained |
| Critical | stale/out-of-order/duplicate terminal | ignored; current request remains monotonic with one terminal |
| Critical | cancel/unmount/window close | backend cancel requested once; listener retained through terminal handshake then removed once |
| Critical | binding rejects before terminal event | listener remains; matching backend terminal determines final state |
| Critical | draft root edited after load | loaded graph/chat/history/citations stay on one session identity until successful activation |
| Critical | typed root activation denied/cancelled | prior loaded session remains intact; no new AI read or capability |
| Critical | credential save/serialization | password clears; no secret in storage/state/binding response |
| High | retry | linked attempt; user message not duplicated; old request cannot append |
| High | citation click | graph citation selects node; allowlisted non-graph citation opens note artifact through backend; unknown stays inert |
| High | semantic disabled/stale | lexical fallback/status; no embedding call when off |
| Medium | history/new chat | correct workspace scope; profile/theme/workspace retained |

## Interface and Function Checklist

- [ ] `reduceChat` filters request/sequence/terminal state and caps rendered output.
- [ ] `startChat(bridge, req, dispatch)` subscribes synchronously; explicit cancel waits for authoritative terminal or timeout before cleanup.
- [ ] `AgentPanel` has real composer, Cancel, Retry, New chat, citation buttons, live region, collapse/reopen controls.
- [ ] `normalizeSettings`, `credentialStatusLabel`, `consentRequired`; no frontend `localStorage` for AI profiles/secrets/history.
- [ ] Citation navigation resolves current graph nodes or calls `ReadCitationNote` with an opaque citation ID; never accepts arbitrary filesystem paths.
- [ ] Workspace view-model separates draft root from backend-issued loaded session and atomically clears prior graph/note/chat on successful activation only.
- [ ] Open/typed-root flows use trusted backend chooser/confirmation methods; frontend cannot mint a session by calling validation with a path.

## Dependency Map

Phase 5 generated bindings and stream semantics plus phase 6 shell slots block phase 7. Phase 1 supplies settings/history/secret statuses; phase 4 supplies index controls. Phase 8 validates rendered integration.

## Tests Before

- RED: `cd apps/desktop/frontend && npm run test`
- Expected RED: new `chat-state.test.mjs` and settings tests fail on missing reducer/bridge/normalizer; old structural test expecting no chat controls must be replaced by real-chat/no-canned-response assertions.
- Binding RED: `npm run build` fails if any planned AI service/model export is absent or stale.

## Refactor

Move async stream logic out of `App.tsx`; move state transitions out of JSX; keep Wails imports in bridge/settings gateway modules. Split `AgentPanel` if it exceeds 200 lines into message list and composer.

## Tests After

- GREEN: `cd apps/desktop/frontend && npm run test`
- Build: `cd apps/desktop/frontend && npm run build`
- Binding/regression: `cd apps/desktop && wails3 generate bindings -clean=true -ts && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers ./internal/ai/retrieval ./internal/ai/index ./internal/ai/chat && cd frontend && npm run build`

## Implementation Steps

- [ ] Write reducer ordering/terminal/retry/reset tests; run RED; implement `chat-state.ts`; run GREEN.
- [ ] Write subscribe-before-call/explicit-cancel/promise-reject-before-terminal/timeout cleanup tests; run RED; implement `use-chat-stream.ts`; run GREEN.
- [ ] Commit: `feat(desktop): connect cancellable chat state`.
- [ ] Replace no-chat structural test with real composer/no-canned-response contract; run RED; implement Agent panel; run GREEN.
- [ ] Write settings normalization/secret/consent/index tests; run RED; refactor dialog and backend gateways; run GREEN.
- [ ] Commit: `feat(desktop): connect AI settings and history`.
- [ ] Add citation-to-node and semantic-fallback integration tests; run RED; wire `App.tsx`/shell; run GREEN.
- [ ] Regenerate/scan bindings, run frontend build/full Go tests, then commit `feat(desktop): integrate cited agent chat`.

## Success Criteria

- [ ] Real streamed chat cancels, retries, cites, resets, persists/clears history, and cleans listeners.
- [ ] No fake response, phantom message, frontend secret persistence, or arbitrary citation navigation remains.
- [ ] `App.tsx` and Agent/settings modules meet modularity targets and all existing workspace flows pass.

## Security, Risks, and Rollback

- Risk: stale events overwrite a new workspace/conversation. Mitigation: request ID, sequence, terminal reducer, and workspace reset action.
- Risk: frontend errors echo sensitive values. Mitigation: render backend stable codes only and clear password state in `finally`.
- Rollback: hide Agent/settings integration and unregister listeners; backend phases remain independently testable and workspace stays unchanged.
