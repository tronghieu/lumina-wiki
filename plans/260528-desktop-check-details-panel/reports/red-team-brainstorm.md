# Red-Team Brainstorm: Desktop Check Details Panel

## Findings

1. Raw stdout/stderr could be long and break layout.
   - Mitigation: display in bounded scrollable `<pre>` blocks.

2. Raw output could contain sensitive local paths.
   - Mitigation: only local display, no telemetry, no persistence, no copy/upload behavior.

3. Showing JSON stdout may be ugly.
   - Mitigation: structured summary appears above raw output; raw section is debugging detail.

4. Storing check result globally can become stale after workspace changes.
   - Mitigation: clear details when loading a new workspace; details otherwise remain until next run.

5. Failed `RunCheck` can throw before returning a result.
   - Mitigation: keep existing action error path; no fake details if no result is available.

6. Adding a modal is overkill.
   - Decision: use inspector panel, consistent with current UI density.

## Verdict

Proceed with frontend-only detail model and inspector panel. Do not expand backend or invent rule docs yet.
