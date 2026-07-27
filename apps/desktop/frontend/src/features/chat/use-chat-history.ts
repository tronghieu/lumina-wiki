import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DeleteAllHistory,
  DeleteHistory,
  ListHistory,
  LoadHistory,
  SetHistoryEnabled,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service';
import type {
  HistoryMetadataDTO,
  SessionReferenceDTO,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import { chatStateFromHistory } from './chat-state';
import type { ChatState } from './chat-types';
import { createSessionRequestGuard } from '../shared/session-request-guard';

export function useChatHistory(
  session: SessionReferenceDTO | null,
  historyEnabled: boolean,
  setHistoryEnabled: (enabled: boolean) => void,
  loadChatState: (state: ChatState) => void,
) {
  const requestGuard = useMemo(createSessionRequestGuard, []);
  const sessionKey = requestGuard.setSession(session);
  const [historyState, setHistoryState] = useState<{
    sessionKey: string;
    conversations: HistoryMetadataDTO[];
  }>({ sessionKey, conversations: [] });
  const [historyBusy, setHistoryBusy] = useState(false);
  const [partialDeleteCount, setPartialDeleteCount] = useState(0);
  const history = historyState.sessionKey === sessionKey ? historyState.conversations : [];

  useEffect(() => {
    setHistoryState({ sessionKey, conversations: [] });
    setHistoryBusy(false);
    setPartialDeleteCount(0);
  }, [sessionKey]);

  const refreshHistory = useCallback(async () => {
    if (!session) {
      setHistoryState({ sessionKey, conversations: [] });
      return;
    }
    const request = requestGuard.begin();
    setHistoryBusy(true);
    try {
      const result = await ListHistory(session);
      if (requestGuard.isCurrent(request)) {
        setHistoryState({ sessionKey, conversations: result.conversations });
      }
    } catch {
      if (requestGuard.isCurrent(request)) {
        setHistoryState({ sessionKey, conversations: [] });
      }
    } finally {
      if (requestGuard.isCurrent(request)) setHistoryBusy(false);
    }
  }, [requestGuard, session, sessionKey]);

  async function loadHistory(conversationId: string) {
    if (!session) return;
    const request = requestGuard.begin();
    setHistoryBusy(true);
    try {
      const records = await LoadHistory({ session, conversationId });
      if (requestGuard.isCurrent(request)) {
        loadChatState(chatStateFromHistory(records.records, conversationId));
      }
    } finally {
      if (requestGuard.isCurrent(request)) setHistoryBusy(false);
    }
  }

  async function deleteHistory(conversationId: string) {
    if (!session) return;
    const request = requestGuard.begin();
    setHistoryBusy(true);
    try {
      await DeleteHistory({ session, conversationId });
      if (requestGuard.isCurrent(request)) await refreshHistory();
    } finally {
      if (requestGuard.isCurrent(request)) setHistoryBusy(false);
    }
  }

  async function deleteAllHistory() {
    if (!session) return;
    const request = requestGuard.begin();
    setHistoryBusy(true);
    try {
      const result = await DeleteAllHistory(session);
      if (requestGuard.isCurrent(request)) {
        setHistoryState((current) => ({
          sessionKey,
          conversations: current.sessionKey === sessionKey
            ? current.conversations.filter((item) => result.remainingIds.includes(item.conversationId))
            : [],
        }));
        setPartialDeleteCount(result.durable ? 0 : result.remainingIds.length);
      }
    } finally {
      if (requestGuard.isCurrent(request)) setHistoryBusy(false);
    }
  }

  async function toggleHistory() {
    if (!session) return;
    const request = requestGuard.begin();
    setHistoryBusy(true);
    try {
      const result = await SetHistoryEnabled({ session, enabled: !historyEnabled });
      if (requestGuard.isCurrent(request)) setHistoryEnabled(result.enabled);
    } finally {
      if (requestGuard.isCurrent(request)) setHistoryBusy(false);
    }
  }

  return {
    deleteAllHistory,
    deleteHistory,
    history,
    historyBusy: historyState.sessionKey === sessionKey && historyBusy,
    loadHistory,
    partialDeleteCount: historyState.sessionKey === sessionKey ? partialDeleteCount : 0,
    refreshHistory,
    toggleHistory,
  };
}
