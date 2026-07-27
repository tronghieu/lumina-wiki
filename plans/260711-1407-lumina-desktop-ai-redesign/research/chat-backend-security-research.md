# Chat Backend and Security Research

Research date: 2026-07-11

## Recommendation

Real provider-backed chat is feasible without changing Lumina workspaces. Keep all network access, retrieval, credentials, and persistence in Go. The React frontend should receive typed settings/status and streamed events only. Chat and embedding providers must be independently configurable; lexical retrieval remains available when semantic indexing is disabled, stale, unavailable, or fails.

Do not add a vector database. Personal-wiki scale supports an exact cosine scan over flat float32 files, combined with a small lexical index. Persist chat history locally per workspace after disclosure, with opt-out and explicit delete-one/delete-all controls; never store it in the workspace.

## Service boundaries

```text
internal/ai/
  service.go                 Wails-facing validation and DTOs
  chat/                      retrieval, context assembly, orchestration
  providers/                 OpenAI, Anthropic, Gemini, OpenAI-compatible
  retrieval/                 chunking, lexical search, rank fusion
  index/                     incremental flat embedding index
  settings/                  non-secret application configuration
  secrets/                   OS credential store abstraction
```

Core contracts:

```go
type ChatProvider interface {
    Stream(context.Context, ChatRequest, StreamSink) (Usage, error)
}

type EmbeddingProvider interface {
    Embed(context.Context, []string) (EmbeddingBatch, error)
}

type SecretStore interface {
    Put(context.Context, string, []byte) error
    Get(context.Context, string) ([]byte, error)
    Delete(context.Context, string) error
}
```

Prefer direct `net/http` adapters in the first implementation. This keeps dependencies small and makes cancellation, redirect policy, timeouts, response limits, and safe error mapping uniform.

## Provider adapters

