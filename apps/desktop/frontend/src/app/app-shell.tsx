import { GraphView } from '../features/graph/graph-view';
import { NodeInspector } from '../features/graph/node-inspector';
import type { CheckResult } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';
import type { WorkspaceSummary } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import type { KnowledgeGraph } from '../features/graph/graph-types';
import type { NoteContentState } from '../features/graph/note-content';
import { formatWorkspaceOverviewStats, type WorkspaceActionState } from '../features/workspace/workspace-actions';

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
  sourcePath,
  workspaceSummary,
  workspaceRoot,
  onImportSource,
  onChooseSourcePath,
  onChooseWorkspace,
  onQueryChange,
  onRefreshGraph,
  onRunCheck,
  onSelectNode,
  onSourcePathChange,
  onWorkspaceRootChange,
}: AppShellProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  const workspaceLabel = workspaceRoot || 'Sample graph';
  const artifactTitle = selectedNode?.title ?? 'Knowledge graph';

  return (
    <main className="app-shell">
      <aside className="graph-menu" aria-label="Graph menu">
        <div className="activity-rail" aria-label="Obsidian-style activity rail">
          <button className="activity-button" type="button" aria-label="Files" disabled>
            <span className="file-icon" />
          </button>
          <button className="activity-button active" type="button" aria-label="Graph view" onClick={() => onQueryChange('')}>
            <span className="graph-icon">
              <i />
              <i />
              <i />
            </span>
          </button>
          <button className="activity-button" type="button" aria-label="Canvas" disabled>
            <span className="grid-icon" />
          </button>
          <button className="graph-menu-settings" type="button" aria-label="Settings unavailable" disabled>
            <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.8v3" />
              <path d="M12 18.2v3" />
              <path d="M4.4 4.4l2.1 2.1" />
              <path d="M17.5 17.5l2.1 2.1" />
              <path d="M2.8 12h3" />
              <path d="M18.2 12h3" />
              <path d="M4.4 19.6l2.1-2.1" />
              <path d="M17.5 6.5l2.1-2.1" />
            </svg>
          </button>
        </div>
        <div className="file-tree" aria-label="Workspace file tree">
          <div className="file-tree-toolbar">
            <strong>ai-work-society</strong>
            <span>17 files</span>
          </div>
          <nav className="file-tree-list">
            <button type="button" disabled><span>›</span> _lumina</button>
            <button type="button" disabled><span>⌄</span> Clippings</button>
            <button type="button" disabled><span>›</span> raw</button>
            <button className="expanded" type="button" disabled><span>⌄</span> wiki</button>
            {[
              'chapters',
              'characters',
              'concepts',
              'foundations',
              'graph',
              'outputs',
              'people',
              'plot',
              'sources',
              'summary',
              'themes',
              'topics',
              'index',
              'log',
            ].map((item) => (
              <button className={item === 'foundations' ? 'tree-child selected' : 'tree-child'} key={item} type="button" disabled>
                <span>{item === 'index' || item === 'log' ? '-' : '›'}</span> {item}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <section className="main-artifact">
        <header className="artifact-header">
          <div>
            <p className="artifact-kicker">{workspaceRoot ? 'Loaded workspace' : 'Sample graph'}</p>
            <h1>{artifactTitle}</h1>
          </div>
          <div className="artifact-tools">
            <input
              aria-label="Search nodes"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search nodes..."
              value={query}
            />
            <span>{graph.nodes.length} nodes</span>
          </div>
          <div className="artifact-fallback-actions" aria-label="Workspace actions">
            <button type="button" onClick={onChooseWorkspace}>Open</button>
            <button type="button" onClick={onRefreshGraph}>Refresh</button>
            <button type="button" onClick={onChooseSourcePath}>Source</button>
            <button type="button" onClick={onRunCheck}>Check</button>
            <button type="button" onClick={onImportSource}>Import</button>
          </div>
        </header>
        {workspaceSummary && (
          <section className="overview-strip" aria-label="Workspace overview">
            {formatWorkspaceOverviewStats(workspaceSummary).map((stat) => (
              <div className="overview-stat" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </section>
        )}
        <GraphView graph={graph} query={query} selectedNodeId={selectedNode?.id ?? ''} onSelectNode={onSelectNode} />
      </section>

      <NodeInspector
        actionState={actionState}
        graph={graph}
        lastCheckResult={lastCheckResult}
        noteState={noteState}
        selectedNodeId={selectedNode?.id ?? ''}
        sourcePath={sourcePath}
        workspaceSummary={workspaceSummary}
        workspaceRoot={workspaceRoot}
        workspaceLabel={workspaceLabel}
        onChooseSourcePath={onChooseSourcePath}
        onChooseWorkspace={onChooseWorkspace}
        onImportSource={onImportSource}
        onRefreshGraph={onRefreshGraph}
        onRunCheck={onRunCheck}
        onSelectNode={onSelectNode}
        onSourcePathChange={onSourcePathChange}
        onWorkspaceRootChange={onWorkspaceRootChange}
      />
    </main>
  );
}
