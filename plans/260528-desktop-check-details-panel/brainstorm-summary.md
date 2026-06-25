# Brainstorm Summary: Desktop Check Details Panel

## Codebase Findings

- Backend `tools.RunCheck` already returns `status`, `summary`, `stdout`, `stderr`, and `exitCode`.
- Frontend currently calls `RunCheck` but only formats a short summary into `WorkspaceActionState`.
- Desktop UI already has an inspector action panel where check details can fit without a new route.
- No backend contract change is needed for this feature.

## Exact Requirements

- Expected output: after `Run Check`, inspector shows a details panel with status, exit code, error/warning/fixable counts, per-check counts, stdout, and stderr.
- Acceptance: clean and issue results both render; empty stdout/stderr render as a clear placeholder; malformed/failed action still surfaces existing action error; check details survive node selection changes until next check.
- Scope boundary: no backend changes, no auto-fix, no linter rule explanations, no persistence, no parsing stdout beyond the existing summary object.
- Non-negotiable constraints: Wails 3, React/TypeScript, no new dependencies, no root package changes, no telemetry.
- Touchpoints: `workspace-actions.ts`, `workspace-actions.test.mjs`, `App.tsx`, `app-shell.tsx`, `node-inspector.tsx`, `app.css`, `apps/desktop/README.md`.

## Approaches Considered

### A. Frontend detail model from existing `CheckResult`

Store the last successful `CheckResult` in app state and render it in the inspector.

Pros: no backend changes, uses existing data, small blast radius.
Cons: only shows whatever `lint.mjs --summary` emits today.

### B. Backend runs full lint without `--summary`

Expose a second backend method for verbose lint output.

Pros: potentially richer report.
Cons: unclear output contract, duplicates check runner, higher parsing risk.

### C. Parse stdout into structured diagnostics

Interpret lint output into rule-level rows beyond `by_check`.

Pros: richer UI.
Cons: current stdout is JSON summary; deeper parsing would depend on unstable text.

## Recommendation

Use approach A. It makes existing check data visible immediately and avoids inventing a second diagnostics contract.

## Success Metrics

- User can see what `Run Check` actually returned.
- Per-check counts from `by_check` are visible.
- Raw stdout/stderr are available for debugging without leaving the app.
- Existing check/import/workspace flows remain unchanged.
