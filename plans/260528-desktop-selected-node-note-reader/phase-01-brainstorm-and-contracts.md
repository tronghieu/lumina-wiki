---
phase: 1
title: Brainstorm And Contracts
status: completed
priority: P2
effort: 1h
dependencies: []
---

# Phase 1: Brainstorm And Contracts

## Overview

Lock the feature scope and safety contract before adding read access to wiki note files.

## Requirements

- Functional: selected node content appears in inspector for loaded workspace nodes.
- Non-functional: read-only, no new dependencies, path-safe, symlink-safe.

## Architecture

Use graph service for read-only note content because graph nodes already own the relative note path.

## Related Code Files

- Create: `plans/260528-desktop-selected-node-note-reader/brainstorm-summary.md`
- Create: `plans/260528-desktop-selected-node-note-reader/reports/red-team-brainstorm.md`
- Create: `plans/260528-desktop-selected-node-note-reader/reports/plan-audit.md`

## Implementation Steps

1. Scout current graph and workspace services.
2. Compare backend graph method vs new notes service vs frontend file reads.
3. Red-team path traversal, symlink, non-md, and stale async risks.
4. Write plan audit constraints.

## Success Criteria

- [ ] Brainstorm summary exists.
- [ ] Red-team report exists.
- [ ] Plan audit exists.
- [ ] Scope excludes editing/rendering.
