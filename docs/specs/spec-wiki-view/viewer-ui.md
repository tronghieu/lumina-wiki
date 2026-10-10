# Viewer UI

Layout and behavior of the three panes. Graph look and feel is inherited from `../spec-project-docs-overlay/graph-view.md`; this file states only what differs or is new. Only that file's Interaction and Lumina-specific sections apply here. Its Delivery section does not.

## Layout

Two panes when no page is open:

```
+--------------------------------------+-------------+
|                                      |             |
|               GRAPH                  |    TREE     |
|                                      |             |
+--------------------------------------+-------------+
```

Three panes when a page is open:

```
+------------------+-------------------+-------------+
|                  |                   |             |
|      GRAPH       |      READER       |    TREE     |
|                  |                   |             |
+------------------+-------------------+-------------+
```

- Graph is on the left and is the primary surface. Tree is on the right. This mirrors the usual markdown-app layout on purpose.
- The reader appears between them when a page opens, and leaves when it is closed.
- The graph stays visible while a page is open.

## Graph pane

Inherited from the project-mode graph view: animated force layout, drag, zoom, pan, node size by degree, hover highlight of a node and its neighbors, legend, orphan toggle, community coloring with a community list.

The resting view holds one filter box, two switches, and the legend. Nothing else sits over the graph until the reader asks for it.

Specific to the wiki:

| Aspect | Behavior |
|---|---|
| Node color | By entity type, with a legend |
| Edge | Shows relation type and direction; symmetric relations have no arrow |
| Citations | Drawn as their own relation between source nodes |
| Confidence | Visible on an edge that carries it, and usable as a filter |
| External URL target | A distinct kind of leaf node; it has no reader page |
| Filters | One filter box: plain text keeps pages whose title matches; `type:`, `rel:`, and `conf:` terms keep one kind of page, relation, or confidence; a leading `-` excludes. Focusing the box offers the keys and this wiki's values. One switch beside it: orphans. A legend entry toggles its `type:` term |
| Lint findings | A ring on the node, behind a toggle that is off by default |
| Choosing a node | Opens that page in the reader and reveals it in the tree |

## Tree pane

- Mirrors `wiki/` on disk: one group per entity folder.
- Nested pages sit under their parent: reading units under their source, chapters under their book.
- Lists `index.md` and `log.md`.
- Omits `wiki/graph/`.
- Shows each page by title, falling back to slug.
- Marks a page that has lint findings.
- Choosing a page opens it in the reader and highlights it in the graph.
- A search box above the tree finds a page by title or slug and opens it. It is separate from the graph filter: one opens a page, the other narrows the graph.

## Reader pane

Header:

- Title, entity type, created and updated dates.
- The type-specific required frontmatter fields, for example authors and year on a source.

Body:

| Content | Rendering |
|---|---|
| Headings, lists, emphasis, block quotes, links, tables, plain code blocks | Rendered |
| YAML frontmatter block | Not shown as raw text; selected fields appear in the header |
| HTML comments outside code blocks, Lumina markers included | Not shown |
| Wikilink with a target | A link that opens the target page |
| Wikilink with no target | Visibly marked broken, not clickable |
| External link | Opens outside the viewer |
| Raw HTML in the page | Never executed; shown as plain text |
| Math, syntax highlighting, diagrams | Out of this iteration; source text shows as written |
| Embedded image | Out of this iteration; its alt text shows |
| Markdown link with no scheme | Inert text; only wikilinks navigate inside the viewer |

Relations:

- Below or beside the body, the page's relations are grouped by relation type.
- Inbound and outbound are listed separately.
- Each entry is a link to the other page.

Lint findings:

- The reader lists the open page's findings: check id, severity, message, and line when known.
- The page list marks each page that has findings, and each folder that holds one.
- Findings that name no page are listed once, under the page list, closed until opened.
- The graph panel shows the three counts beside its toggle.
- The viewer calls findings "Problems" and offers no fix.

## Staying in step

One page is "open" at a time across all three panes.

| Action | Graph | Reader | Tree |
|---|---|---|---|
| Choose a node | Highlights it and its neighbors | Opens the page | Reveals and selects it |
| Choose a page in the tree | Highlights it and its neighbors | Opens the page | Selects it |
| Follow a wikilink | Highlights the target and its neighbors | Opens the target | Reveals and selects it |
| Choose a search result | Same as choosing a node | Opens the page | Reveals and selects it |
| Close the reader | Clears the highlight | Leaves | Clears the selection |
| Browser Back | Follows the reader | Returns to the previous page | Follows the reader |

## Freshness

- The server reads the wiki from disk on each request.
- Reloading the browser shows the current wiki.
- The page does not update by itself.
- After a reload, the page that was open stays open.

## Presentation

- Dark theme only.
- Interface text in English. Page content is shown in whatever language it was written.
