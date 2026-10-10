# Adversarial Review — ARCHITECTURE-SPINE wiki-view

- **Target:** `../ARCHITECTURE-SPINE.md` (draft, 2026-10-10)
- **Method:** five builders work apart and obey every `AD` to the letter. Each hole below is a pair of compliant readings that do not fit together.
- **Builders:** S = HTTP server (`view.mjs`, `lib/server.mjs`). D = read model (`lib/data.mjs`). C = React client (`ui/`). B = build script and CI guard. I = installer and skill.

## Verdict

The spine pins the wire routes and the process line well. It does not pin the seams between builders: the `server.mjs` to `data.mjs` call, the value of several AD-7 keys on real data, and the owner of every file outside the five named scopes. Two holes stop the first integration outright. Three more break a fresh install or a spec acceptance check.

## Facts checked in the code

These drive the ranking. All are in `src/scripts/` unless noted.

| Fact | Where |
| --- | --- |
| `lint.mjs` imports `node:fs/promises`, `node:fs`, `node:path` and runs a `process.argv[1]` guard at module top level | `lint.mjs:47-49`, `lint.mjs:3523` |
| `WIKILINK_RE` is `/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g`, not exported; the capture is untrimmed | `lint.mjs:181` |
| `schemas.mjs` has no import and no `process` use | whole file |
| The installer seeds `wiki/index.md` and `wiki/log.md` with no frontmatter | `src/installer/commands.js:2381,2384` |
| `parseFrontmatter` returns `null` for such a file, and turns `title: 1984` into the number `1984` | `lint.mjs:980-1060` |
| `checkL05` reports a link broken whenever the trimmed target is not an exact known slug; `resolveWikilinkTarget` also accepts a unique bare basename and a `.md` suffix | `lint.mjs:1404`, `lint.mjs:722-730` |
| L06, L08, L17, L19 set `file` to the raw `edge.from`; L20 sets `graph/citations.jsonl`; L09 sets `index.md` | `lint.mjs:1477,1532,1903,2004,2038,1578` |
| `ENTITY_DIRS` contains `graph` | `schemas.mjs:142` |
| `REQUIRED_FRONTMATTER` is keyed by folder plus `_base`; each folder list repeats the base keys and mixes `required: true` with `required: false` | `schemas.mjs:305-345` |
| `detectCommunities` gives every node a community, singletons included, and names each after a node id with the text before the first `:` cut off | `src/project/lib/view.mjs:91-140` |
| `runLint` findings carry extra keys (`fix_applied`, `brokenSlug`, `candidates`, `key`, …) | `lint.mjs:1147`, `lint.mjs:3366-3372` |

## Ranked holes

### H1 — `server.mjs` and `data.mjs` share no interface. Critical, certain.

- **AD:** AD-1, AD-7, AD-13.
- **S reads:** AD-1 says the read model "takes a workspace root and returns plain data". S writes `import { getWiki, getPage, getLint } from './data.mjs'`. S builds `generatedAt` and `schema` itself, because they are part of the response. S maps lint findings in the route, because AD-13 says "`/api/lint` calls `runLint` … It maps each finding".
- **D reads:** the Structural Seed assigns AD-13 to `data.mjs`. D exports `buildGraph(root)`, `readPage(root, id)` that throws on an unknown id, and `lintFindings(root)` that already adds `nodeId`.
- **Both comply:** no AD names an export, a signature, sync or async, the split of the response body, or how "not found" is signalled.
- **Failure:** `SyntaxError: does not provide an export named` at start. After a hand fix: `nodeId` added twice or never, an unknown id answered 500 instead of 404, `schema` missing.
- **Closing rule (new AD):** `lib/data.mjs` exports exactly three async functions, `readWiki(root)`, `readPage(root, id)`, `readLint(root)`. Each returns the complete AD-7 response body. `readPage` returns `null` for an id not in the walk. `server.mjs` adds no key: it serializes, maps `null` to 404 and a throw to 500. `/api/health` belongs to S alone.

### H2 — `WIKILINK_RE` cannot reach the browser bundle, and its export has no owner. Critical, certain.

