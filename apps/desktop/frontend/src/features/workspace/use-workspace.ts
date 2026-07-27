import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { resolveSelectedNodeId } from '../graph/graph-data';
import type { GraphNode, KnowledgeGraph } from '../graph/graph-types';
import {
  noteUnavailableState,
  toSnapshotNoteState,
  type NoteContentState,
} from '../graph/note-content';
import {
  friendlyWorkspaceFailure,
  idleActionState,
  libraryOpenedState,
  workspaceLoadCanceledState,
  type WorkspaceActionState,
} from './workspace-actions';
import {
  abortIfStalePrepared,
  resolveActivationHistoryEnabled,
} from './workspace-activation';
import {
  finalizeReadyState,
  type PreparedLibrary,
  type ReadyLibraryState,
} from './ready-library-state';
import {
  continuityWarningMessage,
  resetRecentActivityMessage,
  resolvePreparedContinuity,
  type ArtifactLocator,
  type PreparedContinuity,
  type RecentLibrary,
  type RestoredHistory,
  type ResolvedContinuity,
  type WorkspaceFocus,
} from './workspace-restoration';
import {
  initialWorkspaceScreenState,
  reduceWorkspaceScreen,
  type WorkspaceAttemptKind,
} from './welcome-state';
import {
  wailsWorkspaceGateway,
  type WorkspaceGateway,
} from './workspace-gateway';

type PreparedWorkspaceAttempt = {
  prepared: PreparedLibrary;
  continuity: ResolvedContinuity | null;
};

