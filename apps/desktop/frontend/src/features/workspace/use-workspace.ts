import { Dialogs } from '@wailsio/runtime';
import { useMemo, useRef, useState } from 'react';
import {
  ConfirmAndActivateWorkspace,
  HistoryStatus,
  WorkspaceTree,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service';
import type { SessionReferenceDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import { Load, ReadNote } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph/service';
import { ImportToRawSources } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/service';
import { RunCheck } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/service';
import type { WorkspaceSummary } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import { Summary, Validate } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service';
import { resolveSelectedNodeId } from '../graph/graph-data';
import type { KnowledgeGraph } from '../graph/graph-types';
import {
  noteUnavailableState,
  toNoteErrorState,
  toNoteLoadedState,
  type NoteContentState,
} from '../graph/note-content';
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
} from './workspace-actions';
import type { WorkspaceTreeNode } from './workspace-tree-data';

export type LoadedWorkspace = {
  root: string;
  workspaceId: string;
  label: string;
  session: SessionReferenceDTO;
};

export function useWorkspace() {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [draftWorkspaceRoot, setDraftWorkspaceRoot] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [actionState, setActionState] = useState<WorkspaceActionState>(idleActionState);
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [noteState, setNoteState] = useState<NoteContentState>(noteUnavailableState);
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary | null>(null);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode[]>([]);
  const [loadedWorkspace, setLoadedWorkspace] = useState<LoadedWorkspace | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const workspaceRequestGuard = useMemo(createWorkspaceRequestGuard, []);
  const artifactRequestGuard = useMemo(createWorkspaceRequestGuard, []);
  const activationId = useRef(0);
  const activationInProgress = useRef(false);
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
      await activateWorkspace(selected);
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  async function activateWorkspace(root = draftWorkspaceRoot) {
    const requestedRoot = root.trim();
    if (!requestedRoot) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Choose or enter a Lumina workspace root.' });
      return;
    }
    activationId.current += 1;
    const currentActivationId = activationId.current;
    activationInProgress.current = true;
    artifactRequestGuard.begin();
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Loading workspace', message: requestedRoot });
    try {
      const validation = await Validate(requestedRoot);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      const [loadedSummary, loadedGraph] = await Promise.all([Summary(validation.root), Load(validation.root)]);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      const activation = await ConfirmAndActivateWorkspace(validation.root);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      if (activation.status !== 'active' || !activation.capability) {
        setActionState(workspaceLoadCanceledState);
        return;
      }
      const session = {
        sessionId: activation.capability.sessionId,
        generation: activation.capability.generation,
      };
      const [treeResult, historyResult] = await Promise.all([
        WorkspaceTree(session).catch(() => ({ nodes: [] })),
        HistoryStatus(session).catch(() => ({ enabled: false })),
      ]);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      const nextSelectedNodeId = resolveSelectedNodeId(loadedGraph, '');
      setLoadedWorkspace({
        root: validation.root,
        workspaceId: activation.capability.workspaceId,
        label: activation.capability.display.label,
        session,
      });
      setDraftWorkspaceRoot(validation.root);
      setWorkspaceSummary(loadedSummary);
      setWorkspaceTree(treeResult.nodes);
      setHistoryEnabled(historyResult.enabled);
      setGraph(loadedGraph);
      setSelectedNodeId(nextSelectedNodeId);
      void loadSelectedNote(validation.root, loadedGraph, nextSelectedNodeId);
      setActionState(formatWorkspaceLoaded(validation.root, loadedGraph));
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) setActionState(formatActionError(error));
    } finally {
      if (activationId.current === currentActivationId) activationInProgress.current = false;
    }
  }

  async function refreshGraph() {
    const root = loadedWorkspace?.root;
    if (!root) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Open a Lumina workspace before refreshing.' });
      return;
    }
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Refreshing graph', message: root });
    try {
      const [summary, loadedGraph] = await Promise.all([Summary(root), Load(root)]);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      const nextSelectedNodeId = resolveSelectedNodeId(loadedGraph, selectedNodeId);
      setWorkspaceSummary(summary);
      setGraph(loadedGraph);
      setSelectedNodeId(nextSelectedNodeId);
      void loadSelectedNote(root, loadedGraph, nextSelectedNodeId);
      setActionState(formatGraphRefreshed(loadedGraph));
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) setActionState(formatActionError(error));
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
      if (selected) setSourcePath(selected);
    } catch (error) {
      setActionState(formatActionError(error));
    }
  }

  async function runCheck() {
    const root = loadedWorkspace?.root;
    if (!root) {
      setActionState({ kind: 'error', title: 'Workspace required', message: 'Open a Lumina workspace before checking.' });
      return;
    }
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Running check', message: root });
    try {
      const result = await RunCheck(root);
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      setActionState(formatCheckResult(result));
      await refreshGraph();
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) setActionState(formatActionError(error));
    }
  }

  async function importSource() {
    const root = loadedWorkspace?.root;
    const importedSourcePath = sourcePath.trim();
    if (!root || !importedSourcePath) {
      setActionState({ kind: 'error', title: 'Paths required', message: 'Open a workspace and choose a source file.' });
      return;
    }
    const requestId = beginWorkspaceRequest();
    setActionState({ kind: 'loading', title: 'Importing source', message: importedSourcePath });
    try {
      const importState = formatImportResult(await ImportToRawSources(root, importedSourcePath));
      if (!workspaceRequestGuard.isCurrent(requestId)) return;
      setActionState(importState);
      await refreshGraph();
    } catch (error) {
      if (workspaceRequestGuard.isCurrent(requestId)) setActionState(formatActionError(error));
    }
  }

  function updateWorkspaceRoot(path: string) {
    beginWorkspaceRequest();
    setDraftWorkspaceRoot(path);
  }

  function beginWorkspaceRequest() {
    const requestId = workspaceRequestGuard.begin();
    noteRequestId.current += 1;
    return requestId;
  }

  async function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    if (loadedWorkspace) await loadSelectedNote(loadedWorkspace.root, graph, nodeId);
  }

  async function loadSelectedNote(root: string, currentGraph: KnowledgeGraph, nodeId: string) {
    const requestId = noteRequestId.current + 1;
    noteRequestId.current = requestId;
    const node = currentGraph.nodes.find((candidate) => candidate.id === nodeId);
    if (!root || !node) {
      setNoteState(noteUnavailableState);
      return;
    }
    setNoteState({ kind: 'loading', path: node.path, content: 'Loading note content...' });
    try {
      const note = await ReadNote(root, node.path);
      if (noteRequestId.current === requestId) setNoteState(toNoteLoadedState(note));
    } catch (error) {
      if (noteRequestId.current === requestId) setNoteState(toNoteErrorState(node.path, error));
    }
  }

  function showCitationNote(note: { path: string; content: string }) {
    setNoteState({ kind: 'loaded', path: note.path, content: note.content });
  }

  function beginArtifactRead(): number | null {
    return activationInProgress.current ? null : artifactRequestGuard.begin();
  }

  function isArtifactReadCurrent(requestId: number): boolean {
    return artifactRequestGuard.isCurrent(requestId);
  }

  return {
    actionState,
    activateWorkspace,
    beginArtifactRead,
    chooseSourcePath,
    chooseWorkspace,
    draftWorkspaceRoot,
    graph,
    historyEnabled,
    importSource,
    isArtifactReadCurrent,
    loadedWorkspace,
    noteState,
    query,
    refreshGraph,
    runCheck,
    selectNode,
    selectedNodeId,
    setActionState,
    setHistoryEnabled,
    setQuery,
    setSourcePath,
    showCitationNote,
    sourcePath,
    updateWorkspaceRoot,
    workspaceSummary,
    workspaceTree,
  };
}
