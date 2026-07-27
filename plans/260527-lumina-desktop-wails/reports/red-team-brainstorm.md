---
title: "Red-Team Brainstorm Review: Lumina Desktop Wails"
date: "2026-05-27"
status: complete
source: ck:brainstorm-red-team
---

# Red-Team Brainstorm Review

## Summary

The Wails direction is viable, but only if the desktop app stays isolated from the npm CLI and refuses direct graph mutation in MVP. The biggest failure mode is building a beautiful shell that silently diverges from Lumina's existing filesystem/tool contracts.

## Findings

| Severity | Finding | Why It Matters | Action |
|---|---|---|---|
| Critical | Directly editing `wiki/graph` from Go would violate the core invariant. | Current graph is generated and tools own mutation. | MVP graph service is read-only; mutation routes through existing scripts only. |
| High | Adding desktop deps to root `package.json` would damage CLI package discipline. | Root has `devDependencies: {}` intentionally and npm package allowlist is strict. | Create `apps/desktop/package.json`; root package unchanged unless adding workspace scripts later. |
| High | Wails 3 alpha creates release risk. | CLI repo is stable; alpha framework can churn. | Isolate app, pin versions, commit plan notes, keep npm CLI unaffected. |
| High | Chat in screenshot invites provider/API scope creep. | Bundled provider API conflicts with zero-telemetry/simple local model and will delay MVP. | Ship scoped local prompt UI placeholder or context handoff; no provider integration v1. |
| Medium | Graph rendering from only markdown links may miss generated edges. | Lumina graph logic is richer than wiki links. | Prefer graph files/tool output; markdown parser only enriches display. |
| Medium | File import can overwrite user raw files. | `raw/` is user-owned and overwrite-sensitive. | Import copies only when target does not exist; later phase can add confirm UI. |
| Medium | Tests can pass without proving real workspace behavior. | Desktop app must validate actual Lumina folder contracts. | Add a fixture workspace and service tests for valid/invalid roots and graph load. |
| Low | The mockup is polish-heavy. | Spending early time on visual polish delays core proof. | Implement layout fidelity enough for usability, then iterate. |

## Scope Cuts

- No bundled AI provider in MVP.
- No automatic ingest pipeline from desktop.
- No graph editing.
- No cloud sync, accounts, or telemetry.
- No packaging/signing release pipeline until MVP behavior is proven.

## Required Plan Adjustments

1. Phase 1 must establish an isolated Wails app under `apps/desktop/` and prove it can build without root package changes.
2. Phase 2 must define service contracts and fixture tests before UI.
3. Phase 3 must deliver the graph UI from fixture and real workspace data.
4. Phase 4 can add controlled tool execution and import only after read path is tested.
5. Each phase must have its own commit.

## Audit Verdict

Proceed. Do not widen scope. The app is a companion browser/control surface, not a second Lumina engine.

## Unresolved Questions

None.
