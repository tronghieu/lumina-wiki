# Lumina Desktop

Lumina Desktop is an unreleased Wails 3 app-only preview for local Lumina-Wiki
libraries. It can create a first library, safely open an existing one, browse
notes and relationships, and continue workspace-scoped chat without changing
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
npm run test:visual
npm run test:a11y
```

## Scope

This app is intentionally isolated from the root npm package. Do not add
desktop dependencies to the root `package.json`.

Current app-only preview:

- A first launch with no valid recent library shows Welcome with Create library
  and Open existing library paths.
- Create provisions and activates a standard library from embedded, generated
  assets. The running app does not discover or invoke Node.js, npm, Python, the
  Lumina CLI, or workspace executables.
- Open starts with the native folder picker, validates the selected library,
  confirms its identity, and does not change its names, types, modes, or bytes.
- Recent libraries live in private local application data. A later process can
  restore the latest saved conversation, open note, and Chat, Note, or Graph
  focus independently for each library.
- A moved, missing, or replaced recent library fails closed and returns to
  recovery instead of silently attaching to a different directory.
- The responsive shell renders the real bounded workspace tree and `wiki/`
  graph, with no sample workspace content.
- Selecting a graph node shows the full Markdown note content in the inspector.
- Check, Import, update, repair, reset, and other maintenance actions are
  temporarily unavailable from the current renderer surface. Graph and wiki
  mutations remain outside this preview.

AI surface:

- Provider-backed chat streams cited answers and supports cancellation, retry,
  new conversations, and workspace-scoped history.
- The Go backend owns provider profiles, credential handling, conversation
  history, retrieval, citations, and active workspace sessions. Secrets are not
  returned to the frontend.
- Lexical workspace search is always available. Semantic search is opt-in,
  requires disclosure consent, and falls back to lexical search when unavailable.

## AI privacy and local data

- Chat sends your question and selected workspace evidence only to the provider
  profile you configure. Semantic search explains whether it runs locally or
  sends note text to a remote embedding provider before you can enable it.
- Provider credentials stay in the Go backend and the operating system's secure
  credential store when available. The frontend cannot read them back.
- Conversation history is optional and stored in Lumina's local application
  data, scoped to the active workspace. You can turn history off, delete one
  conversation, or clear all conversations from the Agent panel.
- Cancel stops an active answer and waits for the backend's final cancellation
  event. Retry creates a linked attempt without duplicating the original user
  message.
- If semantic search is unavailable, chat continues with workspace text search
  and shows that fallback in the Agent panel.
- Chat, search, profiles, history, citations, and semantic indexes do not write
  into the active workspace.

The desktop app is not released yet. Local automated tests cover the app-only
library lifecycle, workspace immutability, continuity, privacy boundaries,
visual behavior, and accessibility. The
[Desktop workflow](../../.github/workflows/desktop.yml) defines native package,
install, and launch jobs for macOS, Windows, and Linux; fresh workflow results
and digest-bound manual installed-GUI acceptance reports are still required.
Signing, macOS notarization, and trusted distribution also remain release
prerequisites.
Track the remaining product work in the
[Desktop build-to-complete roadmap](../../docs/desktop-app-roadmap.md).

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
