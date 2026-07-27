import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  beginWorkspaceAttempt,
  initialWorkspaceScreenState,
  reduceWorkspaceScreen,
} from './welcome-state.ts';

const emptyLibrary = {
  libraryLabel: 'Lumina Library',
  accessMode: 'read-write',
  summary: { notes: 0, documents: 0, relationships: 0 },
  graph: { nodes: [], edges: [] },
  tree: [],
  warnings: [],
  session: { sessionId: 'session-a', generation: 1 },
};

describe('welcome-state', () => {
  it('boots to Welcome with an optional safe recovery card', () => {
    const recovery = {
      recoveryId: 'opaque-recovery',
      libraryLabel: 'Lumina Library',
      message: 'Creation was interrupted before this library opened.',
    };
    assert.deepEqual(
      reduceWorkspaceScreen(initialWorkspaceScreenState, { type: 'boot-welcome', recovery }),
      {
        kind: 'welcome',
        nextAttemptGeneration: 1,
        previousLibrary: null,
        recovery,
        notice: null,
      },
    );
  });

  it('boots directly to one ready state without a Welcome transition', () => {
    assert.deepEqual(
      reduceWorkspaceScreen(initialWorkspaceScreenState, { type: 'boot-ready', library: emptyLibrary }),
      {
        kind: 'ready',
        nextAttemptGeneration: 1,
        library: emptyLibrary,
        recovery: null,
        notice: null,
      },
    );
  });

  it('keeps the current library mounted behind an activation veil', () => {
    const ready = reduceWorkspaceScreen(
      initialWorkspaceScreenState,
      { type: 'boot-ready', library: emptyLibrary },
    );
    const pending = beginWorkspaceAttempt(ready, 'open');

    assert.equal(pending.kind, 'activating');
    assert.equal(pending.previousLibrary, emptyLibrary);
    assert.equal(pending.returnTo, 'ready');
    assert.equal(pending.attempt.generation, 1);
    assert.equal(pending.attempt.kind, 'open');
  });

  it('returns to the prior library after cancellation or failure', () => {
    const ready = reduceWorkspaceScreen(
      initialWorkspaceScreenState,
      { type: 'boot-ready', library: emptyLibrary },
    );
    const pending = beginWorkspaceAttempt(ready, 'open');

    assert.deepEqual(
      reduceWorkspaceScreen(pending, {
        type: 'attempt-cancelled',
        generation: 1,
      }),
      {
        kind: 'ready',
        nextAttemptGeneration: 2,
        library: emptyLibrary,
        recovery: null,
        notice: null,
      },
    );

    assert.deepEqual(
      reduceWorkspaceScreen(pending, {
        type: 'attempt-failed',
        generation: 1,
        notice: 'That library could not be opened. Your current library is unchanged.',
      }),
      {
        kind: 'ready',
        nextAttemptGeneration: 2,
        library: emptyLibrary,
        recovery: null,
        notice: 'That library could not be opened. Your current library is unchanged.',
      },
    );
  });

  it('atomically replaces the prior library and ignores late attempt results', () => {
    const libraryB = {
      ...emptyLibrary,
      libraryLabel: 'Library B',
      session: { sessionId: 'session-b', generation: 2 },
    };
    const ready = reduceWorkspaceScreen(
      initialWorkspaceScreenState,
      { type: 'boot-ready', library: emptyLibrary },
    );
    const first = beginWorkspaceAttempt(ready, 'open');
    const second = beginWorkspaceAttempt(first, 'create');

    assert.equal(second.kind, 'activating');
    assert.equal(second.attempt.generation, 2);
    assert.equal(
      reduceWorkspaceScreen(second, {
        type: 'attempt-committed',
        generation: 1,
        library: libraryB,
      }),
      second,
    );
    assert.deepEqual(
      reduceWorkspaceScreen(second, {
        type: 'attempt-committed',
        generation: 2,
        library: libraryB,
      }),
      {
        kind: 'ready',
        nextAttemptGeneration: 3,
        library: libraryB,
        recovery: null,
        notice: null,
      },
    );
  });

  it('returns a committed-but-not-active creation to one recovery card', () => {
    const pending = beginWorkspaceAttempt(
      reduceWorkspaceScreen(initialWorkspaceScreenState, { type: 'boot-welcome', recovery: null }),
      'create',
    );
    const recovery = {
      recoveryId: 'opaque-recovery',
      libraryLabel: 'Lumina Library',
      message: 'Creation was interrupted before this library opened.',
    };

    assert.deepEqual(reduceWorkspaceScreen(pending, {
      type: 'attempt-failed',
      generation: 1,
      notice: 'The library was created but could not be opened.',
      recovery,
    }), {
      kind: 'welcome',
      nextAttemptGeneration: 2,
      previousLibrary: null,
      recovery,
      notice: 'The library was created but could not be opened.',
    });
  });

  it('retains a committed-but-not-active recovery while the current library stays ready', () => {
    const recovery = {
      recoveryId: 'opaque-recovery',
      libraryLabel: 'Library B',
      message: 'Creation was interrupted before this library opened.',
    };
    const ready = reduceWorkspaceScreen(
      initialWorkspaceScreenState,
      { type: 'boot-ready', library: emptyLibrary },
    );
    const pending = beginWorkspaceAttempt(ready, 'create');
    const failed = reduceWorkspaceScreen(pending, {
      type: 'attempt-failed',
      generation: 1,
      notice: 'The new library was created but could not be opened.',
      recovery,
    });

    assert.deepEqual(failed, {
      kind: 'ready',
      nextAttemptGeneration: 2,
      library: emptyLibrary,
      recovery,
      notice: 'The new library was created but could not be opened.',
    });
    assert.deepEqual(reduceWorkspaceScreen(failed, { type: 'show-welcome' }), {
      kind: 'welcome',
      nextAttemptGeneration: 2,
      previousLibrary: emptyLibrary,
      recovery,
      notice: null,
    });
  });

  it('returns a cancelled Welcome action to Welcome while preserving the current library', () => {
    const ready = reduceWorkspaceScreen(
      initialWorkspaceScreenState,
      { type: 'boot-ready', library: emptyLibrary },
    );
    const welcome = reduceWorkspaceScreen(ready, { type: 'show-welcome' });
    const pending = beginWorkspaceAttempt(welcome, 'open');

    assert.deepEqual(
      reduceWorkspaceScreen(pending, { type: 'attempt-cancelled', generation: 1 }),
      {
        kind: 'welcome',
        nextAttemptGeneration: 2,
        previousLibrary: emptyLibrary,
        recovery: null,
        notice: null,
      },
    );
    assert.deepEqual(reduceWorkspaceScreen(welcome, { type: 'return-to-ready' }), {
      kind: 'ready',
      nextAttemptGeneration: 1,
      library: emptyLibrary,
      recovery: null,
      notice: null,
    });
  });

  it('removes recovery without discarding the current library', () => {
    const recovery = {
      recoveryId: 'opaque-recovery',
      libraryLabel: 'Library B',
      message: 'Creation was interrupted before this library opened.',
    };
    const readyWithRecovery = {
      kind: 'ready',
      nextAttemptGeneration: 2,
      library: emptyLibrary,
      recovery,
      notice: null,
    };

    assert.deepEqual(
      reduceWorkspaceScreen(readyWithRecovery, {
        type: 'recovery-removed',
        recoveryId: recovery.recoveryId,
      }),
      { ...readyWithRecovery, recovery: null },
    );
  });
});
