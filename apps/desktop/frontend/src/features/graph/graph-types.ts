export type GraphNode = {
  id: string;
  title: string;
  type: string;
  path: string;
  preview: string;
};

export type GraphEdge = {
  from: string;
  type: string;
  to: string;
};

export type KnowledgeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
