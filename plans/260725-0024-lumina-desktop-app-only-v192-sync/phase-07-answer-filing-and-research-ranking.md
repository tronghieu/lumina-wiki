---
phase: 7
title: "Answer filing and research ranking"
status: todo
priority: P1
effort: "3-4d"
dependencies: [4, 5, 6]
---

# Phase 7: Answer filing and research ranking

## Context Links

- [Phase 6](./phase-06-native-graph-correction-operations.md)
- [`src/skills/core/ask/SKILL.md`](../../src/skills/core/ask/SKILL.md)
- [`src/skills/packs/research/rank/SKILL.md`](../../src/skills/packs/research/rank/SKILL.md)
- [`apps/desktop/internal/ai/chat/orchestrator.go`](../../apps/desktop/internal/ai/chat/orchestrator.go)

## Overview

Bring corrected answer filing and v1.7 research ranking into Desktop using the
existing AI, consent, credential, retrieval, and history foundations.

## Requirements

- Authorization: consume the focused plan's session-owned
  `read-only|writable` access mode; preview may read, but filing/ranking writes
  reject read-only sessions in backend code.
- Functional: preview and save a completed answer as a summary/output with index,
  log, and graph updates; rank research sources and show structured results.
- Non-functional: no silent workspace writes, no secrets in frontend/history,
  transactional multi-file changes, and clear disclosure before remote requests.

## Architecture

Native workflow services assemble deterministic change sets from validated AI
output. The existing provider layer performs model requests; optional research
signals use secure backend-only credentials and the hardened HTTP policy. One
review screen precedes a locked transaction.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/filing/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/ranking/service.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/filing/service_test.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workflows/ranking/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/chat/agent-panel.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/app/ai-settings-panel.tsx`

## Implementation Steps

1. Write RED answer-filing tests for canonical filenames, user-edited markers,
   index/log updates, edges, duplicates, rollback, and provider failure.
2. Implement previewable answer filing as one journaled transaction; preserve
   existing content and append corrections instead of overwriting.
3. Write RED ranking tests for required metadata, missing optional services,
   rate limits, cancellation, retry bounds, and credential redaction.
4. Implement ranking with existing providers and optional Scite/Altmetric/OpenAlex
   adapters only where current credentials and network consent permit.
5. Add user-facing review flows that describe outcomes in plain language and
   require explicit approval before committing notes or metadata.

## Tests Before

- [ ] A chat answer cannot be filed correctly from Desktop.
- [ ] Ranking output lacks a native workflow and structured display.
- [ ] Partial multi-file failures leave no visible workspace changes.

## Refactor

Extract a shared transaction/change-set layer only after both workflows prove
the same commit and rollback needs.

## Tests After

- [ ] Filing produces a valid page, index entry, append-only log, and graph links.
- [ ] Ranking survives unavailable optional signals and never fabricates values.
- [ ] Secrets are absent from events, history, previews, errors, and logs.
- [ ] Decline/cancel leaves the workspace byte-identical.

## Regression Gate

Run workflow, provider/security, chat/history, graph, and related frontend tests,
then full Desktop tests.

## Success Criteria

- [ ] Users can file useful answers and rank sources entirely in Desktop.
- [ ] Every write is reviewed, authorized, atomic, and checker-clean.

## Risk Assessment

Model output can be structurally valid but semantically poor. Preserve evidence
links and make the complete proposed result editable/rejectable before commit.

## Security Considerations

Keep keys in the secure backend store, retain SSRF/redirect protections, disclose
destinations, bound response bodies, and sanitize filenames and rendered content.
