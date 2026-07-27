---
title: "Desktop v1.9.2 synchronization scout report"
created: 2026-07-25
---

# Desktop v1.9.2 Synchronization Scout Report

## Summary

Desktop foundations are healthy and tested, but current operational behavior
still assumes an already-installed workspace and an external Node executable
for checks. Recent CLI/workspace changes expose hardcoded compatibility gaps and
new write workflows that do not yet have native Desktop equivalents.

## Recent Capability Deltas

| Release | Accepted capability | Current Desktop gap |
|---|---|---|
| v1.7.0 | Research ranking and optional influence providers | No ranking workflow or structured ranking view |
| v1.7.1 | Learning init and topic organization edges | Learning pack not detected |
| v1.7.2-v1.7.3 | Safer ingest/ask filing behavior | Chat cannot file an approved answer |
| v1.8.0 | Quick update vs modify installation | No native create/upgrade/pack lifecycle |
| v1.9.0 | `readings`, long-source pipeline, quote verification | Graph omits `readings`; no native pipeline |
| v1.9.1 | Remove/replace edge and L17 dangling-edge check | No native mutation; check depends on Node |
| v1.9.2 | Remove citation | No native citation removal |

## Relevant Files

- `src/scripts/schemas.mjs` — current entity, edge, pack, and field authority.
- `src/scripts/wiki.mjs` — mutation semantics through v1.9.2.
- `src/scripts/lint.mjs` — check behavior through L17.
- `src/installer/commands.js` — workspace creation/upgrade behavior.
- `apps/desktop/internal/workspace/service.go` — hardcoded pack detection.
- `apps/desktop/internal/graph/service.go` — hardcoded entity directories.
- `apps/desktop/internal/tools/service.go` — calls external `node`.
- `apps/desktop/internal/importer/service.go` — only current workspace write path.
- `apps/desktop/internal/ai/` — reusable provider, consent, session, history,
  retrieval, and secret boundaries.
- `apps/desktop/frontend/src/features/workspace/use-workspace.ts` — current
  Open/Check/Import flow.

## Confirmed Constraints

- Packaged runtime must not require Node.js, npm, Python, CLI, or terminal.
- Build/test may generate deterministic assets from CLI sources.
- CLI/workspace contracts remain authority; Desktop uses native behavior plus
  conformance tests.
- No silent overwrites or AI-initiated workspace writes.
- Existing workspace session capabilities remain the authorization boundary.

## Recommended Direction

Generate a versioned contract and workspace payload during build, embed both in
the Go app, and implement native lifecycle/check/mutation services against the
generated contract. Use CLI-produced fixtures to test semantic parity instead
of maintaining two handwritten schema inventories.

## Unresolved Questions

None. The accepted app-only roadmap resolves product scope; exact extraction
library choice remains an implementation spike inside the long-source phase.
