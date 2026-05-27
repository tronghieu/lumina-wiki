import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler } from '@xyflow/react';
import { useMemo } from 'react';
import { searchGraph, toFlowEdges, toFlowNodes } from './graph-data';
import type { KnowledgeGraph } from './graph-types';

type GraphViewProps = {
  graph: KnowledgeGraph;
  query: string;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
};

export function GraphView({ graph, query, selectedNodeId, onSelectNode }: GraphViewProps) {
  const visibleGraph = useMemo(() => searchGraph(graph, query, selectedNodeId), [graph, query, selectedNodeId]);
  const visibleNodeIds = useMemo(() => new Set(visibleGraph.nodes.map((node) => node.id)), [visibleGraph.nodes]);
  const nodes = useMemo(() => toFlowNodes(visibleGraph.nodes, selectedNodeId), [visibleGraph.nodes, selectedNodeId]);
  const edges = useMemo(() => toFlowEdges(visibleGraph.edges, visibleNodeIds), [visibleGraph.edges, visibleNodeIds]);

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
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d7dce8" gap={28} />
        <MiniMap pannable zoomable className="graph-minimap" />
        <Controls className="graph-controls" showInteractive={false} />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="empty-state">
          <strong>No nodes found</strong>
          <span>Try a broader search.</span>
        </div>
      )}
    </section>
  );
}