- **OpenAI chat:** native `POST /v1/responses` with SSE; normalize text delta, refusal, completion, usage, and error events. [OpenAI streaming reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/queued)
- **Anthropic chat:** `POST /v1/messages` with `stream: true`; normalize `content_block_delta`, `message_delta`, `message_stop`, and stream errors. Ignore unknown event types safely, as required by its versioning guidance. [Anthropic streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming)
- **Gemini chat:** `models/{model}:streamGenerateContent?alt=sse`; normalize candidate text and usage. [Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation)
- **OpenAI-compatible chat:** `/v1/chat/completions` SSE. This covers Ollama and other compatible endpoints. Bearer authentication is optional per profile. [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- **Embeddings:** implement OpenAI-compatible `/v1/embeddings` and Gemini `embedContent`. Do not couple embedding support to the selected chat adapter. [OpenAI embeddings](https://platform.openai.com/docs/api-reference/embeddings/object), [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [Ollama embeddings](https://docs.ollama.com/api/embed)

Do not hard-code current model names. Persist the user's model identifier and validate it through a small connection test.

## Wails streaming and cancellation

Use one blocking context-bearing binding:

```go
func (s *Service) Chat(ctx context.Context, req ChatRequest) (ChatCompletion, error)
```

The frontend generates a request ID, subscribes to `lumina:chat-stream`, then invokes Chat. Cancel calls an explicit backend `CancelChat(workspaceSessionID, requestID)` method. Stream terminal events are authoritative; the frontend retains the matching listener until terminal delivery or a bounded timeout, even if the binding promise settles first.

Stream payloads contain `requestId`, monotonic `seq`, and one of `started`, `delta`, `citation`, `usage`, `completed`, or `failed`. Subscribe before starting the binding call to avoid losing early deltas. Inject a `StreamSink` in domain tests; keep Wails event emission in a thin adapter.

This matches the pinned Wails `v3.0.0-alpha.78` behavior. [Wails bridge and streaming guidance](https://v3alpha.wails.io/concepts/bridge), [official cancellable binding example](https://github.com/wailsapp/wails/tree/v3.0.0-alpha.78/examples/cancel-async)

## Credentials and configuration

- Move current settings out of frontend `localStorage`.
- Store non-secret settings under `os.UserConfigDir()/Lumina Wiki Desktop/settings.json`, using an atomic replace, directory mode `0700`, and file mode `0600` where supported.
- Store derived indexes under `os.UserCacheDir()/lumina-wiki-desktop/indexes/<workspace-id>/`. Derive `workspace-id` from SHA-256 of the canonical workspace path; never create index/config files in the workspace.
- Key credentials by product identifier plus opaque provider-profile ID. The frontend may submit a key once through an ephemeral password input; Go returns only configured/not-configured state and never returns the secret.
- Use macOS Keychain, Windows Credential Locker/Credential Manager, and Linux Secret Service through a narrowly audited cross-platform Go keyring package or small platform adapters. If secure storage is unavailable, allow session-only credentials; never silently fall back to plaintext or application-managed encryption.

Primary platform references: [Apple Keychain Services](https://developer.apple.com/documentation/Security/keychain-services), [Windows Credential Locker](https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker), [Linux Secret Service](https://specifications.freedesktop.org/secret-service/latest/), [Go user config/cache directories](https://pkg.go.dev/os).

## Hybrid index lifecycle

Use generation-scoped derived files:

```text
indexes/<workspace-id>/
  manifest.json
  chunks.<generation>.jsonl
  vectors.<generation>.f32
  lexical.<generation>.json
```

`manifest.json` is the commit pointer. It records index/chunker version, embedding provider fingerprint, model, dimensions, document hashes, chunk hashes, and vector offsets.

Lifecycle:

1. Read only allowed wiki entity Markdown files; skip graph files, `index.md`, `log.md`, symlinks, and non-regular files.
2. Remove frontmatter and split deterministically by headings/paragraphs with bounded overlap.
3. Record separate content hashes for vector reuse and path-aware chunk IDs for citations.
4. Rechunk changed files only, remove deleted-file chunks, and reuse embeddings whose content and provider fingerprint are unchanged.
5. A provider, endpoint, model, dimension, or chunker-version change invalidates semantic vectors.
6. Write all generation files first and atomically replace the manifest last. Cancellation or failure leaves the prior generation intact.
7. Read selected source text from the workspace at query time and verify its chunk hash; do not duplicate full note text in the cache.
8. Rank lexical and semantic results separately and combine with reciprocal-rank fusion. Exact linear cosine search is adequate at personal-wiki scale. Lexical search is always the fallback.

Remote embeddings require explicit opt-in because note contents leave the machine. Provide build, progress, cancel, clear-index, and rebuild controls.

## Security and privacy controls

- Explain before first use which provider endpoint receives the question, conversation context, and retrieved note excerpts. Embedding consent is separate from chat consent.
- Treat retrieved Markdown as untrusted quoted source material. Do not expose write tools, shell execution, or Lumina mutation commands to chat.
- Accept only HTTP(S) endpoints; require HTTPS except for loopback; reject URL userinfo. Disable redirects or permit only revalidated same-origin redirects so authorization headers cannot leak.
- Never log credentials, authorization headers, provider request bodies, retrieved excerpts, or raw provider error bodies.
- Bound question/history size, selected chunks, SSE line/event size, output bytes, total request duration, and stream idle time.
- Never retry after the first visible delta. Before it, allow at most one bounded retry for transport, 429, or 5xx failures.
- Map provider failures to stable safe codes such as `auth_failed`, `rate_limited`, `model_not_found`, `endpoint_unreachable`, `timeout`, `cancelled`, `invalid_response`, and `index_stale`.
- Store vectors with user-only permissions and expose clear-cache. Persist conversation history locally per workspace when enabled; disabling stops future writes, while explicit controls delete one conversation or the workspace history.
- Preserve workspace immutability: chat/indexing must never write under `wiki/`, `raw/`, or `_lumina/` and must not call mutation scripts.

## TDD seams

- Provider adapters: `httptest.Server` coverage for fragmented/multiline SSE, unknown events, malformed JSON, stream errors, cancellation, headers, redirect rejection, status mapping, and response limits.
- Inject `HTTPDoer`, clock, ID generator, backoff, `StreamSink`, `SecretStore`, `ConfigStore`, workspace reader, and embedder.
- Chunker golden tests: frontmatter removal, headings, Unicode, long paragraphs, overlap, deterministic hashes.
- Index tests: unchanged reuse, one-file edit, deletion, provider/model/dimension change, partial batch failure, cancellation, corrupt cache, and atomic commit.
- Retrieval tests: lexical fallback, semantic ranking, rank fusion, dimension mismatch, and stale chunk rejection.
- Credential tests: save, replace, delete, and status without a frontend getter.
- Frontend tests: subscribe-before-call ordering, request/sequence filtering, AbortController cancellation, listener cleanup, no `localStorage`, and secret-field clearing.
- Keep Wails-specific coverage to a thin binding/event smoke test; domain behavior remains ordinary Go unit tests.

## Risks

- Wails 3 alpha APIs can change; isolate event and cancellable-promise code.
- Some Linux sessions have no available or unlocked Secret Service; session-only credentials must remain supported.
- Provider event formats evolve; adapters must ignore unknown event types and maintain contract tests.

## Unresolved questions

None.
