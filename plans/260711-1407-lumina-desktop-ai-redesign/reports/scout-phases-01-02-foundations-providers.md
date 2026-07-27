# Deep Scout: Phases 01-02 Foundations and Providers

## Current Evidence

- Wails registers four services in `apps/desktop/main.go:22-26`; new AI/settings services follow this pattern.
- `workspace.Service.ResolveInside` is the current containment boundary at `internal/workspace/service.go:62`.
- `tools.Service` already injects executable path/timeout and uses `context.WithTimeout` at `internal/tools/service.go:31-64`.
- Frontend AI settings persist only provider/model in `localStorage` at `frontend/src/app/ai-settings-panel.tsx:17-49`; no backend contract exists.
- Go has 25 existing desktop tests across graph/import/tools/workspace; frontend shell has 5 structural tests.

## Phase 01 Inventory

| Action | File | Rough LoC | Test impact |
|---|---|---:|---|
| Modify | `apps/desktop/go.mod`, `go.sum` | keyring dependency | module/build gate |
| Create | `internal/ai/settings/types.go` | 100-150 | schema tests |
| Create | `internal/ai/settings/store.go` | 140-190 | atomic/migration tests |
| Create | `internal/ai/secrets/store.go` | under 100 | interface tests |
| Create | `internal/ai/secrets/keyring.go` | 100-150 | mock conformance tests |
| Create | `internal/ai/history/store.go` | 150-200 | lifecycle/isolation tests |
| Create | matching `*_test.go` | 250-350 total | 20+ focused cases |
| Modify | `apps/desktop/main.go` | service registration | Go smoke |

## Phase 01 Interface Checklist

- `ConfigStore.Load/Save`; unknown schema fail closed.
- `SecretStore.Put/Get/Delete/Status`; no Wails getter returning secret.
- `HistoryStore.List/Load/Append/Delete/DeleteAll/SetEnabled`.
- Atomic writes, user-only permissions, injected config/cache roots, clock/ID generator.
- Workspace identity canonicalization and path-reuse detection.

## Phase 01 Test Matrix

| Severity | Scenario | Expected |
|---|---|---|
| Critical | Binding serialization | no secret/key value field returned |
| Critical | keyring locked/missing | explicit status; confirmed session fallback only |
| Critical | history workspace alias/reuse | no cross-workspace transcript leak |
| High | malformed/unknown config | safe error, no overwrite |
| High | interrupted history append | atomic terminal record, no duplicate retry |
| Medium | delete/disable semantics | disable retains; delete purges selected scope |

## Phase 02 Inventory

| Action | File | Rough LoC | Test impact |
|---|---|---:|---|
| Create | `internal/ai/providers/provider.go` | under 120 | shared contract |
| Create | `internal/ai/providers/sse.go` | 120-180 | fragmented parser tests |
| Create | `openai.go`, `anthropic.go`, `gemini.go`, `openai-compatible.go` | 120-190 each | adapter tests |
| Create | provider `*_test.go` | 300-450 total | `httptest.Server` matrix |

## Phase 02 Interface Checklist

- `ChatProvider.Stream(context.Context, ProviderRequest, StreamSink)`.
- Normalized `started/delta/usage/completed/failed`; exactly one terminal state.
- Inject `HTTPDoer`, resolver, clock/backoff, sink.
- Profile-specific auth/base URL/model/version validation.
- Same-origin redirect and endpoint/IP policy before credentials attach.

## Phase 02 Test Matrix

| Severity | Scenario | Expected |
|---|---|---|
| Critical | fragmented/multiline/unknown SSE | normalized ordered deltas; unknown ignored |
| Critical | cancel/timeout/oversized event | request stops; stable sanitized error |
| Critical | redirect/rebinding/private target | credentials never forwarded |
| High | 401/403/404/429/5xx | stable error code; bounded retry before first delta only |
| High | malformed JSON/provider error | capped sanitized failure |
| Medium | usage/refusal/empty completion | provider-specific normalization |

## Dependency Map

Phase 01 profile/secrets contracts block Phase 02 auth/profile construction. Phase 02 blocks Phase 05 orchestration. Phase 01 history blocks Phase 05 persistence and Phase 07 settings UI.

## TDD Commands

- RED: `cd apps/desktop && go test ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history`
- RED: `cd apps/desktop && go test ./internal/ai/providers`
- Expected first failure: missing packages/types or unmet behavior assertion, never fixture/setup error.
- Regression: `cd apps/desktop && go test ./...`

## Unresolved Questions

None.
