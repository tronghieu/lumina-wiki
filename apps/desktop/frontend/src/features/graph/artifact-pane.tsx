import type { WorkspaceSummary } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import type { ArtifactView } from '../../app/app-shell-state';
import { formatWorkspaceOverviewStats } from '../workspace/workspace-actions';
import { GraphView } from './graph-view';
import type { KnowledgeGraph } from './graph-types';
import type { NoteContentState } from './note-content';
import { NoteView } from './note-view';

type ArtifactPaneProps = {
  activeView: ArtifactView;
  graph: KnowledgeGraph;
  noteState: NoteContentState;
  query: string;
  selectedNodeId: string;
  workspaceSummary: WorkspaceSummary | null;
  workspaceRoot: string;
  onActiveViewChange: (view: ArtifactView) => void;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onImportSource: () => void;
  onQueryChange: (query: string) => void;
  onRefreshGraph: () => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
};

export function ArtifactPane({
  activeView,
  graph,
  noteState,
  query,
  selectedNodeId,
  workspaceSummary,
  workspaceRoot,
  onActiveViewChange,
  onChooseSourcePath,
  onChooseWorkspace,
  onImportSource,
  onQueryChange,
  onRefreshGraph,
  onRunCheck,
  onSelectNode,
}: ArtifactPaneProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const title = selectedNode?.title ?? (workspaceRoot ? 'Knowledge graph' : 'Open a workspace');

  return (
    <section className="main-artifact" aria-label="Workspace artifact">
      <header className="artifact-header">
        <div className="artifact-heading">
          <span>{selectedNode?.path ?? (workspaceRoot || 'No workspace connected')}</span>
          <h1>{title}</h1>
        </div>
        <div className="artifact-actions" aria-label="Workspace actions">
          <button type="button" onClick={onChooseWorkspace}>Open</button>
          <button type="button" onClick={onRefreshGraph} disabled={!workspaceRoot}>Refresh</button>
          <button type="button" onClick={onChooseSourcePath}>Source</button>
          <button type="button" onClick={onRunCheck} disabled={!workspaceRoot}>Check</button>
          <button className="primary-action" type="button" onClick={onImportSource} disabled={!workspaceRoot}>Import</button>
        </div>
        <div className="artifact-controls">
          <div className="artifact-tabs" role="tablist" aria-label="Artifact view">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'graph'}
              onClick={() => onActiveViewChange('graph')}
            >
              Graph
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'note'}
              disabled={!selectedNode}
              onClick={() => onActiveViewChange('note')}
            >
              Note
            </button>
          </div>
          <label className="graph-search">
            <span className="visually-hidden">Search graph nodes</span>
            <input
              aria-label="Search graph nodes"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search graph nodes"
              value={query}
            />
          </label>
          <div className="artifact-counts" aria-label="Graph totals">
            <span><strong>{graph.nodes.length}</strong> nodes</span>
            <span><strong>{graph.edges.length}</strong> links</span>
          </div>
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

      {activeView === 'graph' ? (
        <GraphView graph={graph} query={query} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
      ) : (
        <NoteView noteState={noteState} />
      )}
    </section>
  );
}
