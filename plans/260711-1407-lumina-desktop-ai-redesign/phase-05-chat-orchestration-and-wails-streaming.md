---
phase: 5
title: "Chat orchestration and Wails streaming"
status: pending
priority: P1
effort: "4d"
dependencies: [1, 2, 3, 4]
---

# Phase 05: Chat Orchestration and Wails Streaming

## Overview

Assemble bounded workspace evidence, stream normalized provider output through a cancellable Wails binding, validate backend-owned citations, and persist exactly one terminal history attempt when enabled.

## Context Links

- `brainstorm-summary.md` lines 226-266, 279-307
- `research/chat-backend-security-research.md` lines 54-66, 105-126
- `reports/scout-phases-03-05-retrieval-chat.md`
- Existing Wails service registration: `apps/desktop/main.go:22-27`; generated cancellable bindings: `apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`.

## Requirements

- State machine `idle -> starting -> streaming -> completed|failed|cancelled`; per request/window bounded buffer, monotonic sequence, exactly one terminal event, cleanup on cancel/terminal/window close.
- Context reserves system rules, current question, recent history, then ranked evidence under char and UTF-8 byte caps; truncate only at turn/chunk boundaries.
- Retrieved Markdown is quoted untrusted evidence; backend assigns `S1`, `S2`; unknown/stale/duplicate citations never become navigable paths.
- Semantic disabled/stale/offline/failure visibly falls back to lexical; retry once only before first delta; history terminal record once.
- The native Open flow activates a backend workspace session capability. `ChooseAndActivateWorkspace` opens the directory picker inside the trusted backend; a manually typed root must pass a backend-native confirmation prompt through `ConfirmAndActivateWorkspace`. No public method mints a capability from an unconfirmed caller path. Chat/history/index/tree/citation methods accept only the resulting capability and reject forged, expired, stale-generation, or cross-window use.
- Cancellation is explicit: `CancelChat(sessionID, requestID)` signals backend work; stream events remain authoritative for terminal state.

## Architecture

```go
type ChatRequest struct { RequestID, WorkspaceSessionID, ConversationID, Question, SelectedPath string }
type StreamEvent struct { WorkspaceSessionID, RequestID string; Seq uint64; Kind EventKind; Delta string; Citation *CitationDTO; Usage *UsageDTO; Error *SafeError }
type StreamSink interface { Emit(context.Context, StreamEvent) error }
func (s *Service) Chat(ctx context.Context, req ChatRequest) (ChatCompletion, error)
func (s *Service) CancelChat(workspaceSessionID, requestID string) error
```

`Orchestrator` resolves the backend-owned loaded workspace from a window-bound capability, retrieves, rereads hashes, builds an evidence allowlist, calls `ChatProvider`, resolves cited evidence IDs backend-side, then records terminal history. `WailsStreamSink` only emits typed events to the owning window.

The phase-5 Wails facade is the sole composition owner. Its complete exported surface is: `ChooseAndActivateWorkspace`, `ConfirmAndActivateWorkspace`, `DeactivateWorkspace`, profile/settings list-save-delete, credential status/begin-confirm-delete, history enable-list-load-delete-delete-all, index status-build-cancel-clear, `WorkspaceTree`, `Chat`, `CancelChat`, and `ReadCitationNote`. Secret bytes occur only in write/confirm request arguments and never in response DTOs.

## Related Code Files

- Create: `apps/desktop/internal/ai/chat/types.go`, `context.go`, `citations.go`, `orchestrator.go` and colocated tests.
- Create: `apps/desktop/internal/ai/types.go`, `service.go`, `wails-stream.go` and tests.
- Modify/regenerate: `apps/desktop/main.go`, `apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/`.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Create | `apps/desktop/internal/ai/chat/types.go` | request/context/evidence/completion contracts | 130 + compile cases |
| Create | `apps/desktop/internal/ai/chat/context.go` | deterministic budgets/evidence delimiters | 180 + 15 cases |
| Create | `apps/desktop/internal/ai/chat/citations.go` | allowlist ID/path/span resolution | 130 + 12 cases |
| Create | `apps/desktop/internal/ai/chat/orchestrator.go` | retrieval/provider/history coordination | 200 + 20 cases |
| Create | `apps/desktop/internal/ai/types.go` | Wails-safe DTOs/stable errors | 120 + serialization cases |
| Create | `apps/desktop/internal/ai/service.go` | Wails validation/facade | 170 + facade cases |
| Create | `apps/desktop/internal/ai/wails-stream.go` | window-scoped event sink/sequencer | 120 + lifecycle cases |
| Modify | `apps/desktop/main.go` | inject/register AI service and window sink | under 35 + smoke |
| Regenerate | `apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/` | cancellable Chat/settings/index/history DTOs | generated + TS gate |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | cancel/start/terminal race | monotonic events and exactly one cancelled/completed/failed terminal |
| Critical | concurrent request/window | scoped events; no cross-conversation content leak; bounded buffer |
| Critical | forged/stale/cross-window workspace capability | rejected before any read, history lookup, retrieval, or provider call |
| Critical | direct activation with arbitrary shaped root | no capability without trusted native choose/confirmation; cancellation/denial performs zero AI reads |
| Critical | fake delimiter/instruction/exfiltration | quoted evidence cannot alter system/tool policy |
| Critical | unknown/stale/duplicate evidence IDs | rejected/deduped; no attacker path reaches frontend |
| High | char/byte/history/evidence budgets | deterministic whole-boundary truncation |
| High | semantic failure | lexical context and visible fallback status |
| High | retry/history | no retry after delta; one linked terminal attempt |
| Medium | window close/sink error | provider context cancelled; listener/buffer released |

