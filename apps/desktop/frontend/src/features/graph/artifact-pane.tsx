import type { WorkspaceSummary } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import type { KeyboardEvent } from 'react';
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
  workspaceDraftRoot: string;
  workspaceRoot: string;
  onActivateWorkspace: () => void;
  onActiveViewChange: (view: ArtifactView) => void;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onImportSource: () => void;
  onQueryChange: (query: string) => void;
  onRefreshGraph: () => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
  onWorkspaceDraftChange: (path: string) => void;
};

export function ArtifactPane({
  activeView,
  graph,
  noteState,
  query,
  selectedNodeId,
  workspaceSummary,
  workspaceDraftRoot,
  workspaceRoot,
  onActivateWorkspace,
  onActiveViewChange,
  onChooseSourcePath,
  onChooseWorkspace,
  onImportSource,
  onQueryChange,
  onRefreshGraph,
  onRunCheck,
  onSelectNode,
  onWorkspaceDraftChange,
}: ArtifactPaneProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const title = selectedNode?.title ?? (workspaceRoot ? 'Knowledge graph' : 'Open a workspace');

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentView = (event.target as HTMLElement).id === 'artifact-tab-note' ? 'note' : 'graph';
    const nextView = event.key === 'Home'
      ? 'graph'
      : event.key === 'End'
        ? 'note'
        : currentView === 'graph' ? 'note' : 'graph';
    if (nextView === 'note' && !selectedNode) return;
    onActiveViewChange(nextView);
    event.currentTarget.querySelector<HTMLButtonElement>(`#artifact-tab-${nextView}`)?.focus();
  }

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
        <form className="workspace-root-control" onSubmit={(event) => {
          event.preventDefault();
          onActivateWorkspace();
        }}>
          <label>
            <span className="visually-hidden">Workspace root</span>
            <input
              aria-label="Workspace root"
              value={workspaceDraftRoot}
              placeholder="Workspace path"
              onChange={(event) => onWorkspaceDraftChange(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!workspaceDraftRoot.trim()}>Connect</button>
        </form>
        <div className="artifact-controls">
          <div
            className="artifact-tabs"
            role="tablist"
            aria-label="Artifact view"
            onKeyDown={handleTabKeyDown}
          >
            <button
              id="artifact-tab-graph"
              type="button"
              role="tab"
              aria-controls="artifact-panel-graph"
              aria-selected={activeView === 'graph'}
              tabIndex={activeView === 'graph' ? 0 : -1}
              onClick={() => onActiveViewChange('graph')}
            >
              Graph
            </button>
            <button
              id="artifact-tab-note"
              type="button"
              role="tab"
              aria-controls="artifact-panel-note"
              aria-selected={activeView === 'note'}
              disabled={!selectedNode}
              tabIndex={activeView === 'note' ? 0 : -1}
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

      <div
        id={`artifact-panel-${activeView}`}
        className="artifact-tab-panel"
        role="tabpanel"
        aria-labelledby={`artifact-tab-${activeView}`}
      >
        {activeView === 'graph' ? (
          <GraphView graph={graph} query={query} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : (
          <NoteView noteState={noteState} />
        )}
      </div>
    </section>
  );
}
