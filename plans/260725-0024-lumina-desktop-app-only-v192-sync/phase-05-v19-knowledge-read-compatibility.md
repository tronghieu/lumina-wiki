---
phase: 5
title: "v1.9 knowledge read compatibility"
status: todo
priority: P1
effort: "2-3d"
dependencies: [2]
---

# Phase 5: v1.9 knowledge read compatibility

## Context Links

- [Phase 2](./phase-02-generated-workspace-contract.md)
- [`apps/desktop/internal/graph/service.go`](../../apps/desktop/internal/graph/service.go)
- [`apps/desktop/internal/ai/retrieval/corpus.go`](../../apps/desktop/internal/ai/retrieval/corpus.go)
- [`apps/desktop/frontend/src/features/graph/node-inspector.tsx`](../../apps/desktop/frontend/src/features/graph/node-inspector.tsx)

## Overview

Make Desktop understand all accepted workspace read structures through v1.9.2,
including learning, readings, reflections, ranking data, and new edge types.

## Requirements

- Functional: discover entities from the contract; render new nodes/edges and
  ranking metadata; include new notes in AI retrieval and citations.
- Non-functional: bounded parsing of untrusted workspace metadata and graceful
  degradation for unknown future fields.

## Architecture

Workspace and graph services resolve pack/entity definitions from the generated
contract rather than directory constants. A bounded metadata parser provides
typed known fields while retaining unknown values for forward-compatible reads.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/metadata/frontmatter.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/metadata/frontmatter_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workspace/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/graph/service.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/ai/retrieval/corpus.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/graph-types.ts`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/frontend/src/features/graph/node-inspector.tsx`

## Implementation Steps

1. Turn Phase 1 compatibility failures into focused RED tests for pack detection,
   entity discovery, graph mapping, retrieval, citation paths, and ranking.
2. Implement bounded frontmatter parsing with fixtures for arrays, objects,
   malformed input, excessive depth/size, aliases, and unknown fields.
3. Replace hardcoded entity lists with contract-driven discovery and style
   fallback for unknown future types.
4. Add ranking and reading/reflection details to the inspector without exposing
   internal field names to non-technical users.
5. Prove retrieval and citations include these directories without changing
   read-only guarantees.

## Tests Before

- [ ] Learning pack and new entity directories are missing from workspace/graph.
- [ ] Ranking metadata is not available to the inspector.
- [ ] Retrieval coverage for new note types is explicit rather than incidental.

## Refactor

Keep metadata parsing independent of graph rendering so later write workflows
reuse one validated representation.

## Tests After

- [ ] All v1.9.2 fixture nodes and edges load.
- [ ] Ranking details render with missing optional fields.
- [ ] AI answers can cite readings/reflections.
- [ ] Malformed or oversized metadata cannot crash or exhaust the app.

## Regression Gate

Run metadata, workspace, graph, retrieval, and graph frontend tests, followed by
full Desktop tests.

## Success Criteria

- [ ] Desktop reads every accepted v1.9.2 workspace entity and relationship.
- [ ] No entity directory remains hardcoded outside the generated contract.

## Risk Assessment

A full YAML implementation may accept surprising constructs. Use a maintained
pure-Go parser with strict limits and reject aliases/custom tags.

## Security Considerations

Treat every workspace file as untrusted: bound bytes/depth/counts, prevent path
escape, avoid HTML injection, and return structured diagnostics.