## Interface and Function Checklist

- [ ] `ContextBuilder.Build`, `EvidenceAllowlist.Resolve`, `Orchestrator.Chat`.
- [ ] `TerminalGuard.Emit` owns sequence and rejects late/duplicate terminals.
- [ ] `Service.ChooseAndActivateWorkspace` and `ConfirmAndActivateWorkspace` create a window-bound capability/generation only after trusted native user action; all read APIs resolve it rather than accepting a root.
- [ ] `Service.Chat` validates sizes/IDs/session and returns only safe completion metadata; `CancelChat` is idempotent and request-scoped.
- [ ] Complete facade includes settings, credential challenge, history, index, tree, chat/cancel, and broad citation-read methods before bindings regenerate.
- [ ] `WailsStreamSink` is the sole Wails-specific event adapter; domain tests inject memory sink.
- [ ] DTO/error serialization contains no credentials, raw provider body, prompt, excerpt, or transcript.

## Dependency Map

Phases 1-4 supply settings/secrets/history, provider stream, corpus/lexical/tree, and optional hybrid search. Phase 5 alone owns generated AI service registration and blocks phase 7. Phase 6 can proceed after phase 3 without touching `main.go` or AI bindings.

## Tests Before

- RED: `cd apps/desktop && go test ./internal/ai/chat ./internal/ai -run 'Context|Citation|Chat|Stream|Cancel|Fallback|Redact' -count=1`
- Expected RED: missing chat/facade package first; then missing builder/orchestrator/sink or wrong sequence/budget/citation assertions.
- Binding RED after frontend imports `Chat`: `cd apps/desktop/frontend && npm run build` fails with TS module/export-not-found until bindings regenerate.

## Refactor

Keep Wails emission out of domain orchestration. Keep `main.go` construction-only; split context/citations from orchestration before either exceeds 200 lines. Reuse current workspace request-ID concept but do not place chat state in `App.tsx`.

## Tests After

- GREEN: `cd apps/desktop && go test ./internal/ai/chat ./internal/ai -count=1`
- Race: `cd apps/desktop && go test -race ./internal/ai/chat ./internal/ai`
- Bindings: `cd apps/desktop && wails3 generate bindings -clean=true -ts && cd frontend && npm run build`
- Regression: `cd apps/desktop && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers ./internal/ai/retrieval ./internal/ai/index ./internal/ai/chat`

## Implementation Steps

- [ ] Write context budget/injection/citation allowlist tests; run RED; implement context and citations; run GREEN.
- [ ] Commit: `feat(desktop): build bounded cited chat context`.
- [ ] Write provider/fallback/retry/history orchestration tests; run RED; implement orchestrator; run GREEN.
- [ ] Write stream race/concurrency/window-close tests; run RED; implement terminal guard and Wails sink; run GREEN/race.
- [ ] Write forged/stale/cross-window/direct-root capability, native-denial, and explicit-cancel handshake tests; run RED; implement trusted activation registry and request cancellation; run GREEN/race.
- [ ] Commit: `feat(desktop): orchestrate cancellable chat streams`.
- [ ] Write complete Wails facade serialization/validation tests for every listed method; run RED; implement facade and sole `main.go` registration; run GREEN.
- [ ] Regenerate bindings, inspect for secret fields/getters, run TS build/full Go regression.
- [ ] Commit: `feat(desktop): expose safe AI service bindings`.

## Success Criteria

- [ ] Every request produces ordered events and one terminal event under race tests.
- [ ] Only current allowlisted evidence becomes a citation path; prompt-injection fixtures cannot request tools or secrets.
- [ ] Chat/retrieval/history leaves workspace manifest byte-identical and sanitized errors pass scans.

## Security, Risks, and Rollback

- Risk: global Wails events leak across windows. Mitigation: window-owned sink and request ID filtering, not app-wide broadcast.
- Risk: backpressure stalls provider. Mitigation: bounded buffer and cancellation on overflow/sink failure.
- Rollback: unregister AI service/event adapter; phase 1-4 stores/index remain clearable and existing desktop services continue.
