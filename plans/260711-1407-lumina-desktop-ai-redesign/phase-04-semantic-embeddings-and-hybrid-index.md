---
phase: 4
title: "Semantic embeddings and hybrid index"
status: pending
priority: P1
effort: "4d"
dependencies: [2, 3]
---

# Phase 04: Semantic Embeddings and Hybrid Index

## Overview

Add opt-in OpenAI, Gemini, and OpenAI-compatible embeddings, immutable flat-vector generations, incremental reuse, exact cosine search, and reciprocal-rank fusion. Any semantic fault returns the lexical phase-3 result.

## Context Links

- `brainstorm-summary.md` lines 209-220, 236-256
- `research/chat-backend-security-research.md` lines 50, 68-103, 117-126
- `reports/scout-phases-03-05-retrieval-chat.md`

## Requirements

- Separate embedding profile/credential/consent from chat; remote consent fingerprint includes workspace, normalized endpoint, kind, model, dimensions, and disclosure version; loopback has CPU/disk disclosure.
- Cache only in `os.UserCacheDir()/lumina-wiki-desktop/indexes/<workspace-id>/`; generation files first, fsync, atomic manifest pointer last; previous generation survives cancel/failure/corruption.
- Reuse vectors by normalized content hash and effective profile fingerprint; invalidate on endpoint/provider/model/dimension/chunker change; reject NaN/Inf and dimension mismatch.

## Architecture

```go
type EmbeddingProvider interface { Embed(context.Context, []string) (EmbeddingBatch, error) }
type Index interface { Build(context.Context, BuildRequest, ProgressSink) (IndexStatus, error); Search(context.Context, []float32, int) ([]SemanticHit, error); Status(context.Context) (IndexStatus, error); Clear(context.Context) error }
type Manifest struct { Version, Generation, ChunkerVersion, ProfileFingerprint string; Dimensions int; Documents map[string]string; Vectors []VectorRef }
func FuseRanks(lexical []Hit, semantic []SemanticHit, k float64, limit int) []Hit
```

`manifest.json` is the only commit pointer. `chunks.<generation>.jsonl`, `vectors.<generation>.f32` (documented little-endian float32), and `lexical.<generation>.json` are immutable.

## Related Code Files

- Create: `apps/desktop/internal/ai/index/types.go`, `embedding-provider.go`, `openai-compatible.go`, `gemini.go`, `manifest.go`, `vectors.go`, `indexer.go`, `consent.go` and colocated tests.
- Create: `apps/desktop/internal/ai/retrieval/fusion.go`, `apps/desktop/internal/ai/retrieval/fusion_test.go`.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Create | `apps/desktop/internal/ai/index/types.go` | manifest/vector/status/progress contracts | 130 + schema cases |
| Create | `apps/desktop/internal/ai/index/embedding-provider.go` | independent provider interface/factory | 100 + contract cases |
| Create | `apps/desktop/internal/ai/index/openai-compatible.go` | OpenAI/Ollama embedding HTTP | 170 + `httptest` matrix |
| Create | `apps/desktop/internal/ai/index/gemini.go` | Gemini embedding HTTP | 170 + matrix |
| Create | `apps/desktop/internal/ai/index/manifest.go` | strict load/atomic commit/GC | 190 + corruption cases |
| Create | `apps/desktop/internal/ai/index/vectors.go` | float32 encode/cosine scan | 170 + numeric cases |
| Create | `apps/desktop/internal/ai/index/indexer.go` | incremental generation/cancel/reuse | 200 + lifecycle matrix |
| Create | `apps/desktop/internal/ai/index/consent.go` | disclosure fingerprint/state | 120 + drift cases |
| Create | `apps/desktop/internal/ai/retrieval/fusion.go` | reciprocal-rank fusion/fallback | 100 + rank cases |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | remote embed without matching consent | zero outbound calls; disclosure required |
| Critical | cancel/partial batch/manifest write fault | old generation remains committed and searchable |
| Critical | workspace/profile/model/dimension/chunker drift | isolated cache or full semantic invalidation |
| High | unchanged/edit/delete chunks | reuse unchanged vectors; embed changed only; remove deleted refs |
| High | corrupt/truncated/NaN/dimension mismatch | stable stale/corrupt status; lexical fallback |
| High | cosine + RRF | deterministic expected ranking and tie-break |
| Medium | clear/rebuild/progress | bounded progress; clear only selected workspace cache |

