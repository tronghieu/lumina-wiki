import { Controls, Handle, Position, ReactFlow, type NodeMouseHandler, type NodeProps } from '@xyflow/react';
import { useMemo } from 'react';
import { resolveGraphEmphasis, toFlowEdges, toFlowNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';

type GraphViewProps = {
  graph: KnowledgeGraph;
  query: string;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
};

export function GraphView({ graph, query, selectedNodeId, onSelectNode }: GraphViewProps) {
  const emphasis = useMemo(() => resolveGraphEmphasis(graph, query, selectedNodeId), [graph, query, selectedNodeId]);
  const nodes = useMemo(() => toFlowNodes(graph, emphasis), [graph, emphasis]);
  const edges = useMemo(() => toFlowEdges(graph.edges, emphasis), [graph.edges, emphasis]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode(node.id);
  };

  return (
    <section className="graph-canvas" aria-label="Graph preview">
      <ReactFlow
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.45}
        nodes={nodes}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="graph-controls" showInteractive={false} />
      </ReactFlow>
      <ul className="graph-node-fallback" aria-label="Graph nodes">
        {graph.nodes.map((node) => (
          <li key={node.id}>
            <button type="button" onClick={() => onSelectNode(node.id)}>
              {node.title}
            </button>
          </li>
        ))}
      </ul>
      {nodes.length === 0 && (
        <div className="empty-state">
          <strong>No graph nodes loaded</strong>
          <span>Open a Lumina workspace to view its knowledge graph.</span>
        </div>
      )}
    </section>
  );
}

const nodeTypes = {
  lumina: LuminaGraphNode,
};

function LuminaGraphNode({ data }: NodeProps) {
  return (
    <div className="graph-node-content">
      <Handle type="target" position={Position.Top} />
      <span className="graph-node-dot" aria-hidden="true" />
      <span className="graph-node-label">{String(data.label ?? '')}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
