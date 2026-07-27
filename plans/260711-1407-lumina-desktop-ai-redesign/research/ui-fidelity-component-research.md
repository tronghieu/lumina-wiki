# UI Fidelity and Component Research

Date: 2026-07-11
Status: complete
Visual source of truth: `/Users/plateau/Downloads/Lumina-wiki design/lumina-wiki design/Lumina Desktop.dc.html`

## Direction

Implement the `.dc.html` design faithfully in the existing Wails 3 + React + TypeScript + React Flow stack. Preserve real workspace actions and data. Prototype content and inert controls are not product behavior: no seeded notes, graph nodes, chat messages, canned replies, counts, or successful tool results.

Bundle the prototype's exact fonts locally; never fetch Google Fonts at runtime:

- Inter: 400, 500, 600, 700
- Source Serif 4 optical-size variants: 400, 600
- JetBrains Mono: 400, 500, 600
- Be Vietnam Pro: 400, 700

Copy corresponding license files into the desktop frontend package. Do not substitute system fonts except as final CSS fallbacks.

## Exact design tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0F0F10` | `#FAFAF8` | artifact canvas/note |
| `--surface` | `#1A1A1C` | `#FFFFFF` | inputs, cards, menus |
| `--rail` | `#161617` | `#F1F0EA` | file/chat panels |
| `--rail-2` | `#121213` | `#EAE9E1` | title bar, activity strip, composer |
| `--border` | `#2A2A2D` | `#E5E5E3` | primary dividers |
| `--line-2` | `#222225` | `#E2E1DA` | tree guides/subtle rules |
| `--ink` | `#EDEDEE` | `#111111` | primary text |
| `--muted` | `#9A9A9E` | `#6B6B70` | metadata/secondary text |
| `--accent` | `#E5B341` | `#8A5E0A` | selection, CTA, graph focus |
| `--on-accent` | `#1B1505` | `#FFFFFF` when contrast requires | CTA text |
| `--success` | `#28C840` | accessible darker green | connected/pass |
| `--danger` | `#FF5F57` | accessible darker red | errors only |

Additional exact values:

- Fonts: `--font-sans: Inter`; `--font-serif: Source Serif 4`; `--font-mono: JetBrains Mono`; Vietnamese override: Be Vietnam Pro.
- Radii: 4px controls/tree rows, 5–6px panels, 8px tool cards/composer, 10px chat bubbles.
- Spacing: 4, 6, 8, 10, 12, 14, 18, 20, 32px.
- Title bar: 38px. Activity strip: 46px. File tree: 228px. Open agent panel: 344px; collapsed agent strip: 50px.
- Primary reference viewport: 1480×920.
- Motion: 150–220ms opacity/transform; retain prototype rise/blink/spin only for real state changes; respect reduced motion.

## Layout and component mapping

```text
App
└─ AppShell
   ├─ DesktopTitleBar
   ├─ WorkspaceRail
   │  ├─ ActivityStrip
   │  ├─ WorkspaceTree
   │  └─ WorkspaceSwitcher
   ├─ ArtifactPane
   │  ├─ ArtifactHeader + WorkspaceActionBar
   │  ├─ GraphNoteTabs + GraphSearch
   │  ├─ WorkspaceOverviewStrip
   │  ├─ GraphView
   │  └─ NoteView
   ├─ AgentPanel
   │  ├─ AgentHeader + SelectedContextBar
   │  ├─ ChatMessageList
   │  ├─ ToolResultCard
   │  └─ ChatComposer
   └─ AiSettingsDialog
      ├─ Chat provider/model
      └─ Opt-in embeddings settings
```

- `WorkspaceTree` groups real graph node paths and summary counts; no fixed folder/note list.
- `NoteView` displays the actual `ReadNote` result in the center Graph/Note tab.
- `AgentPanel` replaces the inspector layout while retaining selected context, linked-note navigation, check output, and workspace status.
- Provider/model controls remain settings-owned. Composer may show the active model as read-only status.
- React Flow stays; style nodes as compact circles/dots with subdued edges, amber selection, focused-neighbor emphasis, zoom/fit/layout controls.

## Production behavior versus prototype

