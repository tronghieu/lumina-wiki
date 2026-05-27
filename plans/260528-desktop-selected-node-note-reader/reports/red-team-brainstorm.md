# Red-Team Brainstorm: Desktop Selected Node Note Reader

## Findings

1. Node path is user-controlled data once loaded from workspace files.
   - Mitigation: do not trust it; resolve as `wiki/<path>` through workspace safe resolver.

2. `ResolveInside(root, "wiki/"+path)` must not allow absolute or backslash paths.
   - Mitigation: reject absolute `notePath` and backslash in graph service before joining.

3. Symlink notes could expose files outside the workspace.
   - Mitigation: use `os.Lstat`; reject symlink and non-regular files.

4. Non-Markdown paths could read `wiki/graph/edges.jsonl` or other internals.
   - Mitigation: require `.md` suffix and use relative node paths from graph entities.

5. Large notes could make inspector unusable.
   - Mitigation: initial implementation displays plain text in scrollable panel; no rendering or parsing. Size cap deferred unless real workspace shows issue.

6. Async selection changes can show stale content.
   - Mitigation: clear previous content on new node/workspace; only display content for current selected path.

7. Markdown rendering may introduce XSS if added casually.
   - Decision: no Markdown HTML renderer in this feature.

## Verdict

Proceed with a read-only graph service method and plain Markdown display. Security risk is acceptable with path, suffix, symlink, and workspace checks.
