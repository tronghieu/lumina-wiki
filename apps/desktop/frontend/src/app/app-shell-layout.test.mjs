import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const shellSource = readSource('./app-shell.tsx');
const appSource = readSource('../App.tsx');
const titleSource = readSource('./desktop-title-bar.tsx');
const railSource = readSource('../features/workspace/workspace-rail.tsx');
const artifactSource = readSource('../features/graph/artifact-pane.tsx');
const noteSource = readSource('../features/graph/note-view.tsx');
const agentSource = readSource('../features/chat/agent-panel.tsx');

test('app shell composes the reference semantic zones', () => {
  assert.match(shellSource, /<DesktopTitleBar/);
  assert.match(shellSource, /<WorkspaceRail/);
  assert.match(shellSource, /<ArtifactPane/);
  assert.match(shellSource, /<AgentPanel/);
  assert.match(titleSource, /data-wails-drag/);
  assert.match(titleSource, /Library ready/);
  assert.match(railSource, /aria-label="Library navigation"/);
  assert.match(artifactSource, /aria-label="Library content"/);
  assert.match(agentSource, /aria-label="Agent panel"/);
});

test('artifact pane keeps only MVP-A library actions reachable', () => {
  for (const label of ['Switch library', 'Refresh']) {
    assert.match(artifactSource, new RegExp(`>\\s*${label}\\s*<`));
  }
  for (const callback of ['onOpenLibrary', 'onRefreshGraph']) {
    assert.ok(artifactSource.includes(`onClick={${callback}}`));
  }
  assert.doesNotMatch(artifactSource, />\s*(Source|Check|Import)\s*</);
  assert.doesNotMatch(artifactSource, /workspace-root-control|Workspace root/);
  assert.match(appSource, /onOpenLibrary=\{workspace\.showWelcome\}/);
  assert.doesNotMatch(appSource, /onOpenLibrary=\{workspace\.openLibrary\}/);
});

test('graph and note remain real selectable artifact views', () => {
  assert.match(artifactSource, /role="tablist"/);
  assert.match(artifactSource, /role="tab"/);
  assert.match(artifactSource, /onKeyDown=\{handleTabKeyDown\}/);
  assert.match(artifactSource, />\s*Graph\s*</);
  assert.match(artifactSource, />\s*Note\s*</);
  assert.match(artifactSource, /<GraphView/);
  assert.match(artifactSource, /<NoteView/);
  assert.match(noteSource, /noteState\.kind/);
  assert.match(noteSource, /<pre>/);
});

test('tree and agent regions have explicit reopen controls', () => {
  assert.match(railSource, /aria-label=\{open \? 'Close library notes' : 'Open library notes'\}/);
  assert.match(shellSource, /aria-label="Open Agent panel"/);
  assert.match(railSource, /aria-expanded=/);
  assert.match(agentSource, /aria-label="Close Agent panel"/);
});

test('production shell contains no sample workspace or hard-coded tree rows', () => {
  const productionSources = [shellSource, railSource, artifactSource, noteSource, agentSource].join('\n');
  assert.doesNotMatch(productionSources, /Sample graph|AI Social Impact|Ada Lovelace|ai-work-society/);
  assert.doesNotMatch(railSource, /\[\s*['"]chapters['"]/);
  assert.match(agentSource, />New chat</);
  assert.match(agentSource, /aria-label="Chat input"/);
  assert.match(agentSource, />Send</);
  assert.doesNotMatch(agentSource, /Welcome|How can I help|Sample response|canned/i);
});