| Prototype | Production behavior |
|---|---|
| Drawn traffic lights | Native Wails/macOS controls and real drag region; no fake window controls. |
| Connected badge | Derived from validation/loading/error state. |
| Static tree and counts | Derived from graph paths and `WorkspaceSummary`; unsupported entries omitted. |
| Back/forward, new page, help, graph settings | Omit until a real implementation exists. |
| Open/Refresh/Run check/Import | Preserve current Wails actions exactly; retain Source native picker. |
| Graph/Note switch | Real view state; real React Flow graph and `ReadNote` content. |
| Search-dim graph | Match nodes by real fields, dim nonmatches, retain selected node and neighbors. |
| Fake note body/backlinks | Real note content and `linkedNodes`. |
| Seeded chat/canned delayed reply | Empty chat state; render only actual provider responses. |
| Static passed check card | Render only after actual `RunCheck`. |
| Skill chips | Show only commands backed by real routes; `/lumi-check` may call ToolService. |
| Attach/history/add-context | Omit until backend contracts exist. |
| Theme toggle | Persist real light/dark preference and apply `data-theme`. |
| Settings-local model values | Persist non-secret preferences; backend owns credential/configured status. |
| Embeddings | Default off; explicit consent before indexing or sending note text to a provider. |

Real chat flow: validated workspace + selected note → submit request → backend validates and retrieves bounded context → optional embedding retrieval when enabled → provider call → answer plus cited note paths → citations navigate to real nodes. Use request IDs so stale responses cannot overwrite newer chat/workspace state. No frontend-held API secrets or generated fallback answers.

Embedding caches must be isolated by workspace and invalidated by note hash, provider, model, and chunking version. Prefer app-support storage so the workspace remains untouched. Remote embedding consent must explain that note text leaves the machine; local embeddings still require opt-in for disk/CPU use.

## Responsive and accessibility

- At approximately 1180px, collapse the file tree to its activity rail and make chat a reopenable drawer/strip. Never hide real chat without a reopening control.
- At narrow widths, keep graph/note primary and use overlay drawers for tree and chat; preserve all workspace actions.
- Settings must be an accessible modal dialog: labelled heading, `aria-modal`, Escape close, initial focus, focus containment, and focus return.
- Icon buttons need accessible names and visible `:focus-visible`; target a 44px hit area around compact 34px visuals.
- Tree rows need button semantics, `aria-expanded`, and selected state; remove disabled fake rows.
- Chat status uses `aria-live="polite"`; Enter sends, Shift+Enter inserts a newline; loading/disabled/error/retry states are announced.
- Provide a keyboard-accessible graph node list or equivalent fallback.
- Do not convey success/error/selection by color alone. Verify both themes independently for WCAG contrast.

## Test seams under current tooling

Keep React component tests structural because the frontend uses `tsc --noEmit` and Node's test runner without a DOM library. Move behavior into pure TypeScript modules.

- `chat-state.test.mjs`: empty-send rejection, request/loading/success/error, stale response guard, retry, new-chat reset.
- `ai-settings.test.mjs`: invalid settings normalization, credentials excluded from serialization, embeddings default false, provider/model compatibility.
- `workspace-tree.test.mjs`: deterministic grouping/sorting, real-only folders, selected-path expansion.
- `graph-data.test.mjs`: dimming search, selected node/neighbors retained, type styling.
- `theme-preference.test.mjs`: valid stored/system fallback and theme attribute.
- `app-shell-layout.test.mjs`: semantic zones, reachable actions, reopenable compact panel, dialog semantics, real composer, and absence of canned reply/seed data.
- Go tests: workspace/path validation, timeout/cancellation, non-2xx provider errors, bounded context, no embedding calls while disabled, explicit opt-in, cache isolation/invalidation, safe citation normalization.

## Likely files

Existing frontend:

- `apps/desktop/frontend/src/App.tsx`
- `apps/desktop/frontend/src/app/app-shell.tsx`
- `apps/desktop/frontend/src/app/ai-settings-panel.tsx`
- `apps/desktop/frontend/src/app/app-shell-layout.test.mjs`
- `apps/desktop/frontend/src/app.css`
- `apps/desktop/frontend/src/features/graph/graph-view.tsx`
- `apps/desktop/frontend/src/features/graph/graph-data.ts`
- `apps/desktop/frontend/src/features/graph/graph-data.test.mjs`
- `apps/desktop/frontend/src/features/graph/node-inspector.tsx`
- `apps/desktop/frontend/public/` and local font licenses

Likely new frontend:

- `src/app/theme-preference.ts` and test
- `src/features/workspace/workspace-tree.tsx`, data helper, and test
- `src/features/chat/agent-panel.tsx`, `chat-state.ts`, types, and test
- `src/features/settings/ai-settings.ts` and test

Backend/integration required for real behavior:

- `apps/desktop/internal/chat/`
- `apps/desktop/internal/settings/`
- `apps/desktop/internal/embeddings/`
- `apps/desktop/main.go`
- regenerated Wails frontend bindings
- `apps/desktop/README.md`

No new frontend runtime dependency is essential. Existing React, React Flow, CSS, local SVG/assets, pure state modules, Wails bindings, and Go standard-library HTTP are sufficient.

## Unresolved questions

None. Provider, credential, cache, and embedding-consent specifics should be fixed by the parent plan before implementation begins.
