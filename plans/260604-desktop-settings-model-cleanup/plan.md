# Desktop Settings Model Cleanup Plan

Date: 2026-06-04

## Status

Complete.

## Phase 1: Test Contract

Status: complete.

Steps:

1. Update layout contract test.
2. Assert Settings panel/model controls exist.
3. Assert Agent Panel no longer owns chat/model UI.

## Phase 2: UI State and Markup

Status: complete.

Steps:

1. Add local Settings state in `AppShell`.
2. Make gear button open/close Settings.
3. Add model provider/model selects in Settings.
4. Remove fake chat controls from `NodeInspector`.
5. Remove disabled rail buttons.

## Phase 3: Styling

Status: complete.

Steps:

1. Style Settings panel as an operational side sheet.
2. Keep visual density restrained.
3. Keep responsive fallback stable.

## Phase 4: Verification

Status: complete.

Commands:

- `cd apps/desktop/frontend && npm run test`
- `cd apps/desktop/frontend && node --test --experimental-strip-types $(find src -name '*.test.mjs' -print | sort)`
- `cd apps/desktop/frontend && npm run build`
- `cd apps/desktop && go test ./...`
- `cd apps/desktop && wails3 build`
- `git diff --check`

## Open Questions

None.
