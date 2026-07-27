import type {
  PreparedLibrary,
  ReadyCommit,
  WorkspaceSnapshot,
} from './ready-library-state';
import type { PendingLibraryOperation } from './welcome-state';
import type { WorkspaceTreeNode } from './workspace-tree-data';
import {
  normalizeRecentLibraries,
  type PreparedContinuity,
  type RecentLibrary,
} from './workspace-restoration.ts';

export type RawLocationCapability = {
  status: 'approved' | 'cancelled';
  token?: string;
};

export type RawPreparedLibrary = {
  status: 'ready' | 'cancelled';
  preparationToken?: string;
  snapshot: RawWorkspaceSnapshot;
};

export type RawReadyCommit = {
  status: ReadyCommit['status'];
  capability?: {
    sessionId: string;
    generation: number;
  } | null;
  pending?: RawPendingLibraryOperation | null;
  recoveryRetained?: boolean;
  continuityWarning?: boolean;
};

export type RawWorkspaceSnapshot = {
  display: { label: string };
  summary: {
    notes: number;
    sources: number;
    relationships: number;
  };
  graph: WorkspaceSnapshot['graph'];
  tree: {
    nodes: WorkspaceTreeNode[];
  };
  accessMode: 'read-only' | 'writable';
  warnings: Array<{ code: string }>;
};

export type RawPendingLibraryOperation = {
  available: boolean;
  recoveryId?: string;
  name?: string;
  phase?: string;
};

export type RawPreparedContinuity = {
  prepared: RawPreparedLibrary;
  focus: string;
  artifactStatus: 'loaded' | 'empty' | 'unavailable';
  artifact?: {
    artifact: { version: number; kind: string; relativePath: string };
    content: string;
  } | null;
  historyStatus: PreparedContinuity['historyStatus'];
  conversationId?: string;
};

export function toPreparedLibrary(raw: RawPreparedLibrary): PreparedLibrary | null {
  if (raw.status !== 'ready' || !raw.preparationToken) return null;
  return {
    preparationToken: raw.preparationToken,
    snapshot: toWorkspaceSnapshot(raw.snapshot),
  };
}

export function toPendingLibraryOperation(
  raw: RawPendingLibraryOperation,
): PendingLibraryOperation | null {
  if (!raw.available || !raw.recoveryId || !raw.name) return null;
  return {
    recoveryId: raw.recoveryId,
    libraryLabel: raw.name,
    message: 'Creation was interrupted before this library opened.',
  };
}

export function toReadyCommit(raw: RawReadyCommit): ReadyCommit {
  return {
    status: raw.status,
    session: raw.capability
      ? {
          sessionId: raw.capability.sessionId,
          generation: raw.capability.generation,
        }
      : null,
    pending: raw.pending ? toPendingLibraryOperation(raw.pending) : null,
    recoveryRetained: Boolean(raw.recoveryRetained),
    continuityWarning: Boolean(raw.continuityWarning),
  };
}

export function toRecentLibraries(raw: { libraries?: unknown[] }): RecentLibrary[] {
  return normalizeRecentLibraries(Array.isArray(raw.libraries) ? raw.libraries : []);
}

export function toPreparedContinuity(raw: RawPreparedContinuity): PreparedContinuity | null {
  const prepared = toPreparedLibrary(raw.prepared);
  if (!prepared) return null;
  const focus = raw.focus === 'chat' || raw.focus === 'note' ? raw.focus : 'graph';
  const artifact = raw.artifact
    && raw.artifact.artifact.version === 1
    && raw.artifact.artifact.kind === 'wiki_note'
    ? {
        artifact: {
          version: 1 as const,
          kind: 'wiki_note' as const,
          relativePath: raw.artifact.artifact.relativePath,
        },
        content: raw.artifact.content,
      }
    : null;
  return {
    prepared,
    focus,
    artifactStatus: raw.artifactStatus,
    artifact,
    historyStatus: raw.historyStatus,
    conversationId: raw.conversationId ?? null,
  };
}

export function toWorkspaceSnapshot(raw: RawWorkspaceSnapshot): WorkspaceSnapshot {
  return {
    libraryLabel: raw.display.label,
    accessMode: raw.accessMode === 'read-only' ? 'read-only' : 'read-write',
    summary: {
      notes: raw.summary.notes,
      documents: raw.summary.sources,
      relationships: raw.summary.relationships,
    },
    graph: raw.graph,
    tree: raw.tree.nodes,
    warnings: raw.warnings.map(friendlyWarning),
  };
}

function friendlyWarning(): string {
  return 'Some library details could not be displayed.';
}
