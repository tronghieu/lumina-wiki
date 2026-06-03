# Brainstorm Summary

Date: 2026-06-04

## Problem

Current desktop UI is a dense dashboard. User wants the Wails desktop app redesigned to match a simple hand-drawn layout:

- narrow graph menu on the left,
- large graph/artifact view in the middle,
- agent/chat panel on the right,
- chat input and model selector at the bottom of the right panel.

## Mockup Read

- Left rail: "Menu graph", graph icon, `raw`, `wiki`, setting button at bottom.
- Main area: "Graph view", article/title line such as `AI Social Impact`, graph displayed below.
- Right panel: "Agent Panel", collapse chevron, new chat button, scrollable agent content, model selector and chat input at bottom.
- Notes indicate clicking tree/menu changes what is shown in the main artifact area.

## Options

### Option A: Pure Visual Restyle

Keep existing sidebar/workspace/inspector structure and only make it look narrower.

Pros:
- Lowest code churn.
- Preserves all existing behavior.

Cons:
- Still feels like old dashboard.
- Does not match right-side chat panel and narrow graph menu strongly enough.

### Option B: Simple Three-Zone Shell

Replace current visible layout with:

- compact left graph rail,
- central graph artifact,
- right agent panel that contains status, selected note, linked nodes, workspace actions, check output, and chat input.

Pros:
- Closest to mockup.
- Keeps all functionality without adding new backend/chat scope.
- Fits current React state model.
- Requires no new dependencies.

Cons:
- Agent chat is only UI placeholder until chat backend exists.
- Right panel can become long; must use scroll region and sticky composer.

### Option C: Add Real Chat Backend Now

Build model-backed chat in the agent panel.

Pros:
- Makes "Agent Panel" literal.

Cons:
- New product scope, model config, security and API-key handling.
- Not requested directly by the sketch.
- High risk for this redesign pass.

## Recommendation

Use Option B.

The redesign should be a real shell change, not just CSS polish. Keep backend behavior stable and reinterpret the existing inspector as the Agent Panel:

- selected note preview becomes agent context,
- workspace actions become compact controls,
- check details stay available inside the right panel,
- model selector is a disabled/local selector for now,
- chat input is present but does not promise remote model behavior.

## Concrete Acceptance

- App visually has three clear zones matching the sketch.
- Left zone is a narrow graph menu, not the old full sidebar.
- Center zone is the primary graph/artifact surface.
- Right zone is titled/structured as an agent panel and has top new-chat affordance plus bottom model/input composer.
- Existing actions still reachable: open workspace, refresh graph, run check, choose source, import.
- Existing graph interactions still work: search/select nodes, linked node navigation, note reading.
- Frontend test/build and Go/Wails build pass.

## Open Questions

None for this pass. Treat chat/model controls as visual shell only unless user requests live model integration.
