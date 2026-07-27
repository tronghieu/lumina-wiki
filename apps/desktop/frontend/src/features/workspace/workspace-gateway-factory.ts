import type {
  PreparedLibrary,
  ReadyCommit,
  SessionReference,
  WorkspaceSnapshot,
} from './ready-library-state';
import type { PendingLibraryOperation } from './welcome-state';
import type { HistoryRecordDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import type {
  ArtifactLocator,
  PreparedContinuity,
  RecentLibrary,
  WorkspaceFocus,
} from './workspace-restoration';
import {
  toPendingLibraryOperation,
  toPreparedLibrary,
  toReadyCommit,
  toWorkspaceSnapshot,
  toPreparedContinuity,
  toRecentLibraries,
  type RawLocationCapability,
  type RawPendingLibraryOperation,
  type RawPreparedLibrary,
  type RawReadyCommit,
  type RawWorkspaceSnapshot,
  type RawPreparedContinuity,
} from './workspace-gateway-adapters.ts';

export interface WorkspaceGateway {
  beginCreateLibrary: (name: string) => Promise<unknown | null>;
  prepareCreateLibrary: (locationCapability: unknown) => Promise<PreparedLibrary | null>;
  listPendingLibraryOperation: () => Promise<PendingLibraryOperation | null>;
  preparePendingLibraryOperation: (recoveryId: string) => Promise<PreparedLibrary | null>;
  removePendingLibraryOperation: (recoveryId: string) => Promise<void>;
  prepareChooseWorkspace: () => Promise<PreparedLibrary | null>;
  commitPreparedLibrary: (preparationToken: string) => Promise<ReadyCommit>;
  abortPreparedLibrary: (preparationToken: string) => Promise<void>;
  workspaceSnapshot: (session: SessionReference) => Promise<WorkspaceSnapshot>;
  listRecentLibraries: () => Promise<RecentLibrary[]>;
  prepareRestoreRecentLibrary: (workspaceId: string) => Promise<PreparedContinuity | null>;
  prepareFindRecentLibrary: (workspaceId: string) => Promise<PreparedContinuity | null>;
  removeRecentLibrary: (workspaceId: string) => Promise<void>;
  clearRecentActivity: () => Promise<string>;
  saveWorkspaceView: (
    session: SessionReference,
    focus: WorkspaceFocus,
    artifact: ArtifactLocator | null,
  ) => Promise<void>;
  loadLatestHistory: (session: SessionReference) => Promise<{
    status: string;
    conversationId: string | null;
    records: HistoryRecordDTO[];
  }>;
  historyEnabled: (session: SessionReference) => Promise<boolean>;
}

export type GeneratedLibraryService = {
  BeginCreateLibrary: (name: string) => Promise<RawLocationCapability>;
  PrepareCreateLibrary: (locationCapability: unknown) => Promise<RawPreparedLibrary>;
  ListPendingLibraryOperation: () => Promise<RawPendingLibraryOperation>;
  PreparePendingLibraryOperation: (recoveryId: string) => Promise<RawPreparedLibrary>;
  RemovePendingLibraryOperation: (recoveryId: string) => Promise<{ removed: boolean }>;
  PrepareChooseWorkspace: () => Promise<RawPreparedLibrary>;
  CommitPreparedLibrary: (preparationToken: string) => Promise<RawReadyCommit>;
  AbortPreparedLibrary: (preparationToken: string) => Promise<{ cancelled: boolean }>;
  WorkspaceSnapshot: (session: SessionReference) => Promise<RawWorkspaceSnapshot>;
  ListRecentLibraries: () => Promise<{ libraries?: unknown[] }>;
  PrepareRestoreRecentLibrary: (request: { workspaceId: string }) => Promise<RawPreparedContinuity>;
  PrepareFindRecentLibrary: (request: { workspaceId: string }) => Promise<RawPreparedContinuity>;
  RemoveRecentLibrary: (request: { workspaceId: string }) => Promise<{ removed: boolean }>;
  BeginResetRecentViewState: () => Promise<{ status: string; token?: string }>;
  ResetRecentViewState: (token: string) => Promise<{ status: string }>;
  SaveWorkspaceView: (request: {
    session: SessionReference;
    focus: WorkspaceFocus;
    artifact?: ArtifactLocator | null;
  }) => Promise<unknown>;
  LoadLatestHistory: (session: SessionReference) => Promise<{
    status: string;
    conversationId?: string;
    records?: HistoryRecordDTO[];
  }>;
  HistoryStatus: (session: SessionReference) => Promise<{ enabled: boolean }>;
};

export function createWorkspaceGateway(
  generated: GeneratedLibraryService,
): WorkspaceGateway {
  return {
    async beginCreateLibrary(name): Promise<unknown | null> {
      const location = await generated.BeginCreateLibrary(name);
      return location.status === 'approved' && location.token ? location : null;
    },
    async prepareCreateLibrary(locationCapability): Promise<PreparedLibrary | null> {
      return toPreparedLibrary(await generated.PrepareCreateLibrary(locationCapability));
    },
    async listPendingLibraryOperation(): Promise<PendingLibraryOperation | null> {
      return toPendingLibraryOperation(await generated.ListPendingLibraryOperation());
    },
    async preparePendingLibraryOperation(recoveryId): Promise<PreparedLibrary | null> {
      return toPreparedLibrary(await generated.PreparePendingLibraryOperation(recoveryId));
    },
    async removePendingLibraryOperation(recoveryId): Promise<void> {
      await generated.RemovePendingLibraryOperation(recoveryId);
    },
    async prepareChooseWorkspace(): Promise<PreparedLibrary | null> {
      return toPreparedLibrary(await generated.PrepareChooseWorkspace());
    },
    async commitPreparedLibrary(preparationToken): Promise<ReadyCommit> {
      return toReadyCommit(await generated.CommitPreparedLibrary(preparationToken));
    },
    async abortPreparedLibrary(preparationToken): Promise<void> {
      await generated.AbortPreparedLibrary(preparationToken);
    },
    async workspaceSnapshot(session): Promise<WorkspaceSnapshot> {
      return toWorkspaceSnapshot(await generated.WorkspaceSnapshot(session));
    },
    async listRecentLibraries(): Promise<RecentLibrary[]> {
      return toRecentLibraries(await generated.ListRecentLibraries());
    },
    async prepareRestoreRecentLibrary(workspaceId): Promise<PreparedContinuity | null> {
      return toPreparedContinuity(
        await generated.PrepareRestoreRecentLibrary({ workspaceId }),
      );
    },
    async prepareFindRecentLibrary(workspaceId): Promise<PreparedContinuity | null> {
      return toPreparedContinuity(
        await generated.PrepareFindRecentLibrary({ workspaceId }),
      );
    },
    async removeRecentLibrary(workspaceId): Promise<void> {
      await generated.RemoveRecentLibrary({ workspaceId });
    },
    async clearRecentActivity(): Promise<string> {
      const confirmation = await generated.BeginResetRecentViewState();
      if (confirmation.status !== 'ready' || !confirmation.token) return 'cancelled';
      const result = await generated.ResetRecentViewState(confirmation.token);
      return result.status;
    },
    async saveWorkspaceView(session, focus, artifact): Promise<void> {
      await generated.SaveWorkspaceView({
        session,
        focus,
        artifact,
      });
    },
    async loadLatestHistory(session) {
      const result = await generated.LoadLatestHistory(session);
      return {
        status: result.status,
        conversationId: result.conversationId ?? null,
        records: result.records ?? [],
      };
    },
    async historyEnabled(session): Promise<boolean> {
      return (await generated.HistoryStatus(session)).enabled;
    },
  };
}
