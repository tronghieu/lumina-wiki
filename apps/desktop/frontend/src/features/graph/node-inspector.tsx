import { linkedNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';

type NodeInspectorProps = {
  graph: KnowledgeGraph;
  selectedNodeId: string;
};

export function NodeInspector({ graph, selectedNodeId }: NodeInspectorProps) {
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
          <div className="prompt-box">
            <input aria-label="Ask about graph" placeholder="Ask about this node..." />
            <button type="button">Send</button>
          </div>
        </>
      )}
    </aside>
  );
}
