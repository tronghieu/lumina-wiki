import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abortIfStalePrepared,
  resolveActivationHistoryEnabled,
} from './workspace-activation.ts';

describe('workspace activation lifecycle', () => {
  it('never carries A history enablement into a normal B activation', () => {
    assert.equal(resolveActivationHistoryEnabled({
      previousEnabled: true,
      continuityStatus: null,
      backendEnabled: false,
    }), false);
    assert.equal(resolveActivationHistoryEnabled({
      previousEnabled: true,
      continuityStatus: null,
      backendEnabled: true,
    }), true);
    assert.equal(resolveActivationHistoryEnabled({
      previousEnabled: true,
      continuityStatus: 'off',
      backendEnabled: true,
    }), false);
    assert.equal(resolveActivationHistoryEnabled({
      previousEnabled: false,
      continuityStatus: 'empty',
      backendEnabled: false,
    }), true);
    assert.equal(resolveActivationHistoryEnabled({
      previousEnabled: false,
      continuityStatus: 'loaded',
      backendEnabled: false,
    }), true);
  });

  it('aborts a stale prepared token exactly once without committing it', async () => {
    let resolveOld;
    const oldPrepare = new Promise((resolve) => {
      resolveOld = resolve;
    });
    let currentGeneration = 1;
    const aborted = [];
    const committed = [];
    const oldAttempt = oldPrepare.then(async (prepared) => {
      if (await abortIfStalePrepared(
        prepared,
        1,
        () => currentGeneration,
        async (token) => aborted.push(token),
      )) {
        return;
      }
      committed.push(prepared.preparationToken);
    });

    currentGeneration = 2;
    await Promise.reject(new Error('newer prepare rejected before backend entry')).catch(() => {});
    resolveOld({ preparationToken: 'stale-preparation' });
    await oldAttempt;

    assert.deepEqual(aborted, ['stale-preparation']);
    assert.deepEqual(committed, []);
  });
});
