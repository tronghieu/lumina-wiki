# Brainstorm Summary: Desktop Selected Node Note Reader

## Codebase Findings

- `apps/desktop/internal/graph` loads nodes from `wiki/<entity>/*.md` and stores each node path relative to `wiki/`.
- `workspace.ResolveInside` already prevents absolute paths, backslashes, and path escape.
- Frontend inspector currently shows node title, path, preview, linked nodes, and workspace actions.
- Wails bindings regenerate from Go service methods, so adding a graph service read method is enough for frontend access.
- Current desktop write surface remains limited to source import and check runner.

## Exact Requirements

- Expected output: when a node is selected in a loaded workspace, inspector shows the full Markdown note content for that node.
- Acceptance: reads only `.md` files under `wiki/`; rejects path escape, backslash traversal, non-Markdown files, missing files, and symlink notes; sample graph without a workspace keeps using preview only.
- Scope boundary: no Markdown rendering library, no editing, no frontmatter mutation, no graph writes, no raw file preview.
- Non-negotiable constraints: Wails 3, Go backend, React/TypeScript frontend, no new dependencies, no root package changes, zero telemetry.
- Touchpoints: `apps/desktop/internal/graph/service.go`, graph tests/types/bindings, `App.tsx`, `node-inspector.tsx`, desktop README.

## Approaches Considered

### A. Read-only graph service method

Add `ReadNote(root, notePath)` to graph service. It validates workspace, resolves `wiki/<notePath>`, rejects unsafe files, and returns content.

Pros: small, testable, matches graph ownership, no new service.  
Cons: graph service grows beyond graph topology into note content reads.

### B. New notes service

Create `internal/notes` with read-only note APIs.

Pros: clean domain boundary if note features grow.  
Cons: overkill for one read-only method; more bindings and files.

### C. Frontend reads files directly

Use Web APIs or runtime APIs to read selected files.

Pros: no backend code.  
Cons: bypasses path safety and workspace validation, not acceptable.

## Recommendation

Use approach A now. Keep the method narrowly named and read-only. If later features add search, backlinks by section, or note editing, extract `internal/notes`.

## Success Metrics

- Selecting `concepts/privacy.md` in fixture returns full Markdown including body text.
- Unsafe paths and symlink notes are rejected in Go tests.
- Inspector clearly distinguishes preview from full note content.
- Existing graph/check/import flows remain unchanged.