- **AD:** AD-3, AD-14, AD-16, AD-1.
- **C reads:** AD-14 says the inline rule is "built on the engine's `WIKILINK_RE`". AD-3 says a needed symbol "is exported from its home module; it is not re-declared". C imports it from `../../../scripts/lint.mjs` in `render.mjs`. Under `node --test` this passes.
- **B reads:** AD-16 fixes the esbuild options. The list has no `platform` and no `external`. B adds neither.
- **Both comply:** each follows its own AD word for word.
- **Failure:** esbuild's default browser platform cannot resolve `node:fs/promises`; the build fails. If someone marks `node:` external, the bundle carries all of lint and dies in the browser on `process.argv`. The only other way out is to copy the regex, which AD-3 forbids. Separately, D and C both need the new export and both add `export { WIKILINK_RE }` to `lint.mjs`: duplicate export, or a merge conflict in the engine.
- **Closing rule (AD-3):** `WIKILINK_RE` moves to `schemas.mjs`, and `lint.mjs` imports it from there. `ui/lib/render.mjs` may import `schemas.mjs` and no other engine file; that is the one exception to AD-1. D owns the engine edit. Callers build a fresh `RegExp` from `.source`, because the shared object has the `g` flag.

### H3 — A page with no frontmatter has no pinned `title` or `frontmatter`. High, fires on every fresh install.

- **AD:** AD-7, Consistency Conventions.
- **D reads:** `title` comes from frontmatter. `index` and `log` have none, so `title: null`. `frontmatter` is what `parseFrontmatter` returns: `null`.
- **C reads:** `viewer-ui.md` says the tree "shows each page by title, falling back to slug". C expects the server to have applied that, since only the read model may interpret an id (AD-5). C calls `node.title.toLowerCase()` in search and reads `frontmatter.created` in the header.
- **Both comply:** AD-7 lists the keys, not their values.
- **Failure:** `TypeError` on the two pages every workspace has. White screen in the CAP-1 acceptance run. Second trigger: `title: 1984` arrives as a number.
- **Related divergence, same key:** the convention "JSON keys camelCase" lets D rename `external_ids` to `externalIds`, while `schema.required` still says `external_ids`. The convention "Dates: ISO 8601 UTC" lets D turn `created: 2026-10-10` into a timestamp, which C then shows a day early west of UTC.
- **Closing rule (AD-7):** `title` is always a non-empty string: `String(frontmatter.title)` when present and non-empty, else the last segment of the id; for a `url` node the href; for a `missing` node the target as written. `frontmatter` is `parseFrontmatter(...).data` unchanged, keys and value types as parsed, and `{}` when the page has none.

### H4 — AD-13's `nodeId` rule is wrong for edge findings, and has two owners. High, likely.

- **AD:** AD-13, AD-7.
- **S (or D) reads:** "`nodeId` (the finding's `file` without `.md`)". Strip the suffix, done.
- **C reads:** `nodeId` is a node id (the name says so). C marks `nodeById.get(f.nodeId)`.
- **Both comply:** the rule is followed exactly.
- **Failure:** for L06, L08, L17 and L19, `file` is the raw `edge.from`. When an edge stores a bare `lora`, `nodeId` is `lora` and matches nothing. The CAP-15 acceptance fixture is an L06 finding, so the page is never marked. For L20 `nodeId` becomes `graph/citations.jsonl`. C either drops such findings silently or crashes on the lookup. "The marked set equals what `lint --json` reports" cannot hold for file-level findings.
- **Closing rule (AD-13):** `readLint` sets `nodeId` to `resolveWikilinkTarget(file, pageSet, basenameIndex)` and to `null` when that fails. The client marks a page only for a non-null `nodeId` and lists the rest in one workspace-level group. `readLint` strips every key not in AD-7.

### H5 — The shell and the stylesheet have no owner, no mount point, and no pinned asset paths. High, likely.

