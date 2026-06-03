import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const shellSource = readFileSync(new URL('./app-shell.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('./ai-settings-panel.tsx', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../features/graph/node-inspector.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

test('app shell follows the hand-drawn three-zone layout contract', () => {
  assert.match(shellSource, /className="graph-menu"/);
  assert.match(shellSource, /className="activity-rail"/);
  assert.match(shellSource, /className="file-tree"/);
  assert.match(shellSource, /className="main-artifact"/);
  assert.match(inspectorSource, /className="agent-panel"/);
  assert.match(settingsSource, /className="settings-panel"/);
});

test('app shell keeps primary workspace actions reachable', () => {
  for (const label of ['Open', 'Refresh', 'Source', 'Check', 'Import']) {
    assert.match(shellSource + inspectorSource, new RegExp(`>${label}<`));
  }
});

test('layout css defines desktop zones and compact fallbacks', () => {
  assert.match(cssSource, /\.app-shell\s*{[^}]*grid-template-columns:\s*300px minmax\(520px, 1fr\) 360px/s);
  assert.match(cssSource, /\.agent-panel\s*{/);
  assert.match(cssSource, /\.graph-menu-settings\s*{[^}]*grid-row:\s*3/s);
  assert.match(shellSource, /className="settings-icon"/);
  assert.match(cssSource, /@media \(max-width: 1080px\)/);
  assert.match(cssSource, /@media \(max-width: 760px\)/);
});

test('settings owns local AI model controls', () => {
  assert.match(shellSource, /aria-label="Settings"/);
  assert.match(shellSource, /aria-expanded={settingsOpen}/);
  assert.match(settingsSource, /aria-label="AI provider"/);
  assert.match(settingsSource, /aria-label="AI model"/);
  assert.match(settingsSource, /localStorage/);
  assert.match(settingsSource, /provider:\s*'Local'/);
  assert.doesNotMatch(inspectorSource, /aria-label="Model"/);
});

test('agent panel does not expose fake chat controls', () => {
  assert.doesNotMatch(inspectorSource, /New chat/);
  assert.doesNotMatch(inspectorSource, /Chat input/);
  assert.doesNotMatch(inspectorSource, />Send</);
});
