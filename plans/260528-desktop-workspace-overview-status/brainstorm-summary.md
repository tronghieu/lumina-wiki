# Brainstorm Summary: Desktop Workspace Overview Status

## Problem

The desktop app can open a workspace, render the graph, show notes, run checks,
and import one source. It still gives weak orientation: users do not see which
workspace packs are detected, how much content exists, or whether core folders
are missing until an action fails.

## Codebase Findings

- Wails 3 app lives under `apps/desktop`; root package stays untouched.
- Backend workspace service already validates root and detects packs.
- Graph, check, and import services already reuse workspace validation and path
  containment.
- Frontend already holds app-level workspace state in `App.tsx` and renders
  shell/inspector status surfaces.
- Plan history shows MVP is complete; incremental desktop feature plans are
  committed per feature.

## Options Considered

### Option A: Frontend-only summary from loaded graph

Pros: smallest change, no binding regeneration.
Cons: cannot show raw/source inventory or missing folders; weak fit for Lumina
workspace contract.

### Option B: Backend workspace summary API

Pros: one read-only source of truth for packs, raw sources, wiki notes, graph
edges, citations, and missing optional folders. Matches existing service pattern.
Cons: requires Wails binding regeneration and Go tests.

### Option C: Run existing lint/check and derive dashboard

Pros: uses existing Lumina tooling.
Cons: slower, conflates health checks with inventory, can fail for reasons not
related to summary.

## Decision

Use Option B.

Add a read-only `Summary(root)` method to the workspace service. Frontend loads
it during workspace load/refresh and renders a compact overview strip in the
main workspace area plus pack/source details in the inspector.

## Requirements

- Expected output: loaded workspace shows overview counts for packs, wiki notes,
  raw sources, graph edges, citations, and missing expected folders.
- Acceptance:
  - Opening or refreshing a workspace updates overview.
  - Empty/sample state does not claim real workspace counts.
  - Missing `raw/`, `raw/sources`, or `wiki/graph` is surfaced as missing
    inventory, not as a workspace validation failure.
  - Summary reads only; no workspace files are mutated.
- Scope boundary: no file watcher, no recent workspace persistence, no check
  auto-run, no ingest or graph edits.
- Constraints: no new dependencies, no root package changes, no telemetry, no
  direct wiki/graph mutation.
- Touchpoints: workspace Go service/tests, generated Wails bindings, `App.tsx`,
  `AppShell`, `NodeInspector`, workspace frontend formatters/tests, CSS.

## Risks

- Counting too broadly may confuse users. Mitigation: count regular files only;
  count wiki markdown notes outside `wiki/graph`.
- Symlink traversal could leak outside workspace. Mitigation: `WalkDir` does not
  follow symlinked dirs; count regular files only.
- UI crowding in current three-column shell. Mitigation: compact status strip
  with fixed labels and wrap-safe layout.

## Unresolved Questions

None.
