import type { HistoryRecordDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import type { NoteContentState } from '../graph/note-content';
import type { PreparedLibrary } from './ready-library-state';

export type WorkspaceFocus = 'chat' | 'note' | 'graph';
export type RecentLibraryStatus = 'available' | 'unavailable';

export type RecentLibrary = {
  workspaceId: string;
  label: string;
  activatedAt: string;
  status: RecentLibraryStatus;
  focus: WorkspaceFocus;
};

export type ArtifactLocator = {
  version: 1;
  kind: 'wiki_note';
  relativePath: string;
};

export type PreparedContinuity = {
  prepared: PreparedLibrary;
  focus: WorkspaceFocus;
  artifactStatus: 'loaded' | 'empty' | 'unavailable';
  artifact: {
    artifact: ArtifactLocator;
    content: string;
  } | null;
  historyStatus: 'off' | 'empty' | 'loaded' | 'deleted_retry_exhausted' | 'unavailable' | 'corrupt';
  conversationId: string | null;
};

export type ResolvedContinuity = {
  prepared: PreparedLibrary;
  focus: WorkspaceFocus;
  selectedNodeId: string;
  note: NoteContentState | null;
  historyStatus: PreparedContinuity['historyStatus'];
  conversationId: string | null;
  fallbackNotice: string | null;
};

export type RestoredHistory = {
  conversationId: string;
  records: HistoryRecordDTO[];
};

type RawRecentLibrary = {
  workspaceId?: unknown;
  label?: unknown;
  activatedAt?: unknown;
  status?: unknown;
  focus?: unknown;
};

export function normalizeRecentLibraries(raw: unknown[]): RecentLibrary[] {
  return raw.slice(0, 12).flatMap((value) => {
    if (!isRawRecentLibrary(value)) return [];
    const item = value;
    if (typeof item.workspaceId !== 'string' || !item.workspaceId) return [];
    const label = typeof item.label === 'string' && item.label.trim()
      ? item.label.trim().slice(0, 120)
      : 'Library';
    return [{
      workspaceId: item.workspaceId,
      label,
      activatedAt: normalizeTime(item.activatedAt),
      status: item.status === 'available' ? 'available' : 'unavailable',
      focus: normalizeFocus(item.focus),
    }];
  });
}

function isRawRecentLibrary(value: unknown): value is RawRecentLibrary {
  return typeof value === 'object' && value !== null;
}

export function resolvePreparedContinuity(
  continuity: PreparedContinuity,
): ResolvedContinuity {
  const artifact = continuity.artifactStatus === 'loaded'
    ? validWikiArtifact(continuity.artifact)
    : null;
  const graphPath = artifact?.artifact.relativePath.slice('wiki/'.length);
  const selectedNode = graphPath
    ? continuity.prepared.snapshot.graph.nodes.find((node) => node.path === graphPath)
    : undefined;
  const note = artifact && selectedNode
    ? {
        kind: 'loaded' as const,
        path: artifact.artifact.relativePath,
        content: artifact.content,
      }
    : null;
  const requestedFocus = normalizeFocus(continuity.focus);
  const focus = requestedFocus === 'note' && !note ? 'graph' : requestedFocus;
  const artifactFailed = continuity.artifactStatus === 'unavailable'
    || (continuity.artifactStatus === 'loaded' && !note);

  return {
    prepared: continuity.prepared,
    focus,
    selectedNodeId: selectedNode?.id ?? '',
    note,
    historyStatus: continuity.historyStatus,
    conversationId: continuity.historyStatus === 'loaded' && continuity.conversationId
      ? continuity.conversationId
      : null,
    fallbackNotice: continuityFallbackNotice(continuity.historyStatus, artifactFailed),
  };
}

function continuityFallbackNotice(
  historyStatus: PreparedContinuity['historyStatus'],
  artifactFailed: boolean,
): string | null {
  const historyFailed = ['deleted_retry_exhausted', 'unavailable', 'corrupt'].includes(historyStatus);
  if (artifactFailed && historyFailed) {
    return 'Your library opened, but some recent activity could not be restored.';
  }
  if (artifactFailed) return 'Your library opened, but the last note is unavailable.';
  if (historyStatus === 'deleted_retry_exhausted') {
    return 'Your library opened, but its latest saved conversation changed before it could be restored.';
  }
  if (historyStatus === 'unavailable') {
    return 'Your library opened, but recent conversations are unavailable right now.';
  }
  if (historyStatus === 'corrupt') {
    return 'Your library opened, but recent conversation details could not be read.';
  }
  return null;
}

export function resetRecentActivityMessage(status: string): string {
  if (status === 'reset') return 'Recent activity was cleared.';
  if (status === 'already_reset') return 'There was no recent activity to clear.';
  if (status === 'failed_preserved') {
    return 'Recent activity could not be cleared. Nothing was changed.';
  }
  return 'Recent activity is unavailable right now. Nothing was changed.';
}

export function continuityWarningMessage(
  recoveryRetained: boolean,
  continuityWarning: boolean,
): string | null {
  if (recoveryRetained) {
    return 'Your library opened. An unfinished library is still available from Welcome.';
  }
  if (continuityWarning) {
    return 'Your library opened, but some recent activity could not be restored.';
  }
  return null;
}

function normalizeFocus(value: unknown): WorkspaceFocus {
  if (value === 'chat' || value === 'note') return value;
  return 'graph';
}

function normalizeTime(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return '';
}

function validWikiArtifact(
  artifact: PreparedContinuity['artifact'],
): PreparedContinuity['artifact'] {
  if (!artifact || artifact.artifact.version !== 1 || artifact.artifact.kind !== 'wiki_note') {
    return null;
  }
  const path = artifact.artifact.relativePath;
  if (
    !path.startsWith('wiki/')
    || !path.endsWith('.md')
    || path.includes('\\')
    || path.includes('//')
    || path.split('/').some((part) => part === '.' || part === '..' || !part)
  ) {
    return null;
  }
  return artifact;
}
