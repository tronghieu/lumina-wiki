import type { KeyboardEvent } from 'react';
import type { ArtifactView } from '../../app/app-shell-state';
import type { LibrarySummary } from '../workspace/ready-library-state';
import { GraphView } from './graph-view';
import type { KnowledgeGraph } from './graph-types';
import type { NoteContentState } from './note-content';
import { NoteView } from './note-view';

interface ArtifactPaneProps {
  activeView: ArtifactView;
  graph: KnowledgeGraph;
  libraryLabel: string;
  librarySummary: LibrarySummary;
  noteState: NoteContentState;
  query: string;
  selectedNodeId: string;
  onActiveViewChange: (view: ArtifactView) => void;
  onOpenLibrary: () => void;
  onQueryChange: (query: string) => void;
  onRefreshGraph: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const ArtifactPane: React.FC<ArtifactPaneProps> = ({
  activeView,
  graph,
  libraryLabel,
  librarySummary,
  noteState,
  query,
  selectedNodeId,
  onActiveViewChange,
  onOpenLibrary,
  onQueryChange,
  onRefreshGraph,
  onSelectNode,
}) => {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const title = selectedNode?.title ?? 'Knowledge graph';

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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
    <section className="main-artifact" aria-label="Library content">
      <header className="artifact-header">
        <div className="artifact-heading">
          <span>{selectedNode ? friendlyNodeType(selectedNode.type) : libraryLabel}</span>
          <h1>{title}</h1>
        </div>
        <div className="artifact-actions" aria-label="Library actions">
          <button type="button" onClick={onOpenLibrary}>Switch library</button>
          <button type="button" onClick={onRefreshGraph}>Refresh</button>
        </div>
        <div className="artifact-controls">
          <div
            className="artifact-tabs"
            role="tablist"
            aria-label="Library view"
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
            <span className="visually-hidden">Search notes and topics</span>
            <input
              aria-label="Search notes and topics"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search notes and topics"
              value={query}
            />
          </label>
          <div className="artifact-counts" aria-label="Library totals">
            <span><strong>{librarySummary.notes}</strong> notes</span>
            <span><strong>{librarySummary.relationships}</strong> relationships</span>
          </div>
        </div>
      </header>

      <section className="overview-strip" aria-label="Library overview">
        <div className="overview-stat"><span>Notes</span><strong>{librarySummary.notes}</strong></div>
        <div className="overview-stat"><span>Documents</span><strong>{librarySummary.documents}</strong></div>
        <div className="overview-stat"><span>Relationships</span><strong>{librarySummary.relationships}</strong></div>
      </section>

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
};

export default ArtifactPane;

function friendlyNodeType(type: string): string {
  const types: Record<string, string> = {
    concept: 'Topic',
    concepts: 'Topic',
    source: 'Document',
    sources: 'Document',
    people: 'Person',
    person: 'Person',
    summary: 'Summary',
  };
  return types[type.toLowerCase()] ?? 'Note';
}
