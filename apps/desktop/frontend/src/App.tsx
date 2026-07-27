import '@xyflow/react/dist/style.css';
import './app.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListAIProfiles,
  ReadCitationNote,
} from '../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service';
import { AppShell } from './app/app-shell';
import { useChatHistory } from './features/chat/use-chat-history';
import type { ChatCitation } from './features/chat/chat-types';
import { chatStateFromHistory } from './features/chat/chat-state';
import { useChat } from './features/chat/use-chat';
import { linkedNodes } from './features/graph/graph-data';
import {
  normalizeSettings,
  settingsForSession,
  type SettingsViewModel,
} from './features/settings/ai-settings';
import {
  createSessionRequestGuard,
  sessionIdentity,
} from './features/shared/session-request-guard';
import { useWorkspace } from './features/workspace/use-workspace';
import {
  WelcomeScreen,
  workspaceAttemptLabel,
} from './features/workspace/welcome-screen';

function App() {
  const workspace = useWorkspace();
  const profileRequestGuard = useMemo(createSessionRequestGuard, []);
  const citationRequestGuard = useMemo(createSessionRequestGuard, []);
  const activeSession = workspace.readyLibrary?.session ?? null;
  const activeSessionKey = sessionIdentity(activeSession);
  citationRequestGuard.setSession(activeSession);
  const [aiSettings, setAISettings] = useState<SettingsViewModel>(() => normalizeSettings({}));
  const [aiSettingsSessionKey, setAISettingsSessionKey] = useState('no-session');
  const activeAISettings = settingsForSession(aiSettings, aiSettingsSessionKey, activeSessionKey);
  const selectedNode = workspace.graph.nodes.find((node) => node.id === workspace.selectedNodeId);
  const chat = useChat({
    session: activeSession,
    chatProfileId: activeAISettings.chat.model ? activeAISettings.chat.id : '',
    embeddingProfileId: activeAISettings.semanticEnabled ? activeAISettings.embedding?.id : undefined,
    historyEnabled: workspace.historyEnabled,
    selectedPath: selectedNode?.path,
    linkedPaths: selectedNode
      ? linkedNodes(workspace.graph, selectedNode.id).map((node) => node.path)
      : [],
  });
  const history = useChatHistory(
    activeSession,
    workspace.historyEnabled,
    workspace.setHistoryEnabled,
    chat.loadState,
  );

  useEffect(() => {
    if (!workspace.restoredHistory) return;
    chat.loadState(chatStateFromHistory(
      workspace.restoredHistory.records,
      workspace.restoredHistory.conversationId,
    ));
    workspace.clearRestoredHistory();
  }, [chat.loadState, workspace.clearRestoredHistory, workspace.restoredHistory]);

  useEffect(() => {
    const request = profileRequestGuard.begin();
    void ListAIProfiles()
      .then((profiles) => {
        if (profileRequestGuard.isCurrent(request)) setAISettings(normalizeSettings(profiles));
      })
      .catch(() => {
        if (profileRequestGuard.isCurrent(request)) setAISettings(normalizeSettings({}));
      });
  }, [profileRequestGuard]);

  const updateAISettings = useCallback((settings: SettingsViewModel) => {
    profileRequestGuard.begin();
    setAISettings(settings);
    setAISettingsSessionKey(activeSessionKey);
  }, [activeSessionKey, profileRequestGuard]);

  useEffect(() => {
    if (history.partialDeleteCount > 0) {
      workspace.setActionState({
        kind: 'error',
        title: 'Recent activity partially cleared',
        message: `${history.partialDeleteCount} conversation(s) remain.`,
      });
    }
  }, [history.partialDeleteCount, workspace.setActionState]);

  async function openCitation(citation: ChatCitation): Promise<boolean> {
    const library = workspace.readyLibrary;
    if (!library || !citation.requestId) return false;
    const request = citationRequestGuard.begin();
    try {
      const note = await ReadCitationNote({
        session: library.session,
        requestId: citation.requestId,
        citationId: citation.citationId,
      });
      if (!citationRequestGuard.isCurrent(request)) return false;
      workspace.showCitationNote(note);
      workspace.setActionState({
        kind: 'success',
        title: 'Citation opened',
        message: note.heading || 'The cited note is ready.',
      });
      return true;
    } catch {
      if (!citationRequestGuard.isCurrent(request)) return false;
      workspace.setActionState({
        kind: 'error',
        title: 'Citation unavailable',
        message: 'This citation can no longer be opened.',
      });
      return false;
    }
  }

  if (
    workspace.screen.kind === 'booting'
    || (
      workspace.screen.kind === 'activating'
      && workspace.screen.attempt.kind === 'restore'
      && workspace.screen.previousLibrary === null
    )
  ) {
    return (
      <main className="boot-screen" aria-busy="true" aria-live="polite">
        <strong>Opening Lumina</strong>
        <span>Getting your library ready…</span>
      </main>
    );
  }

  if (workspace.screen.kind === 'welcome' || (
    workspace.screen.kind === 'activating' && workspace.screen.previousLibrary === null
  )) {
    const screen = workspace.screen;
    return (
      <WelcomeScreen
        busy={screen.kind === 'activating'}
        currentLibraryLabel={screen.previousLibrary?.libraryLabel}
        notice={screen.kind === 'welcome'
          ? screen.notice ?? workspace.recentNotice
          : workspace.recentNotice}
        recentLibraries={workspace.recentLibraries}
        recovery={screen.recovery}
        onCreate={workspace.createLibrary}
        onOpen={workspace.openLibrary}
        onRemoveRecovery={workspace.removeRecovery}
        onRetryRecovery={workspace.retryRecovery}
        onReturnToLibrary={screen.previousLibrary ? workspace.returnToReady : undefined}
        onRestoreRecent={workspace.restoreRecentLibrary}
        onFindRecent={workspace.findRecentLibrary}
        onRemoveRecent={workspace.removeRecentLibrary}
        onClearRecentActivity={workspace.clearRecentActivity}
      />
    );
  }

  const library = workspace.readyLibrary;
  if (!library) return null;

  return (
    <AppShell
      accessMode={library.accessMode}
      actionState={workspace.actionState}
      activationLabel={workspace.screen.kind === 'activating'
        ? workspaceAttemptLabel(workspace.screen.attempt.kind)
        : null}
      aiSession={activeSession}
      canChat={Boolean(activeAISettings.chat.model)}
      cancellingChat={chat.cancelling}
      chat={chat.state}
      graph={workspace.graph}
      history={history.history}
      historyBusy={history.historyBusy}
      historyEnabled={workspace.historyEnabled}
      libraryLabel={library.libraryLabel}
      librarySummary={library.summary}
      noteState={workspace.noteState}
      query={workspace.query}
      selectedNodeId={workspace.selectedNodeId}
      restoredFocus={workspace.restoredFocus}
      workspaceTree={library.tree}
      onCancelChat={chat.cancel}
      onCitation={openCitation}
      onDeleteAllHistory={history.deleteAllHistory}
      onDeleteHistory={history.deleteHistory}
      onLoadHistory={history.loadHistory}
      onNewChat={() => chat.reset()}
      onOpenLibrary={workspace.showWelcome}
      onProfilesChange={updateAISettings}
      onQueryChange={workspace.setQuery}
      onRefreshGraph={() => void workspace.refreshSnapshot()}
      onRefreshHistory={history.refreshHistory}
      onRetryChat={chat.retry}
      onSelectNode={workspace.selectNode}
      onSubmitChat={chat.submit}
      onToggleHistory={history.toggleHistory}
      onWorkspaceFocusChange={workspace.saveWorkspaceView}
    />
  );
}

export default App;
