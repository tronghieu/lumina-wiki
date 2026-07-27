import { useEffect, useRef, useState } from 'react';
import type {
  HistoryMetadataDTO,
  SessionReferenceDTO,
} from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import type { WorkspaceSummary } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import { AgentPanel } from '../features/chat/agent-panel';
import type { ChatCitation, ChatState } from '../features/chat/chat-types';
import type { SettingsViewModel } from '../features/settings/ai-settings';
import { ArtifactPane } from '../features/graph/artifact-pane';
import type { KnowledgeGraph } from '../features/graph/graph-types';
import type { NoteContentState } from '../features/graph/note-content';
import type { WorkspaceActionState } from '../features/workspace/workspace-actions';
import type { WorkspaceTreeNode } from '../features/workspace/workspace-tree-data';
import { WorkspaceRail } from '../features/workspace/workspace-rail';
import { AiSettingsPanel } from './ai-settings-panel';
import { resolveArtifactView, resolveResponsivePanels, type ArtifactView } from './app-shell-state';
import { DesktopTitleBar } from './desktop-title-bar';
import { resolveThemePreference, toggleTheme } from './theme-preference';

type AppShellProps = {
  actionState: WorkspaceActionState;
  aiSession: SessionReferenceDTO | null;
  canChat: boolean;
  cancellingChat: boolean;
  chat: ChatState;
  graph: KnowledgeGraph;
  history: HistoryMetadataDTO[];
  historyBusy: boolean;
  historyEnabled: boolean;
  noteState: NoteContentState;
  query: string;
  selectedNodeId: string;
  sourcePath: string;
  workspaceSummary: WorkspaceSummary | null;
  workspaceDraftRoot: string;
  workspaceRoot: string;
  workspaceTree: WorkspaceTreeNode[];
  onImportSource: () => void;
  onActivateWorkspace: () => void;
  onCancelChat: () => void;
  onCitation: (citation: ChatCitation) => Promise<boolean>;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onQueryChange: (query: string) => void;
  onDeleteHistory: (conversationId: string) => void;
  onDeleteAllHistory: () => void;
  onLoadHistory: (conversationId: string) => void;
  onNewChat: () => void;
  onProfilesChange: (settings: SettingsViewModel) => void;
  onRefreshGraph: () => void;
  onRefreshHistory: () => void;
  onRetryChat: () => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
  onSourcePathChange: (path: string) => void;
  onSubmitChat: (text: string) => boolean;
  onToggleHistory: () => void;
  onWorkspaceRootChange: (path: string) => void;
};

