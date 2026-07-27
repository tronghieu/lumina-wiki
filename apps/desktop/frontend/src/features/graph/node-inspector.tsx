import type { LibrarySummary } from '../workspace/ready-library-state';
import type { WorkspaceActionState } from '../workspace/workspace-actions';
import { linkedNodeSelectionId, linkedNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';

interface NodeInspectorProps {
  actionState: WorkspaceActionState;
  graph: KnowledgeGraph;
  libraryLabel: string;
  librarySummary: LibrarySummary;
  selectedNodeId: string;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const NodeInspector: React.FC<NodeInspectorProps> = ({
  actionState,
  graph,
  libraryLabel,
  librarySummary,
  selectedNodeId,
  onClose,
  onSelectNode,
}) => {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const links = selectedNode ? linkedNodes(graph, selectedNode.id) : [];

  return (
    <aside className="agent-panel" id="agent-panel" aria-label="Note details">
      <header className="agent-panel-header">
        <button type="button" aria-label="Close note details" onClick={onClose}>›</button>
        <div>
          <h2>Note details</h2>
          <span>{libraryLabel}</span>
        </div>
      </header>
      <div className="agent-panel-scroll">
        <section className={`agent-status ${actionState.kind}`} aria-live="polite">
          <strong>{actionState.title}</strong>
          <span>{actionState.message}</span>
        </section>
        {selectedNode ? (
          <section className="agent-card selected-context">
            <span className="type-pill">Note</span>
            <h3>{selectedNode.title}</h3>
            {selectedNode.preview && <p>{selectedNode.preview}</p>}
          </section>
        ) : (
          <p className="agent-empty">Select a note or topic to see its relationships.</p>
        )}
        <section className="agent-card workspace-inventory">
          <span>Notes</span><strong>{librarySummary.notes}</strong>
          <span>Documents</span><strong>{librarySummary.documents}</strong>
        </section>
        {selectedNode && (
          <section className="agent-card linked-list">
            <h3>Relationships</h3>
            {links.length === 0 && <p>No relationships yet.</p>}
            {links.map((node) => (
              <button key={node.id} type="button" onClick={() => onSelectNode(linkedNodeSelectionId(node))}>
                <strong>{node.title}</strong>
                <span>Related note</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
};

export default NodeInspector;
