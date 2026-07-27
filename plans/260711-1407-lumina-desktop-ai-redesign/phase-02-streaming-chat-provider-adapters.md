---
phase: 2
title: "Streaming chat provider adapters"
status: completed
priority: P1
effort: "4d"
dependencies: [1]
---

# Phase 02: Streaming Chat Provider Adapters

## Overview

Implement four direct-HTTP streaming chat adapters behind one normalized contract, with origin-bound credentials, safe endpoints, bounded SSE, cancellation, stable errors, and retry only before visible output.

## Context Links

- `brainstorm-summary.md` lines 194-213, 252-266
- `research/chat-backend-security-research.md` lines 24-66, 105-126
- `reports/scout-phases-01-02-foundations-providers.md`

## Requirements

- OpenAI Responses SSE, Anthropic Messages SSE with pinned version, Gemini `streamGenerateContent?alt=sse`, and OpenAI-compatible `/v1/chat/completions` SSE.
- HTTPS except validated literal/resolved loopback HTTP; reject userinfo, credential-like query keys, metadata/link-local targets, DNS rebinding, and cross-origin auth forwarding.
- Cap line/event/body/output/idle/total duration; ignore unknown event kinds; stable sanitized error codes; one retry before first delta for transport/429/5xx only.

## Architecture

```go
type ChatProvider interface { Stream(context.Context, ProviderRequest, StreamSink) (Usage, error) }
type StreamSink interface { Emit(ProviderEvent) error }
type HTTPDoer interface { Do(*http.Request) (*http.Response, error) }
type ProviderEvent struct { Kind EventKind; Text string; Usage Usage }
```

`EndpointPolicy.Validate(ctx, URL, credentialOrigin)` returns approved addresses for each hop. `PinnedTransport` installs a proxy-disabled `DialContext` that connects only to those addresses while preserving the validated URL host for HTTP `Host` and TLS SNI; redirects repeat validation and pinning before credentials attach. Shared SSE parsing emits provider-neutral deltas; adapters own request/response envelopes only.

## Related Code Files

- Create: `apps/desktop/internal/ai/providers/types.go`, `endpoint.go`, `transport.go`, `sse.go`, `retry.go`, `openai.go`, `anthropic.go`, `gemini.go`, `openai-compatible.go` and colocated tests.
- Read/protect: `apps/desktop/internal/tools/service.go`, `apps/desktop/internal/tools/service_test.go`, and phase-1 settings/secrets contracts.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Create | `apps/desktop/internal/ai/providers/types.go` | provider request/event/error contracts | 120 + compile cases |
| Create | `apps/desktop/internal/ai/providers/endpoint.go` | URL/origin/resolver/redirect policy | 190 + 18 cases |
| Create | `apps/desktop/internal/ai/providers/transport.go` | approved-IP dial pinning, SNI/Host, proxy disable | 170 + rebinding matrix |
| Create | `apps/desktop/internal/ai/providers/sse.go` | bounded fragmented SSE parser | 170 + 15 cases |
| Create | `apps/desktop/internal/ai/providers/openai.go` | Responses adapter | 170 + `httptest` matrix |
| Create | `apps/desktop/internal/ai/providers/anthropic.go` | Messages adapter | 170 + matrix |
| Create | `apps/desktop/internal/ai/providers/gemini.go` | Gemini adapter | 170 + matrix |
| Create | `apps/desktop/internal/ai/providers/openai-compatible.go` | compatible/Ollama adapter | 170 + matrix |
| Create | `apps/desktop/internal/ai/providers/retry.go` | pre-delta bounded retry/stable errors | 100 + 10 cases |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | fragmented/multiline/unknown SSE | ordered deltas; unknown ignored; no scanner truncation |
| Critical | cancel/idle/total timeout/oversize | request closes; one sanitized terminal error |
| Critical | redirect, rebinding, private/metadata target | request rejected before credential forwarding |
| Critical | DNS answer changes between validation/dial | connection uses only approved address or fails closed |
| Critical | environment proxy configured | credentialed custom endpoint bypasses proxy; no auth leakage |
| High | 401/403/404/429/5xx | stable code; retry at most once and only pre-delta |
| High | malformed event/raw provider error | capped `invalid_stream`; body and credentials absent |
| Medium | refusal, empty completion, usage | normalized provider-neutral events and usage |

