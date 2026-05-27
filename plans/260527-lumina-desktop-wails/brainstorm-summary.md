---
title: "Lumina Desktop Wails Brainstorm"
date: "2026-05-27"
status: approved-for-planning
source: ck:brainstorm
---

# Lumina Desktop Wails Brainstorm

## Summary

Build Lumina Desktop as a local-first companion app for existing Lumina workspaces. It should look and behave like the provided graph-first mockup: left navigation, main graph canvas, right inspector/chat panel. It must not replace the npm CLI or agent skills in the first release.

## Scout Findings

- Repo is currently an npm-published CLI scaffolder, not an app shell. Main code is `bin/lumina.js`, `src/installer/`, `src/scripts/`, `src/tools/`, `src/skills/`.
- Current architecture is locked around two layers: installer layer and workspace payload layer. Desktop must be a third companion layer, not a rewrite.
- Workspace contract is local filesystem: `raw/`, `wiki/`, `_lumina/`, `wiki/graph`, `wiki/log.md`, and Node/Python tools.
- Public mutation contract stays through existing tools such as `wiki.mjs` and `lint.mjs`; direct graph edits would violate project invariants.
- Existing roadmap already lists a desktop app as proposed future work.
- No current frontend framework, desktop app framework, Go module, or app package exists in repo.

## Concrete Requirements

| Area | Requirement |
|---|---|
| Expected output | A Wails 3 desktop app scaffold and MVP implementation under `apps/desktop/`, plus plan/docs/tests. |
| UX target | App resembles the provided screenshot: sidebar, graph workspace, toolbar, right panel with tabs and chat-like area. |
| Core behavior | Open a local Lumina workspace, validate it, read wiki nodes/edges, render graph, show node details, search/filter nodes, run wiki checks. |
| Data safety | Read-heavy by default; writes only via explicit tool service or safe import copy into `raw/sources`. |
| Acceptance | Desktop app builds, frontend tests pass, Go tests pass, graph loads from a seeded test workspace, no existing CLI tests regress. |
| Out of scope v1 | Replacing slash-command agent workflows, bundled LLM provider API, auto-ingest AI pipeline, background daemon, sync/cloud accounts, graph write editor. |
| Constraints | Preserve npm CLI cold-start, do not add root dev dependencies, no telemetry, no install into repo root, no direct mutation of `wiki/graph`. |

## Evaluated Approaches

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| Tauri + React + React Flow | Lightweight, mature Rust shell, good local app story | Rust dependency; project prefers Go Wails now | Rejected by user preference |
| Electron + React + React Flow | Fastest with Node scripts; large ecosystem | Heavy app, Chromium bundle, IPC/security burden, more npm dependency pressure | Good fallback, not first choice |
| Wails 3 + React + React Flow | Go backend fits filesystem/process work; native WebView; small app; type bindings | Wails 3 still alpha; Linux WebKit dependency complexity; Go module adds second build stack | Recommended |

## Recommended Design

Use Wails 3 with a React/TypeScript frontend and React Flow graph canvas.

Backend Go services:

- `WorkspaceService`: open/validate Lumina workspace, store current workspace path in app memory.
- `GraphService`: read markdown pages and graph files into normalized node/edge models.
- `ToolService`: run existing Node tools for check/status workflows; never import JS internals.
- `FileService`: copy user-selected files into `raw/sources` with no overwrite unless confirmed later.

Frontend:

- Left sidebar: workspace identity, navigation, recent graph/chat placeholders.
- Main graph view: React Flow canvas, controls, mini-map, search box, filter button.
- Right panel: details/chat/linked/media tabs, selected node metadata, scoped prompt input.
- Empty/error states: no workspace, invalid workspace, missing graph, tool failure.

## Wails 3 Feasibility Notes

- Local environment has `wails3 v3.0.0-alpha.78`, Go `1.26.1`, Node `24.14.0`, npm `11.9.0`.
- `wails3 doctor` reports no blocking local issues on macOS arm64.
- Official Wails v3 docs describe v3 as alpha, so plan must isolate the app under `apps/desktop/` and avoid coupling core CLI to Wails internals.
- React Flow is appropriate for graph rendering because it is built for custom nodes/edges, viewport controls, and interactive node graphs.

References:

- Wails v3 docs: https://v3.wails.io/
- Wails v3 installation: https://v3.wails.io/getting-started/installation/
- Wails v3 service bindings: https://v3.wails.io/learn/services/
- React Flow docs: https://reactflow.dev/

## Brutal Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wails 3 alpha churn | Tooling/API breakage before release | Keep app isolated; pin versions; document alpha status. |
| Direct file writes corrupt wiki | Loss of trust and broken linter | MVP writes only imports; graph/wiki mutation through existing tools. |
| Desktop app balloons scope | Never ships | MVP is graph browser + check runner, not full AI IDE. |
| Root npm package becomes bloated | CLI publish safety and cold-start risk | Put frontend dependencies in `apps/desktop/package.json`, not root. |
| Graph parser drift from wiki schema | Incorrect graph display | Prefer graph files and existing tool outputs; add fixture tests. |

## Success Metrics

- User can open a sandbox Lumina workspace and see graph nodes within 2 seconds for small sample data.
- User can select a node and see title/type/path/links/body preview.
- User can search nodes by title/path/type.
- User can run wiki check from UI and see summarized errors/warnings.
- `npm run test:all`, `npm run ci:package`, desktop Go tests, and desktop frontend tests pass.

## Decision

Proceed with Wails 3 + React + React Flow as an isolated `apps/desktop/` companion app. Keep first implementation local-first, read-heavy, and contract-respecting.

## Unresolved Questions

None for planning. Provider-backed chat is intentionally deferred.
