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

function App() {
  const workspace = useWorkspace();
  const profileRequestGuard = useMemo(createSessionRequestGuard, []);
  const citationRequestGuard = useMemo(createSessionRequestGuard, []);
  const activeSession = workspace.loadedWorkspace?.session ?? null;
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
        title: 'History partially cleared',
        message: `${history.partialDeleteCount} conversation(s) remain.`,
      });
    }
  }, [history.partialDeleteCount, workspace.setActionState]);

  async function openCitation(citation: ChatCitation): Promise<boolean> {
    const loaded = workspace.loadedWorkspace;
    if (!loaded || !citation.requestId) return false;
    const artifactRequest = workspace.beginArtifactRead();
    if (artifactRequest === null) return false;
    const request = citationRequestGuard.begin();
    try {
      const note = await ReadCitationNote({
        session: loaded.session,
        requestId: citation.requestId,
        citationId: citation.citationId,
      });
      if (!citationRequestGuard.isCurrent(request) || !workspace.isArtifactReadCurrent(artifactRequest)) return false;
      workspace.showCitationNote(note);
      workspace.setActionState({
        kind: 'success',
        title: 'Citation opened',
        message: note.heading || note.path,
      });
      return true;
    } catch {
      if (!citationRequestGuard.isCurrent(request) || !workspace.isArtifactReadCurrent(artifactRequest)) return false;
      workspace.setActionState({
        kind: 'error',
        title: 'Citation unavailable',
        message: 'This citation can no longer be opened.',
      });
      return false;
    }
  }

  return (
    <AppShell
      actionState={workspace.actionState}
      aiSession={activeSession}
      canChat={Boolean(workspace.loadedWorkspace && activeAISettings.chat.model)}
      cancellingChat={chat.cancelling}
      chat={chat.state}
      graph={workspace.graph}
      history={history.history}
      historyBusy={history.historyBusy}
      historyEnabled={workspace.historyEnabled}
      noteState={workspace.noteState}
      query={workspace.query}
      selectedNodeId={workspace.selectedNodeId}
      sourcePath={workspace.sourcePath}
      workspaceDraftRoot={workspace.draftWorkspaceRoot}
      workspaceRoot={workspace.loadedWorkspace?.root ?? ''}
      workspaceSummary={workspace.workspaceSummary}
      workspaceTree={workspace.workspaceTree}
      onActivateWorkspace={() => void workspace.activateWorkspace()}
      onCancelChat={chat.cancel}
      onChooseSourcePath={workspace.chooseSourcePath}
      onChooseWorkspace={workspace.chooseWorkspace}
      onCitation={openCitation}
      onDeleteAllHistory={history.deleteAllHistory}
      onDeleteHistory={history.deleteHistory}
      onImportSource={workspace.importSource}
      onLoadHistory={history.loadHistory}
      onNewChat={() => chat.reset()}
      onProfilesChange={updateAISettings}
      onQueryChange={workspace.setQuery}
      onRefreshGraph={workspace.refreshGraph}
      onRefreshHistory={history.refreshHistory}
      onRetryChat={chat.retry}
      onRunCheck={workspace.runCheck}
      onSelectNode={workspace.selectNode}
      onSourcePathChange={workspace.setSourcePath}
      onSubmitChat={chat.submit}
      onToggleHistory={history.toggleHistory}
      onWorkspaceRootChange={workspace.updateWorkspaceRoot}
    />
  );
}

export default App;