## Interface and Function Checklist

- [x] `ChatProvider.Stream`, `StreamSink.Emit`, `HTTPDoer.Do`, injected resolver/clock/backoff.
- [x] Bounded `ParseSSE` handles CRLF, fragmentation, multiline `data`, comments, EOF, cancellation, persistent IDs, and zero-progress readers.
- [x] Endpoint policy returns approved IPs; pinned transport binds the dial while preserving SNI/Host; redirects revalidate/re-pin and strip cross-origin credentials.
- [x] Adapter factory accepts validated profiles plus a backend credential resolver; adapters never retain a frontend key field.
- [x] Provider/status errors return stable codes without body, prompt, transcript, URL/IP, header, or credential data.

## Dependency Map

Phase 1 profile/secret contracts feed adapter construction. Phase 2 `ChatProvider` blocks phase 5 orchestration; embedding adapters remain phase 4 and independent from selected chat kind.

## Tests Before

- RED: `cd apps/desktop && go test ./internal/ai/providers -run 'SSE|Endpoint|OpenAI|Anthropic|Gemini|Compatible|Retry' -count=1`
- Expected RED: missing provider package initially; then missing parser/adapter symbols or unmet event/error assertions, never live-network or credential failures.
- Existing transport precedent: `apps/desktop/internal/tools/service_test.go` remains green for context timeout behavior.

## Refactor

Keep shared parsing, endpoint policy, retry, and errors provider-neutral. Keep each adapter below 200 lines; extract request/response DTOs into its file rather than branching one universal adapter.

## Tests After

- GREEN: `cd apps/desktop && go test ./internal/ai/providers -count=1`
- Race/cancel: `cd apps/desktop && go test -race ./internal/ai/providers`
- Regression: `cd apps/desktop && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers`

## Implementation Steps

- [x] Write SSE fragmentation/size/cancel tests; run RED; implement bounded parser; run GREEN.
- [x] Write endpoint redirect/DNS/private-range/rebinding/proxy/SNI tests; implement approved-IP pinned transport; pass spec and quality review.
- [x] Commit: `feat(desktop): add secure streaming transport` (`5520a252`).
- [x] Write OpenAI and Anthropic request/header/event tests; implement adapters; run GREEN.
- [x] Write Gemini and compatible/Ollama request/lifecycle/usage/refusal tests; implement adapters; run GREEN.
- [x] Commit: `feat(desktop): add chat provider adapters` (`059d53f5`).
- [x] Write status/retry-after-event/redaction/timeout tests; implement stable mapping and two-attempt pre-event retry; run GREEN/race/full regression.
- [x] Commit: `test(desktop): harden provider stream failures` (`dc927b46`).

## Success Criteria

- [x] All adapters satisfy one event contract and never use paid/live APIs in tests.
- [x] Cancellation reaches request/body/credential resolution; late or malformed bytes do not emit after terminal state.
- [x] Credential forwarding, error redaction, endpoint/DNS pinning, limits, lifecycle, usage, and retry rules are empirically covered.

## Completion Evidence

- Completed: 2026-07-12.
- Reviews: transport, adapters, and retry/error slices each passed spec-compliance and code-quality review after every finding was fixed and re-reviewed.
- Gates: focused/full provider tests, race detector, vet, full desktop regression, diff checks, and Windows/Linux/Darwin/FreeBSD package cross-compilation passed.
- Protocol sources: official OpenAI Responses streaming reference, Anthropic Messages event contract, and Google Gemini `streamGenerateContent` documentation; all tests use local fixtures/fakes.

## Security, Risks, and Rollback

- Risk: provider event drift. Mitigation: ignore unknown types and pin known fixture contracts.
- Risk: proxy/DNS bypass. Mitigation: disable proxy inheritance for credentialed custom endpoints and validate every resolved hop.
- Rollback: remove adapter registration while retaining phase 1 profiles; no workspace or cache cleanup required.
