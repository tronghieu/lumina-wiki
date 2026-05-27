# Code Review: Desktop Selected Node Note Reader

## Findings

No blocking findings.

## Spec Compliance

- Selected node note content: implemented through generated `ReadNote` binding and inspector state.
- Read-only boundary: no write path added; no graph/wiki mutation.
- Path safety: backend rejects absolute paths, backslashes, path normalization changes, non-entity directories, non-Markdown files, non-regular files, and symlinks.
- Frontend scope: plain text Markdown display only; no renderer or editor.
- Existing flows: workspace load, graph display, check runner, and source import contracts unchanged.

## Red-Team Checks

- Path traversal to project root was initially caught by test and fixed by resolving inside `wiki/`.
- Direct binding calls to non-entity `.md` paths are blocked by entity directory validation.
- Fast node selection is guarded with a request id so stale note reads cannot overwrite newer selection state.

## Verification

- `cd apps/desktop && go test ./...` passed.
- `cd apps/desktop/frontend && npm run test` passed.
- `cd apps/desktop/frontend && npm run build` passed.
- `cd apps/desktop && wails3 build` passed.
- `git diff --check` passed.

## Residual Risk

- Large Markdown notes are rendered as scrollable plain text, not virtualized.
- CSS file remains over the soft 200-line target from previous UI work; no split in this feature to avoid unrelated churn.
