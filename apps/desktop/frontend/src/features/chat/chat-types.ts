export type ChatPhase = 'idle' | 'starting' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export type ChatCitation = {
  modelId: string;
  citationId: string;
  path: string;
  heading: string;
  start: number;
  end: number;
  requestId?: string;
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  requestId: string;
};

export type ChatStreamEvent = {
  kind: 'started' | 'delta' | 'citation' | 'usage' | 'completed' | 'failed' | 'cancelled';
  requestId: string;
  conversationId: string;
  seq: number;
  delta?: string;
  citation?: ChatCitation;
  usage?: ChatUsage;
  errorCode?: string;
  semantic?: {
    status: string;
    warning?: string;
  };
};

export type ChatEventEnvelope = {
  session: {
    sessionId: string;
    generation: number;
  };
  event: ChatStreamEvent;
};

export type ChatState = {
  requestId: string | null;
  conversationId: string | null;
  phase: ChatPhase;
  lastSeq: number;
  messages: ChatMessage[];
  citations: ChatCitation[];
  usage: ChatUsage | null;
  errorCode: string;
  semanticStatus: string;
  semanticWarning: string;
  lastQuestion: string;
};

export type ChatAction =
  | {
      type: 'submit';
      requestId: string;
      conversationId: string;
      text: string;
      retry?: boolean;
    }
  | { type: 'event'; event: ChatStreamEvent }
  | { type: 'reset'; conversationId?: string | null }
  | { type: 'load'; state: ChatState };
