import type {
  ChatAction,
  ChatMessage,
  ChatState,
  ChatStreamEvent,
} from './chat-types';
import type { HistoryRecordDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';

export const CHAT_OUTPUT_LIMIT = 120_000;

export const initialChatState: ChatState = {
  requestId: null,
  conversationId: null,
  phase: 'idle',
  lastSeq: 0,
  messages: [],
  citations: [],
  usage: null,
  errorCode: '',
  semanticStatus: 'disabled',
  semanticWarning: '',
  lastQuestion: '',
};

export function chatStateForSession(
  state: ChatState,
  stateSessionKey: string,
  currentSessionKey: string,
): ChatState {
  return chatSessionChanged(stateSessionKey, currentSessionKey) ? initialChatState : state;
}

export function chatSessionChanged(
  stateSessionKey: string,
  currentSessionKey: string,
): boolean {
  return stateSessionKey !== currentSessionKey;
}

const terminalPhases = new Set<ChatState['phase']>(['completed', 'failed', 'cancelled']);

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'reset') {
    return { ...initialChatState, conversationId: action.conversationId ?? null };
  }
  if (action.type === 'load') {
    return action.state;
  }
  if (action.type === 'submit') {
    const text = action.text.trim();
    const userMessage: ChatMessage = {
      id: `${action.requestId}:user`,
      role: 'user',
      content: text,
      requestId: action.requestId,
    };
    return {
      ...state,
      requestId: action.requestId,
      conversationId: action.conversationId,
      phase: 'starting',
      lastSeq: 0,
      messages: action.retry ? removeAssistantAttempt(state.messages) : [...state.messages, userMessage],
      citations: [],
      usage: null,
      errorCode: '',
      semanticWarning: '',
      lastQuestion: text,
    };
  }

  return reduceEvent(state, action.event);
}

function reduceEvent(state: ChatState, event: ChatStreamEvent): ChatState {
  if (
    !state.requestId
    || event.requestId !== state.requestId
    || event.conversationId !== state.conversationId
    || !Number.isSafeInteger(event.seq)
    || event.seq <= state.lastSeq
    || terminalPhases.has(state.phase)
  ) {
    return state;
  }

  const semanticStatus = event.semantic?.status || state.semanticStatus;
  const semanticWarning = event.semantic?.warning || state.semanticWarning;
  const common = { lastSeq: event.seq, semanticStatus, semanticWarning };

  switch (event.kind) {
    case 'started':
      return { ...state, ...common, phase: 'streaming' };
    case 'delta':
      return {
        ...state,
        ...common,
        phase: 'streaming',
        messages: appendAssistantDelta(state.messages, state.requestId, event.delta || ''),
      };
    case 'citation':
      return event.citation
        ? {
            ...state,
            ...common,
            citations: appendUniqueCitation(state.citations, { ...event.citation, requestId: event.requestId }),
          }
        : { ...state, ...common };
    case 'usage':
      return { ...state, ...common, usage: event.usage || state.usage };
    case 'completed':
      return { ...state, ...common, phase: 'completed' };
    case 'failed':
      return { ...state, ...common, phase: 'failed', errorCode: event.errorCode || 'chat_failed' };
    case 'cancelled':
      return { ...state, ...common, phase: 'cancelled', errorCode: event.errorCode || 'cancelled' };
    default:
      return state;
  }
}

export function chatStateFromHistory(
  records: HistoryRecordDTO[],
  conversationId: string,
): ChatState {
  const messages: ChatMessage[] = [];
  const citations: ChatState['citations'] = [];
  for (const record of records) {
    if (record.userMessage) {
      messages.push({
        id: `${record.attemptId}:user`,
        role: 'user',
        content: record.userMessage,
        requestId: record.attemptId,
      });
    }
    if (record.assistantOutput) {
      messages.push({
        id: `${record.attemptId}:assistant`,
        role: 'assistant',
        content: record.assistantOutput.slice(0, CHAT_OUTPUT_LIMIT),
        requestId: record.attemptId,
      });
    }
    for (const citation of record.citations || []) {
      citations.push({
        modelId: citation.label,
        citationId: citation.id,
        path: '',
        heading: citation.label,
        start: 0,
        end: 0,
        requestId: record.attemptId,
      });
    }
  }
  const latest = records.length > 0 ? records[records.length - 1] : undefined;
  const phase = historyPhase(latest?.status);
  return {
    ...initialChatState,
    conversationId,
    requestId: latest?.attemptId || null,
    phase,
    messages,
    citations,
    errorCode: latest?.errorCode || '',
    lastQuestion: [...messages].reverse().find((message) => message.role === 'user')?.content || '',
  };
}

function appendAssistantDelta(messages: ChatMessage[], requestId: string, delta: string): ChatMessage[] {
  const assistantIndex = messages.findIndex(
    (message) => message.role === 'assistant' && message.requestId === requestId,
  );
  if (assistantIndex === -1) {
    return [
      ...messages,
      {
        id: `${requestId}:assistant`,
        role: 'assistant',
        content: delta.slice(0, CHAT_OUTPUT_LIMIT),
        requestId,
      },
    ];
  }
  const next = messages.slice();
  const assistant = next[assistantIndex];
  next[assistantIndex] = {
    ...assistant,
    content: `${assistant.content}${delta}`.slice(0, CHAT_OUTPUT_LIMIT),
  };
  return next;
}

function appendUniqueCitation(
  citations: ChatState['citations'],
  citation: NonNullable<ChatStreamEvent['citation']>,
) {
  if (citations.some((current) => current.citationId === citation.citationId)) {
    return citations;
  }
  return [...citations, citation];
}

function historyPhase(status?: string): ChatState['phase'] {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'idle';
}

function removeAssistantAttempt(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex === -1 ? [] : messages.slice(0, lastUserIndex + 1);
}
