import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createWorkspaceRequestGuard,
  friendlyWorkspaceFailure,
  idleActionState,
  libraryOpenedState,
  workspaceLoadCanceledState,
} from './workspace-actions.ts';

describe('workspace-actions', () => {
  it('uses friendly, path-free library status', () => {
    assert.deepEqual(idleActionState, {
      kind: 'idle',
      title: 'Library ready',
      message: 'Choose a note or ask about this library.',
    });
    assert.deepEqual(workspaceLoadCanceledState, {
      kind: 'idle',
      title: 'Library unchanged',
      message: 'Nothing was changed.',
    });
    assert.deepEqual(libraryOpenedState('Research notes', 2, 1), {
      kind: 'success',
      title: 'Library ready',
      message: 'Research notes · 2 notes, 1 relationship',
    });
  });

  it('never returns raw failures', () => {
    assert.equal(
      friendlyWorkspaceFailure('private-operating-system-message').message,
      'Lumina could not finish that action. Your current library is unchanged.',
    );
  });

  it('marks older requests stale when a newer one starts', () => {
    const guard = createWorkspaceRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
  });
});
