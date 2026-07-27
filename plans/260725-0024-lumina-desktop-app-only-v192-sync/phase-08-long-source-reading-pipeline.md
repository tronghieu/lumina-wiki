---
phase: 8
title: "Long-source reading pipeline"
status: todo
priority: P1
effort: "4-6d"
dependencies: [4, 5, 6]
---

# Phase 8: Long-source reading pipeline

## Context Links

- [Phase 6](./phase-06-native-graph-correction-operations.md)
- [`src/skills/core/ingest/SKILL.md`](../../src/skills/core/ingest/SKILL.md)
- [`src/tools/extract_pdf.py`](../../src/tools/extract_pdf.py)
- [`apps/desktop/internal/importer/service.go`](../../apps/desktop/internal/importer/service.go)

## Overview

Implement the v1.9 multi-pass long-source workflow for text PDFs with native
extraction, reading notes, checkpoints, annotations, and quote verification.

## Requirements

- Authorization: consume the focused plan's session-owned
  `read-only|writable` access mode; extraction may remain app-local, but every
  workspace write rejects read-only sessions.
- Functional: detect long PDFs, extract page-marked text, build a structure map,
  process bounded units into `readings`, verify quotes/pages, resume checkpoints,
  and commit reviewed results.
- Non-functional: no Python at runtime, bounded memory/time/network, cancellable
  work, deterministic resume, and no OCR in this scope.

## Architecture

First run a conformance spike to select a maintained pure-Go PDF text extractor
that meets fixtures and license/package constraints. A native orchestrator feeds
bounded units to the existing AI provider, stores app-private checkpoints, and
builds one reviewable workspace change set with source/readings/annotation edges.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/extract/pdf.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/extract/pdf_test.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/longsource/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/longsource/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/importer/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/workspace/workspace-actions.ts`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/artifact-pane.tsx`

## Implementation Steps

1. Add representative small/multi-page, malformed, encrypted, scanned, and
   oversized PDF fixtures; write RED extraction and quote-verification tests.
2. Compare candidate pure-Go extractors against current Python marker output,
   license, binary size, platform builds, and malformed-file behavior; record the
   accepted choice before adding the dependency.
3. Implement page-aware extraction and clearly report unsupported scanned/OCR
   documents instead of returning empty success.
4. Write RED orchestration tests for threshold routing, structure map, batching,
   resume/cancel, exact/near/missing quotes, provider errors, and stale sources.
5. Implement the multi-pass workflow with private checkpoints and a final
   preview; commit source/readings/index/log/annotation edges transactionally.

## Tests Before

- [ ] Desktop cannot complete a long PDF without Python/CLI.
- [ ] Quote/page verification failures block final commit.
- [ ] Resume rejects a checkpoint when source hash or workspace identity changed.

## Refactor

Reuse provider streaming/cancellation and the Phase 7 transaction layer; keep PDF
extraction independent so future accepted formats do not alter the workflow core.

## Tests After

- [ ] A supported long PDF produces checker-clean reading notes and annotations.
- [ ] Cancel/resume neither duplicates nor loses completed units.
- [ ] Scanned, encrypted, malformed, and excessive inputs fail safely.
- [ ] Packaged-runtime smoke passes without Python.

## Regression Gate

Run extractor and long-source tests, AI provider/retrieval tests, package builds
for all three OS targets, then full Desktop tests.

## Success Criteria

- [ ] v1.9 long-source behavior is usable entirely from the app for text PDFs.
- [ ] Quotes are traceable to source pages before any workspace commit.

## Risk Assessment

Pure-Go extractors vary on complex PDFs. The spike is a hard gate; OCR and
unsupported layouts remain explicit non-goals rather than silent low-quality data.

## Security Considerations

Limit file bytes/pages/decompressed content, reject escaping links, never execute
embedded content, redact extracted private text from logs, and honor cancellation.
