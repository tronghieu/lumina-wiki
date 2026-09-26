---
name: lumi-project-view
description: >
  Runs `project.mjs view` and reports the file:// path to the generated graph
  view so the user can open it in a browser. Use when the user asks to see,
  browse, open, or visualize the project graph.
allowed-tools: [Bash, Read]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You open the door to the graph view: run the engine's `view` subcommand and
hand back a path the user can open, plus a one-line orientation to what the
page offers.

## Context

- `view` writes `_lumina/graph/view.html` (gitignored, regenerated every run):
  a self-contained page, no server, opened with `file://`. It lets the user
  drag/zoom/pan an animated force layout colored by meta-type, filter by
  type/status/folder, toggle orphans, view the local graph around a searched
  node, and click a node to see its evidence quote and a link to the exact
  source line; lint violations and stale facts are highlighted.

## Instructions

1. Run:
   ```
   node _lumina/project/project.mjs view
   ```
2. On exit 2 or exit 3, the error is on stderr as `{"error": "...", "code": 2|3}`.
   Stop and report it as-is — never retry or work around it. Suggest
   lumi-project-setup only if the error says no config was found.
3. On success, read the JSON: `{ok: true, file: "_lumina/graph/view.html",
   url: "file:///abs/percent-encoded/path/..."}`. Report `url` as-is —
   already an absolute, percent-encoded `file://` URL.

## Output Format

```
Graph view ready: file:///abs/percent-encoded/path/_lumina/graph/view.html

Open it to drag/zoom the graph, filter by type/status/folder, search a node
for its local neighborhood, and click any node for its evidence quote and
source-line link.
```

## Examples

<example>
User: "Show me the project graph."
Run `view`, get `{"ok": true, "file": "_lumina/graph/view.html", "url":
"file:///Users/.../_lumina/graph/view.html"}`, then report that `url` plus
the one-line orientation above.
</example>

<example>
`view` exits 2 with stderr `{"error": "no project root found: ...", "code": 2}`.
Report the error and suggest running lumi-project-setup if no config exists
yet. Do not attempt to create one yourself.
</example>

## Guardrails

- The only file this skill writes is `_lumina/graph/view.html`, which the
  `view` subcommand overwrites on every run (gitignored, regenerated each
  time). Nothing else is written.
- Never start a server or fetch the page yourself; report the path and stop.
- No engine, installer, or config change. No git operations.

## Definition of Done

`view` ran, exited 0, and the reported URL is exactly the engine's own
`url` field.
