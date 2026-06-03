# Scout and Image Access Report

Date: 2026-06-04

## Objective

Redesign the Wails desktop app to match the user's simple hand-drawn mockup, while following the prior workflow:

1. Brainstorm.
2. Red-team brainstorm.
3. Deep TDD plan.
4. Plan audit.
5. Implement.
6. Test.
7. Code review.
8. Commit, push, restart app.

## Current Evidence

- Branch: `feat/lumina-desktop-wails`.
- Worktree: clean at scout time.
- App server: `http://localhost:9245/` is listening on PID `6412`.
- Desktop app location: `apps/desktop`.
- Frontend stack: React 18, TypeScript, Vite, Wails 3 bindings.
- Graph library: `@xyflow/react`.
- No new frontend dependencies should be added unless explicitly approved.

## Relevant Files

- `apps/desktop/frontend/src/App.tsx`
  - Owns app state, workspace actions, graph loading, note loading.
  - Best kept stable unless behavior changes are required.
- `apps/desktop/frontend/src/app/app-shell.tsx`
  - Owns visible app layout: sidebar, topbar, graph workspace, inspector.
  - Primary JSX touchpoint for redesign.
- `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
  - Owns selected-node detail, note content, linked nodes, workspace actions, check details.
  - Likely needs simplification or repositioning based on mockup.
- `apps/desktop/frontend/src/app.css`
  - Primary styling touchpoint.
- `apps/desktop/frontend/src/features/graph/graph-view.tsx`
  - Graph surface can likely remain structurally stable.

## Current UI Shape

The app is currently a dense 3-column dashboard:

- Left sidebar: brand, New Chat, nav items, recent chats, favorite nodes, workspace card.
- Center: topbar, actions, search, optional overview strip, React Flow graph.
- Right inspector: selected node, tabs, preview, note content, linked nodes, workspace actions, check details.

## Constraint From Mockup

The referenced `Image #1` is not available in the current tool context and was not found as a local image asset in the repo.

Local image search found only existing product/docs assets:

- `apps/desktop/build/appicon.png`
- `assets/lumi-discover-new-paper.png`
- `assets/lumina-architecture-en.png`
- `assets/lumina-architecture-vi.png`
- `assets/lumina-env-en.png`
- `assets/lumina-env-vi.png`
- `assets/lumina-logo.png`
- `assets/obsidian-preview.png`
- `assets/social-impacts-of-AI-lumi-answer.png`
- `assets/zalo-community-qr.jpg`

## Design Requirements Known

- Must be simpler than current UI.
- Must use Go Wails 3 app already in `apps/desktop`.
- Must preserve existing desktop functionality unless user explicitly cuts scope:
  - Open workspace.
  - Refresh graph.
  - Run check.
  - Import source.
  - Search nodes.
  - Select linked nodes.
  - Read note content.
  - Show workspace overview/check status.
- Must avoid guessing details of the hand-drawn mockup.

## Pending Input

Need the user to resend `Image #1` or describe the mockup's concrete layout:

- main regions and placement,
- labels/text in each region,
- which controls stay visible,
- whether inspector/actions move, collapse, or remain side-by-side.

## Recommended Next Step

After image access is restored:

1. Analyze mockup visually.
2. Brainstorm 2-3 layout interpretations.
3. Red-team risks around hidden functionality and responsive behavior.
4. Write TDD implementation plan.
5. Implement only after design is concrete enough to verify against the mockup.

## Open Questions

- Can `Image #1` be resent or attached as a local file path?
