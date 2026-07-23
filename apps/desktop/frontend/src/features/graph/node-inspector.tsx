import type { CheckResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';
import type { WorkspaceSummary } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import { formatCheckDetails, formatWorkspacePacks, type WorkspaceActionState } from '../workspace/workspace-actions';
import { linkedNodeSelectionId, linkedNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';

type NodeInspectorProps = {
  actionState: WorkspaceActionState;
  graph: KnowledgeGraph;
  lastCheckResult: CheckResult | null;
  selectedNodeId: string;
  workspaceSummary: WorkspaceSummary | null;
  workspaceRoot: string;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
};

export function NodeInspector({
  actionState,
  graph,
  lastCheckResult,
  selectedNodeId,
  workspaceSummary,
  workspaceRoot,
  onClose,
  onSelectNode,
}: NodeInspectorProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const links = selectedNode ? linkedNodes(graph, selectedNode.id) : [];
  const checkDetails = lastCheckResult ? formatCheckDetails(lastCheckResult) : null;

  return (
    <aside className="agent-panel" id="agent-panel" aria-label="Agent panel">
      <header className="agent-panel-header">
        <button type="button" aria-label="Close Agent panel" onClick={onClose}>›</button>
        <div>
          <h2>Agent Panel</h2>
          <span>Workspace context</span>
        </div>
      </header>

      <div className="agent-context">
        <span>{selectedNode?.type ?? 'Workspace'}</span>
        <strong>{selectedNode?.path ?? (workspaceRoot || 'No workspace connected')}</strong>
      </div>

      <div className="agent-panel-scroll">
        <section className={`agent-status ${actionState.kind}`} aria-live="polite">
          <strong>{actionState.title}</strong>
          <span>{actionState.message}</span>
        </section>

        {selectedNode ? (
          <section className="agent-card selected-context">
            <span className="type-pill">{selectedNode.type}</span>
            <h3>{selectedNode.title}</h3>
            {selectedNode.preview && <p>{selectedNode.preview}</p>}
          </section>
        ) : (
          <p className="agent-empty">Select a graph node to inspect its workspace context.</p>
        )}

        {workspaceSummary && (
          <section className="agent-card workspace-inventory">
            <span>Packs</span>
            <strong>{formatWorkspacePacks(workspaceSummary)}</strong>
            <span>Wiki notes</span>
            <strong>{workspaceSummary.wikiNotes}</strong>
          </section>
        )}

        {selectedNode && (
          <section className="agent-card linked-list">
            <h3>Linked Nodes</h3>
            {links.length === 0 && <p>No linked nodes.</p>}
            {links.map((node) => (
              <button key={node.id} type="button" onClick={() => onSelectNode(linkedNodeSelectionId(node))}>
                <strong>{node.title}</strong>
                <span>{node.type} / {node.path}</span>
              </button>
            ))}
          </section>
        )}

        {checkDetails && (
          <section className="agent-card check-card">
            <h3>Check Details</h3>
            <div className="check-summary-grid">
              <span>Status</span><strong>{checkDetails.status}</strong>
              <span>Exit</span><strong>{checkDetails.exitCode}</strong>
              <span>Counts</span><strong>{checkDetails.counts}</strong>
            </div>
            {checkDetails.byCheck.map((item) => <span key={item}>{item}</span>)}
          </section>
        )}
      </div>
    </aside>
  );
}
