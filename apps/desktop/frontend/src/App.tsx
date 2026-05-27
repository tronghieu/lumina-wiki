import '@xyflow/react/dist/style.css';
import './app.css';
import { Dialogs } from '@wailsio/runtime';
import { useRef, useState } from 'react';
import { AppShell } from './app/app-shell';
import { Load, ReadNote } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph/service';
import { ImportToRawSources } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/service';
import { RunCheck } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/service';
import { Validate } from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service';
import { resolveSelectedNodeId, sampleGraph } from './features/graph/graph-data';
import type { KnowledgeGraph } from './features/graph/graph-types';
import {
  noteUnavailableState,
  toNoteErrorState,
  toNoteLoadedState,
  type NoteContentState,
} from './features/graph/note-content';
import {
  formatActionError,
  formatCheckResult,
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
    const trimmedRoot = root.trim();
    if (!trimmedRoot) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Choose or enter a Lumina workspace root.' });
      return;
    }
    setActionState({ kind: 'loading', title: 'Loading workspace', message: trimmedRoot });
    try {
      const validation = await Validate(trimmedRoot);
      const loadedGraph = await Load(validation.root);
      const nextSelectedNodeId = resolveSelectedNodeId(loadedGraph, selectedNodeId);
      setWorkspaceRoot(validation.root);
      setGraph(loadedGraph);
      setSelectedNodeId(nextSelectedNodeId);
      void loadSelectedNote(validation.root, loadedGraph, nextSelectedNodeId);
      setActionState(formatWorkspaceLoaded(validation.root, loadedGraph));
    } catch (error) {
      setActionState(formatActionError(error));
    }
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
      query={query}
      noteState={noteState}
      selectedNodeId={selectedNodeId}
      sourcePath={sourcePath}
      workspaceRoot={workspaceRoot}
      onImportSource={importSource}
      onChooseSourcePath={chooseSourcePath}
      onChooseWorkspace={chooseWorkspace}
      onLoadWorkspace={() => loadWorkspace()}
      onQueryChange={setQuery}
      onRunCheck={runCheck}
      onSelectNode={selectNode}
      onSourcePathChange={setSourcePath}
      onWorkspaceRootChange={setWorkspaceRoot}
    />
  );
}

export default App;
