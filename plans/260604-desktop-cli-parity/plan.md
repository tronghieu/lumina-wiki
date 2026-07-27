---
title: "Desktop CLI parity roadmap"
description: "Roadmap to bring desktop feature coverage to parity with Lumina-Wiki CLI and installed workspace skills."
status: in-progress
priority: P2
branch: "feat/lumina-desktop-wails"
tags: []
blockedBy: [260711-1407-lumina-desktop-ai-redesign]
blocks: []
created: "2026-06-03T18:31:12.992Z"
createdBy: "ck:plan"
source: skill
---

# Desktop CLI parity roadmap

## Overview

Desktop must become a practical GUI over existing Lumina-Wiki CLI/workspace capability, not a separate toy graph viewer.

Current desktop coverage:

- Workspace open/validate/summary.
- Graph load/read note/linked navigation.
- Import to `raw/sources`.
- Run `lumi-check` equivalent via `_lumina/scripts/lint.mjs --summary`.

Missing parity areas:

- Installer lifecycle: install/upgrade/uninstall/version/discover run.
- Workspace initialization and maintenance: init, migrate, reset.
- Knowledge operations: ask/edit/verify workflow surfaces backed by `wiki.mjs` reads/writes and lint.
- Research pack: discover/setup/prefill/survey/topic/watchlist/watch-run.
- Reading/learning packs: chapter ingest, character/theme/plot tracking, learning reflection.

Principle:

- Desktop features must call existing scripts/services or produce explicit handoff steps. No fake controls.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Inventory](./phase-01-inventory.md) | Completed |
| 2 | [Core workspace actions](./phase-02-core-workspace-actions.md) | Pending |
| 3 | [Knowledge operations](./phase-03-knowledge-operations.md) | Pending |
| 4 | [Research and reading packs](./phase-04-research-and-reading-packs.md) | Pending |
| 5 | [Verification and ship](./phase-05-verification-and-ship.md) | Pending |

## Dependencies

- Builds on `plans/260604-desktop-settings-model-cleanup/` for removing fake AI UI and moving model defaults into Settings.
