---
phase: 2
title: "Workspace Services TDD"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Workspace Services TDD

## Context Links

- [Phase 1](./phase-01-scaffold-isolated-wails-app.md)
- [Code standards](../../docs/code-standards.md)
- [Project context](../../docs/project-context.md)

## Overview

Implement backend service contracts test-first: workspace validation, graph loading, note metadata extraction, and safe path handling. This phase proves the desktop app can understand Lumina workspaces without mutating them.

## Requirements

- Functional: backend validates a workspace folder and loads nodes/edges from fixture data.
- Non-functional: no direct graph mutation; all paths stay inside selected workspace; deterministic output order for UI/tests.

## Architecture

Go services:

- `WorkspaceService`: validate root contains `README.md`, `wiki/`, `_lumina/` where applicable; expose active workspace.
- `GraphService`: read `wiki/graph/*.jsonl` when present and enrich nodes from `wiki/**/*.md`.
- `MarkdownService`: parse title/type from frontmatter enough for preview; no writes.
- Fixture workspace under desktop tests, not installed into repo root.

## Related Code Files

- Create: `apps/desktop/internal/workspace/*`
- Create: `apps/desktop/internal/graph/*`
- Create: `apps/desktop/internal/testdata/lumina-workspace/*`
- Create: `apps/desktop/internal/*/*_test.go`
- Modify: `apps/desktop/main.go`

## Implementation Steps

1. Write failing Go tests for valid workspace, invalid workspace, graph load, path escape rejection.
2. Add fixture workspace with small `wiki/` and graph files.
3. Implement services until tests pass.
4. Expose services to Wails bindings.
5. Add frontend type use where bindings are generated or shimmed.
6. Commit phase.

## Success Criteria

- [ ] Go tests cover valid/invalid workspace validation.
- [ ] Go tests cover graph node/edge load from fixture.
- [ ] Path traversal or external path input is rejected.
- [ ] Service outputs stable node IDs, labels, type, path, and links.
- [ ] No writes to `wiki/graph`.
- [ ] Phase 2 commit created.

## Risk Assessment

- Markdown parser overreach: parse only what UI needs; defer full schema parser.
- Fixture too narrow: include source, concept, person, and output node shapes.
