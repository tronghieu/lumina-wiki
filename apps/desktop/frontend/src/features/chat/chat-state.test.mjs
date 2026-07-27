import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAT_OUTPUT_LIMIT,
  chatSessionChanged,
  chatStateForSession,
  chatStateFromHistory,
  initialChatState,
  reduceChat,
} from './chat-state.ts';

function submitted(overrides = {}) {
  return reduceChat(initialChatState, {
    type: 'submit',
    requestId: 'req-1',
    conversationId: 'conv-1',
    text: 'Explain the graph',
    ...overrides,
  });
}

function event(kind, seq, overrides = {}) {
  return {
    kind,
    seq,
    requestId: 'req-1',
    conversationId: 'conv-1',
    ...overrides,
  };
}

describe('chat-state', () => {
  it('hides prior workspace messages before the reset effect commits', () => {
    const prior = {
      ...initialChatState,
      messages: [{ id: 'old', role: 'user', content: 'private workspace text' }],
    };

    assert.deepEqual(chatStateForSession(prior, 'session-a:1', 'session-b:2'), initialChatState);
    assert.equal(chatStateForSession(prior, 'session-a:1', 'session-a:1'), prior);
    assert.equal(chatSessionChanged('session-a:1', 'session-b:2'), true);
    assert.equal(chatSessionChanged('session-a:1', 'session-a:1'), false);
  });

  it('starts with the real user message and no assistant placeholder', () => {
    const state = submitted();
    assert.equal(state.phase, 'starting');
    assert.deepEqual(state.messages.map(({ role, content }) => ({ role, content })), [
      { role: 'user', content: 'Explain the graph' },
    ]);
  });

  it('accepts only strictly increasing events for the active request', () => {
    let state = submitted();
    state = reduceChat(state, { type: 'event', event: event('started', 1) });
    state = reduceChat(state, { type: 'event', event: event('delta', 3, { delta: 'B' }) });
    state = reduceChat(state, { type: 'event', event: event('delta', 2, { delta: 'A' }) });
    state = reduceChat(state, { type: 'event', event: event('delta', 3, { delta: 'duplicate' }) });
    state = reduceChat(state, {
      type: 'event',
      event: { ...event('delta', 4, { delta: 'stale' }), requestId: 'req-old' },
    });
    assert.equal(state.lastSeq, 3);
    assert.equal(state.messages.at(-1).content, 'B');
  });

  it('keeps exactly one assistant message while deltas stream', () => {
    let state = submitted();
    state = reduceChat(state, { type: 'event', event: event('delta', 1, { delta: 'Hello ' }) });
    state = reduceChat(state, { type: 'event', event: event('delta', 2, { delta: 'world' }) });
    assert.equal(state.phase, 'streaming');
    assert.deepEqual(state.messages.map((message) => message.role), ['user', 'assistant']);
    assert.equal(state.messages[1].content, 'Hello world');
  });

  it('caps rendered output while preserving terminal state', () => {
    let state = submitted();
    state = reduceChat(state, {
      type: 'event',
      event: event('delta', 1, { delta: 'x'.repeat(CHAT_OUTPUT_LIMIT + 20) }),
    });
    state = reduceChat(state, { type: 'event', event: event('completed', 2) });
    assert.equal(state.messages.at(-1).content.length, CHAT_OUTPUT_LIMIT);
    assert.equal(state.phase, 'completed');
  });

  it('records citations, usage, semantic fallback, and stable error codes', () => {
    let state = submitted();
    state = reduceChat(state, {
      type: 'event',
      event: event('citation', 1, {
        citation: {
          modelId: 'S1',
          citationId: 'cit-1',
          path: 'wiki/a.md',
          heading: 'A',
          start: 0,
          end: 3,
        },
        semantic: { status: 'fallback', warning: 'index_stale' },
      }),
    });
    state = reduceChat(state, {
      type: 'event',
      event: event('usage', 2, {
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      }),
    });
    state = reduceChat(state, {
      type: 'event',
      event: event('failed', 3, { errorCode: 'provider_error' }),
    });
    assert.equal(state.citations.length, 1);
    assert.equal(state.usage.totalTokens, 3);
    assert.equal(state.semanticStatus, 'fallback');
    assert.equal(state.semanticWarning, 'index_stale');
    assert.equal(state.errorCode, 'provider_error');
  });

  it('ignores every event after the first terminal event', () => {
    let state = submitted();
    state = reduceChat(state, { type: 'event', event: event('cancelled', 1) });
    state = reduceChat(state, { type: 'event', event: event('completed', 2) });
    state = reduceChat(state, { type: 'event', event: event('delta', 3, { delta: 'late' }) });
    assert.equal(state.phase, 'cancelled');
    assert.equal(state.lastSeq, 1);
    assert.equal(state.messages.length, 1);
  });

  it('retries without duplicating the user message', () => {
    const failed = reduceChat(submitted(), {
      type: 'event',
      event: event('failed', 1, { errorCode: 'provider_error' }),
    });
    const retry = reduceChat(failed, {
      type: 'submit',
      requestId: 'req-2',
      conversationId: 'conv-1',
      text: 'Explain the graph',
      retry: true,
    });
    assert.equal(retry.messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(retry.requestId, 'req-2');
    assert.equal(retry.errorCode, '');
  });

  it('reset clears request data and can retain a chosen conversation', () => {
    const reset = reduceChat(submitted(), { type: 'reset', conversationId: 'conv-2' });
    assert.deepEqual(reset, { ...initialChatState, conversationId: 'conv-2' });
  });

  it('loads only real backend history records and keeps opaque citation ids', () => {
    const loaded = chatStateFromHistory([{
      conversationId: 'conv-1',
      attemptId: 'attempt-1',
      status: 'completed',
      userMessage: 'Question',
      assistantOutput: 'Answer',
      citations: [{ id: 'citation-1', label: 'S1' }],
      usage: { inputTokens: 1, outputTokens: 1 },
    }], 'conv-1');
    assert.deepEqual(loaded.messages.map(({ role, content }) => ({ role, content })), [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ]);
    assert.equal(loaded.citations[0].citationId, 'citation-1');
    assert.equal(loaded.citations[0].requestId, 'attempt-1');
  });
});
