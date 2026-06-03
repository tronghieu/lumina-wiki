---
phase: 3
title: "Knowledge operations"
status: pending
priority: P2
effort: "2-3d"
---

# Phase 3: Knowledge operations

## Overview

Bring ask/edit/verify workflows into desktop without pretending to be an agent.

## Requirements

- Functional: users can inspect entities, open related source context, and start safe edit/verify workflows.
- Non-functional: no direct raw/wiki mutation outside existing `wiki.mjs` contracts.

## Implementation Steps

1. Add query panel backed by `wiki.mjs list-entities/read-meta/read-edges`.
2. Add note edit workflow only after mutation contract is defined.
3. Add verify workflow with source evidence handoff.

## Success Criteria

- [ ] No fake chat UI.
- [ ] All mutations go through existing scripts.
