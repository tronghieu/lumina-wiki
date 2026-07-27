# Phase 4 Focused Scout: Welcome, Create, Open, and Restore UX

## Outcome and Boundaries

Phase 4 should turn the Phase 2 provisioner and Phase 3 recent/restoration APIs
into one non-technical boot and library flow:

```text
booting -> restoring -> ready
booting -> welcome
restoring -> identity confirmation -> ready
restoring failure/cancel -> welcome with recovery
```

It owns visible Welcome/Create/Open/recent/recovery states and independently
restores latest saved conversation, reading note, and Chat/Note/Graph focus.
It does not implement provisioning filesystem mechanics, silently bypass
identity confirmation, expose external runtimes, add official skill execution,
or show model/provider selectors outside Advanced settings.

User-language decisions:

- visible nouns: library, document, note, topic, relationship;
- no CLI, runtime, pack, schema, registry, signature, root path, state file,
  JSON, or workspace-ID terminology;
- canonical `/lumi-*` IDs remain reserved/unchanged, but skill runtime is out
  of scope for this phase;
- model/provider selection stays in Advanced settings only;
- Create/Open/Restore makes no network request and asks no blanket first-run
  network consent;
- existing `Check` cannot remain an apparently working clean-machine action
  while it still launches external Node. Hide it in this slice or replace it
  only when the native-check phase is ready.

## Exact File Inventory

### Boot orchestration and new Welcome feature

| File | Required Phase 4 change |
|---|---|
| `apps/desktop/frontend/src/App.tsx` | Own `booting/welcome/restoring/ready`, call Phase 3 APIs, coordinate session-safe independent restoration, render Welcome vs shell. |
| `.../features/workspace/welcome-screen.tsx` (new) | Accessible Welcome, Create/Open actions, recent list, recovery cards, local/privacy copy. |
| `.../features/workspace/welcome-state.ts` (new) | Pure state/reducer and safe machine-status-to-view-model mapping. |
| `.../features/workspace/welcome-state.test.mjs` (new) | Boot/recovery/cancel/race state matrix. |
| `.../features/workspace/workspace-restoration.ts` (new) | Pure latest-conversation, artifact-path and focus fallback helpers. |
| `.../features/workspace/workspace-restoration.test.mjs` (new) | Deterministic restoration/fallback tests. |
| `.../features/workspace/use-workspace.ts` | Replace frontend `Dialogs.OpenFile` + raw-root loading with backend Choose/Create/Restore activation and `WorkspaceSnapshot(session)`. Expose startup/action outcomes. |
| `.../features/workspace/workspace-actions.ts` | Plain-language library action states; keep internal workspace types. |
| `.../features/workspace/workspace-actions.test.mjs` | Cancellation, permission, unavailable, incompatibility and continuity-warning copy contracts. |

### Shell and semantic focus

| File | Required Phase 4 change |
|---|---|
| `frontend/src/app/app-shell-state.ts` | Add semantic focus `chat | note | graph` independently from responsive panel geometry. |
| `.../app/app-shell-state.test.mjs` | Focus restoration and stale-note fallback at 1480/1180/760 widths. |
| `.../app/app-shell.tsx` | Make focus controlled by `App`; restore Chat by opening/focusing Agent, Note/Graph through artifact tabs; retain Escape/focus recovery. |
| `.../app/desktop-title-bar.tsx` | Replace visible "Workspace" text with "Library"; support no-library boot/Welcome state if title bar is shared. |
| `.../features/workspace/workspace-rail.tsx` | Replace visible Workspace terminology; add a library switch/Welcome action without exposing paths. |
| `.../features/graph/artifact-pane.tsx` | Remove technical root input; use Create/Open/library actions; hide external-Node Check; render empty-library guidance. |
| `.../features/graph/graph-data.ts` | Add normalized note-path -> node selection helper. |
| `.../features/graph/graph-data.test.mjs` | Existing/stale path, empty graph and deterministic fallback. |
| `.../features/graph/note-view.tsx` | Preserve loading/error semantics; ensure stale restore does not show an old note. |
| `.../features/chat/agent-panel.tsx` | Accept focus target/ref, truthful history restore status, non-technical library copy. |
| `.../features/chat/use-chat-history.ts` | Add latest-history restore method/outcome; do not list/load when disabled. |
| `.../features/chat/chat-state.ts` | Reuse `chatStateFromHistory` and session clearing; no persisted frontend chat content. |
| `.../features/chat/chat-state.test.mjs` | Preserve synchronous cross-library clearing and history conversion. |