- **AD:** AD-16, AD-7, Structural Seed.
- **B reads:** `app/` is the build's output folder, so B authors `app/index.html` with `<div id="app">` and `<script src="viewer.js">` in `<head>`, matching the files on disk.
- **C reads:** C owns `ui/` only. `main.jsx` mounts on `document.getElementById('root')`. C writes class names in JSX and assumes someone writes `viewer.css`.
- **Both comply:** AD-16 says the two files are "authored by hand". No AD says by whom, names the mount element, or says the shell must use the `/assets/` routes.
- **Failure:** blank page. `viewer.js` at `/viewer.js` is a 404 (AD-7). A head script runs before the mount element exists. No styles. If nobody writes the files, the install list exits 3. If S guesses a content type, `nosniff` blocks the script.
- **Closing rule (new AD):** C owns `app/index.html` and `app/viewer.css`. The shell links `/assets/viewer.css` and loads `/assets/viewer.js` with `defer`, holds `<div id="root">`, and contains no inline script. S sends `text/html`, `text/javascript`, `text/css`, `application/json`, each with `charset=utf-8`.

### H6 — The viewer and lint disagree on bare slugs today. High, certain where such a link exists.

- **AD:** AD-5.
- **D reads:** AD-5 says resolve with `resolveWikilinkTarget`. `[[lora]]` with one `sources/lora` resolves. `links` gives the id.
- **C reads:** show lint findings for the open page (CAP-15). `checkL05` reports the same `[[lora]]` as "Broken wikilink … does not resolve to any wiki file".
- **Both comply:** AD-5 claims to prevent this, but `checkL05` tests exact match only (`lint.mjs:1404`). It never calls the resolver.
- **Failure:** the reader shows a working link and, under it, an error saying the link is broken. A CAP-9 test written as "`links[t] === null` exactly when L05 fires" fails on the first bare slug and on every `.md`-suffixed target.
- **Closing rule (AD-5):** "agree with lint" means agree with `resolveWikilinkTarget`, not with L05. The CAP-9 test compares `links` against that function only. The reader may show a working link and an L05 finding for it together.

### H7 — `nodes` is both the page list and the graph node list. Medium-high.

- **AD:** AD-7, AD-4.
- **D reads:** `data-mapping.md` says of `index` and `log`: "whether they are graph nodes follows from whether any edge names them". `nodes` feeds the graph. D leaves them out when no edge names them.
- **C reads:** AD-15 builds the tree "from node ids". The tree must list `index.md` and `log.md` (CAP-7).
- **Failure:** the tree has no index and no log, and they cannot be opened. With the opposite D reading, the graph shows two permanent orphans.
- **Closing rule (AD-7):** `nodes` holds every page under `wiki/` outside `graph/`, always including `index` and `log`, plus one node per `url` and `missing` endpoint. The client draws a page whose `type` is `null` in the graph only when an edge touches it.

### H8 — The key of the `links` map is not pinned. Medium.

- **AD:** AD-7, AD-14.
- **D reads:** key is "the target as written". For `[[ lora |LoRA]]` D may store ` lora ` (raw capture), `lora` (trimmed, as lint does), or `lora |LoRA` (everything written inside the brackets).
- **C reads:** the inline rule looks up capture group 1.
- **Failure:** the lookup returns `undefined`. AD-14 defines only "an id" and "`null`". C renders `#/undefined` or throws.
- **Closing rule (AD-7):** a `links` key is capture group 1 of `WIKILINK_RE` exactly as matched, untrimmed, never with the alias. The renderer looks up the same capture. A key that is absent renders as broken. The read model scans the whole body, code blocks included.

### H9 — `schema.entityTypes[].required` and the reader header. Medium.

- **AD:** AD-7.
- **D reads:** "taken from `schemas.mjs` in its order". D emits every key of `REQUIRED_FRONTMATTER[dir]`, or only those with `required: true`. Both include `id`, `title`, `type`, `created`, `updated`. D also emits a `graph` entry, because `ENTITY_DIRS` has one.
- **C reads:** the header shows title, type, dates, then "the type-specific required fields". C prints every key in `required`.
- **Failure:** the header repeats id, title, type and both dates, or lists twelve optional fields. The legend offers a `graph` type that AD-4 says has no pages. Palette positions shift by one after `outputs`.
- **Closing rule (AD-7):** `required` is the keys with `required: true` in `REQUIRED_FRONTMATTER[dir]`, in order, minus the keys of `_base`; `[]` when the folder has no entry. `entityTypes` omits `graph`. The header shows title, type, `created`, `updated`, then each `required` key present in `frontmatter`.

