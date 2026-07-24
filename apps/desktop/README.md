# Lumina Desktop

Lumina Desktop is a Wails 3 companion app for existing Lumina-Wiki workspaces.
Its reference-faithful workspace shell combines the real workspace tree, graph,
Markdown notes, checks, source import, and an optional AI agent without changing
the root npm CLI package.

## Stack

- Wails 3 alpha
- Go backend
- React + TypeScript frontend
- React Flow for the graph canvas

## Prerequisites

- Node.js 20 or newer
- Go toolchain compatible with Wails 3
- Wails 3 CLI: `wails3`
- Platform WebView dependencies required by Wails

## Development

```bash
cd apps/desktop
cd frontend
npm ci
npm run test
npm run build

cd ..
go test ./...
```

Run the app in development mode:

```bash
cd apps/desktop
wails3 dev
```

Build a local app binary:

```bash
cd apps/desktop
wails3 build
```

Useful verification commands:

```bash
cd apps/desktop
go test ./...
wails3 generate bindings -clean=true -ts
wails3 build

cd frontend
npm run test
npm run build
npm audit --omit=optional
```

## Scope

This app is intentionally isolated from the root npm package. Do not add
desktop dependencies to the root `package.json`. AI, retrieval, and navigation
keep the active workspace immutable. The existing check and non-overwriting
source-import flows remain the only operational surfaces; graph and wiki
mutations still belong to existing Lumina tools, not direct app edits.

Workspace surface:

- `Run Check` executes the installed workspace script at
  `_lumina/scripts/lint.mjs --summary` through Go `exec.CommandContext`.
- `Import` copies one selected file into `raw/sources/`; it refuses overwrites
  and rejects symlink sources.
- `Open Workspace` starts with the native folder picker, then requires backend
  confirmation before activating a session capability for AI, tree, and history
  reads.
- The responsive shell renders the real bounded workspace tree and `wiki/`
  graph, with no sample workspace content.
- Selecting a graph node shows the full Markdown note content in the inspector.
- `Run Check` shows both the summary and detailed stdout/stderr output in the
  inspector.
- `Choose Source` uses the native file picker; the importer service still
  performs all filesystem validation before copying.

AI surface:

- Provider-backed chat streams cited answers and supports cancellation, retry,
  new conversations, and workspace-scoped history.
- The Go backend owns provider profiles, credential handling, conversation
  history, retrieval, citations, and active workspace sessions. Secrets are not
  returned to the frontend.
- Lexical workspace search is always available. Semantic search is opt-in,
  requires disclosure consent, and falls back to lexical search when unavailable.

The desktop app is not released yet. Visual, accessibility, native packaging,
and release gates remain pending.

Generated Wails packaging assets under `build/` are committed because native
desktop builds use them directly. Recreate them with:

```bash
cd apps/desktop
wails3 task common:update:build-assets
wails3 generate icons -input build/appicon.png -macfilename build/darwin/icons.icns -windowsfilename build/windows/icon.ico -iconcomposerinput build/appicon.icon -macassetdir build/darwin
```

## Wails 3 Caveat

Wails 3 is still alpha. Keep framework-specific code contained under this
directory so CLI users are not affected by desktop tooling churn.
