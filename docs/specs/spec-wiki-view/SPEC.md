---
id: SPEC-wiki-view
companions:
  - viewer-ui.md
  - data-mapping.md
  - delivery.md
  - ../spec-project-docs-overlay/graph-view.md
  - ../../planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Wiki View — Built-in Reader for a Lumina Wiki

## Why

A pain to solve plus an opportunity. In a Lumina wiki the agent writes and the human reads, yet a classic workspace ships no way to read: `view` exists only in project mode, and the README can only suggest opening the folder in a third-party markdown app. That app draws untyped links. It cannot show what Lumina records: entity types, typed and directed relations, confidence, citations between sources, clusters, lint findings. Wiki view gives every classic workspace a ready-made reading surface that understands that data and stays current while the agent works. It is positioned as the built-in option, not as a replacement for any other tool.

## Capabilities

- **CAP-1**
  - **intent:** User asks their agent to open the wiki and gets the viewer in their browser at a local address, with nothing else to install.
  - **success:** In a fresh classic install with a seeded wiki and no network beyond loopback, running the skill starts the viewer and reports an `http://127.0.0.1:<port>/` address that shows every wiki page. Where the host cannot start or keep the server, the agent gives the user one command that does the same from a terminal.
- **CAP-2**
  - **intent:** User sees the wiki as a graph where node color tells the entity type and every edge tells its relation type and direction.
  - **success:** Each entity type present has its own legend color. Selecting an edge names its relation type. A symmetric relation is drawn once, with no arrow.
- **CAP-3**
  - **intent:** Source-to-source citations appear in the graph as their own relation.
  - **success:** Each row of `citations.jsonl` shows as one directed edge between two source nodes, distinguishable from other relations.
- **CAP-4**
  - **intent:** User can narrow the graph by entity type, relation type, and confidence, and hide pages that have no relations.
  - **success:** With only sources and citations left on, the graph shows exactly the citation network.
- **CAP-5**
  - **intent:** User can recolor the graph by detected community to see clusters of related pages.
  - **success:** Switching to community view recolors the nodes and lists each community with its member pages.
- **CAP-6**
  - **intent:** User can focus the graph on one page and its neighbors within a chosen number of hops.
  - **success:** At one hop, only the selected page and the pages directly related to it remain.
- **CAP-7**
  - **intent:** User can browse every page in a tree organized the way `wiki/` is, including nested readings and chapters.
  - **success:** The tree holds every markdown file under `wiki/` outside `wiki/graph/`, the index and the log included. Nested units sit under their source or book.
- **CAP-8**
  - **intent:** Opening a page shows it as a rendered document in a pane between the graph and the tree.
  - **success:** Choosing a page in the tree opens the reader in the middle, showing title, type, and rendered body. Frontmatter and Lumina marker comments never show as raw text. Closing the reader returns to two panes.
- **CAP-9**
  - **intent:** User can follow links between pages inside the reader, and go back.
  - **success:** `[[slug]]`, `[[type/slug]]`, and `[[slug|alias]]` open their target. A link with no target is visibly marked broken. Browser Back returns to the previous page. Every link in the fixture resolves exactly as lint's `resolveWikilinkTarget` resolves it.
- **CAP-10**
  - **intent:** The reader lists the open page's relations grouped by relation type, inbound and outbound, each one a link.
  - **success:** A concept page lists the sources that introduce it, and choosing one opens that source.
- **CAP-11**
  - **intent:** The three panes stay in step with each other.
  - **success:** Choosing a graph node opens it in the reader and reveals it in the tree. Opening from the tree, or following a link, highlights the node and its neighbors in the graph.
- **CAP-12**
  - **intent:** User can find a page by typing part of its title or slug.
  - **success:** Typing a fragment lists the matching pages, and choosing one opens it in all three panes.
- **CAP-13**
  - **intent:** User sees the current wiki without asking the agent again.
  - **success:** After the agent adds or edits a page, reloading the browser shows the change, with no agent step in between.
- **CAP-14**
  - **intent:** Maintainer can publish knowing the shipped viewer bundle matches the source.
  - **success:** CI rebuilds the bundle and fails on any difference from the committed one, on every pull request and before publish. `ci:package` requires the bundle file.
- **CAP-15**
  - **intent:** User can see which pages have lint findings, in the graph and the tree, and read the findings for the open page.
  - **success:** With a seeded missing-reverse-edge error, the page is marked in the tree and, with the lint toggle on, in the graph. The reader lists the finding's check id and message. The marked set equals the pages that the findings of `lint --json` resolve to; findings that name no page are listed once for the whole wiki.
- **CAP-16**
  - **intent:** The viewer runs only while someone keeps it running, and leaves nothing behind.
  - **success:** Ending the command frees the port and leaves no process and no file in the workspace. Starting it again for the same workspace reports the address already serving it. A port held by something else leads to another port and a clear message, never a silent failure.

