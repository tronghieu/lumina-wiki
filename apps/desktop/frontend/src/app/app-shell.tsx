import { useEffect, useState } from 'react';
import type { CheckResult } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';
import type { WorkspaceSummary } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import { ArtifactPane } from '../features/graph/artifact-pane';
import type { KnowledgeGraph } from '../features/graph/graph-types';
import { NodeInspector } from '../features/graph/node-inspector';
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
  graph: KnowledgeGraph;
  lastCheckResult: CheckResult | null;
  noteState: NoteContentState;
  query: string;
  selectedNodeId: string;
  sourcePath: string;
  workspaceSummary: WorkspaceSummary | null;
  workspaceRoot: string;
  workspaceTree: WorkspaceTreeNode[];
  onImportSource: () => void;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onQueryChange: (query: string) => void;
  onRefreshGraph: () => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
  onSourcePathChange: (path: string) => void;
  onWorkspaceRootChange: (path: string) => void;
};

export function AppShell({
  actionState,
  graph,
  lastCheckResult,
  noteState,
  query,
  selectedNodeId,
  workspaceSummary,
  workspaceRoot,
  workspaceTree,
  onImportSource,
  onChooseSourcePath,
  onChooseWorkspace,
  onQueryChange,
  onRefreshGraph,
  onRunCheck,
  onSelectNode,
}: AppShellProps) {
  const initialPanels = resolveResponsivePanels(typeof window === 'undefined' ? 1480 : window.innerWidth);
  const [activeView, setActiveView] = useState<ArtifactView>('graph');
  const [treeOpen, setTreeOpen] = useState(initialPanels.treeInitiallyOpen);
  const [agentOpen, setAgentOpen] = useState(initialPanels.agentInitiallyOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => resolveThemePreference(
    typeof window === 'undefined' ? null : window.localStorage.getItem('lumina.desktop.theme'),
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  ));
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const resolvedView = resolveArtifactView(activeView, selectedNodeId);
  const workspaceLabel = workspaceName(workspaceRoot);

  useEffect(() => {
    function closeOverlay(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
      else if (agentOpen) setAgentOpen(false);
      else if (treeOpen) setTreeOpen(false);
    }
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [agentOpen, settingsOpen, treeOpen]);

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
          onClose={() => setTreeOpen(false)}
          onOpen={() => setTreeOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
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
          workspaceRoot={workspaceRoot}
          onActiveViewChange={setActiveView}
          onChooseSourcePath={onChooseSourcePath}
          onChooseWorkspace={onChooseWorkspace}
          onImportSource={onImportSource}
          onQueryChange={onQueryChange}
          onRefreshGraph={onRefreshGraph}
          onRunCheck={onRunCheck}
          onSelectNode={onSelectNode}
        />
        {agentOpen ? (
          <NodeInspector
            actionState={actionState}
            graph={graph}
            lastCheckResult={lastCheckResult}
            selectedNodeId={selectedNodeId}
            workspaceSummary={workspaceSummary}
            workspaceRoot={workspaceRoot}
            onClose={() => setAgentOpen(false)}
            onSelectNode={onSelectNode}
          />
        ) : (
          <aside className="agent-panel-collapsed" aria-label="Agent panel collapsed">
            <button
              type="button"
              aria-controls="agent-panel"
              aria-expanded={agentOpen}
              aria-label="Open Agent panel"
              onClick={() => setAgentOpen(true)}
            >
              ‹
            </button>
            <span>Agent</span>
          </aside>
        )}
        {settingsOpen && <AiSettingsPanel onClose={() => setSettingsOpen(false)} />}
      </div>
    </main>
  );
}

function workspaceName(root: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
