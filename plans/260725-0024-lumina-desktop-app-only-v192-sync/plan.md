---
title: "Lumina Desktop App-Only v1.9.2 Sync"
description: "Make packaged Lumina Desktop self-contained and synchronize accepted CLI/workspace capabilities through v1.9.2."
status: pending
priority: P1
effort: "24-35d"
branch: "feat/lumina-desktop-wails"
tags: [feature, desktop, backend, frontend, critical, tdd]
blockedBy: [260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning]
blocks: []
created: 2026-07-25
---

# Lumina Desktop App-Only v1.9.2 Sync

## Overview

Deliver a packaged Desktop app that creates, opens, checks, upgrades, and
operates compatible Lumina workspaces without requiring Node.js, npm, Python,
the CLI, or a terminal at runtime. Synchronize accepted workspace capabilities
through v1.9.2 using generated contracts and native Go services.

## Scope

- Runtime is app-only; build/test tooling may use Node to generate deterministic
  assets from CLI sources.
- Include: v1.7 ranking, learning/topic schema changes, v1.8 lifecycle choices,
  v1.9 readings/quote verification, v1.9.1 edge correction/L17, and v1.9.2
  citation removal.
- Preserve current workspace capability, privacy, secret, history, and
  non-overwrite boundaries.
- Exclude OCR, speculative Desktop-only features, silent AI writes, and
  unsupported workflow controls.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Baseline and capability matrix](./phase-01-baseline-and-capability-matrix.md) | Pending |
| 2 | [Generated workspace contract](./phase-02-generated-workspace-contract.md) | Pending |
| 3 | [App-only workspace provisioning](./phase-03-app-only-workspace-provisioning.md) | Pending |
| 4 | [Native lifecycle and checks](./phase-04-native-lifecycle-and-checks.md) | Pending |
| 5 | [v1.9 knowledge read compatibility](./phase-05-v19-knowledge-read-compatibility.md) | Pending |
| 6 | [Native graph correction operations](./phase-06-native-graph-correction-operations.md) | Pending |
| 7 | [Answer filing and research ranking](./phase-07-answer-filing-and-research-ranking.md) | Pending |
| 8 | [Long-source reading pipeline](./phase-08-long-source-reading-pipeline.md) | Pending |
| 9 | [Desktop integration and release gates](./phase-09-desktop-integration-and-release-gates.md) | Pending |

## Dependencies

- Phase chain: `1 -> 2 -> 3 -> 4`; `2 -> 5`; `4 + 5 -> 6`;
  `4 + 5 + 6 -> 7`; `4 + 5 + 6 -> 8`; `7 + 8 -> 9`.
- The provisioning/materialization subset of phase 2 and the Welcome/
  provisioning subset of phase 3 are blocked by the focused deep-TDD plan
  `../260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning/`;
  synchronize those fields only. Full schema/check/mutation contract work in
  phase 2 and unrelated integration journeys remain here.
- The focused dependency's Welcome, standard provisioning, recents, recovery,
  and conversation/note/focus continuity subset is implementation- and
  local-gate-complete, and its evergreen documentation is synchronized. This
  does not complete umbrella phases 2 or 3: their broader contract and
  integration work remains pending.
- The focused dependency remains open for native macOS/Windows/Linux package-job
  execution, digest-bound human installed-GUI acceptance, and the separate
  signing/notarization release gate.
- Replaces the superseded Node-backed direction in
  `plans/260604-desktop-cli-parity/`.
- `src/scripts/schemas.mjs`, installer payloads, and CLI conformance fixtures
  remain the build-time capability authority.

## Success Criteria

- [ ] A clean packaged app creates and reopens a workspace without external runtimes.
- [ ] Desktop reads `readings`, `reflections`, ranking data, and all v1.9.2 edges.
- [ ] Native checks and mutations conform to CLI fixtures through L17.
- [ ] Lifecycle actions preserve user-owned `wiki/` and `raw/` data.
- [ ] Filing, ranking, and long-source workflows write only after explicit approval.
- [ ] macOS, Windows, and Linux package/install/launch gates pass.

<!-- slug: lumina-desktop-app-only-v192-sync -->
