import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./welcome-screen.tsx', import.meta.url), 'utf8');
const renderedSource = source.slice(source.indexOf('  return ('));
const visibleCopy = [...renderedSource.matchAll(/>\s*([^<>{}\n]+?)\s*</g)]
  .map((match) => match[1].trim())
  .filter((text) => /^[A-Z]/.test(text))
  .join('\n');

test('Welcome offers Create, Open, and safe recovery actions in plain language', () => {
  assert.match(source, />\s*Create library\s*</);
  assert.match(source, />\s*Open existing library\s*</);
  assert.match(source, />\s*Retry\s*</);
  assert.match(source, />\s*Remove from this list\s*</);
  assert.doesNotMatch(visibleCopy, /\b(workspace|root|schema|runtime|raw|CLI|Check|Import)\b/i);
});

test('Welcome exposes status and labels its library name field', () => {
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Library name/);
  assert.match(source, /aria-busy=\{busy\}/);
});

test('Welcome can return explicitly to the current library', () => {
  assert.match(source, /currentLibraryLabel/);
  assert.match(source, /onReturnToLibrary/);
  assert.match(source, />\s*Return to current library\s*</);
});

test('Welcome offers bounded recent actions and visible native-confirmed clearing', () => {
  for (const text of ['Recent libraries', 'Restore', 'Find again', 'Remove', 'Clear recent activity']) {
    assert.match(source, new RegExp(`>\\s*${text}\\s*<`));
  }
  assert.doesNotMatch(visibleCopy, /\b(root|path|backend|reset)\b/i);
});
