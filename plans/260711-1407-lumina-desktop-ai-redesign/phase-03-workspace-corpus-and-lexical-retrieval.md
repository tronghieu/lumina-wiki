---
phase: 3
title: "Workspace corpus and lexical retrieval"
status: pending
priority: P1
effort: "3d"
dependencies: [1]
---

# Phase 03: Workspace Corpus and Lexical Retrieval

## Overview

Build a deterministic, read-only Markdown corpus and lexical search baseline. Corpus policy, snapshot hashes, chunk boundaries, and evidence paths become the source of truth for later embeddings and citations.

## Context Links

- `brainstorm-summary.md` lines 236-250, 262-264
- `research/chat-backend-security-research.md` lines 78-103, 117-126
- `reports/scout-phases-03-05-retrieval-chat.md`
- Preserve `apps/desktop/internal/workspace/service.go:22-84`, `apps/desktop/internal/graph/service.go:42-139`, and graph parser tests.

## Requirements

- Include regular `.md` under `wiki/`, including `outputs/`; exclude `graph/**`, `index.md`, `log.md`, hidden path components, symlinks, `raw/**`, non-regular files, and files over 2 MiB.
- Strip YAML frontmatter; chunk by headings/paragraphs with bounded overlap; normalize Unicode/text deterministically; warnings are bounded and path-only.
- Retry a file changed during traversal once, then omit it; query-time evidence reread must match committed chunk hash.
- Expose a bounded, read-only workspace tree snapshot covering real `_lumina/`, `raw/`, and `wiki/` hierarchy; skip symlinks/hidden paths, cap depth/entries, and return metadata only.
- Issue an opaque citation ID for each allowlisted hit and provide a safe current-hash note read so broad corpus citations are openable even when absent from the graph entity allowlist.

## Architecture

```go
type Chunk struct { ID, Path, Heading, Text, ContentHash, SnapshotHash string; Start, End int }
type Corpus interface { Scan(context.Context, string) ([]Chunk, []Warning, error); ReadCurrent(context.Context, Chunk) ([]byte, error) }
type LexicalSearcher interface { Search(context.Context, string, SearchOptions) ([]Hit, error) }
type SearchOptions struct { Limit int; SelectedPath string; LinkedPaths []string }
type WorkspaceTreeNode struct { ID, Name, RelativePath, Kind string; Children []WorkspaceTreeNode }
type CitationReader interface { ReadCitationNote(context.Context, WorkspaceSession, CitationID) (CitationNote, error) }
```

Traversal emits normalized relative paths; chunk IDs are path-aware for citations while content hashes are path-independent for later vector reuse. A small deterministic BM25 index ranks terms, then applies explicit selected/linked boosts and stable path/chunk tie-breaking.

## Related Code Files

- Create: `apps/desktop/internal/ai/retrieval/types.go`, `corpus.go`, `safe-open.go`, `chunker.go`, `lexical.go`, `citation-reader.go`, colocated tests, and `testdata/corpus/` fixtures.
- Create: `apps/desktop/internal/workspace/tree.go` and `tree_test.go` for the real bounded hierarchy DTO/API.
- Modify only if reuse is proven: `apps/desktop/internal/graph/markdown.go`; protect `apps/desktop/internal/graph/markdown_test.go` and `service_test.go`.

## Deep File Inventory

| Action | Exact path | Responsibility | Rough LoC/test impact |
|---|---|---|---:|
| Create | `apps/desktop/internal/ai/retrieval/types.go` | chunk/hit/warning/options contracts | 110 + compile cases |
| Create | `apps/desktop/internal/ai/retrieval/corpus.go` | corpus traversal/policy/snapshot retry | 190 + 20 cases |
| Create | `apps/desktop/internal/ai/retrieval/safe-open.go` | contained no-follow regular reads | 160 + race/symlink cases |
| Create | `apps/desktop/internal/ai/retrieval/chunker.go` | frontmatter stripping/chunk hashes | 190 + golden cases |
| Create | `apps/desktop/internal/ai/retrieval/lexical.go` | BM25, boosts, stable ranking | 180 + ranking cases |
| Create | `apps/desktop/internal/ai/retrieval/citation-reader.go` | opaque allowlist/current-hash broad-note reads | 140 + authorization cases |
| Create | `apps/desktop/internal/ai/retrieval/testdata/corpus/` | policy/chunk/ranking fixtures | fixture-only |
| Create | `apps/desktop/internal/workspace/tree.go` | bounded `_lumina`/`raw`/`wiki` tree snapshot | 170 + traversal cases |
| Modify | `apps/desktop/internal/graph/markdown.go` | export a pure body/frontmatter helper only if tests prove reuse | under 40; preserve graph tests |

