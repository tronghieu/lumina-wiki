# Data Mapping

What the viewer reads from a workspace and how each piece becomes something on screen. The engine files named here are the authority; where a doc disagrees with them, the code wins.

## Inputs

| Input | Read for |
|---|---|
| `wiki/**/*.md` except `wiki/graph/` | Pages: frontmatter and body |
| `wiki/graph/edges.jsonl` | Typed relations |
| `wiki/graph/citations.jsonl` | Source-to-source citations |
| `src/scripts/schemas.mjs` | Entity types and folders, relation types, symmetry, terminal types, exemptions |

The viewer serves nothing under `raw/`. Lint, which runs inside it, checks that the `raw/` paths a page names exist. All inputs are read from disk when the browser asks, so a reload is always current.

No existing `wiki.mjs` read command emits the full node and edge set: `list-entities` gives nodes only, and `read-edges` works per slug.

## Nodes

- One node per page file.
- Entity type comes from the page's folder, as defined by `ENTITY_DIRS`.
- A slug is unique within its entity folder, not across the wiki. Node identity must therefore include the folder.
- `index.md` and `log.md` are pages in the tree and the reader. Whether they are graph nodes follows from whether any edge names them.
- An edge target that is an external URL has no page. It becomes a leaf node of its own kind.
- An edge target that names a page that does not exist is shown as a missing node, not dropped silently.

## Edges

Line shape in `edges.jsonl`:

```
{"from":"<slug>","type":"<relation_type>","to":"<slug>","confidence":"high|medium|low"}
```

- `confidence` is optional.
- Symmetric relation types are stored once, with endpoints sorted. Draw one undirected edge.
- Relation types with a named reverse are stored in both directions. Draw one directed edge per pair, not two.
- No reverse is stored when the relation type is terminal, or when the target matches an exemption: `foundations/**`, `outputs/**`, `reflections/**`, or an external URL.
- `cites` and `cited_by` do not belong in `edges.jsonl`. A legacy row found there is treated as a citation.

`docs/project-context.md` describes the edge line as `{source,target,type,confidence}`. The code writes `{from,type,to}`. The code is correct; that doc line needs fixing.

## Citations

Line shape in `citations.jsonl`:

```
{"from":"<source-slug>","type":"cites","to":"<source-slug>"}
```

- Source page to source page only.
- Forward rows only; no `cited_by` row is stored.
- Carries no claim or locator data.

## Wikilinks

Forms found in pages: `[[slug]]`, `[[type/slug]]`, `[[slug|alias]]`.

Resolution follows lint's `resolveWikilinkTarget`:

1. An exact match on a known slug resolves.
2. A bare name that is the basename of exactly one page resolves to that page.
3. A path-qualified target resolves on exact match only.
4. A bare name shared by several pages does not resolve.

`resolveWikilinkTarget` is the single judge of whether a link resolves, for the viewer and for edge endpoints. Lint check L05 is stricter: it accepts exact matches only, so a link that resolves by unique basename works in the reader and may still carry an L05 finding.

Reflection pages carry no body wikilinks by rule.

## Page body conventions the reader meets

| Convention | Where |
|---|---|
| `<!-- lumina:index --> ... <!-- /lumina:index -->` | Catalog block in `index.md` |
| `<!-- lumina:timeline --> ... <!-- /lumina:timeline -->` | Append-only timeline on topic pages |
| `<!-- lumina:ranking --> ... <!-- /lumina:ranking -->` | Scorecard on source pages |
| `<!-- user-edited -->` | Marks a section preserved on upgrade; no closing tag |
| `"exact words" (p. N)`, `(pp. A-B)`, `(§2.3)` | Inline quotes and locators; plain text |

## Lint

The viewer shows the findings `lint.mjs --json` reports for the workspace when the page loads.

- Finding keys: `id`, `severity` (error, warning, info), `fixable`, `file`, `line`, `message`.
- `file` is a wiki-relative `.md` path for page checks, the edge endpoint as written for edge checks, and a `.jsonl` path for citation checks.
- A finding maps to a page by resolving `file` with `resolveWikilinkTarget`. A finding that resolves to no page is listed once for the whole wiki.
- The marked page set equals the set of pages the findings resolve to.
- The viewer shows findings. It never applies or offers a fix.
