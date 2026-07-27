import { useEffect, useRef, useState } from 'react';
import type {
  HistoryMetadataDTO,
  SessionReferenceDTO,
} from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import { AgentPanel } from '../features/chat/agent-panel';
import type { ChatCitation, ChatState } from '../features/chat/chat-types';
import type { KnowledgeGraph } from '../features/graph/graph-types';
import type { NoteContentState } from '../features/graph/note-content';
import { ArtifactPane } from '../features/graph/artifact-pane';
import type { SettingsViewModel } from '../features/settings/ai-settings';
import type {
  LibraryAccessMode,
  LibrarySummary,
} from '../features/workspace/ready-library-state';
import type { WorkspaceActionState } from '../features/workspace/workspace-actions';
import { WorkspaceRail } from '../features/workspace/workspace-rail';
import type { WorkspaceTreeNode } from '../features/workspace/workspace-tree-data';
import { AiSettingsPanel } from './ai-settings-panel';
import {
  resolveArtifactView,
  resolveResponsivePanels,
  type ArtifactView,
  type SemanticFocus,
} from './app-shell-state';
import { DesktopTitleBar } from './desktop-title-bar';
import { resolveThemePreference, toggleTheme } from './theme-preference';

interface AppShellProps {
  accessMode: LibraryAccessMode;
  actionState: WorkspaceActionState;
  activationLabel: string | null;
  aiSession: SessionReferenceDTO | null;
  canChat: boolean;
  cancellingChat: boolean;
  chat: ChatState;
  graph: KnowledgeGraph;
  history: HistoryMetadataDTO[];
  historyBusy: boolean;
  historyEnabled: boolean;
  libraryLabel: string;
  librarySummary: LibrarySummary;
  noteState: NoteContentState;
  query: string;
  selectedNodeId: string;
  restoredFocus: SemanticFocus;
  workspaceTree: WorkspaceTreeNode[];
  onCancelChat: () => void;
  onCitation: (citation: ChatCitation) => Promise<boolean>;
  onDeleteHistory: (conversationId: string) => void;
  onDeleteAllHistory: () => void;
  onLoadHistory: (conversationId: string) => void;
  onNewChat: () => void;
  onOpenLibrary: () => void;
  onProfilesChange: (settings: SettingsViewModel) => void;
  onQueryChange: (query: string) => void;
  onRefreshGraph: () => void;
  onRefreshHistory: () => void;
  onRetryChat: () => void;
  onSelectNode: (nodeId: string) => void;
  onSubmitChat: (text: string) => boolean;
  onToggleHistory: () => void;
  onWorkspaceFocusChange: (focus: SemanticFocus, relativePath?: string) => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  accessMode,
  actionState,
  activationLabel,
  aiSession,
  canChat,
  cancellingChat,
  chat,
  graph,
  history,
  historyBusy,
  historyEnabled,
  libraryLabel,
  librarySummary,
  noteState,
  query,
  selectedNodeId,
  restoredFocus,
  workspaceTree,
  onCancelChat,
  onCitation,
  onDeleteHistory,
  onDeleteAllHistory,
  onLoadHistory,
  onNewChat,
  onOpenLibrary,
  onProfilesChange,
  onQueryChange,
  onRefreshGraph,
  onRefreshHistory,
  onRetryChat,
  onSelectNode,
  onSubmitChat,
  onToggleHistory,
  onWorkspaceFocusChange,
}) => {
  const initialPanels = resolveResponsivePanels(typeof window === 'undefined' ? 1480 : window.innerWidth);
  const [activeView, setActiveView] = useState<ArtifactView>('graph');
  const [treeOpen, setTreeOpen] = useState(initialPanels.treeInitiallyOpen);
  const [agentOpen, setAgentOpen] = useState(initialPanels.agentInitiallyOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const responsivePanels = useRef(initialPanels);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const workspaceContent = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState(() => resolveThemePreference(
    typeof window === 'undefined' ? null : window.localStorage.getItem('lumina.desktop.theme'),
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  ));
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const resolvedView = resolveArtifactView(activeView, selectedNodeId);

  function closeAgentPanel(): void {
    setAgentOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open Agent panel"]')?.focus();
    });
  }

  function openAgentPanel(): void {
    if (window.innerWidth <= 1180) setTreeOpen(false);
    setAgentOpen(true);
    onWorkspaceFocusChange('chat', selectedNode?.path);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close Agent panel"]')?.focus();
    });
  }

  function closeWorkspaceTree(): void {
    setTreeOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open library notes"]')?.focus();
    });
  }

  function openWorkspaceTree(): void {
    if (window.innerWidth <= 1180) setAgentOpen(false);
    setTreeOpen(true);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.workspace-tree-panel [aria-label="Close library notes"]')?.focus();
    });
  }

  function openSettings(): void {
    settingsTrigger.current = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
    setSettingsOpen(true);
  }

  function closeSettings(): void {
    setSettingsOpen(false);
  }

  useEffect(() => {
    function closeOverlay(event: KeyboardEvent): void {
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
    function syncResponsivePanels(): void {
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

  useEffect(() => {
    if (activationLabel) workspaceContent.current?.setAttribute('inert', '');
    else workspaceContent.current?.removeAttribute('inert');
  }, [activationLabel]);

  useEffect(() => {
    if (restoredFocus === 'chat') {
      setAgentOpen(true);
      window.setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>('.chat-composer textarea')?.focus();
      });
      return undefined;
    }
    const view = restoredFocus === 'note' && selectedNodeId ? 'note' : 'graph';
    setActiveView(view);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`#artifact-tab-${view}`)?.focus();
    });
    return undefined;
  }, [aiSession?.generation, aiSession?.sessionId, restoredFocus, selectedNodeId]);

  function selectTreePath(path: string): void {
    const graphPath = path.startsWith('wiki/') ? path.slice('wiki/'.length) : path;
    const node = graph.nodes.find((candidate) => candidate.path === graphPath);
    if (node) {
      onSelectNode(node.id);
      setActiveView('note');
      onWorkspaceFocusChange('note', node.path);
    }
  }

  async function openCitation(citation: ChatCitation): Promise<void> {
    const graphPath = citation.path.startsWith('wiki/')
      ? citation.path.slice('wiki/'.length)
      : citation.path;
    const node = graph.nodes.find((candidate) => candidate.path === graphPath);
    if (node) {
      onSelectNode(node.id);
      setActiveView('note');
      onWorkspaceFocusChange('note', node.path);
      return;
    }
    if (await onCitation(citation)) {
      setActiveView('note');
      onWorkspaceFocusChange('note', citation.path.replace(/^wiki\//, ''));
    }
  }

  return (
    <main className="app-shell" lang="en">
      <DesktopTitleBar libraryLabel={libraryLabel} readOnly={accessMode === 'read-only'} />
      <section className="desktop-workspace-host" aria-busy={Boolean(activationLabel)}>
        <div
          ref={workspaceContent}
          className="desktop-workspace"
          aria-hidden={activationLabel ? true : undefined}
        >
          <WorkspaceRail
            open={treeOpen}
            selectedPath={selectedNode ? `wiki/${selectedNode.path}` : ''}
            workspaceLabel={libraryLabel}
            workspaceTree={workspaceTree}
            theme={theme}
            onClose={closeWorkspaceTree}
            onOpen={openWorkspaceTree}
            onOpenLibrary={onOpenLibrary}
            onOpenSettings={openSettings}
            onSelectGraph={() => {
              setActiveView('graph');
              onQueryChange('');
              onWorkspaceFocusChange('graph');
            }}
            onSelectPath={selectTreePath}
            onToggleTheme={() => setTheme((current) => toggleTheme(current))}
          />
          <ArtifactPane
            activeView={resolvedView}
            graph={graph}
            libraryLabel={libraryLabel}
            librarySummary={librarySummary}
            noteState={noteState}
            query={query}
            selectedNodeId={selectedNodeId}
            onActiveViewChange={(view) => {
              setActiveView(view);
              onWorkspaceFocusChange(view, view === 'note' ? selectedNode?.path : undefined);
            }}
            onOpenLibrary={onOpenLibrary}
            onQueryChange={onQueryChange}
            onRefreshGraph={onRefreshGraph}
            onSelectNode={onSelectNode}
          />
          {agentOpen ? (
            <AgentPanel
              chat={chat}
              canChat={canChat}
              cancelling={cancellingChat}
              contextLabel={selectedNode?.title ?? libraryLabel}
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
        {activationLabel && (
          <div className="activation-veil" role="status" aria-live="polite">
            <strong>{activationLabel}</strong>
            <span>Your current library will stay open unless the new one is ready.</span>
          </div>
        )}
      </section>
    </main>
  );
};

export default AppShell;