export function useWorkspace(gateway: WorkspaceGateway = wailsWorkspaceGateway) {
  const [screen, dispatch] = useReducer(reduceWorkspaceScreen, initialWorkspaceScreenState);
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [noteState, setNoteState] = useState<NoteContentState>(noteUnavailableState);
  const [actionState, setActionState] = useState<WorkspaceActionState>(idleActionState);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>([]);
  const [recentNotice, setRecentNotice] = useState<string | null>(null);
  const [restoredFocus, setRestoredFocus] = useState<WorkspaceFocus>('graph');
  const [restoredHistory, setRestoredHistory] = useState<RestoredHistory | null>(null);
  const attemptGeneration = useRef(screen.nextAttemptGeneration);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  attemptGeneration.current = screen.nextAttemptGeneration;

  const readyLibrary = screen.kind === 'ready'
    ? screen.library
    : screen.kind === 'welcome'
      ? screen.previousLibrary
      : screen.kind === 'activating'
        ? screen.previousLibrary
        : null;

  const finishPreparedLibrary = useCallback(async (
    attempt: PreparedWorkspaceAttempt,
    generation: number,
  ): Promise<void> => {
    const { prepared, continuity } = attempt;
    let commitCompleted = false;
    try {
      const commit = await gateway.commitPreparedLibrary(prepared.preparationToken);
      commitCompleted = true;
      if (attemptGeneration.current !== generation + 1) return;
      if (
        commit.status !== 'created_and_active'
        && commit.status !== 'opened_and_active'
      ) {
        dispatch({
          type: 'attempt-failed',
          generation,
          notice: 'The library was prepared but could not be opened. You can retry it from Welcome.',
          recovery: commit.status === 'created_not_active' ? commit.pending : null,
        });
        return;
      }

      const library = finalizeReadyState(prepared, commit);
      setHistoryEnabled(false);
      const backendHistoryEnabled = continuity
        ? false
        : await gateway.historyEnabled(library.session).catch(() => false);
      if (attemptGeneration.current !== generation + 1) return;
      setHistoryEnabled(resolveActivationHistoryEnabled({
        previousEnabled: historyEnabled,
        continuityStatus: continuity?.historyStatus ?? null,
        backendEnabled: backendHistoryEnabled,
      }));
      applyReadySelection(
        library,
        continuity,
        setSelectedNodeId,
        setNoteState,
        setRestoredFocus,
      );
      const opened = libraryOpenedState(
        library.libraryLabel,
        library.summary.notes,
        library.summary.relationships,
      );
      const warning = continuityWarningMessage(
        commit.recoveryRetained,
        commit.continuityWarning,
      ) ?? continuity?.fallbackNotice;
      setActionState(warning ? { ...opened, message: warning } : opened);

      if (continuity?.historyStatus === 'loaded' && continuity.conversationId) {
        const latest = await gateway.loadLatestHistory(library.session).catch(() => null);
        if (
          latest?.status === 'loaded'
          && latest.conversationId === continuity.conversationId
          && attemptGeneration.current === generation + 1
        ) {
          setRestoredHistory({
            conversationId: latest.conversationId,
            records: latest.records,
          });
        } else {
          setRestoredHistory(null);
          if (!commit.recoveryRetained) {
            setActionState({
              ...opened,
              message: 'Your library opened, but its latest conversation could not be restored.',
            });
          }
        }
      } else {
        setRestoredHistory(null);
      }

      void gateway.listRecentLibraries().then(setRecentLibraries).catch(() => undefined);
      dispatch({
        type: 'attempt-committed',
        generation,
        library,
        recovery: commit.recoveryRetained ? commit.pending : null,
      });
    } catch (error) {
      if (attemptGeneration.current === generation + 1) {
        const failure = friendlyWorkspaceFailure(outcomeCode(error));
        setActionState(failure);
        dispatch({ type: 'attempt-failed', generation, notice: failure.message });
      }
    } finally {
      if (!commitCompleted) {
        await gateway.abortPreparedLibrary(prepared.preparationToken).catch(() => undefined);
      }
    }
  }, [gateway]);

  const runAttempt = useCallback(async (
    kind: WorkspaceAttemptKind,
    prepare: () => Promise<PreparedWorkspaceAttempt | null>,
  ): Promise<void> => {
    const generation = attemptGeneration.current;
    attemptGeneration.current = generation + 1;
    dispatch({ type: 'begin-attempt', attemptKind: kind });
    try {
      const prepared = await prepare();
      if (
        prepared
        && await abortIfStalePrepared(
          prepared.prepared,
          generation,
          () => attemptGeneration.current - 1,
          gateway.abortPreparedLibrary,
        )
      ) {
        return;
      }
      if (attemptGeneration.current !== generation + 1) return;
      if (!prepared) {
        setActionState(workspaceLoadCanceledState);
        dispatch({ type: 'attempt-cancelled', generation });
        return;
      }
      await finishPreparedLibrary(prepared, generation);
    } catch (error) {
      if (attemptGeneration.current !== generation + 1) return;
      const failure = friendlyWorkspaceFailure(outcomeCode(error));
      setActionState(failure);
      dispatch({ type: 'attempt-failed', generation, notice: failure.message });
    }
  }, [finishPreparedLibrary, gateway]);

  const createLibrary = useCallback((name: string): void => {
    void runAttempt('create', async () => {
      const capability = await gateway.beginCreateLibrary(name);
      if (!capability) return null;
      return wrapPrepared(await gateway.prepareCreateLibrary(capability));
    });
  }, [gateway, runAttempt]);

  const openLibrary = useCallback((): void => {
    void runAttempt('open', async () => wrapPrepared(await gateway.prepareChooseWorkspace()));
  }, [gateway, runAttempt]);

  const retryRecovery = useCallback((recoveryId: string): void => {
    void runAttempt('recover', async () => (
      wrapPrepared(await gateway.preparePendingLibraryOperation(recoveryId))
    ));
  }, [gateway, runAttempt]);

  const restoreRecentLibrary = useCallback((workspaceId: string): void => {
    void runAttempt('restore', async () => (
      wrapContinuity(await gateway.prepareRestoreRecentLibrary(workspaceId))
    ));
  }, [gateway, runAttempt]);

  const findRecentLibrary = useCallback((workspaceId: string): void => {
    void runAttempt('find', async () => (
      wrapContinuity(await gateway.prepareFindRecentLibrary(workspaceId))
    ));
  }, [gateway, runAttempt]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      gateway.listRecentLibraries().catch(() => []),
      gateway.listPendingLibraryOperation().catch(() => null),
    ]).then(([recents, recovery]) => {
      if (!current) return;
      setRecentLibraries(recents);
      dispatch({ type: 'boot-welcome', recovery });
      const latest = recents.find((library) => library.status === 'available');
      if (latest) restoreRecentLibrary(latest.workspaceId);
    });
    return () => {
      current = false;
    };
  }, [gateway, restoreRecentLibrary]);

  const showWelcome = useCallback((): void => {
    dispatch({ type: 'show-welcome' });
  }, []);

  const returnToReady = useCallback((): void => {
    dispatch({ type: 'return-to-ready' });
  }, []);

  const removeRecovery = useCallback((recoveryId: string): void => {
    void gateway.removePendingLibraryOperation(recoveryId)
      .then(() => dispatch({ type: 'recovery-removed', recoveryId }))
      .catch((error) => setActionState(friendlyWorkspaceFailure(outcomeCode(error))));
  }, [gateway]);

  const removeRecentLibrary = useCallback((workspaceId: string): void => {
    void gateway.removeRecentLibrary(workspaceId)
      .then(() => setRecentLibraries((current) => (
        current.filter((library) => library.workspaceId !== workspaceId)
      )))
      .then(() => setRecentNotice('The library was removed from recent activity.'))
      .catch(() => setRecentNotice('That library could not be removed from the list.'));
  }, [gateway]);

  const clearRecentActivity = useCallback((): void => {
    void gateway.clearRecentActivity()
      .then((status) => {
        if (status === 'reset' || status === 'already_reset') setRecentLibraries([]);
        if (status === 'cancelled') return;
        setRecentNotice(resetRecentActivityMessage(status));
        const succeeded = status === 'reset' || status === 'already_reset';
        setActionState({
          kind: succeeded ? 'success' : 'error',
          title: succeeded ? 'Recent activity cleared' : 'Recent activity unchanged',
          message: resetRecentActivityMessage(status),
        });
      })
      .catch(() => {
        const message = resetRecentActivityMessage('unavailable');
        setRecentNotice(message);
        setActionState({
          kind: 'error',
          title: 'Recent activity unchanged',
          message,
        });
      });
  }, [gateway]);

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const current = screenRef.current;
    const library = current.kind === 'ready' ? current.library : null;
    if (!library) return;
    try {
      const snapshot = await gateway.workspaceSnapshot(library.session);
      if (
        screenRef.current.kind !== 'ready'
        || screenRef.current.library.session !== library.session
      ) {
        return;
      }
      const refreshed: ReadyLibraryState = { ...snapshot, session: library.session };
      setReadySelection(refreshed, setSelectedNodeId, setNoteState, selectedNodeId);
      dispatch({ type: 'boot-ready', library: refreshed });
    } catch (error) {
      setActionState(friendlyWorkspaceFailure(outcomeCode(error)));
    }
  }, [gateway, selectedNodeId]);

  const selectNode = useCallback((nodeId: string): void => {
    const node = readyLibrary?.graph.nodes.find((candidate) => candidate.id === nodeId);
    setSelectedNodeId(node?.id ?? '');
    setNoteState(node ? toSnapshotNoteState(node) : noteUnavailableState);
  }, [readyLibrary]);

  const showCitationNote = useCallback((note: { path: string; content: string }): void => {
    setNoteState({ kind: 'loaded', path: note.path, content: note.content });
  }, []);

  const saveWorkspaceView = useCallback((
    focus: WorkspaceFocus,
    relativePath?: string,
  ): void => {
    if (!readyLibrary) return;
    const artifact: ArtifactLocator | null = relativePath
      ? { version: 1, kind: 'wiki_note', relativePath: `wiki/${relativePath}` }
      : null;
    void gateway.saveWorkspaceView(readyLibrary.session, focus, artifact).catch(() => undefined);
  }, [gateway, readyLibrary]);

  const clearRestoredHistory = useCallback((): void => {
    setRestoredHistory(null);
  }, []);

  const graph = useMemo<KnowledgeGraph>(
    () => readyLibrary?.graph ?? { nodes: [], edges: [] },
    [readyLibrary],
  );

  return {
    actionState,
    clearRecentActivity,
    clearRestoredHistory,
    createLibrary,
    findRecentLibrary,
    graph,
    historyEnabled,
    noteState,
    openLibrary,
    query,
    readyLibrary,
    recentLibraries,
    recentNotice,
    refreshSnapshot,
    removeRecentLibrary,
    removeRecovery,
    restoredFocus,
    restoredHistory,
    restoreRecentLibrary,
    retryRecovery,
    returnToReady,
    saveWorkspaceView,
    screen,
    selectNode,
    selectedNodeId,
    setActionState,
    setHistoryEnabled,
    setQuery,
    showCitationNote,
    showWelcome,
  };
}

