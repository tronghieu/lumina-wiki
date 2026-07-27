---
phase: 1
title: "Inventory"
status: completed
priority: P1
effort: "1h"
---

# Phase 1: Inventory

## Overview

Create the authoritative CLI-to-desktop parity matrix.

## Requirements

- Functional: identify every user-facing CLI/workspace skill capability.
- Non-functional: classify each item as direct executable, GUI workflow, or agent-assisted handoff.

## Architecture

Desktop must prefer these existing runtime contracts:

- `bin/lumina.js` for installer lifecycle.
- `_lumina/scripts/lint.mjs` for checks.
- `_lumina/scripts/wiki.mjs` for wiki reads/mutations.
- `_lumina/scripts/reset.mjs` for reset.
- `_lumina/scripts/discover-runner.mjs` for scheduled discovery.
- Python tools under `_lumina/tools/` only through existing skills/scripts.

## Parity Matrix

| CLI / Skill | Existing Desktop | Required Desktop Surface |
|---|---:|---|
| `lumina install` / upgrade | No | New workspace installer wizard, sandbox-safe, directory picker, packs, IDE targets |
| `lumina uninstall` | No | Preserve `wiki/` and `raw/`, confirmation UI |
| `lumina --version` | No | About/version panel with update status |
| `lumina discover run` | No | Research scheduler run action with dry-run option |
| `/lumi-init` | Partial via open graph | Initialize/rebuild workspace from `raw/` |
| `/lumi-ingest` | Partial import only | Import + guided source-to-wiki drafting handoff |
| `/lumi-ask` | No | Query UI using local wiki reads; agent handoff until model backend exists |
| `/lumi-edit` | Read-only note view | Safe edit workflow using existing wiki mutation contracts |
| `/lumi-check` | Yes summary/details | Add fix/dry-run options later |
| `/lumi-reset` | No | Scoped destructive reset UI with typed confirmation |
| `/lumi-verify` | No | Source-check workflow/handoff |
| `/lumi-migrate-legacy` | No | Run `wiki.mjs migrate --add-defaults` |
| `/lumi-help` | No | Desktop help/next-action panel based on workspace state |
| Research pack skills | No | Pack-gated research command center |
| Reading pack skills | No | Pack-gated reading workflow panel |
| Learning pack skills | No | Pack-gated learning reflection panel |

## Related Code Files

- Modify: `apps/desktop/internal/tools/service.go`
- Modify: `apps/desktop/internal/workspace/service.go`
- Modify: `apps/desktop/frontend/src/App.tsx`
- Modify: `apps/desktop/frontend/src/app/app-shell.tsx`
- Modify: `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- Create as needed: `apps/desktop/internal/commands/*`, `apps/desktop/frontend/src/features/commands/*`

## Implementation Steps

1. Keep inventory updated as features land.
2. Start with low-risk direct scripts: migrate, reset dry-run/confirmed, discover dry-run.
3. Defer LLM/agent-heavy workflows until model/settings/persistence exists.

## Success Criteria

- [x] Inventory covers installer commands, workspace scripts, and installed skills.
- [x] Current desktop coverage is explicit.
- [x] Missing areas are phase-classified.