### Advanced settings decision

| File | Requirement |
|---|---|
| `frontend/src/app/ai-settings-panel.tsx` | Provider/model controls remain here only; label/entry point as Advanced settings if product copy is updated. |
| `.../app/ai-settings-panel.test.mjs` | Assert model/provider text does not appear in Welcome/App shell outside the Advanced dialog. |
| `.../features/settings/*` | No restoration-state storage and no new first-run requirement. |

### Styles and browser fixtures

| File | Required change |
|---|---|
| `frontend/src/styles/tokens.css` | Reuse existing theme tokens; add tokens only if Welcome needs a semantic role not already present. |
| `.../styles/shell.css` | Welcome/restoring/recovery/empty-library layout and existing 1180/760 behavior. |
| `.../styles/chat.css` | Restored Chat focus/announcement without fragile persisted layout. |
| `.../app.css` | Add a Welcome stylesheet import only if splitting materially reduces `shell.css`; otherwise keep scoped shell rules. |
| `frontend/tests/visual/fixtures/wails-bridge.ts` | Deterministic variants for Welcome, recents, restoring, recovery, empty, restored Chat/Note/Graph. |
| `.../tests/visual/fixture.html` | Optional query/route selection for fixture variants. |
| `.../tests/visual/accessibility.spec.ts` | Axe, keyboard, focus and live-region checks for new states. |
| `.../tests/visual/desktop-shell.spec.ts` | Dark/light and responsive snapshots for Welcome/restoration. |
| `frontend/playwright.config.ts` | Reuse existing thresholds/viewports; add projects only if a real platform need exists. |

### Existing contract tests to update

- `frontend/src/app/ai-session-integration.test.mjs`
- `frontend/src/app/app-shell-layout.test.mjs`
- `frontend/src/app/accessibility-contract.test.mjs`
- `frontend/src/styles/design-system.test.mjs`
- `frontend/src/features/shared/session-request-guard.test.mjs`
- `frontend/src/features/chat/chat-request.test.mjs` only if history/focus request
  wiring changes.

### Backend/binding dependencies consumed, not reimplemented

- Phase 2 `workspace.Provisioner`, `ProvisionResult.Root`, and non-serializable
  root proof. Phase 2 deliberately has no Wails surface; Phase 4 must add the
  thin create/provision/activate coordinator described below.
- Phase 3 `ListRecentLibraries`, `RestoreRecentLibrary`,
  `SaveWorkspaceView`, `RemoveRecentLibrary`, `WorkspaceSnapshot`,
  `ReadWorkspaceNote`.
- Generated AI/provisioning bindings under
  `frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/...`.
- Existing `ChooseAndActivateWorkspace()` should replace the frontend directory
  picker for Open once capability-scoped snapshot reads remove the need to
  receive a root.

Phase 4 backend coordinator files:

| File | Required change |
|---|---|
| `apps/desktop/internal/ai/service-provision-types.go` (new) | Safe library-name/location-choice request and progress/result DTOs; no canonical path or proof. |
| `.../internal/ai/service-provision.go` (new) | Call Phase 2 `Provisioner`, carry `ProvisionResult.Root` and proof into the shared proof-aware activation path, then record Phase 3 recent state. |
| `.../internal/ai/service-provision_test.go` (new) | Cancellation, collision, permission, proof continuity, activation rollback, error privacy and no duplicate approval. |
| `.../internal/ai/service-types.go` | Add a narrow `WorkspaceProvisioner` interface and trusted provisioned-activation dependency. |
| `.../internal/ai/wails-native-authority.go` | Own optional Change-location directory selection; do not return a path to React. |
| `apps/desktop/ai-composition.go` | Inject the verified Phase 1 payload-backed Phase 2 provisioner into `ai.Service`. |
| Generated AI bindings | Add `CreateAndActivateLibrary` only after the Go facade is complete. |

## Function and Component Checklist

### Boot state

Recommended pure types/functions in `welcome-state.ts`:

```ts
type AppMode = 'booting' | 'welcome' | 'restoring' | 'ready';
type RecoveryKind =
  | 'none'
  | 'missing'
  | 'permission'
  | 'unsafe'
  | 'incompatible'
  | 'newer'
  | 'state-unavailable';

function initialWelcomeState(): WelcomeState;
function reduceWelcome(state: WelcomeState, event: WelcomeEvent): WelcomeState;
function welcomeViewModel(machineResult: BackendStatus): WelcomeViewModel;
```

