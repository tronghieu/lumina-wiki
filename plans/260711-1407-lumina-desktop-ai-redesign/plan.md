---
title: "Lumina Desktop AI workspace redesign"
description: "Reference-faithful Wails desktop shell with secure provider chat, local history, and opt-in hybrid retrieval over immutable Lumina workspaces."
status: pending
priority: P1
effort: "28d"
branch: "feat/lumina-desktop-wails"
tags: [desktop, wails, ai, retrieval, tdd]
blockedBy: []
blocks: [260604-desktop-cli-parity]
created: "2026-07-11T07:22:18.174Z"
createdBy: "ck:plan"
source: skill
---

# Lumina Desktop AI Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Lumina Desktop around the approved visual reference and add secure, cited, cancellable AI chat without mutating the active workspace.

**Architecture:** Keep workspace reads, retrieval, provider calls, secrets, history, and derived indexes in focused Go services; expose typed Wails bindings and a thin event adapter to React. A backend-issued workspace session capability—not an editable frontend path—authorizes all AI reads. Lexical retrieval is always available, semantic retrieval is opt-in, and immutable generation manifests make cache failure recoverable.

**Tech Stack:** Go 1.25+, Wails 3 alpha.78, React 18, TypeScript 6, React Flow 12, Node test runner, Playwright 1.61.1, `@axe-core/playwright` 4.12.1, Go `testing`/`httptest`, `github.com/zalando/go-keyring`.

---

## Overview

Production-port `Lumina Desktop.dc.html` tokens and hierarchy while preserving real Open/Refresh/Source/Check/Import/graph/note behavior. Add versioned provider profiles, backend-only credentials, workspace-scoped local history, deterministic Markdown retrieval, exact-vector hybrid ranking, backend-owned citations, bounded streaming, and measurable visual/accessibility/package gates.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Local settings secrets and history foundation](./phase-01-local-settings-secrets-and-history-foundation.md) | Pending |
| 2 | [Streaming chat provider adapters](./phase-02-streaming-chat-provider-adapters.md) | Pending |
| 3 | [Workspace corpus and lexical retrieval](./phase-03-workspace-corpus-and-lexical-retrieval.md) | Pending |
| 4 | [Semantic embeddings and hybrid index](./phase-04-semantic-embeddings-and-hybrid-index.md) | Pending |
| 5 | [Chat orchestration and Wails streaming](./phase-05-chat-orchestration-and-wails-streaming.md) | Pending |
| 6 | [Reference-faithful workspace shell](./phase-06-reference-faithful-workspace-shell.md) | Pending |
| 7 | [Agent chat and settings integration](./phase-07-agent-chat-and-settings-integration.md) | Pending |
| 8 | [Visual accessibility packaging and release gates](./phase-08-visual-accessibility-packaging-and-release-gates.md) | Pending |

## Dependencies

- Phase chain: `1 -> 2`; `1 -> 3`; `2 + 3 -> 4`; `1 + 2 + 3 + 4 -> 5`; `3 -> 6`; `5 + 6 -> 7`; `7 -> 8`. After phase 3, phase 6 may proceed alongside phases 2/4/5.
- This plan blocks `plans/260604-desktop-cli-parity/`; parity work resumes after the redesigned shell and AI service contracts stabilize.
- Existing `workspace`, `graph`, `tools`, and `importer` contracts remain compatible. Import alone may add one non-overwriting regular file under `raw/sources/`.
- No vector database, automatic model discovery, chat tool execution, or AI-initiated workspace mutation enters scope.

## Acceptance Gate

- Every phase observes focused RED for the stated reason, reaches GREEN, runs its regression gate, and commits a conventional checkpoint.
- Chat, retrieval, settings, secrets, history, and indexes leave a pre/post workspace byte manifest unchanged; Import is tested separately.
- Generated bindings expose no secret getter/value, semantic failure falls back to lexical retrieval, and every stream emits one terminal event.
- Dark/light 1480x920 non-dynamic shell comparison stays within 2% differing pixels; 1180px/760px, keyboard, focus, contrast, reduced-motion, packaged Wails, and `git diff --check` gates pass.

## Red Team Review

Full-tier adversarial review accepted 15 evidence-backed findings (3 Critical, 10 High, 2 Medium). This revision resolves them by:

- replacing caller-controlled workspace roots with expiring backend workspace capabilities and a durable rename/path-reuse registry;
- binding approved DNS results to the actual dial, serializing history mutation per workspace, and defining an event-authoritative cancellation handshake;
- adding explicit APIs for session credential confirmation, broad-note citation reads, real bounded workspace tree data, and the complete phase-5 AI facade;
- preserving every current source/root/import callback, fixing recursive frontend test discovery before new suites, and making Playwright/axe/CI gates unconditional;
- parallelizing the shell after the phase-3 tree contract and assigning canonical ownership of existing font assets.

Adjudication: `reports/from-red-team-coordinator-to-planner-adjudicated-plan-review-report.md`.

## Whole-Plan Consistency Sweep

- Workspace identity: draft paths are UI-only; loaded session capability/generation is authoritative in phases 3, 5, and 7.
- Ownership: phase 5 alone creates/registers `internal/ai/service.go`; phase 1 supplies injected stores only.
- Cancellation: frontend requests cancellation explicitly and retains the listener until the matching terminal event or bounded timeout.
- Citations/tree: phase 3 owns safe broad-note reads and bounded workspace tree DTOs; phase 6 renders the DTO; phase 7 navigates graph notes or opens an allowlisted note artifact.
- Verification: recursive Node tests, Playwright screenshots, axe checks, three-OS workflow, package scans, and native smoke evidence are mandatory.

## Validation Log

- 2026-07-11 — Deep structural, traceability, source-evidence, dependency, ownership, security, and testability validation passed after three audit patches.
- Reports: `reports/plan-validation.md` and `reports/plan-audit.md`.
- Implementation readiness: READY; no unresolved decision or waived gate.

## Open Questions

None.
