import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { HistoryMetadataDTO } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import type { WorkspaceActionState } from '../workspace/workspace-actions';
import type { ChatCitation, ChatState } from './chat-types';

type AgentPanelProps = {
  chat: ChatState;
  canChat: boolean;
  cancelling: boolean;
  historyEnabled: boolean;
  history: HistoryMetadataDTO[];
  historyBusy: boolean;
  contextLabel: string;
  workspaceStatus: WorkspaceActionState;
  onCancel: () => void;
  onCitation: (citation: ChatCitation) => void;
  onClose: () => void;
  onDeleteHistory: (conversationId: string) => void;
  onDeleteAllHistory: () => void;
  onLoadHistory: (conversationId: string) => void;
  onNewChat: () => void;
  onRefreshHistory: () => void;
  onRetry: () => void;
  onSubmit: (text: string) => boolean;
  onToggleHistory: () => void;
};

export function AgentPanel({
  chat,
  canChat,
  cancelling,
  historyEnabled,
  history,
  historyBusy,
  contextLabel,
  workspaceStatus,
  onCancel,
  onCitation,
  onClose,
  onDeleteHistory,
  onDeleteAllHistory,
  onLoadHistory,
  onNewChat,
  onRefreshHistory,
  onRetry,
  onSubmit,
  onToggleHistory,
}: AgentPanelProps) {
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const active = chat.phase === 'starting' || chat.phase === 'streaming';
  const retryable = chat.phase === 'failed' || chat.phase === 'cancelled';

  useEffect(() => {
    if (historyOpen) onRefreshHistory();
  }, [historyOpen, onRefreshHistory]);

  useEffect(() => {
    if (confirmClear) confirmClearRef.current?.focus();
  }, [confirmClear]);

  useEffect(() => {
    if (pendingDelete) confirmDeleteRefs.current.get(pendingDelete)?.focus();
  }, [pendingDelete]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !canChat || active) return;
    if (onSubmit(text)) {
      setDraft('');
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <aside className="agent-panel" id="agent-panel" aria-label="Agent panel">
      <header className="agent-panel-header">
        <button type="button" aria-label="Close Agent panel" onClick={onClose}>›</button>
        <div>
          <h2>{historyOpen ? 'History' : 'Agent'}</h2>
          <span>{historyOpen ? (historyEnabled ? 'Saved for this library' : 'History is off') : contextLabel}</span>
        </div>
        {historyOpen ? (
          <button type="button" onClick={() => setHistoryOpen(false)}>Back</button>
        ) : (
          <button type="button" disabled={active} onClick={() => setHistoryOpen(true)}>History</button>
        )}
      </header>

      {historyOpen ? (
        <div className="agent-history" aria-busy={historyBusy}>
          <div className="history-controls">
            <button type="button" disabled={active || historyBusy} onClick={onToggleHistory}>
              Turn history {historyEnabled ? 'off' : 'on'}
            </button>
            {confirmClear ? (
              <>
            <button ref={confirmClearRef} type="button" disabled={historyBusy} onClick={() => {
                  onDeleteAllHistory();
                  setConfirmClear(false);
                }}>Clear recent activity</button>
                <button type="button" onClick={() => setConfirmClear(false)}>Keep history</button>
              </>
            ) : (
              <button type="button" disabled={active || historyBusy || history.length === 0} onClick={() => setConfirmClear(true)}>
                Clear recent activity
              </button>
            )}
          </div>
          {history.length === 0 && <p>No saved conversations.</p>}
          {history.map((conversation) => (
            <article key={conversation.conversationId}>
              <div>
                <strong>{conversation.latestStatus}</strong>
                <span>{conversation.attempts} attempt{conversation.attempts === 1 ? '' : 's'}</span>
              </div>
              <button
                type="button"
                aria-label={`Open ${conversation.latestStatus} conversation ${conversation.conversationId}`}
                disabled={active || historyBusy}
                onClick={() => onLoadHistory(conversation.conversationId)}
              >
                Open
              </button>
              {pendingDelete === conversation.conversationId ? (
                <>
                  <button
                    ref={(element) => {
                      if (element) confirmDeleteRefs.current.set(conversation.conversationId, element);
                      else confirmDeleteRefs.current.delete(conversation.conversationId);
                    }}
                    type="button"
                    aria-label={`Confirm delete conversation ${conversation.conversationId}`}
                    disabled={historyBusy}
                    onClick={() => {
                    onDeleteHistory(conversation.conversationId);
                    setPendingDelete('');
                    }}
                  >
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setPendingDelete('')}>Keep</button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete conversation ${conversation.conversationId}`}
                  disabled={active || historyBusy}
                  onClick={() => setPendingDelete(conversation.conversationId)}
                >
                  Delete
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="agent-toolbar">
            <button type="button" disabled={active} onClick={onNewChat}>New chat</button>
            <span role="status" aria-label={`${workspaceStatus.title}: ${workspaceStatus.message}`}>
              {workspaceStatus.title}
            </span>
            <span>{semanticLabel(chat.semanticStatus, chat.semanticWarning)}</span>
          </div>
          <div className="agent-messages" aria-busy={active}>
            {chat.messages.length === 0 && (
              <p className="agent-empty">
                {canChat ? 'Ask about this library.' : 'Open a library and configure chat in Advanced settings.'}
              </p>
            )}
            {chat.messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role}`}>
                <span>{message.role === 'user' ? 'You' : 'Agent'}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {chat.citations.length > 0 && (
              <div className="chat-citations" aria-label="Answer citations">
                {chat.citations.map((citation) => (
                  <button
                    key={citation.citationId}
                    type="button"
                    aria-label={`Open citation ${citation.modelId}: ${citation.heading || 'cited note'}`}
                    onClick={() => onCitation(citation)}
                  >
                    [{citation.modelId}]
                  </button>
                ))}
              </div>
            )}
            <div className={`chat-terminal ${chat.phase}`} aria-live="polite">
              {chatStatus(chat, cancelling)}
              {retryable && <button type="button" onClick={onRetry}>Retry</button>}
            </div>
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <textarea
              ref={composerRef}
              aria-label="Chat input"
              disabled={!canChat || active}
              placeholder="Ask about this library"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKey}
            />
            {active ? (
              <button type="button" disabled={cancelling} onClick={onCancel}>
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : (
              <button type="submit" disabled={!canChat || !draft.trim()}>Send</button>
            )}
          </form>
        </>
      )}
    </aside>
  );
}

function semanticLabel(status: string, warning: string): string {
  if (status === 'ready' || status === 'active') return 'Semantic search';
  if (status === 'fallback' || warning) return 'Library text search';
  return 'Library search';
}

function chatStatus(chat: ChatState, cancelling: boolean): string {
  if (cancelling) return 'Cancelling…';
  if (chat.phase === 'starting' || chat.phase === 'streaming') return 'Generating';
  if (chat.phase === 'completed') return 'Answer complete';
  if (chat.phase === 'cancelled') return 'Cancelled';
  if (chat.phase === 'failed') return chat.errorCode || 'Chat failed';
  return '';
}