## Test Scenario Matrix

| Severity | Scenario | Expected result |
|---|---|---|
| Critical | symlink/replace/escape race | outside bytes never read; changed file retried once then skipped |
| Critical | hidden/raw/graph/index/log/>2MiB | excluded with bounded non-sensitive warning where applicable |
| High | headings/frontmatter/Unicode/long paragraph | deterministic boundaries, overlap, IDs, hashes |
| High | lexical selected/linked boost | stable expected rank without hiding stronger exact matches |
| High | evidence changed after search | `stale_index`; no stale excerpt returned |
| High | broad citation not represented in graph | opaque citation read opens current note artifact; arbitrary path rejected |
| High | deep/large/symlink workspace tree | deterministic cap/truncation metadata; no target traversal or note content |
| Medium | empty/malformed/unreadable note | scan continues; deterministic warning order |

## Interface and Function Checklist

- [ ] `DefaultCorpusPolicy`, `Corpus.Scan`, `Corpus.ReadCurrent`.
- [ ] `OpenRegularContained` rejects symlink components and validates opened-file identity/size before and after read.
- [ ] `StripFrontmatter`, `ChunkMarkdown`, `ChunkID`, `ContentHash`.
- [ ] `BuildLexical`, `Lexical.Search` with fixed BM25 constants and stable tie-break.
- [ ] `workspace.Service.Tree` returns bounded real hierarchy metadata; `CitationReader.ReadCitationNote` accepts only current session allowlist IDs.
- [ ] Warnings contain relative path and stable code only, never note text or raw OS details.

## Dependency Map

Phase 1 supplies canonical `WorkspaceID`; existing workspace validation guards roots. Phase 3 chunks feed phase 4 vector reuse and phase 5 context/citation assembly; its tree DTO feeds phase 6. Graph note interfaces stay unchanged.

## Tests Before

- RED: `cd apps/desktop && go test ./internal/ai/retrieval -run 'Corpus|Open|Chunk|Lexical|Stale' -count=1`
- Expected RED: missing retrieval package first; after types land, missing scanner/chunker/searcher or mismatched golden hashes/ranks.
- Protection: `cd apps/desktop && go test ./internal/workspace ./internal/graph` remains green before extraction.

## Refactor

Extract only pure Markdown body parsing shared with graph; do not couple retrieval to graph node types. Split safe-open, scan, chunk, and ranking so no production file exceeds about 200 lines.

## Tests After

- GREEN: `cd apps/desktop && go test ./internal/ai/retrieval -count=1`
- Race: `cd apps/desktop && go test -race ./internal/ai/retrieval ./internal/workspace ./internal/graph`
- Regression: `cd apps/desktop && go test ./...` (tests every package present in this checkpoint without assuming parallel phase 2 has landed).

## Implementation Steps

- [ ] Write corpus include/exclude/size/warning tests; run RED; implement policy traversal; run GREEN.
- [ ] Write symlink/replace/snapshot tests; run RED; implement contained regular reads and one retry; run GREEN/race.
- [ ] Write bounded real-tree and opaque broad-citation read tests; run RED; implement tree snapshot and current-hash citation reader; run GREEN.
- [ ] Commit: `feat(desktop): add safe workspace corpus`.
- [ ] Write chunker golden tests for frontmatter/headings/Unicode/overlap; run RED; implement chunker/hashes; run GREEN.
- [ ] Write BM25/boost/tie/stale tests; run RED; implement lexical index and current-hash check; run GREEN.
- [ ] Commit: `feat(desktop): add lexical workspace retrieval`.
- [ ] Run graph/workspace/full regression and commit any pure parser extraction with `refactor(desktop): share markdown body parsing`.

## Success Criteria

- [ ] Corpus exactly matches approved include/exclude policy across OS fixtures.
- [ ] Same corpus produces byte-identical chunk IDs, hashes, and lexical ranks.
- [ ] No scan/search writes beneath workspace or exposes skipped-note content.

## Security, Risks, and Rollback

- Risk: TOCTOU through symlink/reparse replacement. Mitigation: platform-aware no-follow open seam plus opened-file identity checks and race tests.
- Risk: lexical scoring changes invalidate acceptance fixtures. Mitigation: version constants and golden ranks.
- Rollback: discard in-memory lexical index; existing graph/workspace behavior is untouched.