### H10 — Edge rows the schema does not know. Medium.

- **AD:** AD-6, AD-7.
- **D reads:** emit every stored relation. A row whose `type` is not in `EDGE_TYPES` goes out as is.
- **C reads:** "the client shows only … relation types it received in `schema`". C indexes `relationByName[edge.type].symmetric`.
- **Failure:** `TypeError` on one bad row in `edges.jsonl`, or an edge that is drawn but can never be filtered.
- **Closing rule (AD-6):** rows lacking a string `from`, `type` or `to` are skipped. A row with an unknown `type` is emitted with `directed: true`. The client treats a type absent from `schema` as directed and groups it under one filter entry, "other". A `confidence` outside the three values becomes `null`.

### H11 — `url:` and `missing:` nodes are half specified. Medium.

- **AD:** AD-4, AD-7, AD-15.
- **Open values:** `title` (see H3). `community`: D may run detection over all nodes, so a URL gets an index and counts in `size`; C lists "member pages" and the count is off. Whether a wikilink target with `://` maps to `url:<href>` (AD-4) or `null` (AD-7).
- **Open behavior:** AD-15 says the hash is `#/<node id>`. C sets `#/url:https://…` on a node click, the reader asks `/api/page`, AD-8 answers 404.
- **Closing rule (AD-4, AD-15):** community detection runs over page nodes and page-to-page edges; `url` and `missing` nodes get `community: null`. The hash names page ids only. Choosing a `url` node opens the href in a new tab; choosing a `missing` node opens nothing. In `links`, a target containing `://` maps to `null`.

### H12 — The tree needs a parent the client may not compute. Medium.

- **AD:** AD-5, AD-15.
- **Conflict:** AD-15 builds the tree "from node ids". AD-5 says the client "never interprets a slug, a path". The spec wants reading units "under their source"; the source is `sources/<slug>`, the unit is `readings/<slug>/<nn>-…`. Search by slug has the same problem.
- **Failure:** a strict C shows a flat list; a loose C hard-codes the `readings/<source>/` convention.
- **Closing rule (AD-5):** the client may split an id on `/`, for the tree and for the slug in search, and for nothing else. The tree nests by path segments; a segment with no page is a plain folder row.

### H13 — `id` encoding and query strings on routes. Medium-low.

- **AD:** AD-7, AD-9.
- **S reads:** "these routes exist and no others": S compares `req.url` to the route string, and cuts `id` out after `?id=` without decoding. The spine's own sequence diagram shows `?id=sources/lora` unencoded.
- **C reads:** C sends `encodeURIComponent(id)`, so `sources%2Flora`. C may also add a cache-busting query to `/api/wiki`.
- **Failure:** every page 404. An id with `+`, a space, `&`, `#` or non-ASCII letters fails on one side or the other.
- **Closing rule (AD-7):** the client sends `id` through `encodeURIComponent`. The server parses with `new URL(req.url, 'http://x')`, matches `pathname` exactly, ignores unknown parameters, and reads `searchParams.get('id')`. A missing `id` is 404.

### H14 — Exit 2 means two things, and the skill cannot tell them apart. Medium.

- **AD:** AD-10, AD-19.
- **S reads:** no workspace is exit 2; a refused bind is exit 2. `error` is free text.
- **I reads:** "on exit 2 from a refused bind" hand the user the command. I sees only the code, so I hands the command on any exit 2.
- **Failure:** in a folder with no wiki the user is told to run the same command in a terminal and gets the same error.
- **Also open:** the spec's "clear message" on a busy port has no channel in AD-10 (stdout is "exactly one line"). How long the skill waits for the first line is unstated; the probe loop alone can take 20 × 300 ms.
- **Closing rule (AD-10):** the stderr object gains `reason`: `no_workspace`, `bind_refused`, `no_free_port`, `node_version`, or `internal`. The skill hands over the command only on `bind_refused` or when the host has no background task. It waits up to 10 s for the first line. A fallback from the base port prints nothing extra; `port` in the stdout line is the message.

### H15 — Two servers for one workspace remain possible. Medium-low.

