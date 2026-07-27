# Red-Team Brainstorm

Date: 2026-06-04

## Findings

### R1. Settings panel can become fake too

If it only contains disabled fields, it repeats the original issue.

Mitigation:
- Provider/model selects must be enabled and update local state.

### R2. AI config could imply real model calls

There is no AI backend in the desktop app.

Mitigation:
- Label section as "AI model defaults".
- Do not add API key or chat behavior.

### R3. Removing composer might hide future chat affordance

Future chat can be re-added later.

Mitigation:
- Agent Panel remains a context/action panel. Settings holds model config for future use.

### R4. Gear button accessibility

Icon-only gear must have useful label and state.

Mitigation:
- Use aria-expanded/aria-controls.

## Decision

Proceed with local Settings panel.

## Open Questions

None.
