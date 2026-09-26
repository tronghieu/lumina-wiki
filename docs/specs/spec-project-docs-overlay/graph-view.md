# Graph View

An Obsidian-like graph view in Lumina's own HTML page. This is the look and interaction only; nothing is opened in or exported to Obsidian.

## Delivery

- One self-contained HTML file (e.g. `_lumina/graph/view.html`), regenerated on each build, gitignored.
- Graph data embedded inline so the page works from `file://` (browsers block `fetch` of local JSON there).
- Rendered on canvas, not SVG: a full project graph reaches thousands of nodes.
- Built on `force-graph` (2D, canvas) used directly, with no React. `3d-force-graph` is a later option only.
- No network loads. `force-graph` is vendored into the package as a static asset (zero-telemetry rule 10), after measuring its size and adding it to the `ci-package` allowlist. A hand-written force layout is rejected: matching Obsidian-like interaction would be a sub-project.
- Dark theme only.
- `view` prints `{ok, file, url}`; `url` is the `file://` link to the page.
- Viewer generation is lazily imported to keep CLI cold start under 300 ms.

## Interaction

- Animated force layout; drag, zoom, pan.
- Node size by degree.
- Hover highlights a node and its neighbors and fades the rest.
- Color by meta-type, with a legend.
- Settings panel: filters by type, status, and folder; orphan toggle; force sliders (center, repel, link strength, link distance).
- Local graph: only the nodes within N hops of a selected node.
- Search.

## Lumina-specific

- Edge-type labels with directional arrows or particles (`supersedes`, `governs`, ...).
- Lint violations and stale facts highlighted as rings, off by default behind a toggle so a large graph stays readable.
- Detail panel: type, status, evidence quote, and a `vscode://file/...:line` link to the source line.
