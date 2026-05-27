import '@xyflow/react/dist/style.css';
import './app.css';
import { useMemo, useState } from 'react';
import { AppShell } from './app/app-shell';
import { sampleGraph } from './features/graph/graph-data';

function App() {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(sampleGraph.nodes[0]?.id ?? '');
  const graph = useMemo(() => sampleGraph, []);

  return (
    <AppShell
      graph={graph}
      query={query}
      selectedNodeId={selectedNodeId}
      onQueryChange={setQuery}
      onSelectNode={setSelectedNodeId}
    />
  );
}

export default App;
