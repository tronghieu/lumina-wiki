import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startChat } from './use-chat-stream.ts';

const request = {
  session: { sessionId: 'session-a', generation: 2 },
  requestId: 'request-a',
  conversationId: 'conversation-a',
  question: 'Why?',
  profiles: { chatProfileId: 'chat-main' },
  history: { include: true, persist: true },
};

function createBridge({ chat = () => Promise.resolve({}), cancel = () => Promise.resolve() } = {}) {
  let listener;
  let unsubscribeCount = 0;
  const calls = [];
  return {
    bridge: {
      onStream(callback) {
        calls.push('subscribe');
        listener = callback;
        return () => {
          unsubscribeCount += 1;
          listener = undefined;
        };
      },
      chat(value) {
        calls.push('chat');
        return chat(value);
      },
      cancelChat(session, requestId) {
        calls.push('cancel');
        return cancel(session, requestId);
      },
    },
    emit(event, session = request.session) {
      listener?.({ session, event });
    },
    calls,
    unsubscribeCount: () => unsubscribeCount,
    listening: () => Boolean(listener),
  };
}

function streamEvent(kind, seq = 1, overrides = {}) {
  return {
    kind,
    seq,
    requestId: request.requestId,
    conversationId: request.conversationId,
    ...overrides,
  };
}

describe('use-chat-stream lifecycle', () => {
  it('subscribes synchronously before calling Chat and retains an early delta', () => {
    const source = createBridge();
    const received = [];
    startChat(source.bridge, request, (event) => received.push(event));
    source.emit(streamEvent('delta', 1, { delta: 'first' }));
    source.emit(streamEvent('completed', 2));
    assert.deepEqual(source.calls.slice(0, 2), ['subscribe', 'chat']);
    assert.equal(received[0].delta, 'first');
  });

  it('filters envelopes by loaded session and request identity', () => {
    const source = createBridge();
    const received = [];
    startChat(source.bridge, request, (event) => received.push(event));
    source.emit(streamEvent('delta'), { sessionId: 'other', generation: 2 });
    source.emit({ ...streamEvent('delta'), requestId: 'other' });
    source.emit(streamEvent('delta', 3, { delta: 'kept' }));
    source.emit(streamEvent('completed', 4));
    assert.deepEqual(received.filter((event) => event.kind === 'delta').map((event) => event.delta), ['kept']);
  });

  it('keeps the listener after the binding rejects until a terminal event arrives', async () => {
    const source = createBridge({ chat: () => Promise.reject(new Error('binding failed')) });
    const received = [];
    const controller = startChat(source.bridge, request, (event) => received.push(event), {
      terminalTimeoutMs: 1_000,
    });
    await controller.binding;
    assert.equal(source.listening(), true);
    source.emit(streamEvent('failed', 2, { errorCode: 'provider_error' }));
    await controller.done;
    assert.equal(source.unsubscribeCount(), 1);
    assert.equal(received.at(-1).kind, 'failed');
  });

  it('requests cancellation once and waits for the authoritative terminal', async () => {
    const source = createBridge();
    const controller = startChat(source.bridge, request, () => {}, { terminalTimeoutMs: 1_000 });
    await Promise.all([controller.cancel(), controller.cancel()]);
    assert.equal(source.calls.filter((call) => call === 'cancel').length, 1);
    assert.equal(source.listening(), true);
    source.emit(streamEvent('cancelled', 2));
    await controller.done;
    assert.equal(source.unsubscribeCount(), 1);
  });

  it('cleans up once after a lost terminal timeout', async () => {
    let timeoutCallback;
    const source = createBridge();
    const timeouts = [];
    const controller = startChat(source.bridge, request, () => {}, {
      terminalTimeoutMs: 10,
      setTimer(callback) {
        timeoutCallback = callback;
        timeouts.push('set');
        return 1;
      },
      clearTimer() {
        timeouts.push('clear');
      },
    });
    await controller.cancel();
    timeoutCallback();
    await controller.done;
    controller.dispose();
    assert.equal(source.unsubscribeCount(), 1);
    assert.deepEqual(timeouts, ['set', 'clear']);
  });

  it('starts bounded cleanup even when the cancel binding never settles', async () => {
    let timeoutCallback;
    const source = createBridge({ cancel: () => new Promise(() => {}) });
    const controller = startChat(source.bridge, request, () => {}, {
      terminalTimeoutMs: 10,
      setTimer(callback) {
        timeoutCallback = callback;
        return 1;
      },
      clearTimer() {},
    });

    void controller.cancel();
    assert.equal(typeof timeoutCallback, 'function');
    timeoutCallback();
    await controller.done;
    assert.equal(source.unsubscribeCount(), 1);
  });
});
