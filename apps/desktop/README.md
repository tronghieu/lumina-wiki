# Lumina Desktop

Lumina Desktop is a Wails 3 companion app for existing Lumina-Wiki workspaces.
The MVP is local-first and graph-focused: open a workspace, inspect the wiki
graph, and run safe workspace actions without changing the npm CLI package.

## Stack

- Wails 3 alpha
- Go backend
- React + TypeScript frontend
- React Flow for the graph canvas

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

## Scope

This app is intentionally isolated from the root npm package. Do not add
desktop dependencies to the root `package.json`. Desktop writes must respect
Lumina's workspace contract: graph and wiki mutations go through existing
Lumina tools, not direct app edits.

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