## Interface and Function Checklist

- [ ] Embedding adapters reuse phase-2 endpoint/redaction policy and never depend on chat selection.
- [ ] `ConsentFingerprint`, `RequireConsent`, `Build`, `Status`, `Clear`, `Search`.
- [ ] `LoadManifest` validates versions, offsets, dimensions, hashes, and generation filenames.
- [ ] `EncodeFloat32LE`, `CosineExact`, `FuseRanks`; zero-norm vectors fail safely.
- [ ] Progress sink is cancellable, monotonic, and contains counts/status only.

## Dependency Map

Phase 2 supplies hardened HTTP/endpoint policy; phase 3 supplies chunks/hashes/lexical results; phase 1 supplies profile, consent persistence, cache root, identity. Phase 4 hybrid search blocks phase 5 orchestration and phase 7 index controls.

## Tests Before

- RED: `cd apps/desktop && go test ./internal/ai/index ./internal/ai/retrieval -run 'Embed|Consent|Manifest|Index|Vector|Fusion|Fallback' -count=1`
- Expected RED: missing index package/types first; after scaffolding, assertions fail on absent provider requests, commit ordering, reuse, numeric validation, and fusion.
- Protection: phase-3 lexical suite stays green with semantic mode absent.

## Refactor

Keep provider HTTP, manifest I/O, numeric scan, lifecycle, and consent separate. Do not add a vector database or duplicate full note text in cache; query-time evidence still rereads phase-3 chunks.

## Tests After

- GREEN: `cd apps/desktop && go test ./internal/ai/index ./internal/ai/retrieval -count=1`
- Race: `cd apps/desktop && go test -race ./internal/ai/index ./internal/ai/retrieval`
- Regression: `cd apps/desktop && go test . ./internal/workspace ./internal/graph ./internal/importer ./internal/tools ./internal/ai/settings ./internal/ai/secrets ./internal/ai/history ./internal/ai/workspaceid ./internal/ai/providers ./internal/ai/retrieval ./internal/ai/index`

## Implementation Steps

- [ ] Write embedding request/auth/response/limit tests; run RED; implement compatible and Gemini adapters; run GREEN.
- [ ] Write consent drift/loopback tests; run RED; implement consent fingerprint and persistence contract; run GREEN.
- [ ] Commit: `feat(desktop): add opt in embedding providers`.
- [ ] Write manifest corruption/atomic commit/vector numeric tests; run RED; implement immutable generation storage; run GREEN.
- [ ] Write reuse/edit/delete/cancel tests; run RED; implement incremental indexer and cleanup; run GREEN/race.
- [ ] Commit: `feat(desktop): add incremental semantic index`.
- [ ] Write cosine/RRF/fallback tests; run RED; implement exact scan and fusion; run GREEN/full regression.
- [ ] Commit: `feat(desktop): add hybrid retrieval ranking`.

## Success Criteria

- [ ] No note text leaves the machine without a current consent fingerprint.
- [ ] Cancel, failure, stale, or corrupt semantic state always preserves lexical answers and prior valid generation.
- [ ] Cache isolation, vector reuse, invalidation, clear, and deterministic ranks pass.

## Security, Risks, and Rollback

- Risk: cache corruption or malicious dimensions exhaust resources. Mitigation: strict manifest/batch/dimension/file-size caps before allocation.
- Risk: recipient changes under same provider. Mitigation: consent binds normalized endpoint/model/dimensions/disclosure.
- Rollback: disable semantic setting and remove the workspace cache directory; lexical retrieval remains operational.
