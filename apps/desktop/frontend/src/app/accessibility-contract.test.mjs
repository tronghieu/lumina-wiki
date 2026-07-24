import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const shellSource = readSource('./app-shell.tsx');
const artifactSource = readSource('../features/graph/artifact-pane.tsx');
const railSource = readSource('../features/workspace/workspace-rail.tsx');
const agentSource = readSource('../features/chat/agent-panel.tsx');
const settingsSource = readSource('./ai-settings-panel.tsx');
const indexSource = readSource('../../index.html');
const tokensSource = readSource('../styles/tokens.css');
const stylesSource = [
  readSource('../styles/shell.css'),
  readSource('../styles/graph.css'),
  readSource('../styles/chat.css'),
  readSource('../styles/dialog.css'),
].join('\n');

test('the document and shell expose one named main landmark', () => {
  assert.match(indexSource, /<html lang="en">/);
  assert.match(indexSource, /<title>Lumina Wiki Desktop<\/title>/);
  assert.match(shellSource, /<main className="app-shell" lang="en">/);
});

test('artifact tabs identify their controlled tab panels', () => {
  assert.match(artifactSource, /id="artifact-tab-graph"/);
  assert.match(artifactSource, /aria-controls="artifact-panel-graph"/);
  assert.match(artifactSource, /id="artifact-tab-note"/);
  assert.match(artifactSource, /aria-controls="artifact-panel-note"/);
  assert.match(artifactSource, /role="tabpanel"/);
  assert.match(artifactSource, /aria-labelledby=\{`artifact-tab-\$\{activeView\}`\}/);
});

test('workspace tree uses current-page semantics instead of invalid selection state', () => {
  assert.doesNotMatch(railSource, /aria-selected=/);
  assert.match(railSource, /aria-current=\{selectable && node\.path === selectedPath \? 'page' : undefined\}/);
});

test('dialog and side panels provide keyboard and focus recovery contracts', () => {
  assert.match(settingsSource, /role="dialog"/);
  assert.match(settingsSource, /aria-modal="true"/);
  assert.match(settingsSource, /event\.key !== 'Tab'/);
  assert.match(settingsSource, /event\.key === 'Escape'/);
  assert.match(shellSource, /settingsTrigger = useRef<HTMLButtonElement \| null>/);
  assert.match(shellSource, /settingsTrigger\.current = document\.activeElement/);
  assert.match(shellSource, /settingsTrigger\.current\.focus\(\)/);
  assert.match(shellSource, /\[aria-label="Open Agent panel"\]\S*.*focus\(\)/s);
  assert.match(agentSource, /event\.key === 'Enter' && !event\.shiftKey/);
  assert.match(agentSource, /confirmClearRef\.current\?\.focus\(\)/);
  assert.match(agentSource, /confirmDeleteRefs\.current\.get\(pendingDelete\)\?\.focus\(\)/);
  assert.match(agentSource, /aria-label=\{`Delete conversation \$\{conversation\.conversationId\}`\}/);
  assert.match(agentSource, /role="status"/);
});

test('theme tokens cover every custom property consumed by component styles', () => {
  const definitions = new Set([...tokensSource.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const uses = new Set([...stylesSource.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
  assert.deepEqual([...uses].filter((name) => !definitions.has(name)), []);
  assert.match(tokensSource, /\[data-theme='light'\]/);
  assert.match(stylesSource, /prefers-reduced-motion:\s*reduce/);
});

test('every bundled font has one local binary and one local OFL license', () => {
  const fontRoot = new URL('../../public/fonts/', import.meta.url);
  const families = readdirSync(fontRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(families, ['be-vietnam-pro', 'inter', 'jetbrains-mono', 'source-serif-4']);
  for (const family of families) {
    const files = readdirSync(new URL(`${family}/`, fontRoot));
    assert.ok(files.includes('OFL.txt'), `${family} must include OFL.txt`);
    assert.ok(files.some((file) => file.endsWith('.ttf')), `${family} must include a local TTF`);
  }
  assert.equal(existsSync(new URL('../../public/Inter-Variable.ttf', import.meta.url)), false);
  assert.doesNotMatch(`${tokensSource}\n${stylesSource}`, /fonts\.googleapis\.com|url\(\s*['"]?https?:/);
});
