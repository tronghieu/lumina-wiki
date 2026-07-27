import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  toPendingLibraryOperation,
  toPreparedLibrary,
  toReadyCommit,
} from './workspace-gateway-adapters.ts';
import { createWorkspaceGateway } from './workspace-gateway-factory.ts';

const gateway = readFileSync(new URL('./workspace-gateway.ts', import.meta.url), 'utf8');
const gatewayFactory = readFileSync(new URL('./workspace-gateway-factory.ts', import.meta.url), 'utf8');
const hook = readFileSync(new URL('./use-workspace.ts', import.meta.url), 'utf8');
const sources = `${gateway}\n${gatewayFactory}\n${hook}`;
const generatedService = readFileSync(
  new URL('../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service.ts', import.meta.url),
  'utf8',
);

test('library activation uses only the capability-based AI facade', () => {
  assert.match(sources, /PrepareChooseWorkspace/);
  assert.match(sources, /CommitPreparedLibrary/);
  assert.match(sources, /AbortPreparedLibrary/);
  assert.match(sources, /WorkspaceSnapshot/);
  assert.doesNotMatch(sources, /internal\/(workspace|graph|tools|importer)\/service/);
  assert.doesNotMatch(sources, /Dialogs\.OpenFile|typedRoot|draftWorkspaceRoot|workspaceRoot/);
});

test('gateway adapters handle native cancellation and backend DTO shapes', () => {
  assert.equal(toPreparedLibrary({
    status: 'cancelled',
    snapshot: {
      display: { label: '' },
      summary: { notes: 0, sources: 0, relationships: 0 },
      graph: { nodes: [], edges: [] },
      tree: { nodes: [] },
      accessMode: 'writable',
      warnings: [],
    },
  }), null);
  assert.equal(toPendingLibraryOperation({ available: false }), null);
  assert.deepEqual(toPendingLibraryOperation({
    available: true,
    recoveryId: 'opaque-recovery',
    name: 'Lumina Library',
    phase: 'publishing',
  }), {
    recoveryId: 'opaque-recovery',
    libraryLabel: 'Lumina Library',
    message: 'Creation was interrupted before this library opened.',
  });
  assert.deepEqual(toReadyCommit({
    status: 'created_and_active',
    capability: { sessionId: 'opaque-session', generation: 2 },
  }), {
    status: 'created_and_active',
    session: { sessionId: 'opaque-session', generation: 2 },
    pending: null,
    recoveryRetained: false,
    continuityWarning: false,
  });
});

test('created-not-active commit maps its nested safe recovery reference', () => {
  assert.deepEqual(toReadyCommit({
    status: 'created_not_active',
    capability: null,
    pending: {
      available: true,
      recoveryId: 'opaque-recovery',
      name: 'Library B',
      phase: 'committed',
    },
  }), {
    status: 'created_not_active',
    session: null,
    pending: {
      recoveryId: 'opaque-recovery',
      libraryLabel: 'Library B',
      message: 'Creation was interrupted before this library opened.',
    },
    recoveryRetained: false,
    continuityWarning: false,
  });
});

test('commit maps nonblocking continuity warnings without backend detail', () => {
  assert.deepEqual(toReadyCommit({
    status: 'opened_and_active',
    capability: { sessionId: 'session-b', generation: 3 },
    recoveryRetained: true,
    continuityWarning: true,
  }), {
    status: 'opened_and_active',
    session: { sessionId: 'session-b', generation: 3 },
    pending: null,
    recoveryRetained: true,
    continuityWarning: true,
  });
});

test('gateway orchestrates generated methods and adapts their results', async () => {
  const calls = [];
  const rawSnapshot = {
    display: { label: 'Library B' },
    summary: { notes: 0, sources: 0, relationships: 0 },
    graph: { nodes: [], edges: [] },
    tree: { nodes: [] },
    accessMode: 'writable',
    warnings: [],
  };
  const fakeService = {
    BeginCreateLibrary: async (name) => {
      calls.push(['begin', name]);
      return { status: 'approved', token: 'location-capability' };
    },
    PrepareCreateLibrary: async (capability) => {
      calls.push(['prepare-create', capability.token]);
      return { status: 'ready', preparationToken: 'preparation', snapshot: rawSnapshot };
    },
    ListPendingLibraryOperation: async () => ({ available: false }),
    PreparePendingLibraryOperation: async () => ({
      status: 'ready',
      preparationToken: 'recovery-preparation',
      snapshot: rawSnapshot,
    }),
    RemovePendingLibraryOperation: async () => ({ removed: true }),
    PrepareChooseWorkspace: async () => ({
      status: 'ready',
      preparationToken: 'open-preparation',
      snapshot: rawSnapshot,
    }),
    CommitPreparedLibrary: async (token) => {
      calls.push(['commit', token]);
      return {
        status: 'opened_and_active',
        capability: { sessionId: 'session-b', generation: 2 },
        pending: null,
      };
    },
    AbortPreparedLibrary: async () => ({ cancelled: true }),
    WorkspaceSnapshot: async () => rawSnapshot,
  };
  const subject = createWorkspaceGateway(fakeService);

  const location = await subject.beginCreateLibrary('Library B');
  const prepared = await subject.prepareCreateLibrary(location);
  const committed = await subject.commitPreparedLibrary(prepared.preparationToken);

  assert.deepEqual(calls, [
    ['begin', 'Library B'],
    ['prepare-create', 'location-capability'],
    ['commit', 'preparation'],
  ]);
  assert.equal(prepared.snapshot.libraryLabel, 'Library B');
  assert.deepEqual(committed.session, { sessionId: 'session-b', generation: 2 });
});

