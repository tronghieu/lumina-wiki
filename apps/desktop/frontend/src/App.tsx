import '@xyflow/react/dist/style.css';
import './app.css';
import { useMemo, useState } from 'react';
import { AppShell } from './app/app-shell';
import { ImportToRawSources } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/service';
import { RunCheck } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/service';
import { sampleGraph } from './features/graph/graph-data';
import {
  formatActionError,
  formatCheckResult,
  formatImportResult,
  idleActionState,
  type WorkspaceActionState,
} from './features/workspace/workspace-actions';

function App() {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(sampleGraph.nodes[0]?.id ?? '');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [actionState, setActionState] = useState<WorkspaceActionState>(idleActionState);
  const graph = useMemo(() => sampleGraph, []);

  async function runCheck() {
    if (!workspaceRoot.trim()) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Enter a Lumina workspace root.' });
      return;
    }
    setActionState({ kind: 'loading', title: 'Running check', message: workspaceRoot });
    try {
      setActionState(formatCheckResult(await RunCheck(workspaceRoot.trim())));
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  async function importSource() {
    if (!workspaceRoot.trim() || !sourcePath.trim()) {
      setActionState({ kind: 'error', title: 'Paths required', message: 'Enter workspace root and source file path.' });
      return;
    }
    setActionState({ kind: 'loading', title: 'Importing source', message: sourcePath });
    try {
      setActionState(formatImportResult(await ImportToRawSources(workspaceRoot.trim(), sourcePath.trim())));
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  return (
    <AppShell
      actionState={actionState}
      graph={graph}
      query={query}
      selectedNodeId={selectedNodeId}
      sourcePath={sourcePath}
      workspaceRoot={workspaceRoot}
      onImportSource={importSource}
      onQueryChange={setQuery}
      onRunCheck={runCheck}
      onSelectNode={setSelectedNodeId}
      onSourcePathChange={setSourcePath}
      onWorkspaceRootChange={setWorkspaceRoot}
    />
  );
}

export default App;