Checklist:

- show neutral branded loading while startup lookup/restore is unresolved;
- no Welcome flash before an automatic restore decision;
- every boot/activation attempt has a monotonically increasing local attempt ID
  and session request guard;
- cancellation lands on Welcome with neutral "No library opened";
- permission failure is not called corruption;
- app-state failure still enables Create/Open;
- no backend error/path rendered verbatim.

### `WelcomeScreen`

Recommended props:

```ts
type WelcomeScreenProps = {
  state: WelcomeViewModel;
  onCreateLibrary(): void;
  onOpenLibrary(): void;
  onOpenRecent(workspaceId: string): void;
  onFindAgain(workspaceId: string): void;
  onRemoveRecent(workspaceId: string): void;
  onOpenAdvancedSettings(): void;
};
```

Checklist:

- one `<main>` and one `<h1>` ("Your Lumina libraries");
- `Create library` primary, `Open existing library` secondary;
- recent libraries as a labelled list of buttons/articles, max 12;
- safe label + human last-opened time; no path by default;
- stale card: `Find again`, `Remove from recent`;
- removal requires explicit confirmation and focus restoration;
- short local/privacy statement, no blocking network consent checkbox;
- Advanced settings is optional and visually secondary;
- no model/provider input in Welcome.

### Open flow

Replace current `useWorkspace.chooseWorkspace()` frontend `Dialogs.OpenFile`
flow:

```text
ChooseAndActivateWorkspace()
  -> ActivationResult
  -> WorkspaceSnapshot(session)
  -> set loaded capability/data atomically
  -> restore conversation/artifact/focus
```

Checklist:

- backend owns picker/confirmation/path;
- no raw root input or `Connect` form in `ArtifactPane`;
- no `Validate(root)`, `Summary(root)`, `graph.Load(root)` or
  `ReadNote(root,path)` in the restored frontend flow;
- cancellation does not clear the currently active library when Open is invoked
  from an existing shell;
- successful switch invalidates citation, note, graph, history and profile
  async work before commit;
- Open workspace bytes remain unchanged.

### Create flow

Wrap the exact Phase 2 internal contract
`Provisioner.Provision(ctx, target) (ProvisionResult, error)` in the Phase 4 AI
facade. Recommended UX contract:

```text
Create library
  -> enter a friendly library name
  -> show safe default location summary
  -> optional Change location through native picker
  -> Create
  -> provision + validate + activate
  -> WorkspaceSnapshot(session)
  -> same ready/restoration pipeline as Open
```

Checklist:

- do not expose target path text editing, CLI, packs or internal folders;
- `CreateAndActivateLibrary` accepts a validated friendly name plus a backend
  location choice; React never receives the canonical target or root proof;
- carry `ProvisionResult.Root` and `ProvisionResult.Proof` directly into the
  proof-aware validator/attacher/session sequence proposed by Phase 2;
- classify name collisions/unsafe non-empty targets before mutation in Phase 2;
- cancellation and permission errors retain the entered name when safe;
- show bounded progress and allow cancellation only where Phase 2 guarantees a
  recoverable outcome;
- a new zero-node library is success, with clear next actions and Note disabled;
- do not fabricate graph/note/chat content.

### Restoration orchestration

Recommended helpers:

```ts
function selectLatestConversation(items: HistoryMetadataDTO[]): string | null;
function nodeForArtifactPath(graph: KnowledgeGraph, path: string): GraphNode | null;
function resolveRestoredFocus(
  requested: 'chat' | 'note' | 'graph',
  hasConversation: boolean,
  hasArtifact: boolean,
): 'chat' | 'note' | 'graph';
```

Runtime order:

1. Activate and receive session/workspace ID.
2. Load capability-scoped snapshot.
3. Read history status.
4. If history is enabled, list metadata, choose max `updatedAt` with ID
   tie-break, load records; otherwise do no history list/load.
5. Match saved relative artifact path against the fresh graph and capability
   read it.
6. Resolve focus independently:
   - stale Note -> Graph;
   - Chat may restore with an empty conversation if Chat was the saved focus;
   - graph empty -> Graph empty state.
7. Commit only if activation attempt and session are still current.
8. Persist fallback state after successful resolution so stale pointers
   converge.

Do not store conversation text or chat state in frontend persistence. The
backend history store remains authoritative.

### Semantic focus and responsive panels

