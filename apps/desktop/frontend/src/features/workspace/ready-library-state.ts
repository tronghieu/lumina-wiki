import type { KnowledgeGraph } from '../graph/graph-types';
import type { PendingLibraryOperation } from './welcome-state';
import type { WorkspaceTreeNode } from './workspace-tree-data';

export type SessionReference = {
  sessionId: string;
  generation: number;
};

export type LibraryAccessMode = 'read-only' | 'read-write';

export type LibrarySummary = {
  notes: number;
  documents: number;
  relationships: number;
};

export type WorkspaceSnapshot = {
  libraryLabel: string;
  accessMode: LibraryAccessMode;
  summary: LibrarySummary;
  graph: KnowledgeGraph;
  tree: WorkspaceTreeNode[];
  warnings: string[];
};

export type PreparedLibrary = {
  preparationToken: string;
  snapshot: WorkspaceSnapshot;
};

export type ReadyCommit = {
  status: 'created_and_active' | 'opened_and_active' | 'created_not_active' | 'cancelled_before_commit';
  session: SessionReference | null;
  pending: PendingLibraryOperation | null;
  recoveryRetained: boolean;
  continuityWarning: boolean;
};

export type ReadyLibraryState = WorkspaceSnapshot & {
  session: SessionReference;
};

export function finalizeReadyState(
  prepared: PreparedLibrary,
  commit: ReadyCommit,
): ReadyLibraryState {
  if (
    (commit.status !== 'created_and_active' && commit.status !== 'opened_and_active')
    || commit.session === null
  ) {
    throw new Error('Prepared library is not active.');
  }

  return {
    ...prepared.snapshot,
    session: commit.session,
  };
}
