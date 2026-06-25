# Lumina Desktop

Lumina Desktop is a Wails 3 companion app for existing Lumina-Wiki workspaces.
The MVP is local-first and graph-focused: inspect the wiki graph, run the
existing Lumina check tool, and import source files without changing the root
npm CLI package.

## Stack

- Wails 3 alpha
- Go backend
- React + TypeScript frontend
- React Flow for the graph canvas

## Prerequisites

- Node.js 20 or newer
- Go 1.25 or newer
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
desktop dependencies to the root `package.json`. Desktop writes must respect
Lumina's workspace contract: graph and wiki mutations go through existing
Lumina tools, not direct app edits.

Current write-capable surface:

- `Run Check` executes the installed workspace script at
  `_lumina/scripts/lint.mjs --summary` through Go `exec.CommandContext`.
- `Import` copies one selected file into `raw/sources/`.
- Import publishes the completed copy atomically, refuses overwrites, and
  rejects symlink sources or workspace paths.

Current read/navigation surface:

- `Open Workspace` uses the native folder picker, validates the selected
  Lumina workspace, and loads its real `wiki/` graph.
- Selecting a graph node shows the full Markdown note content in the inspector.
- `Run Check` shows both the summary and detailed stdout/stderr output in the
  inspector.
- The graph canvas starts with sample data only until a workspace is loaded.
- `Choose Source` uses the native file picker; the importer service still
  performs all filesystem validation before copying.

Current MVP limits:

- No provider-backed chat.
- No graph edge or wiki note editing.
- Workspace and source paths are session-only; recent workspaces are not
  persisted yet.

## Continuous Integration

The repository CI runs the desktop frontend typecheck/tests/build and the Go
test suite on Ubuntu 24.04. The desktop dependency trees remain separate from
the root npm package, and the package-readiness gate rejects any accidental
`apps/desktop/` files in the published CLI tarball.

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