Extend state without turning cosmetic panel geometry into a durable contract:

```ts
type PrimaryFocus = 'chat' | 'note' | 'graph';
type ArtifactView = 'graph' | 'note';
```

- Focus `chat`: open Agent and focus its heading/composer after ready.
- Focus `note`: select/read valid note and activate Note tab.
- Focus `graph`: activate Graph tab.
- At <=1180 px, opening Agent closes tree.
- At <=760 px, only one overlay is visible and no horizontal overflow occurs.
- Tree/agent open state when not implied by Chat focus, tree expansion, search,
  pan/zoom, scroll and composer draft remain cosmetic/non-persisted.

## Dependency Map

```text
Phase 1 contract/version
  -> Phase 2 workspace.Provisioner + trusted ProvisionResult
  -> Phase 3 recent/restore/view + capability snapshot APIs
  -> Phase 4 create/provision/activate Wails coordinator
  -> generated Wails bindings
  -> App boot coordinator
      -> WelcomeScreen
      -> useWorkspace activation/snapshot
      -> useChatHistory latest load
      -> AppShell semantic focus
      -> SaveWorkspaceView
  -> Phase 5 packaged platform gates
```

State ownership:

```text
Backend:
  canonical path, workspace ID, recent IDs, saved view, conversation history,
  active session capability, provider/model settings

Frontend memory only:
  boot attempt, current capability DTO, loaded graph/tree/note, active focus,
  responsive panel open state, current chat render state
```

## TDD Scenario Matrix

| Flow | Red test/action | Expected result |
|---|---|---|
| First launch | No app state/recents | Welcome; Create/Open focused/reachable |
| Boot restore | Valid last ID | Restoring surface, confirmation if required, then ready |
| No flash | Slow recent/restore promise | Welcome not rendered behind restoring |
| Restart confirmation | Exact saved library after app restart | One plain-language identity confirmation; cancel -> Welcome |
| Missing recent | Saved directory removed | Recovery card, Find again/Remove; no mutation |
| Permission recent | Unreadable directory | Access message, not "corrupt" |
| Newer/incompatible | Backend status | Plain-language recovery, no internal version/path detail |
| App-state corrupt | Backend state unavailable | Welcome still allows Create/Open |
| Open cancel from Welcome | Picker cancel | Neutral Welcome; no error |
| Open cancel while ready | Picker cancel | Existing library/session remains visible |
| Open success | Compatible existing library | Capability snapshot -> ready; no root field needed |
| Open immutability | Before/after recursive snapshot | Identical workspace bytes/types/names |
| Create cancel | Cancel name/location/provision | Welcome preserved; no partial trusted library |
| Create success empty | Zero-node provisioned library | Ready empty state; Note disabled; no fake data |
| Create collision/permission | Phase 2 typed failure | Name retained where safe; retry/change location |
| Recent list | 1 and 12 safe DTOs | Ordered, labels/times, no paths |
| Remove recent | Confirm/cancel | Focus restored; no history/identity delete |
| Find again moved | Explicit folder selection | Existing move confirmation; same ID restores state |
| Path replaced | Select different library at old location | New ID; old chat/note never displayed |
| History off | Restored library | No List/Load/Toggle call; empty Chat |
| No saved history | Enabled + empty list | Empty Chat, no warning |
| Latest history | Updated times differ from creation order | Max `updatedAt`, ID tie-break loaded |
| Deleted during load | Load returns empty | Empty Chat; library remains ready |
| Corrupt history | List/load rejects | Non-blocking history warning; no auto-enable/overwrite |
| Note restore | Saved relative path exists | Correct node/note and Note focus |
| Stale note | Saved path missing | Graph focus, first valid node only as graph selection |
| Empty graph stale note | No nodes | Graph empty state, no error |
| Chat focus desktop | Saved Chat | Agent opens and focus enters Agent after ready |
| Chat focus medium/narrow | Saved Chat | Tree closes, one overlay, no overflow |
| Switch A -> B | Delay A history/note after B starts | A data hidden immediately and late results ignored |
| Save view failure | Backend rejects save | Ready shell stays usable; non-blocking continuity warning |
| Advanced-only model | Scan Welcome/shell and Playwright roles | No model/provider selector outside Advanced dialog |
| External runtime absent | Open/create/use ready shell | No Check action that launches Node; no runtime error |
| Network | Instrument bridge/network on boot/open/create | No network request/telemetry |

## Commands

Pure/state tests first:

