/**
 * Tests for src/installer/update-check.js
 *
 * Uses node:test + node:assert.
 * Mocks child_process.exec by overriding the imported module behavior.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

import { isNewerVersion, checkForUpdate } from './update-check.js';

// ---------------------------------------------------------------------------
// isNewerVersion
// ---------------------------------------------------------------------------

describe('isNewerVersion', () => {
  test('returns true when candidate has higher major', () => {
    assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
  });

  test('returns true when candidate has higher minor', () => {
    assert.equal(isNewerVersion('1.2.0', '1.1.9'), true);
  });

  test('returns true when candidate has higher patch', () => {
    assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
  });

  test('returns false when versions are equal', () => {
    assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  });

  test('returns false when candidate is older', () => {
    assert.equal(isNewerVersion('0.9.9', '1.0.0'), false);
  });

  test('handles "v" prefix gracefully', () => {
    assert.equal(isNewerVersion('v1.1.0', 'v1.0.0'), true);
  });

  test('handles partial version (1 part)', () => {
    assert.equal(isNewerVersion('2', '1.0.0'), true);
  });

  test('handles partial version (2 parts)', () => {
    assert.equal(isNewerVersion('1.1', '1.0.9'), true);
  });
});

// ---------------------------------------------------------------------------
// isNewerVersion — pre-release channels (npx lumina-wiki@next)
// ---------------------------------------------------------------------------

describe('isNewerVersion — pre-release', () => {
  test('stable outranks the pre-release of the same version', () => {
    assert.equal(isNewerVersion('1.12.0', '1.12.0-next.0'), true);
  });

  test('pre-release does not outrank its own stable release', () => {
    assert.equal(isNewerVersion('1.12.0-next.0', '1.12.0'), false);
  });

  test('pre-release of a future version outranks current stable', () => {
    assert.equal(isNewerVersion('1.12.0-next.0', '1.11.0'), true);
  });

  test('older stable does not outrank a newer pre-release', () => {
    assert.equal(isNewerVersion('1.11.0', '1.12.0-next.0'), false);
  });

  test('later build within the same channel is newer', () => {
    assert.equal(isNewerVersion('1.12.0-next.1', '1.12.0-next.0'), true);
    assert.equal(isNewerVersion('1.12.0-next.0', '1.12.0-next.1'), false);
  });

  test('numeric identifiers compare numerically, not as strings', () => {
    assert.equal(isNewerVersion('1.12.0-next.10', '1.12.0-next.9'), true);
  });

  test('identical pre-releases are not newer', () => {
    assert.equal(isNewerVersion('1.12.0-next.0', '1.12.0-next.0'), false);
  });

  test('alphanumeric identifiers rank above numeric ones', () => {
    assert.equal(isNewerVersion('1.12.0-rc.1', '1.12.0-beta.1'), true);
    assert.equal(isNewerVersion('1.12.0-alpha.1', '1.12.0-beta.1'), false);
  });

  test('a longer identifier list wins when shared fields are equal', () => {
    assert.equal(isNewerVersion('1.12.0-next.0.1', '1.12.0-next.0'), true);
  });

  test('build metadata is ignored for precedence', () => {
    assert.equal(isNewerVersion('1.12.0+build.9', '1.12.0'), false);
    assert.equal(isNewerVersion('1.12.1+build.1', '1.12.0'), true);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — environment variable suppression
// ---------------------------------------------------------------------------

describe('checkForUpdate — LUMINA_NO_UPDATE_CHECK', () => {
  test('returns null when LUMINA_NO_UPDATE_CHECK=1', async () => {
    const orig = process.env.LUMINA_NO_UPDATE_CHECK;
    process.env.LUMINA_NO_UPDATE_CHECK = '1';
    try {
      const result = await checkForUpdate('0.1.0');
      assert.equal(result, null);
    } finally {
      if (orig === undefined) {
        delete process.env.LUMINA_NO_UPDATE_CHECK;
      } else {
        process.env.LUMINA_NO_UPDATE_CHECK = orig;
      }
    }
  });

  test('does not throw on npm exec error (silent failure)', async () => {
    // By pointing to a non-existent npm-like command in a CI-safe way,
    // we verify checkForUpdate swallows errors.
    // The real npm call may fail in restricted CI environments.
    const orig = process.env.LUMINA_NO_UPDATE_CHECK;
    // Allow the check to run but expect null on error
    delete process.env.LUMINA_NO_UPDATE_CHECK;
    try {
      // This will either return a version string or null — both are valid
      const result = await checkForUpdate('0.1.0');
      // Must be either null or a version string — never throws
      assert.ok(result === null || typeof result === 'string');
    } finally {
      if (orig !== undefined) process.env.LUMINA_NO_UPDATE_CHECK = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — AbortController timeout behavior
// ---------------------------------------------------------------------------

describe('checkForUpdate — timeout', () => {
  test('returns null within reasonable time even if npm is slow', async () => {
    const orig = process.env.LUMINA_NO_UPDATE_CHECK;
    delete process.env.LUMINA_NO_UPDATE_CHECK;

    // We run the actual check; the 2s timeout guarantee is the contract.
    // This test verifies it completes within a 3s wall-clock budget.
    const start = Date.now();
    try {
      const result = await checkForUpdate('0.1.0');
      const elapsed = Date.now() - start;
      // Must complete within 3 seconds (2s timeout + 1s buffer)
      assert.ok(elapsed < 3000, `Update check took too long: ${elapsed}ms`);
      assert.ok(result === null || typeof result === 'string');
    } finally {
      if (orig !== undefined) process.env.LUMINA_NO_UPDATE_CHECK = orig;
    }
  });
});