## Constraints

- Read-only. The viewer writes nothing: not under `wiki/`, not under `raw/`, not anywhere else in the workspace.
- Layout is fixed: graph on the left as the primary surface, tree on the right, reader in the middle (see `viewer-ui.md`).
- The viewer is served by a local HTTP server built on Node built-ins only. It adds no runtime dependency and makes no outbound request.
- The server runs in the foreground. No daemon, no detached child, no state file, no idle timer. Whoever starts it owns its life: the agent host as a background task, or the user in a terminal (see `delivery.md`).
- The server binds `127.0.0.1` only, rejects any request whose `Host` header is not its own loopback address, accepts GET only, and sends no CORS headers. It never builds a filesystem path from request input: page ids and asset names are looked up in maps it built itself. It exposes wiki content and its own assets, nothing else.
- One source of truth. Entity types, relation types, symmetry, and exemptions come from `schemas.mjs`. Wikilinks resolve by the same rules as lint. The viewer holds no second hard-coded list (see `data-mapping.md`).
- Page content is untrusted, because pages are written from ingested external sources. Nothing from a page body, frontmatter, or slug runs as script or raw HTML, and the page carries a restrictive content security policy.
- The viewer bundle is built by the maintainer and committed to git. A user's machine never runs a bundler.
- Policy amendment: `devDependencies` are allowed for building the viewer bundle and for nothing else. The CLI, installer, and scripts keep shipping as authored source. Runtime `dependencies`, the ban on `postinstall`, the ban on native modules on user machines, and zero telemetry are unchanged.
- Policy amendment: the architecture rule "Daemonless — no server, no long-running process" now allows a foreground viewer server. A background daemon is still not allowed.
- Libraries bundled into the viewer are build-time inputs, not runtime dependencies. Each carries an allowed license (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause) and is listed in the third-party notices.
- Viewer logic lives in plain `.mjs` modules tested with `node --test`. The React layer stays thin. No Jest or Vitest.
- CLI cold start stays under 300 ms: server and viewer code are lazily imported.
- The UI is built with React 19 and is a separate viewer from the project-mode one. It reuses that viewer's graph styling (see `../spec-project-docs-overlay/graph-view.md`).
- Classic installs stay idempotent and project-mode installs stay byte-identical. Every other policy in `project-context.md` holds: en/vi/zh documentation sync, plain-language user docs, no emoji, exit codes 0–4.

## Non-goals

- Editing pages, frontmatter, or relations from the UI.
- A background daemon, auto-start, or a server that outlives the command or session that started it.
- Pushing changes to the browser. The user reloads.
- A static or `file://` export of the viewer.
- Access from another machine, and any authentication that would make that safe.
- Replacing, configuring, or exporting to any third-party markdown app.
- Rendering math, syntax-highlighted code, diagrams, or embedded images.
- Browsing or previewing files under `raw/`.
- Moving the project-mode viewer onto this one, or changing its output.
- A view across several wikis, including `lumi-hub`.
- A 3D graph.

## Success signal

- On the maintainer's own wiki, with no other app open, the maintainer runs the skill, picks a concept in the graph, reads its page, follows a typed relation to a source, and returns with Back. The agent then ingests a new source; one browser reload shows it. Stopping the command leaves no process and no new file. A release tagged with a stale viewer bundle is blocked before publish.

## Assumptions

- `/lumi-view` is a core skill, installed in every classic workspace on every classic host.
- The skill asks the host to run the server as a background task where the host has one, and otherwise hands the user the command.
- The server does not open a browser. The skill reports the address, and the user opens it.
- Reload is manual. The server does not push changes in this iteration.
- The reader renders standard markdown: headings, lists, emphasis, block quotes, links, tables, plain code blocks. An embedded image shows as its alt text. Basis: no skill or page template tells the agent to write math, fenced code, diagrams, or images into a page.
- Edge targets that are external URLs show as a distinct kind of leaf node with no reader page.
- A relation stored in both directions is drawn as one directed edge. An edge that names a page that does not exist shows as a missing node.
- Search covers titles and slugs only.
- Dark theme only, and English interface text, in this iteration.
- The reader header shows title, type, created and updated dates, and the type-specific required frontmatter fields.
- Lint markers in the graph sit behind a toggle that is off by default, as in the project-mode viewer. The tree always marks. The viewer shows findings and offers no fix.
- Scale target is 1,000 pages and 5,000 edges. The only sizes stated in the repo are in the hundreds of pages.
- The maintainer's `ai-engineering` wiki is available as the pilot fixture.
- The README keeps its mention of opening the workspace in another markdown app, but names `/lumi-view` first.

## Open Questions

- Ctrl-C in a Windows terminal is checked by hand before release. CI covers start, request rejection, and port release on Windows.
- Same bundle bytes on Linux, macOS, and Windows are proven by the first CI run of the bundle check. The fallback is defined in `delivery.md`.