function wrapPrepared(prepared: PreparedLibrary | null): PreparedWorkspaceAttempt | null {
  return prepared ? { prepared, continuity: null } : null;
}

function wrapContinuity(
  continuity: PreparedContinuity | null,
): PreparedWorkspaceAttempt | null {
  if (!continuity) return null;
  const resolved = resolvePreparedContinuity(continuity);
  return { prepared: resolved.prepared, continuity: resolved };
}

function applyReadySelection(
  library: ReadyLibraryState,
  continuity: ResolvedContinuity | null,
  setSelectedNodeId: (nodeId: string) => void,
  setNoteState: (state: NoteContentState) => void,
  setRestoredFocus: (focus: WorkspaceFocus) => void,
): void {
  if (continuity) {
    setSelectedNodeId(continuity.selectedNodeId);
    setNoteState(continuity.note ?? noteUnavailableState);
    setRestoredFocus(continuity.focus);
    return;
  }
  setRestoredFocus('graph');
  setReadySelection(library, setSelectedNodeId, setNoteState);
}

function setReadySelection(
  library: ReadyLibraryState,
  setSelectedNodeId: (nodeId: string) => void,
  setNoteState: (state: NoteContentState) => void,
  priorSelectedNodeId = '',
): void {
  const selectedNodeId = resolveSelectedNodeId(library.graph, priorSelectedNodeId);
  const node = library.graph.nodes.find((candidate) => candidate.id === selectedNodeId);
  setSelectedNodeId(selectedNodeId);
  setNoteState(node ? toSnapshotNoteState(node) : noteUnavailableState);
}

function outcomeCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('destination is unavailable')) return 'destination_in_use';
  if (message.includes('validation failed')) return 'not_a_library';
  if (message.includes('permission')) return 'permission_denied';
  return 'internal_failure';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function noteFromSnapshotNode(node: GraphNode): NoteContentState {
  return toSnapshotNoteState(node);
}
