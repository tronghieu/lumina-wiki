# Red-Team Brainstorm

Date: 2026-06-04

## Risks

### R1. Losing Existing Functionality

The sketch is simpler than current app. Removing controls would make the UI cleaner but regress workspace workflows.

Mitigation:
- Keep all existing workspace actions in the right agent panel.
- Do not change `App.tsx` action logic unless necessary.

### R2. Fake Chat Scope

The right panel resembles chat. Implementing real model chat now would add a new feature not covered by current backend.

Mitigation:
- Add chat composer visually as local UI.
- Label model selector as local/offline style control.
- Avoid new API/key/config dependencies.

### R3. Right Panel Overflow

Node details, notes, linked nodes, workspace actions, and check output can overflow.

Mitigation:
- Make right panel a fixed column with internal scroll.
- Keep composer sticky at bottom.
- Use compact sections and stable min-widths.

### R4. Mobile/Small Desktop Collapse

The mockup is desktop-first. Wails windows can be resized.

Mitigation:
- At medium widths, collapse to two columns by hiding the agent panel.
- At narrow widths, stack left menu above graph and keep controls accessible.

### R5. Source Tests Too Brittle

Without React testing library, layout tests may read TSX/CSS source strings.

Mitigation:
- Keep test limited to durable shell contract: class names and high-level layout rules.
- Rely on TypeScript build and Wails build for stronger runtime evidence.

## Audit Decision

Proceed with a scoped shell redesign. Do not build real chat/model integration. Preserve existing data/action behavior.

## Open Questions

None.