- **AD:** AD-11.
- **Race:** two launches probe the base port, both see nothing, both listen. The loser gets `EADDRINUSE` and, per the rule, "moves to the next port" and listens there.
- **Blocked probe:** a server busy inside a long `/api/wiki` or `/api/lint` call answers after 300 ms. The launcher reads that as "not ours", fails to bind, moves on, starts a second server.
- **Root identity:** `fs.realpathSync` keeps the letter case the caller typed on macOS and Windows; `fs.realpathSync.native` does not. Two shells with `c:\` and `C:\` hash to different ports. "First four bytes … as an unsigned integer" has no byte order, and "that hash" may be the digest or the 16-character string.
- **Closing rule (AD-11):** on `EADDRINUSE` the launcher probes that same port once more, with a 2 s timeout, before moving on. The real path is `fs.realpathSync.native(root)`; the hash input is its UTF-8 bytes; the base port is `28000 + digest.readUInt32BE(0) % 1000`. The probe targets `127.0.0.1`, never `localhost`.

### H16 — `version` has no source, and reuse ignores it. Low-medium.

- **AD:** AD-7, AD-11.
- **Hole:** an installed workspace has no `package.json`. S has nowhere pinned to read a version. After an upgrade, an old process keeps running old server code; it serves the new `viewer.js` from disk (no-store); AD-11 reports it as reused.
- **Failure:** new client against old read model, with whatever AD-7 changed between them.
- **Closing rule (AD-11):** `version` is the package version recorded in `_lumina/manifest.json`, read once at start; `null` when run from the repo. A probe that finds the same `root` and a different `version` exits 3 with `reason: "stale_server"`.

### H17 — AD-18's import path is wrong for files in `lib/`. Low, certain.

- **AD:** AD-2, AD-18.
- **Hole:** AD-18 allows imports from "`../scripts/`". From `_lumina/viewer/lib/data.mjs` the engine is `../../scripts/`. A literal D writes `../scripts/lint.mjs`, which resolves inside `viewer/`. A test that enforces AD-18 by pattern rejects the correct path.
- **Closing rule (AD-18):** the engine path is `../scripts/` from `view.mjs` and `../../scripts/` from `lib/`.

### H18 — A CSS import in `ui/` overwrites the authored stylesheet. Low-medium.

- **AD:** AD-16, AD-17.
- **C reads:** nothing forbids `import './reader.css'` in a component.
- **B reads:** output is `src/viewer/app/viewer.js`. esbuild then also writes `viewer.css` beside it.
- **Failure:** the hand-written `app/viewer.css` is replaced on each build. The guard diffs `viewer.js` only and stays green.
- **Closing rule (AD-16):** `ui/` imports no CSS. The build fails when the metafile lists any output other than `viewer.js`.

### H19 — Files that several builders touch, or none. Low-medium.

- **AD:** AD-2, AD-17, AD-20.
- **Shared with no owner:** `package.json` (`files` by I; `devDependencies` by C and B; scripts by B; `test:viewer` and its place in `test:all` by nobody), `ci.yml`, `ci-package.mjs` (required files by I, forbidden patterns by AD-20), `src/viewer/test-fixtures/` (S, D and C each add fixtures), the AD-15 and AD-18 enforcement tests, `THIRD-PARTY-NOTICES.md`.
- **Install list:** the AD-2 test fails when S or D adds a helper file under `lib/`. They cannot edit the list; I owns it.
- **Closing rule (new AD):** one table names the single owner of each file outside the five scopes. `src/viewer/lib/` holds exactly `server.mjs`, `data.mjs`, `communities.mjs`; a new file there is a spine change.

### H20 — AD-6 leaves normalization order open. Low-medium, one builder but fixture-visible.

- **AD:** AD-6.
- **Open points:**
  - Pairs and duplicates are compared on stored strings or on resolved ids. A forward row with a bare `lora` and its reverse with `sources/lora` only pair up after resolution.
  - A lone reverse row (the L06 state) is emitted as stored or flipped to the first-listed type.
  - Which `confidence` survives when a pair or a duplicate disagrees.
  - Which `source` survives when a legacy `cites` row in `edges.jsonl` duplicates a `citations.jsonl` row; whether a legacy `cited_by` row pairs with a citation.
  - "Sorted" by code unit or by locale. `localeCompare` changes order, and so community indices, across machines.
- **Closing rule (AD-6):** resolve endpoints first, then normalize on ids. A lone row is emitted as stored. The kept row's `confidence` wins, else the dropped row's. `source: "citations"` wins a tie. Sorting is by UTF-16 code unit.

### H21 — Client failure states are undefined. Low-medium.

- **AD:** AD-12, AD-13, AD-15.
- **Open points:** `/api/wiki` fails or the server is gone; the hash names an id that no longer exists after a reload; `/api/page` returns a `links` id that is newer than the loaded `nodes`; "fetches on load and on navigation" may mean refetching `/api/wiki` on every hash change, which restarts the force layout on each click.
- **Closing rule (AD-12, AD-15):** `/api/wiki` is fetched on load only; a hash change fetches `/api/page` only. A failed `/api/wiki` shows one full-pane notice with a reload control. A hash id absent from `nodes`, or a 404 from `/api/page`, shows "page not found" in the reader and leaves graph and tree working. One helper pair in `ui/lib/` converts between id and hash; every pane and `render.mjs` use it.

### H22 — Error codes are not listed. Low.

- **AD:** AD-7.
- **Hole:** `{error: "<code>", message}` has no code list. S sends `not_found`; C tests `error === "page_not_found"`.
- **Closing rule (AD-7):** codes are `method_not_allowed`, `forbidden_host`, `not_found`, `internal`. The client branches on the HTTP status only.

### H23 — `communities[].name` is an id, not a title. Low.

- **AD:** AD-3, AD-7.
- **Hole:** the parity copy must return what the project viewer returns: the id of the highest-degree node, cut after the first `:`. C may print it as a label (`sources/lora`) or look it up as an id (fails for a `url:` node, whose prefix was cut). Every orphan page becomes its own community in the list.
- **Closing rule (AD-7):** `name` is the id of the community's highest-degree page; the client shows that page's `title`. With H11, only pages take part, so no prefix is ever cut.

### H24 — Markdown links that are not wikilinks. Low, client only.

- **AD:** AD-14.
- **Hole:** "external links get `target=_blank`" does not define external. `[x](sources/lora.md)` and `[x](/api/health)` navigate the tab away from the app. `[x](#heading)` changes the hash, which AD-15 reads as "no page open".
- **Closing rule (AD-14):** a link is external when its href has a scheme. Any other href renders as inert text.

## One rule that closes many

H3, H4, H7, H8, H9, H10, H11, H20 and H23 are all "same key, two values". One shared artifact removes them mechanically.

- **Contract fixture (new AD):** `src/viewer/test-fixtures/contract/` holds one workspace and the expected JSON for `/api/wiki`, `/api/lint`, and three `/api/page` calls. D owns it. The read-model test asserts deep equality, `generatedAt` aside. The client tests load the same JSON and nothing hand-made.
- **It must contain:** `index` and `log` without frontmatter; a numeric title; a bare-slug link, an aliased link, a link with inner spaces, a broken link; a pair stored both ways with one bare endpoint; a lone reverse row; a symmetric row stored twice; a legacy `cites` row in `edges.jsonl`; an unknown edge type; a URL endpoint; a missing endpoint; a nested reading unit; an L06 finding and an L20 finding.

## Checked and found closed

| Question | Result |
| --- | --- |
| Who strips frontmatter | Read model only (AD-7 `body`) |
| Who strips HTML comments | `render.mjs` only (AD-14) |
| `type` for `index`, `log`, nested pages | `entityTypeForPath`: first segment when it is an entity folder, else `null` |
| `generatedAt` | ISO 8601 UTC by convention; nothing depends on its exact instant |
| `Host` with port 80 | Cannot occur: ports are 28000 to 29018, so the port is always in the header |
| `Host` in mixed case | Browsers send lower case; add "compared case-insensitively" to AD-9 for other clients |
| Health probe against a non-HTTP service | Covered by "otherwise try to listen", provided the probe treats a parse error as no answer |
| Guard order | Pinned; every error response carries the AD-9 headers |
| Path traversal | Closed by AD-8; no handler builds a path from request text |
| Windows path separators in ids | Pinned by AD-4 |

## Count

24 holes: 2 critical, 4 high, 18 medium or lower.
