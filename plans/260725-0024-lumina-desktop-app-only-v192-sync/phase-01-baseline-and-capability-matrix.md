---
phase: 1
title: "Baseline and capability matrix"
status: todo
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 1: Baseline and capability matrix

## Context Links

- [Scout report](./reports/scout-report.md)
- [`CHANGELOG.md`](../../CHANGELOG.md)
- [`src/scripts/schemas.mjs`](../../src/scripts/schemas.mjs)
- [`apps/desktop/README.md`](../../apps/desktop/README.md)

## Overview

Lock current Desktop behavior and create failing v1.9.2 compatibility tests
before architecture changes.

## Requirements

- Functional: inventory every accepted capability added from v1.7.0 through
  v1.9.2 and map it to existing/missing Desktop behavior.
- Non-functional: fixtures contain no secrets or private paths and are safe to
  commit.

## Architecture

Use one minimal v1.9.2 workspace fixture containing ranking metadata,
`readings/`, `reflections/`, topic edges, dangling edges, and citations.
Separate compatibility facts from implementation choices.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/testdata/lumina-v192-workspace/`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/workspace/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/graph/service_test.go`
- Modify: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/ai/retrieval/corpus_test.go`

## Implementation Steps

1. Record the CLI-to-Desktop matrix with owning source/tests.
2. Add fixture data through supported workspace operations in a temp directory,
   then copy only deterministic, non-private results into testdata.
3. Write RED tests for learning-pack detection, `readings`/`reflections`
   graph nodes, ranking metadata, and new edge/citation forms.
4. Snapshot current full test results before implementation.

## Tests Before

- [ ] Workspace service detects `learning`.
- [ ] Graph service loads `readings` and `reflections`.
- [ ] Retrieval includes new note directories.
- [ ] New edge types remain visible without loss.

## Refactor

None. This phase establishes evidence only.

## Tests After

- [ ] Existing fixture remains byte-stable and all previous tests stay green.

## Regression Gate

`cd apps/desktop && go test ./...` and
`cd apps/desktop/frontend && npm run test`.

## Success Criteria

- [ ] Matrix covers every user-visible v1.7-v1.9.2 change.
- [ ] RED failures identify actual hardcoded Desktop gaps.

## Risk Assessment

Fixture drift can hide gaps. Generate from a temp workspace outside the repo and
review every committed byte.

## Security Considerations

Do not include provider keys, local absolute paths, histories, or source
documents.
