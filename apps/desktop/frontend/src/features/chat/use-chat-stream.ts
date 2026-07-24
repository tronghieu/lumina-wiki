import type { ChatEventEnvelope, ChatStreamEvent } from './chat-types';

export type ChatBridgeRequest = {
  session: { sessionId: string; generation: number };
  requestId: string;
  conversationId: string;
  retryOfAttemptId?: string;
  question: string;
  profiles: { chatProfileId: string; embeddingProfileId?: string };
  history: { include: boolean; persist: boolean };
  selectedPath?: string;
  linkedPaths?: string[];
};

export interface ChatBridge {
  onStream(callback: (envelope: ChatEventEnvelope) => void): () => void;
  chat(request: ChatBridgeRequest): Promise<unknown>;
  cancelChat(
    session: ChatBridgeRequest['session'],
    requestId: string,
  ): Promise<void>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

type StartChatOptions = {
  terminalTimeoutMs?: number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onBindingError?: (error: unknown) => void;
  onTerminalTimeout?: () => void;
};

export type ChatStreamController = {
  binding: Promise<void>;
  done: Promise<void>;
  cancel(): Promise<void>;
  dispose(): void;
};

const terminalKinds = new Set<ChatStreamEvent['kind']>(['completed', 'failed', 'cancelled']);

export function startChat(
  bridge: ChatBridge,
  request: ChatBridgeRequest,
  dispatch: (event: ChatStreamEvent) => void,
  options: StartChatOptions = {},
): ChatStreamController {
  const terminalTimeoutMs = options.terminalTimeoutMs ?? 8_000;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let finished = false;
  let cancelRequested = false;
  let timeoutHandle: TimerHandle | null = null;
  let resolveDone = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const unsubscribe = bridge.onStream((envelope) => {
    if (
      envelope.session.sessionId !== request.session.sessionId
      || envelope.session.generation !== request.session.generation
      || envelope.event.requestId !== request.requestId
    ) {
      return;
    }
    dispatch(envelope.event);
    if (terminalKinds.has(envelope.event.kind)) {
      finish();
    }
  });

  let invocation: Promise<unknown>;
  try {
    invocation = bridge.chat(request);
  } catch (error) {
    invocation = Promise.reject(error);
  }
  const binding = Promise.resolve(invocation)
    .catch((error) => {
      options.onBindingError?.(error);
    })
    .then(() => {
      scheduleLostTerminalCleanup();
    });

  function finish() {
    if (finished) return;
    finished = true;
    if (timeoutHandle !== null) {
      clearTimer(timeoutHandle);
      timeoutHandle = null;
    }
    unsubscribe();
    resolveDone();
  }

  function scheduleLostTerminalCleanup() {
    if (finished || timeoutHandle !== null) return;
    timeoutHandle = setTimer(() => {
      options.onTerminalTimeout?.();
      finish();
    }, terminalTimeoutMs);
  }

  async function cancel() {
    if (finished || cancelRequested) return;
    cancelRequested = true;
    scheduleLostTerminalCleanup();
    await bridge.cancelChat(request.session, request.requestId);
  }

  return {
    binding,
    done,
    cancel,
    dispose() {
      if (finished) return;
      void cancel().catch(() => {});
    },
  };
}
