import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SessionReferenceDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import {
  chatSessionChanged,
  chatStateForSession,
  initialChatState,
  reduceChat,
} from './chat-state';
import { wailsChatBridge } from './chat-bridge';
import { createChatRequest } from './chat-request';
import type { ChatState } from './chat-types';
import { sessionIdentity } from '../shared/session-request-guard';
import {
  startChat,
  type ChatBridge,
  type ChatBridgeRequest,
  type ChatStreamController,
} from './use-chat-stream';

type UseChatOptions = {
  bridge?: ChatBridge;
  session: SessionReferenceDTO | null;
  chatProfileId: string;
  embeddingProfileId?: string;
  historyEnabled: boolean;
  selectedPath?: string;
  linkedPaths?: string[];
};

export function useChat({
  bridge = wailsChatBridge,
  session,
  chatProfileId,
  embeddingProfileId,
  historyEnabled,
  selectedPath,
  linkedPaths,
}: UseChatOptions) {
  const sessionKey = sessionIdentity(session);
  const [state, dispatch] = useReducer(reduceChat, initialChatState);
  const [cancelling, setCancelling] = useState(false);
  const controllerRef = useRef<ChatStreamController | null>(null);
  const cancellingRef = useRef(false);
  const stateRef = useRef<ChatState>(state);
  const stateSessionKeyRef = useRef(sessionKey);
  stateRef.current = state;
  const visibleState = chatStateForSession(state, stateSessionKeyRef.current, sessionKey);

  const reset = useCallback((conversationId: string | null = null) => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    setCancelling(false);
    cancellingRef.current = false;
    stateSessionKeyRef.current = sessionKey;
    dispatch({ type: 'reset', conversationId });
  }, [sessionKey]);

  useEffect(() => {
    if (chatSessionChanged(stateSessionKeyRef.current, sessionKey)) reset();
  }, [reset, sessionKey]);

  useEffect(() => () => {
    controllerRef.current?.dispose();
  }, []);

  const begin = useCallback((text: string, retry = false): boolean => {
    if (!session || !chatProfileId || !text.trim()) return false;
    const sessionChanged = chatSessionChanged(stateSessionKeyRef.current, sessionKey);
    const activeState = chatStateForSession(stateRef.current, stateSessionKeyRef.current, sessionKey);
    if (activeState.phase === 'starting' || activeState.phase === 'streaming') return false;
    if (sessionChanged) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setCancelling(false);
      cancellingRef.current = false;
      stateSessionKeyRef.current = sessionKey;
      dispatch({ type: 'reset', conversationId: null });
    }
    const retryOfAttemptId = retry ? activeState.requestId ?? undefined : undefined;
    const requestId = createEventID('req');
    const conversationId = activeState.conversationId || createEventID('conv');
    const request: ChatBridgeRequest = createChatRequest({
      session,
      requestId,
      conversationId,
      retryOfAttemptId,
      question: text.trim(),
      chatProfileId,
      embeddingProfileId,
      historyEnabled,
      selectedPath,
      linkedPaths,
    });
    stateSessionKeyRef.current = sessionKey;
    dispatch({ type: 'submit', requestId, conversationId, text, retry });
    setCancelling(false);
    const controller = startChat(bridge, request, (event) => dispatch({ type: 'event', event }), {
      onTerminalTimeout() {
        const current = stateRef.current;
        dispatch({
          type: 'event',
          event: {
            kind: cancellingRef.current ? 'cancelled' : 'failed',
            requestId,
            conversationId,
            seq: Math.max(current.lastSeq + 1, 1),
            errorCode: cancellingRef.current ? 'cancelled' : 'stream_timeout',
          },
        });
      },
    });
    controllerRef.current = controller;
    void controller.done.then(() => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setCancelling(false);
        cancellingRef.current = false;
      }
    });
    return true;
  }, [
    bridge,
    cancelling,
    chatProfileId,
    embeddingProfileId,
    historyEnabled,
    linkedPaths,
    selectedPath,
    session,
    sessionKey,
  ]);

  const cancel = useCallback(() => {
    if (!controllerRef.current || cancelling) return;
    setCancelling(true);
    cancellingRef.current = true;
    void controllerRef.current.cancel().catch(() => {});
  }, [cancelling]);

  const retry = useCallback(() => begin(stateRef.current.lastQuestion, true), [begin]);

  return {
    state: visibleState,
    cancelling,
    submit: (text: string) => begin(text, false),
    cancel,
    retry,
    reset,
    loadState: (next: ChatState) => {
      stateSessionKeyRef.current = sessionKey;
      dispatch({ type: 'load', state: next });
    },
  };
}

function createEventID(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
    ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random}`.slice(0, 64);
}
