import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../features/workspace/use-workspace.ts', import.meta.url), 'utf8');
const history = readFileSync(new URL('../features/chat/use-chat-history.ts', import.meta.url), 'utf8');
const integration = `${app}\n${workspace}\n${history}`;

test('workspace draft and loaded capability remain separate', () => {
  assert.match(integration, /draftWorkspaceRoot/);
  assert.match(integration, /loadedWorkspace/);
  assert.match(integration, /ConfirmAndActivateWorkspace\(validation\.root\)/);
  assert.doesNotMatch(integration, /sessionId:\s*draftWorkspaceRoot|generation:\s*draftWorkspaceRoot/);
});

test('AI reads use only the loaded session and citations use opaque ids', () => {
  for (const call of ['WorkspaceTree', 'HistoryStatus', 'ListHistory', 'LoadHistory', 'DeleteHistory', 'ReadCitationNote']) {
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

test('workspace activation invalidates citation reads before the new session commits', () => {
  assert.match(workspace, /beginArtifactRead/);
  assert.match(workspace, /artifactRequestGuard\.begin\(\)/);
  assert.match(app, /workspace\.isArtifactReadCurrent\(artifactRequest\)/);
});
