import type { ChatBridgeRequest } from './use-chat-stream';

type ChatRequestInput = {
  session: ChatBridgeRequest['session'];
  requestId: string;
  conversationId: string;
  retryOfAttemptId?: string;
  question: string;
  chatProfileId: string;
  embeddingProfileId?: string;
  historyEnabled: boolean;
  selectedPath?: string;
  linkedPaths?: string[];
};

export function createChatRequest(input: ChatRequestInput): ChatBridgeRequest {
  return {
    session: input.session,
    requestId: input.requestId,
    conversationId: input.conversationId,
    ...(input.retryOfAttemptId ? { retryOfAttemptId: input.retryOfAttemptId } : {}),
    question: input.question.trim(),
    profiles: {
      chatProfileId: input.chatProfileId,
      ...(input.embeddingProfileId ? { embeddingProfileId: input.embeddingProfileId } : {}),
    },
    history: { include: input.historyEnabled, persist: input.historyEnabled },
    ...(input.selectedPath ? { selectedPath: input.selectedPath } : {}),
    ...(input.linkedPaths?.length ? { linkedPaths: input.linkedPaths } : {}),
  };
}
