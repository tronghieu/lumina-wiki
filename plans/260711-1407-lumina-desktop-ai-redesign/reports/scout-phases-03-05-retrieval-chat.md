# Deep Scout: Phases 03-05 Retrieval and Chat

## Current Evidence

- Workspace validation and safe containment exist at `internal/workspace/service.go:22-84`.
- Graph note loading already skips symlinks and restricts entity paths at `internal/graph/service.go:42-139`.
- Markdown frontmatter/body parsing exists at `internal/graph/markdown.go:7-57`; retrieval should reuse/extract pure helpers rather than duplicate semantics.
- `App.tsx:32-258` already uses request IDs for workspace/note stale-response protection; chat reducer should follow the same current-request pattern outside the component.
- No retrieval, embedding, provider, stream, or conversation service exists.

## Phase 03 Inventory

| Action | File | Rough LoC | Test impact |
|---|---|---:|---|
| Create | `internal/ai/retrieval/corpus.go` | 120-180 | path/race tests |
| Create | `internal/ai/retrieval/chunker.go` | 150-200 | golden tests |
| Create | `internal/ai/retrieval/lexical.go` | 120-180 | ranking tests |
| Create | `internal/ai/retrieval/types.go` | under 120 | shared contract |
| Create | retrieval `*_test.go` + testdata | 250-400 | 20+ cases |
| Refactor | `internal/graph/markdown.go` only if pure parser reuse needs export | under 40 | preserve graph tests |

### Interfaces and Tests

- `Corpus.Scan(ctx, validatedRoot)`, `Chunker.Chunk(note)`, `Lexical.Search(query, k)`.
- Critical: symlink/replace/path escape, >2 MiB, hidden/raw/graph/index/log exclusion.
- High: headings, frontmatter, Unicode, long paragraph overlap, deterministic IDs.
- High: selected/linked boost, stable lexical ordering, empty/malformed files.
- RED: `cd apps/desktop && go test ./internal/ai/retrieval -run 'Corpus|Chunk|Lexical'`.

## Phase 04 Inventory

| Action | File | Rough LoC | Test impact |
|---|---|---:|---|
| Create | `internal/ai/index/embedding-provider.go` | under 120 | adapter contract |
| Create | `internal/ai/index/openai-compatible.go`, `gemini.go` | 120-180 each | HTTP tests |
| Create | `internal/ai/index/flat-index.go` | 150-200 | vector tests |
| Create | `internal/ai/index/indexer.go` | 180-220; split lifecycle/manifest if over 200 | generation tests |
| Create | `internal/ai/retrieval/fusion.go` | under 120 | rank fusion tests |
| Create | index/fusion tests | 350-500 | lifecycle matrix |

### Interfaces and Tests

- `EmbeddingProvider.Embed(ctx, []string)`, `Index.Build/Status/Clear/Search`, `FuseRanks`.
- Critical: consent fingerprint before remote text, cache workspace isolation, atomic manifest-last commit.
- Critical: model/dimension/provider/chunker invalidation; corrupt/truncated cache fallback.
- High: changed/deleted/unchanged file reuse; partial batch/cancel preserves previous generation.
- High: exact cosine and reciprocal-rank fusion; dimension mismatch rejected.
- RED: `cd apps/desktop && go test ./internal/ai/index ./internal/ai/retrieval -run 'Index|Embed|Fusion'`.

## Phase 05 Inventory

| Action | File | Rough LoC | Test impact |
|---|---|---:|---|
| Create | `internal/ai/chat/orchestrator.go` | 170-220; split context builder if over 200 | orchestration tests |
| Create | `internal/ai/chat/context.go` | 120-180 | budget/injection tests |
| Create | `internal/ai/service.go`, `types.go` | 150-200 total | Wails facade tests |
| Create | `internal/ai/wails-stream.go` | under 120 | sink/state tests |
| Modify | `apps/desktop/main.go` | register service/sink lifecycle | integration smoke |
| Regenerate | `frontend/bindings/.../internal/ai/*` | generated | TS binding check |

### Interfaces and Tests

- `Orchestrator.Chat(ctx, ChatRequest, StreamSink)`, `ContextBuilder.Build`, backend evidence allowlist.
- Critical: subscribe-before-start, monotonic sequence, one terminal event, cancel/window cleanup.
- Critical: no secret/transcript/evidence in errors/logs; prompt evidence delimiters and allowlisted citations.
- High: context char/byte budgets and deterministic truncation.
- High: semantic stale/offline failure falls back lexical with visible status.
- High: completed/cancelled/failed history records exactly once.
- RED: `cd apps/desktop && go test ./internal/ai/chat ./internal/ai -run 'Chat|Context|Stream'`.

## Dependency Map

Phase 03 corpus/chunker/lexical blocks Phase 04 index reuse and Phase 05 context. Phase 02 providers and Phase 01 profiles/secrets/history also block Phase 05. Phase 05 generated contracts block Phase 07 frontend integration.

## Regression Gates

- `cd apps/desktop && go test ./internal/workspace ./internal/graph`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 generate bindings -clean=true -ts`
- `cd apps/desktop/frontend && npm run test && npm run build`

## Unresolved Questions

None.