```bash
cd apps/desktop/frontend
node --test --experimental-strip-types \
  src/features/workspace/welcome-state.test.mjs \
  src/features/workspace/workspace-restoration.test.mjs \
  src/app/app-shell-state.test.mjs \
  src/features/graph/graph-data.test.mjs \
  src/features/chat/chat-state.test.mjs
```

Frontend type/integration:

```bash
cd apps/desktop/frontend
npm run test
npm run build
```

Accessibility and visual:

```bash
cd apps/desktop/frontend
npm run test:a11y
npm run test:visual
```

Backend/binding integration:

```bash
cd apps/desktop
wails3 generate bindings -clean=true -ts
go test ./internal/ai ./internal/appstate ./internal/workspace ./internal/graph
go test ./...
```

Race/full pre-handoff:

```bash
cd apps/desktop
go test -race ./internal/appstate ./internal/ai ./internal/ai/session ./internal/ai/workspaceid

cd frontend
npm run test
npm run build
npm run test:a11y
npm run test:visual
```

Phase 5, not Phase 4, owns `wails3 build` and packaged macOS/Windows/Linux
launch/reopen evidence.

## UX, Accessibility, and Visual Risks

### UX risks

- Current shell says "Workspace" in title bar, navigation, status and errors;
  leaving mixed Library/Workspace terminology violates the non-technical
  decision.
- Current `ArtifactPane` exposes an editable filesystem root and `Connect`;
  this must not survive into the normal library flow.
- Current Open does raw-root reads before capability activation. Reusing it
  unchanged undermines safe restore.
- `Run Check` still launches Node; leaving it visible contradicts app-only use.
- Two native prompts on restore (directory approval plus identity) feel broken.
  Restore-by-ID should retain only the verified identity confirmation.
- Showing privacy/network consent as a blocking Welcome step is misleading
  because no network action occurs.
- "Latest conversation" must be defined by `updatedAt`, not current backend list
  order.
- A history error must not masquerade as "No saved conversations."

### Accessibility gates

- Welcome is the one main landmark before ready; the shell becomes the one main
  landmark after ready.
- One `h1`, labelled recent list, real buttons, visible focus.
- Restoring uses a polite live region and `aria-busy`; it does not trap focus.
- Recovery status is announced once; raw changing filesystem errors are not
  streamed into live regions.
- Remove confirmation is modal, traps focus, Escape cancels, trigger regains
  focus.
- Chat/Note/Graph controls preserve keyboard semantics; restored focus occurs
  only after native confirmation closes.
- Long Unicode labels and 200% zoom preserve actions.
- Axe WCAG A/AA passes Welcome, 12 recents, recovery, empty library, restored
  Chat/Note/Graph in dark and light modes.
- Reduced-motion rules cover Welcome transitions and restored focus.

### Visual/responsive gates

Snapshots:

- first-run Welcome, dark/light;
- Welcome with 1 and 12 recents;
- missing/access recovery;
- restoring/busy;
- empty created library;
- restored Graph, Note and Chat at 1480×920;
- restored Chat at 1180×820 and 760×780.

Assertions:

- no horizontal overflow at 760 and a smaller narrow width;
- no path text stretches recent cards;
- Create/Open remain visible without scrolling on first launch;
- only one tree/Agent overlay at medium/narrow;
- deterministic fixture data lives only in the visual fixture, never production
  components;
- existing 2% screenshot threshold remains unless an approved design baseline
  intentionally changes.

## Unresolved Questions

1. Confirm whether Chat is a true future primary page or, for this slice, the
   recommended semantic focus that opens/focuses the existing Agent panel.
2. Confirm the OS-standard default library parent and collision-name policy.
   Phase 2 intentionally accepts an explicit target; Phase 4 must own this
   user-facing policy before defining `CreateLibraryRequestDTO`.
3. Confirm whether a recent-card removal needs a modal dialog or an inline
   two-step confirmation; both must restore focus and avoid deleting history.

Status: DONE_WITH_CONCERNS

Summary: Phase 4 should replace the technical raw-root flow with a guarded
boot/Welcome state machine, backend-owned Create/Open/Restore activation,
independent latest-history/note/focus restoration, and responsive accessible
recovery states. Provider/model controls remain Advanced-only.

Concerns/Blockers: Phase 4 cannot be implemented safely until Phase 2 exposes a
single create/provision result and Phase 3 generates restore/snapshot bindings.
The external-Node Check action must be hidden or natively replaced for the
app-only user journey.