export function AppShell({
  actionState,
  aiSession,
  canChat,
  cancellingChat,
  chat,
  graph,
  history,
  historyBusy,
  historyEnabled,
  noteState,
  query,
  selectedNodeId,
  workspaceSummary,
  workspaceDraftRoot,
  workspaceRoot,
  workspaceTree,
  onImportSource,
  onActivateWorkspace,
  onCancelChat,
  onCitation,
  onChooseSourcePath,
  onChooseWorkspace,
  onQueryChange,
  onDeleteHistory,
  onDeleteAllHistory,
  onLoadHistory,
  onNewChat,
  onProfilesChange,
  onRefreshGraph,
  onRefreshHistory,
  onRetryChat,
  onRunCheck,
  onSelectNode,
  onSubmitChat,
  onToggleHistory,
  onWorkspaceRootChange,
}: AppShellProps) {
  const initialPanels = resolveResponsivePanels(typeof window === 'undefined' ? 1480 : window.innerWidth);
  const [activeView, setActiveView] = useState<ArtifactView>('graph');
  const [treeOpen, setTreeOpen] = useState(initialPanels.treeInitiallyOpen);
  const [agentOpen, setAgentOpen] = useState(initialPanels.agentInitiallyOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const responsivePanels = useRef(initialPanels);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const [theme, setTheme] = useState(() => resolveThemePreference(
    typeof window === 'undefined' ? null : window.localStorage.getItem('lumina.desktop.theme'),
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  ));
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const resolvedView = resolveArtifactView(activeView, selectedNodeId);
  const workspaceLabel = workspaceName(workspaceRoot);

  function closeAgentPanel() {
    setAgentOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open Agent panel"]')?.focus();
    });
  }

  function openAgentPanel() {
    if (window.innerWidth <= 1180) setTreeOpen(false);
    setAgentOpen(true);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close Agent panel"]')?.focus();
    });
  }

  function closeWorkspaceTree() {
    setTreeOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open workspace tree"]')?.focus();
    });
  }

  function openWorkspaceTree() {
    if (window.innerWidth <= 1180) setAgentOpen(false);
    setTreeOpen(true);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.workspace-tree-panel [aria-label="Close workspace tree"]')?.focus();
    });
  }

  function openSettings() {
    settingsTrigger.current = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  useEffect(() => {
    function closeOverlay(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (settingsOpen) closeSettings();
      else if (agentOpen) closeAgentPanel();
      else if (treeOpen) closeWorkspaceTree();
    }
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [agentOpen, settingsOpen, treeOpen]);

  useEffect(() => {
    if (settingsOpen || !settingsTrigger.current) return;
    settingsTrigger.current.focus();
    settingsTrigger.current = null;
  }, [settingsOpen]);

  useEffect(() => {
    function syncResponsivePanels() {
      const next = resolveResponsivePanels(window.innerWidth);
      const previous = responsivePanels.current;
      if (
        next.agentInitiallyOpen === previous.agentInitiallyOpen
        && next.treeInitiallyOpen === previous.treeInitiallyOpen
      ) {
        return;
      }
      responsivePanels.current = next;
      setAgentOpen(next.agentInitiallyOpen);
      setTreeOpen(next.treeInitiallyOpen);
    }
    window.addEventListener('resize', syncResponsivePanels);
    return () => window.removeEventListener('resize', syncResponsivePanels);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('lumina.desktop.theme', theme);
  }, [theme]);

  function selectTreePath(path: string) {
    const graphPath = path.startsWith('wiki/') ? path.slice('wiki/'.length) : path;
    const node = graph.nodes.find((candidate) => candidate.path === graphPath);
    if (node) {
      onSelectNode(node.id);
      setActiveView('note');
    }
  }

  async function openCitation(citation: ChatCitation) {
    const graphPath = citation.path.startsWith('wiki/')
      ? citation.path.slice('wiki/'.length)
      : citation.path;
    const node = graph.nodes.find((candidate) => candidate.path === graphPath);
    if (node) {
      await onSelectNode(node.id);
      setActiveView('note');
      return;
    }
    if (await onCitation(citation)) {
      setActiveView('note');
    }
  }

  return (
    <main className="app-shell" lang="en">
      <DesktopTitleBar workspaceLabel={workspaceLabel} connected={Boolean(workspaceRoot)} />
      <div className="desktop-workspace">
        <WorkspaceRail
          open={treeOpen}
          selectedPath={selectedNode ? `wiki/${selectedNode.path}` : ''}
          workspaceLabel={workspaceLabel}
          workspaceTree={workspaceTree}
          theme={theme}
          onClose={closeWorkspaceTree}
          onOpen={openWorkspaceTree}
          onOpenSettings={openSettings}
          onSelectGraph={() => {
            setActiveView('graph');
            onQueryChange('');
          }}
          onSelectPath={selectTreePath}
          onToggleTheme={() => setTheme((current) => toggleTheme(current))}
        />
        <ArtifactPane
          activeView={resolvedView}
          graph={graph}
          noteState={noteState}
          query={query}
          selectedNodeId={selectedNodeId}
          workspaceSummary={workspaceSummary}
          workspaceDraftRoot={workspaceDraftRoot}
          workspaceRoot={workspaceRoot}
          onActivateWorkspace={onActivateWorkspace}
          onActiveViewChange={setActiveView}
          onChooseSourcePath={onChooseSourcePath}
          onChooseWorkspace={onChooseWorkspace}
          onImportSource={onImportSource}
          onQueryChange={onQueryChange}
          onRefreshGraph={onRefreshGraph}
          onRunCheck={onRunCheck}
          onSelectNode={onSelectNode}
          onWorkspaceDraftChange={onWorkspaceRootChange}
        />
        {agentOpen ? (
          <AgentPanel
            chat={chat}
            canChat={canChat}
            cancelling={cancellingChat}
            contextLabel={(selectedNode?.path ?? workspaceLabel) || 'No workspace'}
            workspaceStatus={actionState}
            history={history}
            historyBusy={historyBusy}
            historyEnabled={historyEnabled}
            onCancel={onCancelChat}
            onCitation={(citation) => void openCitation(citation)}
            onClose={closeAgentPanel}
            onDeleteHistory={onDeleteHistory}
            onDeleteAllHistory={onDeleteAllHistory}
            onLoadHistory={onLoadHistory}
            onNewChat={onNewChat}
            onRefreshHistory={onRefreshHistory}
            onRetry={onRetryChat}
            onSubmit={onSubmitChat}
            onToggleHistory={onToggleHistory}
          />
        ) : (
          <aside className="agent-panel-collapsed" aria-label="Agent panel collapsed">
            <button
              type="button"
              aria-controls="agent-panel"
              aria-expanded={agentOpen}
              aria-label="Open Agent panel"
              onClick={openAgentPanel}
            >
              ‹
            </button>
            <span>Agent</span>
          </aside>
        )}
        {settingsOpen && (
          <AiSettingsPanel
            session={aiSession}
            onClose={closeSettings}
            onProfilesChange={onProfilesChange}
          />
        )}
      </div>
    </main>
  );
}

function workspaceName(root: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
