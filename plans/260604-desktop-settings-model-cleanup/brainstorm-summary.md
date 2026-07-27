# Brainstorm Summary

Date: 2026-06-04

## Problem

After the Obsidian-style shell redesign, several controls are visual-only:

- disabled New chat,
- disabled collapse button,
- disabled chat input,
- disabled model selector in the Agent Panel,
- disabled Files/Canvas rail buttons.

User asked to remove unnecessary UI/UX and move AI model configuration into Settings.

## Options

### Option A: Hide all AI UI

Remove chat/model controls entirely.

Pros:
- Cleanest.
- No fake functionality.

Cons:
- Does not satisfy model config in Settings.

### Option B: Settings Panel With Local Model Config

Remove fake Agent Panel chat controls. Make the gear button open a Settings panel. Store provider/model values in React state.

Pros:
- Runs now.
- No backend/API scope.
- Satisfies "model config in Settings".
- Keeps future AI integration path clear.

Cons:
- Config is not persisted yet.
- Config is not connected to real AI calls.

### Option C: Full AI Config Persistence

Add backend settings storage and persisted config file.

Pros:
- More real.

Cons:
- Needs storage contract, migration, secret handling.
- Too much scope for cleanup slice.

## Recommendation

Use Option B.

## Acceptance

- Settings gear is clickable.
- Settings panel opens/closes.
- AI provider/model controls live only in Settings.
- Agent Panel no longer shows New chat, model selector, chat input, or fake send.
- Workspace actions and graph workflows remain reachable.
- Tests/build pass.

## Out Of Scope

- Real AI chat backend.
- Persisting API keys/secrets.
- Writing config files.
- CLI behavior changes.

## Open Questions

None.
