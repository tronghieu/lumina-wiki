import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode, KnowledgeGraph } from './graph-types';

export const sampleGraph: KnowledgeGraph = {
  nodes: [
    {
      id: 'ai-social-impact',
      title: 'AI Social Impact',
      type: 'source',
      path: 'sources/ai-social-impact.md',
      preview: 'A source note about how AI affects ethics, privacy, education, and work.',
    },
    {
      id: 'ethics',
      title: 'Ethics',
      type: 'concept',
      path: 'concepts/ethics.md',
      preview: 'Fairness, accountability, and transparency questions around AI systems.',
    },
    {
      id: 'privacy',
      title: 'Privacy',
      type: 'concept',
      path: 'concepts/privacy.md',
      preview: 'How AI systems collect, retain, and infer sensitive personal information.',
    },
    {
      id: 'education',
      title: 'Education',
      type: 'concept',
      path: 'concepts/education.md',
      preview: 'Personalized learning, tutor tools, and equitable access.',
    },
    {
      id: 'ada-lovelace',
      title: 'Ada Lovelace',
      type: 'person',
      path: 'people/ada-lovelace.md',
      preview: 'A historical computing figure used as a reference point in the note set.',
    },
    {
      id: 'outputs/social-impact-brief',
      title: 'Social Impact Brief',
      type: 'output',
      path: 'outputs/social-impact-brief.md',
      preview: 'A short synthesized brief generated from the source and concept notes.',
    },
  ],
  edges: [
    { from: 'ai-social-impact', type: 'defines', to: 'ethics' },
    { from: 'ai-social-impact', type: 'defines', to: 'privacy' },
    { from: 'ai-social-impact', type: 'mentions', to: 'ada-lovelace' },
    { from: 'ethics', type: 'related_to', to: 'privacy' },
    { from: 'privacy', type: 'related_to', to: 'education' },
    { from: 'ai-social-impact', type: 'produced', to: 'outputs/social-impact-brief' },
  ],
};

const nodePositions: Record<string, { x: number; y: number }> = {
  'ai-social-impact': { x: 420, y: 250 },
  ethics: { x: 210, y: 120 },
  privacy: { x: 220, y: 390 },
  education: { x: 620, y: 130 },
  'ada-lovelace': { x: 640, y: 390 },
  'outputs/social-impact-brief': { x: 420, y: 520 },
};

const nodeColors: Record<string, string> = {
  source: '#334155',
  concept: '#2563eb',
  person: '#0f9f8f',
  output: '#d97706',
  summary: '#7c3aed',
};

export function searchGraph(graph: KnowledgeGraph, query: string): KnowledgeGraph {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return graph;
  }
  const visibleIds = new Set(
    graph.nodes
      .filter((node) => [node.id, node.title, node.type, node.path].some((value) => value.toLowerCase().includes(normalizedQuery)))
      .map((node) => node.id),
  );
  return {
    nodes: graph.nodes.filter((node) => visibleIds.has(node.id)),
    edges: graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
  };
}

export function linkedNodes(graph: KnowledgeGraph, nodeId: string): GraphNode[] {
  const linkedIds = new Set<string>();
  graph.edges.forEach((edge) => {
    if (edge.from === nodeId) linkedIds.add(edge.to);
    if (edge.to === nodeId) linkedIds.add(edge.from);
  });
  return graph.nodes.filter((node) => linkedIds.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
}

export function toFlowNodes(nodes: GraphNode[], selectedNodeId: string): Node[] {
  return nodes.map((node, index) => ({
    id: node.id,
    type: 'default',
    position: nodePositions[node.id] ?? fallbackPosition(index),
    data: { label: node.title },
    className: node.id === selectedNodeId ? 'flow-node selected' : 'flow-node',
    style: {
      background: nodeColors[node.type] ?? '#475569',
      borderColor: node.id === selectedNodeId ? '#111827' : 'rgba(255, 255, 255, 0.9)',
    },
  }));
}

export function toFlowEdges(edges: GraphEdge[], visibleNodeIds: Set<string>): Edge[] {
  return edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => ({
      id: `${edge.from}-${edge.type}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.type.split('_').join(' '),
      className: 'flow-edge',
      animated: edge.type === 'produced',
    }));
}

function fallbackPosition(index: number) {
  const angle = (index / 8) * Math.PI * 2;
  return {
    x: 420 + Math.cos(angle) * 260,
    y: 280 + Math.sin(angle) * 190,
  };
}
