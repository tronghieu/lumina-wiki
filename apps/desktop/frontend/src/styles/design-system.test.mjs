import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('app stylesheet is an import-only module boundary', () => {
  const entry = source('../app.css');
  assert.deepEqual(
    entry.trim().split('\n'),
    [
      "@import './styles/tokens.css';",
      "@import './styles/shell.css';",
      "@import './styles/graph.css';",
      "@import './styles/chat.css';",
      "@import './styles/dialog.css';",
    ],
  );
});

test('tokens preserve the approved dark and light reference contract', () => {
  const tokens = source('./tokens.css');
  for (const declaration of [
    '--bg: #0f0f10',
    '--surface: #1a1a1c',
    '--rail: #161617',
    '--rail-2: #121213',
    '--border: #2a2a2d',
    '--line-2: #222225',
    '--ink: #ededee',
    '--muted: #9a9a9e',
    '--accent: #e5b341',
    '--title-height: 38px',
    '--activity-width: 46px',
    '--tree-width: 228px',
    '--agent-width: 344px',
  ]) {
    assert.match(tokens.toLowerCase(), new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(tokens, /\[data-theme='light'\]/);
  for (const value of ['#fafaf8', '#ffffff', '#f1f0ea', '#eae9e1', '#111111', '#8a5e0a']) {
    assert.match(tokens.toLowerCase(), new RegExp(value));
  }
});

test('font sources are local, licensed, canonical, and free of stale duplicates', () => {
  const tokens = source('./tokens.css');
  assert.doesNotMatch(tokens, /https?:|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  for (const path of [
    '../../public/fonts/inter/Inter-Variable.ttf',
    '../../public/fonts/inter/Inter-Medium.ttf',
    '../../public/fonts/inter/OFL.txt',
    '../../public/fonts/source-serif-4/SourceSerif4-Variable.ttf',
    '../../public/fonts/source-serif-4/OFL.txt',
    '../../public/fonts/jetbrains-mono/JetBrainsMono-Variable.ttf',
    '../../public/fonts/jetbrains-mono/OFL.txt',
    '../../public/fonts/be-vietnam-pro/BeVietnamPro-Regular.ttf',
    '../../public/fonts/be-vietnam-pro/BeVietnamPro-Bold.ttf',
    '../../public/fonts/be-vietnam-pro/OFL.txt',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), true, path);
  }
  assert.equal(existsSync(new URL('../../public/Inter-Medium.ttf', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../Inter Font License.txt', import.meta.url)), false);
});

test('styles contain no remote fonts, transition-all, or hidden-only responsive panels', () => {
  const styles = ['./tokens.css', './shell.css', './graph.css', './chat.css', './dialog.css']
    .map(source)
    .join('\n');
  assert.doesNotMatch(styles, /https?:|fonts\.googleapis\.com|@import\s+url|transition:\s*all/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
