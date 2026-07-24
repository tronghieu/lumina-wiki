import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSessionRequestGuard,
  sessionIdentity,
} from './session-request-guard.ts';

describe('session request guard', () => {
  it('invalidates older requests when a newer request starts', () => {
    const guard = createSessionRequestGuard();
    guard.setSession({ sessionId: 'session-a', generation: 1 });
    const first = guard.begin();
    const second = guard.begin();

    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
  });

  it('invalidates in-flight work synchronously when the session changes', () => {
    const guard = createSessionRequestGuard();
    guard.setSession({ sessionId: 'session-a', generation: 1 });
    const prior = guard.begin();
    guard.setSession({ sessionId: 'session-b', generation: 2 });

    assert.equal(guard.isCurrent(prior), false);
    assert.equal(sessionIdentity(null), 'no-session');
    assert.equal(sessionIdentity({ sessionId: 'session-b', generation: 2 }), 'session-b:2');
  });
});
