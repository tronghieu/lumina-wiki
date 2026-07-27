import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createChatRequest } from './chat-request.ts';

describe('chat request construction', () => {
  it('links a retry to the prior attempt without changing the question', () => {
    const request = createChatRequest({
      session: { sessionId: 'session-a', generation: 2 },
      requestId: 'request-b',
      conversationId: 'conversation-a',
      question: 'Why?',
      chatProfileId: 'chat-main',
      historyEnabled: true,
      retryOfAttemptId: 'request-a',
    });

    assert.equal(request.retryOfAttemptId, 'request-a');
    assert.equal(request.requestId, 'request-b');
    assert.equal(request.question, 'Why?');
  });

  it('omits retry linkage for a new root turn', () => {
    const request = createChatRequest({
      session: { sessionId: 'session-a', generation: 2 },
      requestId: 'request-a',
      conversationId: 'conversation-a',
      question: 'Why?',
      chatProfileId: 'chat-main',
      historyEnabled: false,
    });

    assert.equal('retryOfAttemptId' in request, false);
  });
});