test('generated AI facade has exactly 43 methods and no retired raw activation APIs', () => {
  assert.equal(generatedService.match(/^export function /gm)?.length, 43);
  assert.doesNotMatch(
    generatedService,
    /\b(?:ChooseAndActivateWorkspace|ConfirmAndActivateWorkspace)\b/,
  );
});

test('continuity gateway uses recent IDs and the guarded prepared commit', async () => {
  const calls = [];
  const fake = {
    ListRecentLibraries: async () => ({
      libraries: [{
        workspaceId: 'workspace-a',
        label: 'Research',
        activatedAt: '2026-07-27T10:00:00Z',
        status: 'available',
        focus: 'note',
      }],
    }),
    PrepareRestoreRecentLibrary: async (request) => {
      calls.push(['restore', request]);
      return {
        prepared: {
          status: 'ready',
          preparationToken: 'prepared-a',
          snapshot: {
            display: { label: 'Research' },
            summary: { notes: 0, sources: 0, relationships: 0 },
            graph: { nodes: [], edges: [] },
            tree: { nodes: [] },
            accessMode: 'writable',
            warnings: [],
          },
        },
        focus: 'graph',
        artifactStatus: 'empty',
        historyStatus: 'off',
      };
    },
    PrepareFindRecentLibrary: async () => { throw new Error('not used'); },
    RemoveRecentLibrary: async () => ({ removed: true }),
    BeginResetRecentViewState: async () => ({ status: 'cancelled' }),
    ResetRecentViewState: async () => ({ status: 'already_reset' }),
    SaveWorkspaceView: async (request) => request,
    LoadLatestHistory: async () => ({ status: 'empty' }),
    ...fakeServiceForContinuity(),
  };
  const subject = createWorkspaceGateway(fake);
  const recents = await subject.listRecentLibraries();
  const continuity = await subject.prepareRestoreRecentLibrary(recents[0].workspaceId);

  assert.equal(recents.length, 1);
  assert.equal(continuity.prepared.preparationToken, 'prepared-a');
  assert.deepEqual(calls, [['restore', { workspaceId: 'workspace-a' }]]);
});

test('history status is reconciled through the active session only', async () => {
  const fake = {
    HistoryStatus: async (session) => ({
      enabled: session.sessionId === 'session-enabled',
    }),
    ...fakeServiceForContinuity(),
  };
  const subject = createWorkspaceGateway(fake);

  assert.equal(
    await subject.historyEnabled({ sessionId: 'session-enabled', generation: 2 }),
    true,
  );
  assert.equal(
    await subject.historyEnabled({ sessionId: 'session-off', generation: 3 }),
    false,
  );
});

function fakeServiceForContinuity() {
  const snapshot = {
    display: { label: 'Library' },
    summary: { notes: 0, sources: 0, relationships: 0 },
    graph: { nodes: [], edges: [] },
    tree: { nodes: [] },
    accessMode: 'writable',
    warnings: [],
  };
  return {
    BeginCreateLibrary: async () => ({ status: 'cancelled' }),
    PrepareCreateLibrary: async () => ({ status: 'cancelled', snapshot }),
    ListPendingLibraryOperation: async () => ({ available: false }),
    PreparePendingLibraryOperation: async () => ({ status: 'cancelled', snapshot }),
    RemovePendingLibraryOperation: async () => ({ removed: true }),
    PrepareChooseWorkspace: async () => ({ status: 'cancelled', snapshot }),
    CommitPreparedLibrary: async () => ({ status: 'cancelled_before_commit' }),
    AbortPreparedLibrary: async () => ({ cancelled: true }),
    WorkspaceSnapshot: async () => snapshot,
  };
}

test('prepared snapshot adapter removes paths outside bounded graph and tree data', () => {
  assert.deepEqual(toPreparedLibrary({
    status: 'ready',
    preparationToken: 'opaque-preparation',
    snapshot: {
      display: { label: 'Research' },
      summary: { notes: 2, sources: 1, relationships: 3 },
      graph: { nodes: [], edges: [] },
      tree: { nodes: [] },
      accessMode: 'read-only',
      warnings: [{ code: 'limited', path: '/private/not-rendered' }],
    },
  }), {
    preparationToken: 'opaque-preparation',
    snapshot: {
      libraryLabel: 'Research',
      accessMode: 'read-only',
      summary: { notes: 2, documents: 1, relationships: 3 },
      graph: { nodes: [], edges: [] },
      tree: [],
      warnings: ['Some library details could not be displayed.'],
    },
  });
});
