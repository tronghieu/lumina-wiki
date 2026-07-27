import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../features/workspace/use-workspace.ts', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../features/workspace/workspace-gateway.ts', import.meta.url), 'utf8');
const gatewayFactory = readFileSync(
  new URL('../features/workspace/workspace-gateway-factory.ts', import.meta.url),
  'utf8',
);
const history = readFileSync(new URL('../features/chat/use-chat-history.ts', import.meta.url), 'utf8');
const integration = `${app}\n${workspace}\n${gateway}\n${gatewayFactory}\n${history}`;

test('prepared snapshots and active session capabilities remain separate', () => {
  assert.match(integration, /PreparedLibrary/);
  assert.match(integration, /finalizeReadyState\(prepared, commit\)/);
  assert.match(integration, /CommitPreparedLibrary/);
  assert.doesNotMatch(integration, /draftWorkspaceRoot|typedRoot|workspaceRoot/);
});

test('AI reads use only the loaded session and citations use opaque ids', () => {
  for (const call of ['WorkspaceSnapshot', 'ListHistory', 'LoadHistory', 'DeleteHistory', 'ReadCitationNote']) {
    assert.match(integration, new RegExp(call));
  }
  assert.match(app, /citationId:\s*citation\.citationId/);
  assert.match(app, /requestId:\s*citation\.requestId/);
  assert.doesNotMatch(app, /ReadCitationNote\([^)]*citation\.path/);
});

test('a stale profile bootstrap cannot overwrite a newer settings save', () => {
  assert.match(app, /profileRequestGuard\.begin\(\)/);
  assert.match(app, /profileRequestGuard\.isCurrent\(request\)/);
  assert.match(app, /onProfilesChange=\{updateAISettings\}/);
});

test('a citation read cannot commit after its workspace session changes', () => {
  assert.match(app, /citationRequestGuard\.setSession\(/);
  assert.match(app, /const request = citationRequestGuard\.begin\(\)/);
  assert.match(app, /citationRequestGuard\.isCurrent\(request\)/);
});

test('workspace activation is generation guarded and keeps the prior session mounted', () => {
  assert.match(workspace, /attemptGeneration\.current !== generation \+ 1/);
  assert.match(workspace, /screen\.previousLibrary/);
  assert.match(app, /activationLabel=/);
});

test('boot restores a recent library before Welcome can render', () => {
  assert.match(workspace, /ListRecentLibraries|listRecentLibraries/);
  assert.match(workspace, /restoreRecentLibrary\(latest\.workspaceId\)/);
  assert.match(app, /attempt\.kind === 'restore'/);
  assert.ok(
    app.indexOf("attempt.kind === 'restore'") < app.indexOf("screen.kind === 'welcome'"),
  );
});

test('continuity restores guarded history and saves only semantic view state', () => {
  assert.match(workspace, /loadLatestHistory\(library\.session\)/);
  assert.match(app, /chatStateFromHistory/);
  assert.match(workspace, /saveWorkspaceView\(readyLibrary\.session, focus, artifact\)/);
  assert.doesNotMatch(workspace, /SaveWorkspaceView[^]*root/i);
});

test('a normal library switch resolves B history before B becomes chat-ready', () => {
  const resetIndex = workspace.indexOf('setHistoryEnabled(false)');
  const statusIndex = workspace.indexOf('gateway.historyEnabled(library.session)');
  const readyIndex = workspace.indexOf("type: 'attempt-committed'");
  assert.ok(resetIndex >= 0 && resetIndex < statusIndex);
  assert.ok(statusIndex < readyIndex);
  assert.match(app, /historyEnabled:\s*workspace\.historyEnabled/);
});
