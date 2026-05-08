/**
 * Pin user-cancellation exit code: every cancellation path in the
 * interactive prompts must call process.exit(4), not exit(0).
 *
 * Pre-v1.3 behavior was process.exit(0) (silent success), preventing CI
 * scripts from distinguishing "completed install" from "user cancelled".
 * Owner decision in issue #4: introduce code 4 = user cancelled.
 *
 * This test is static — it reads prompts.js and asserts the source
 * contains no exit(0) call inside an isCancel block. Spawn-based SIGINT
 * tests proved flaky across TTY/non-TTY runners.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROMPTS_PATH = join(__dirname, '..', 'src', 'installer', 'prompts.js');

test('every cancellation site in prompts.js exits with code 4', () => {
  const src = readFileSync(PROMPTS_PATH, 'utf8');

  // Find every line that emits process.exit(...) and tag whether it's
  // inside or after an isCancel(...) check. The grouping window is loose
  // — anything within 5 lines of an isCancel reference counts.
  const lines = src.split('\n');
  let lastIsCancelLine = -10;
  const exitsToCheck = [];

  for (let i = 0; i < lines.length; i++) {
    if (/\bisCancel\s*\(/.test(lines[i])) lastIsCancelLine = i;
    const m = lines[i].match(/process\.exit\((\d+)\)/);
    if (m && i - lastIsCancelLine <= 5) {
      exitsToCheck.push({ line: i + 1, code: Number(m[1]), src: lines[i].trim() });
    }
  }

  assert.ok(exitsToCheck.length >= 7, `expected at least 7 cancellation sites; found ${exitsToCheck.length}`);

  const wrong = exitsToCheck.filter(e => e.code !== 4);
  assert.deepEqual(
    wrong, [],
    `cancellation sites must use process.exit(4), found:\n${wrong.map(e => `  ${PROMPTS_PATH}:${e.line}: ${e.src}`).join('\n')}`,
  );
});

test('docstring on promptForInstall references exit(4)', () => {
  const src = readFileSync(PROMPTS_PATH, 'utf8');
  assert.match(
    src,
    /Calls process\.exit\(4\)/,
    'top-level docstring must document the exit(4) cancellation contract',
  );
});
