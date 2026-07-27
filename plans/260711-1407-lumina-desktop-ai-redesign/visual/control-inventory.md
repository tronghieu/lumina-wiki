# Desktop Control Inventory

This inventory maps every visible shell control to production behavior. Browser
tests use accessible names; test-only fixture handlers never enter the
production bundle.

| Control | Component | Production handler/state | Keyboard |
|---|---|---|---|
| Graph view | `WorkspaceRail` | `onSelectGraph` | Tab, Enter/Space |
| Workspace tree toggle | `WorkspaceRail` | `onOpen` / `onClose`, `aria-expanded` | Tab, Enter/Space, Escape |
| Theme toggle | `WorkspaceRail` | `onToggleTheme`, persisted theme only | Tab, Enter/Space |
| Settings | `WorkspaceRail` | opens `AiSettingsPanel` | Tab, Enter/Space |
| Directory row | `TreeRow` | expands/collapses local tree state | Tab, Enter/Space |
| Wiki note row | `TreeRow` | `onSelectPath`, `aria-current` | Tab, Enter/Space |
| Open | `ArtifactPane` | native directory picker then activation | Tab, Enter/Space |
| Refresh | `ArtifactPane` | `onRefreshGraph` | Tab, Enter/Space |
| Source | `ArtifactPane` | native source-file picker | Tab, Enter/Space |
| Check | `ArtifactPane` | `onRunCheck` | Tab, Enter/Space |
| Import | `ArtifactPane` | non-overwriting `onImportSource` | Tab, Enter/Space |
| Workspace root | `ArtifactPane` | draft only; submit calls activation | Tab, text entry, Enter |
| Graph / Note tabs | `ArtifactPane` | `onActiveViewChange` | Tab, Left/Right, Home/End |
| Graph search | `ArtifactPane` | `onQueryChange` | Tab, text entry |
| Graph node | `GraphView` | `onSelectNode` | hidden fallback buttons support Tab, Enter/Space |
| React Flow controls | `GraphView` | zoom in/out/fit | Tab, Enter/Space |
| Agent close/open | `AppShell` / `AgentPanel` | responsive panel state with focus restore | Tab, Enter/Space, Escape |
| History / Back | `AgentPanel` | local history view state | Tab, Enter/Space |
| New chat | `AgentPanel` | `onNewChat` | Tab, Enter/Space |
| History enable/disable | `AgentPanel` | `onToggleHistory` | Tab, Enter/Space |
| Clear/delete confirmations | `AgentPanel` | explicit two-step delete callbacks | Tab, Enter/Space |
| Citation | `AgentPanel` | backend-authorized `onCitation` | Tab, Enter/Space |
| Retry | `AgentPanel` | `onRetry` with prior attempt lineage | Tab, Enter/Space |
| Chat input | `AgentPanel` | local draft | Tab, typing, Enter sends, Shift+Enter newline |
| Send / Cancel | `AgentPanel` | `onSubmit` / `onCancel` | Tab, Enter/Space |
| Settings close | `AiSettingsPanel` | clears ephemeral secret and closes | Tab, Enter/Space, Escape |
| Chat / Search settings | `AiSettingsPanel` | controller section state | Tab, Enter/Space |
| Profile fields/save | `AiSettingsPanel` | backend profile gateway | Tab, typing, Enter |
| Credential save/remove | `AiSettingsPanel` | backend-only credential gateway | Tab, typing, Enter/Space |
| Semantic disclosure/index | `AiSettingsPanel` | consent and index gateways | Tab, Enter/Space |
