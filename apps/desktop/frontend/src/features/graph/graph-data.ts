import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode, KnowledgeGraph } from './graph-types';

export type GraphEmphasis = 'default' | 'match' | 'neighbor' | 'selected' | 'dim';

export function resolveGraphEmphasis(
  graph: KnowledgeGraph,
  query: string,
  selectedNodeId: string,
): Map<string, GraphEmphasis> {
  const normalizedQuery = query.trim().toLowerCase();
  const matchingIds = new Set(
    graph.nodes
      .filter((node) => [node.id, node.title, node.type, node.path].some((value) => value.toLowerCase().includes(normalizedQuery)))
      .map((node) => node.id),
  );
  const neighborIds = new Set(linkedNodes(graph, selectedNodeId).map((node) => node.id));
  return new Map(graph.nodes.map((node) => {
    if (node.id === selectedNodeId) return [node.id, 'selected'];
    if (normalizedQuery && matchingIds.has(node.id)) return [node.id, 'match'];
    if (neighborIds.has(node.id)) return [node.id, 'neighbor'];
    return [node.id, normalizedQuery ? 'dim' : 'default'];
  }));
}

export function linkedNodes(graph: KnowledgeGraph, nodeId: string): GraphNode[] {
  const linkedIds = new Set<string>();
  graph.edges.forEach((edge) => {
    if (edge.from === nodeId) linkedIds.add(edge.to);
    if (edge.to === nodeId) linkedIds.add(edge.from);
  });
  return graph.nodes.filter((node) => linkedIds.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
}

export function resolveSelectedNodeId(graph: KnowledgeGraph, selectedNodeId: string): string {
  if (graph.nodes.some((node) => node.id === selectedNodeId)) {
    return selectedNodeId;
  }
  return graph.nodes[0]?.id ?? '';
}

export function linkedNodeSelectionId(node: GraphNode): string {
  return node.id;
}

export function toFlowNodes(graph: KnowledgeGraph, emphasis: Map<string, GraphEmphasis>): Node[] {
  return graph.nodes.map((node, index) => ({
    id: node.id,
    type: 'lumina',
    position: stablePosition(index, graph.nodes.length),
    data: { label: node.title, nodeType: node.type },
    className: `flow-node ${emphasis.get(node.id) ?? 'default'} node-type-${safeClassName(node.type)}`,
  }));
}

export function toFlowEdges(edges: GraphEdge[], emphasis: Map<string, GraphEmphasis>): Edge[] {
  return edges.map((edge) => {
    const sourceState = emphasis.get(edge.from);
    const targetState = emphasis.get(edge.to);
    const focused = (
      (sourceState === 'selected' && targetState === 'neighbor')
      || (targetState === 'selected' && sourceState === 'neighbor')
      || (sourceState === 'match' && targetState === 'match')
    );
    return {
      id: `${edge.from}-${edge.type}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      className: focused ? 'flow-edge focused' : 'flow-edge',
      animated: false,
    };
  });
}

function stablePosition(index: number, count: number) {
  if (count <= 1) {
    return { x: 420, y: 280 };
  }
  const angle = index * 2.399963229728653;
  const radius = 54 + Math.sqrt(index) * 44;
  return {
    x: 420 + Math.cos(angle) * radius,
    y: 280 + Math.sin(angle) * radius * 0.72,
  };
}

function safeClassName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}
