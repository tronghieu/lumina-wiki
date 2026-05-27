# Red-Team Brainstorm: Desktop Workspace Picker + Live Graph

## Findings

1. Native folder picker alone does not prove a Lumina workspace.
   - Mitigation: always call backend `workspace.Validate` before `graph.Load`.

2. Loading graph from an invalid path could clear useful current state.
   - Mitigation: keep current graph and selected node until a new graph fully loads.

3. Empty picker result can look like an error if treated as failure.
   - Mitigation: treat empty string as cancel/no-op.

4. Import source path still has manual friction if only workspace picker is added.
   - Mitigation: add source file picker in same feature; actual copy still goes through importer service.

5. Sample graph fallback can mislead users after a load failure.
   - Mitigation: label initial graph as sample/no workspace and show loaded workspace root once selected.

6. Persisted recent workspaces is tempting but creates cross-platform config surface.
   - Decision: defer. Current feature is session-only.

7. Wails runtime dialog APIs are framework-specific and alpha.
   - Mitigation: isolate usage in frontend event handlers; no backend/domain dependency on dialog APIs.

## Rejected Scope

- Do not add a database or config file for recents.
- Do not write to `wiki/` or `graph/`.
- Do not add chat placeholders beyond existing static navigation.
- Do not modify root installer/package metadata.

## Verdict

Proceed with runtime dialog + existing backend validation/load. Risk is acceptable because domain safety stays behind current Go services and tests.
