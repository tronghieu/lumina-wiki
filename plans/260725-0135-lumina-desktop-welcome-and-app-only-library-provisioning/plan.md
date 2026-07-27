---
title: "Lumina Desktop Welcome and App-Only Library Provisioning"
description: "Let a non-technical user create, open, and return to a Lumina library using only the packaged Desktop app."
status: in-progress
priority: P1
effort: "18-24d + external release acceptance"
branch: "feat/lumina-desktop-wails"
tags: [feature, desktop, frontend, backend, security, tdd]
blockedBy: []
blocks: [260725-0024-lumina-desktop-app-only-v192-sync]
created: 2026-07-25
---

# Lumina Desktop Welcome and App-Only Library Provisioning

## Overview

Deliver app-only Welcome, safe core Create/Open, and return to the latest
conversation, reading context, and Chat/Note/Graph focus.

This is the deep-TDD execution detail for umbrella phases 2-3. Scope was
challenged and held: skill execution, native checks, maintenance, knowledge
mutation, semantic linking, and cosmetic restoration remain outside.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Generated contract, payload, and materialization](./phase-01-generated-contract-and-core-payload.md) | Completed |
| 2 | [Secure native provisioning](./phase-02-secure-native-provisioning.md) | Completed |
| 3 | [Welcome, Create, and Open — MVP A](./phase-03-welcome-create-open-mvp-a.md) | Completed |
| 4 | [Recent libraries and continuity — MVP B](./phase-04-recent-libraries-and-continuity-mvp-b.md) | Completed |
| 5 | [Packaged runtime and cross-platform gates](./phase-05-packaged-runtime-and-cross-platform-gates.md) | In Progress |

## Dependency Map

Executable order is `1 -> 2 -> 3 (MVP A) -> 4 (MVP B) -> 5`. Phase 5
records automated cook evidence first; installed-GUI release acceptance is a
separate human-owned gate.

## Product Decisions

- Welcome offers Create/Open; Create proposes `Documents/Lumina Library` (home
  fallback), previews the destination, and allows Change location.
- Collisions never overwrite, merge, delete, or auto-number; the user changes
  name or location. An existing empty destination is usable only after a
  separate native confirmation and locked reclassification.
- Existing legacy `README.md` + real `wiki/` libraries open read-only; strict
  manifests with supported schema 1-4 open; newer or malformed manifests do not.
- Core skills are inert compatibility data; raw-root Check/Import stay
  unavailable in backend and UI until native capability replacements; model
  and provider selection stays in Advanced settings.
- Recents never expose/search paths; preserve installer UTC/semantic parity and
  restart identity confirmation when required. MVP B restores the last
  supported wiki note; original-document/PDF page restoration remains later.

## Success Criteria

- [ ] With external runtimes unavailable, a packaged app creates/activates a core library.
- [x] Create never replaces existing entries; interruption remains untrusted and recoverable.
- [x] Open compatible libraries changes no workspace name, type, or byte.
- [x] Relaunch restores independent conversation/artifact/focus state without cross-library leakage.
- [x] Invalid or unavailable recents fall back safely without mutation/path disclosure.
- [x] An empty new library has a real empty graph/tree experience, not fake data.
- [x] Patched Go and terminal-symlink regression gates protect rooted operations.
- [ ] MVP A and MVP B have independent automated gates; release acceptance
      records installed-GUI evidence per OS. Signing remains separate.

## Ownership

This owns only the provisioning/materialization subset of umbrella phase 2,
the Welcome/provisioning subset of phase 3, and their phase 9 integration.
Full schema/check/mutation/release work remains in the umbrella.

## Red Team Review

### Session — 2026-07-25

**Findings:** 20 accepted; 6 critical/blocker, 11 high, 3 medium.
[Adjudication and evidence](./reports/red-team-adjudication.md)

The 2026-07-27 cook-readiness audit produced 16 corrections; all are reflected
in the current phases. [Audit record](./reports/audit-260727-1159-cook-readiness.md)
and [current validation](./reports/validation-260727-1205-cook-readiness.md).

The full implementation sync-back records 4/5 completed phases and preserves
the external Phase 5 gates. [Sync-back report](./reports/project-manager-260727-1821-sync-back.md).

<!-- slug: lumina-desktop-welcome-and-app-only-library-provisioning -->
