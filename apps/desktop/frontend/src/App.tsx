import '@xyflow/react/dist/style.css';
import './app.css';
import { Dialogs } from '@wailsio/runtime';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from './app/app-shell';
import { Load, ReadNote } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph/service';
import { ImportToRawSources } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/service';
import type { CheckResult } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';
import { RunCheck } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/service';
import type { WorkspaceSummary } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import { Summary, Validate } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service';
import { resolveSelectedNodeId, sampleGraph } from './features/graph/graph-data';
import type { KnowledgeGraph } from './features/graph/graph-types';
import {
  noteUnavailableState,
  toNoteErrorState,
  toNoteLoadedState,
  type NoteContentState,
} from './features/graph/note-content';
import {
  createWorkspaceRequestGuard,
  formatActionError,
  formatCheckResult,
  formatGraphRefreshed,
  formatImportResult,
  formatWorkspaceLoaded,
  idleActionState,
  type WorkspaceActionState,
  workspaceLoadCanceledState,
} from './features/workspace/workspace-actions';

function App() {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(sampleGraph.nodes[0]?.id ?? '');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [actionState, setActionState] = useState<WorkspaceActionState>(idleActionState);
  const [graph, setGraph] = useState<KnowledgeGraph>(sampleGraph);
  const [noteState, setNoteState] = useState<NoteContentState>(noteUnavailableState);
  const [lastCheckResult, setLastCheckResult] = useState<CheckResult | null>(null);
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary | null>(null);
  const workspaceRequestGuard = useMemo(createWorkspaceRequestGuard, []);
  const noteRequestId = useRef(0);

  async function chooseWorkspace() {
    try {
      const selected = await Dialogs.OpenFile({
        Title: 'Open Lumina workspace',
        ButtonText: 'Open Workspace',
        CanChooseDirectories: true,
        CanChooseFiles: false,
      });
      if (!selected) {
        setActionState(workspaceLoadCanceledState);
        return;
      }
      await loadWorkspace(selected);
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  async function loadWorkspace(root = workspaceRoot) {
    await refreshWorkspaceGraph(root, {
      clearCheckResult: true,
      loadingTitle: 'Loading workspace',
      missingRootMessage: 'Choose or enter a Lumina workspace root.',
      successState: (validatedRoot, loadedGraph) => formatWorkspaceLoaded(validatedRoot, loadedGraph),
    });
  }

  async function refreshGraph() {
    await refreshWorkspaceGraph(workspaceRoot, {
      clearCheckResult: false,
      loadingTitle: 'Refreshing graph',
      missingRootMessage: 'Open a Lumina workspace before refreshing the graph.',
      successState: (_, loadedGraph) => formatGraphRefreshed(loadedGraph),
    });
  }

  async function chooseSourcePath() {
    try {
      const selected = await Dialogs.OpenFile({
        Title: 'Choose source file',
        ButtonText: 'Choose Source',
        CanChooseDirectories: false,
        CanChooseFiles: true,
        Filters: [
          { DisplayName: 'Documents', Pattern: '*.md;*.txt;*.pdf;*.docx;*.rtf;*.epub' },
          { DisplayName: 'All Files', Pattern: '*' },
        ],
      });
      if (selected) {
        setSourcePath(selected);
      }
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  async function runCheck() {
    const checkedRoot = workspaceRoot.trim();
    if (!checkedRoot) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Enter a Lumina workspace root.' });
      return;
    }
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Running check', message: checkedRoot });
    try {
      const result = await RunCheck(checkedRoot);
      if (!workspaceRequestGuard.isCurrent(requestId)) {
        return;
      }
      setLastCheckResult(result);
      const checkState = formatCheckResult(result);
      await refreshWorkspaceGraph(checkedRoot, {
        clearCheckResult: false,
        loadingTitle: 'Refreshing graph',
        missingRootMessage: 'Open a Lumina workspace before refreshing the graph.',
        successState: () => checkState,
      }, requestId);
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) {
        setActionState(formatActionError(error));
      }
    }
  }

  async function importSource() {
    const importRoot = workspaceRoot.trim();
    const importedSourcePath = sourcePath.trim();
    if (!importRoot || !importedSourcePath) {
      setActionState({ kind: 'error', title: 'Paths required', message: 'Enter workspace root and source file path.' });
      return;
    }
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Importing source', message: importedSourcePath });
    try {
      const importState = formatImportResult(await ImportToRawSources(importRoot, importedSourcePath));
      if (!workspaceRequestGuard.isCurrent(requestId)) {
        return;
      }
      await refreshWorkspaceGraph(importRoot, {
        clearCheckResult: false,
        loadingTitle: 'Refreshing graph',
        missingRootMessage: 'Open a Lumina workspace before refreshing the graph.',
        successState: () => importState,
      }, requestId);
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) {
        setActionState(formatActionError(error));
      }
    }
  }

  async function refreshWorkspaceGraph(
    root: string,
    options: {
      clearCheckResult: boolean;
      loadingTitle: string;
      missingRootMessage: string;
      successState: (validatedRoot: string, loadedGraph: KnowledgeGraph) => WorkspaceActionState;
    },
    requestId = beginWorkspaceRequest(),
  ) {
    const trimmedRoot = root.trim();
    if (!trimmedRoot) {
      setActionState({ kind: 'error', title: 'Workspace required', message: options.missingRootMessage });
      return;
    }
    setActionState({ kind: 'loading', title: options.loadingTitle, message: trimmedRoot });
    try {
      const validation = await Validate(trimmedRoot);
      if (!workspaceRequestGuard.isCurrent(requestId)) {
        return;
      }
      const loadedSummary = await Summary(validation.root);
      if (!workspaceRequestGuard.isCurrent(requestId)) {
        return;
      }
      const loadedGraph = await Load(validation.root);
      if (!workspaceRequestGuard.isCurrent(requestId)) {
        return;
      }
      const nextSelectedNodeId = resolveSelectedNodeId(loadedGraph, selectedNodeId);
      setWorkspaceRoot(validation.root);
      setWorkspaceSummary(loadedSummary);
      setGraph(loadedGraph);
      setSelectedNodeId(nextSelectedNodeId);
      if (options.clearCheckResult) {
        setLastCheckResult(null);
      }
      void loadSelectedNote(validation.root, loadedGraph, nextSelectedNodeId);
      setActionState(options.successState(validation.root, loadedGraph));
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) {
        setActionState(formatActionError(error));
      }
    }
  }

  function updateWorkspaceRoot(path: string) {
    beginWorkspaceRequest();
    setWorkspaceRoot(path);
    setWorkspaceSummary(null);
  }

  function beginWorkspaceRequest() {
    const requestId = workspaceRequestGuard.begin();
    noteRequestId.current += 1;
    return requestId;
  }

  async function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    await loadSelectedNote(workspaceRoot, graph, nodeId);
  }

  async function loadSelectedNote(root: string, currentGraph: KnowledgeGraph, nodeId: string) {
    const requestId = noteRequestId.current + 1;
    noteRequestId.current = requestId;
    const selectedNode = currentGraph.nodes.find((node) => node.id === nodeId);
    if (!root.trim() || !selectedNode) {
      setNoteState(noteUnavailableState);
      return;
    }
    setNoteState({ kind: 'loading', path: selectedNode.path, content: 'Loading note content...' });
    try {
      const note = await ReadNote(root.trim(), selectedNode.path);
      if (noteRequestId.current === requestId) {
        setNoteState(toNoteLoadedState(note));
      }
    } catch (error) {
      if (noteRequestId.current === requestId) {
        setNoteState(toNoteErrorState(selectedNode.path, error));
      }
    }
  }

  return (
    <AppShell
      actionState={actionState}
      graph={graph}
      lastCheckResult={lastCheckResult}
      query={query}
      noteState={noteState}
      selectedNodeId={selectedNodeId}
      sourcePath={sourcePath}
      workspaceSummary={workspaceSummary}
      workspaceRoot={workspaceRoot}
      onImportSource={importSource}
      onChooseSourcePath={chooseSourcePath}
      onChooseWorkspace={chooseWorkspace}
      onQueryChange={setQuery}
      onRefreshGraph={refreshGraph}
      onRunCheck={runCheck}
      onSelectNode={selectNode}
      onSourcePathChange={setSourcePath}
      onWorkspaceRootChange={updateWorkspaceRoot}
    />
  );
}

export default App;
