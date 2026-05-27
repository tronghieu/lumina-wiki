import { linkedNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';
import type { WorkspaceActionState } from '../workspace/workspace-actions';

type NodeInspectorProps = {
  actionState: WorkspaceActionState;
  graph: KnowledgeGraph;
  selectedNodeId: string;
  sourcePath: string;
  workspaceLabel: string;
  workspaceRoot: string;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onImportSource: () => void;
  onLoadWorkspace: () => void;
  onRunCheck: () => void;
  onSourcePathChange: (path: string) => void;
  onWorkspaceRootChange: (path: string) => void;
};

export function NodeInspector({
  actionState,
  graph,
  selectedNodeId,
  sourcePath,
  workspaceLabel,
  workspaceRoot,
  onChooseSourcePath,
  onChooseWorkspace,
  onImportSource,
  onLoadWorkspace,
  onRunCheck,
  onSourcePathChange,
  onWorkspaceRootChange,
}: NodeInspectorProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  const links = selectedNode ? linkedNodes(graph, selectedNode.id) : [];

  return (
    <aside className="inspector" aria-label="Node inspector">
      <header className="inspector-header">
        <div className="brand-mark small">L</div>
        <div>
          <h2>{selectedNode?.title ?? 'No node selected'}</h2>
          <span>{selectedNode?.path ?? 'Select a node'}</span>
        </div>
      </header>
      <nav className="tabs">
        {['Details', 'Chat', `Linked (${links.length})`, 'Media'].map((tab, index) => (
          <button className={index === 0 ? 'active' : ''} key={tab} type="button">{tab}</button>
        ))}
      </nav>
      {selectedNode && (
        <>
          <section className="detail-card">
            <span className="type-pill">{selectedNode.type}</span>
            <p>{selectedNode.preview}</p>
          </section>
          <section className="linked-list">
            <h3>Linked Nodes</h3>
            {links.map((node) => (
              <article key={node.id}>
                <strong>{node.title}</strong>
                <span>{node.type} / {node.path}</span>
              </article>
            ))}
          </section>
          <section className="action-panel">
            <h3>Workspace Actions</h3>
            <p className="workspace-label">{workspaceLabel}</p>
            <input
              aria-label="Workspace root"
              onChange={(event) => onWorkspaceRootChange(event.target.value)}
              placeholder="Workspace root path"
              value={workspaceRoot}
            />
            <input
              aria-label="Source file path"
              onChange={(event) => onSourcePathChange(event.target.value)}
              placeholder="Source file path"
              value={sourcePath}
            />
            <div className="action-buttons">
              <button type="button" onClick={onChooseWorkspace}>Open</button>
              <button type="button" onClick={onLoadWorkspace}>Load Graph</button>
              <button type="button" onClick={onChooseSourcePath}>Choose Source</button>
              <button type="button" onClick={onRunCheck}>Run Check</button>
              <button type="button" onClick={onImportSource}>Import</button>
            </div>
            <div className={`action-result ${actionState.kind}`}>
              <strong>{actionState.title}</strong>
              <span>{actionState.message}</span>
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
