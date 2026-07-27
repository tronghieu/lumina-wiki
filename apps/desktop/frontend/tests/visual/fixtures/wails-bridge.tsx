import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../../../src/app.css';
import { AppShell } from '../../../src/app/app-shell';
import { WelcomeScreen } from '../../../src/features/workspace/welcome-screen';

type ShellProps = React.ComponentProps<typeof AppShell>;

const deterministicShell: ShellProps = {
  accessMode: 'read-write',
  actionState: {
    kind: 'success',
    title: 'Library ready',
    message: 'Lumina Demo · 4 notes, 2 relationships',
  },
  activationLabel: null,
  aiSession: { sessionId: 'visual-session', generation: 1 },
  canChat: true,
  cancellingChat: false,
  chat: {
    requestId: 'visual-request',
    conversationId: 'visual-conversation',
    phase: 'completed',
    lastSeq: 5,
    messages: [
      { id: 'message-user', role: 'user', content: 'What connects these notes?', requestId: 'visual-request' },
      {
        id: 'message-agent',
        role: 'assistant',
        content: 'The project overview links the research map to the implementation notes.',
        requestId: 'visual-request',
      },
    ],
    citations: [{
      modelId: '1',
      citationId: 'citation-1',
      path: 'wiki/project-overview.md',
      heading: 'Project overview',
      start: 0,
      end: 96,
      requestId: 'visual-request',
    }],
    usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
    errorCode: '',
    semanticStatus: 'ready',
    semanticWarning: '',
    lastQuestion: 'What connects these notes?',
  },
  graph: {
    nodes: [
      { id: 'overview', title: 'Project overview', type: 'concept', path: 'project-overview.md', preview: 'Project map' },
      { id: 'research', title: 'Research map', type: 'source', path: 'research-map.md', preview: 'Sources' },
      { id: 'implementation', title: 'Implementation notes', type: 'concept', path: 'implementation-notes.md', preview: 'Build notes' },
      { id: 'glossary', title: 'Glossary', type: 'concept', path: 'glossary.md', preview: 'Terms' },
    ],
    edges: [
      { from: 'overview', type: 'related_to', to: 'research' },
      { from: 'overview', type: 'related_to', to: 'implementation' },
    ],
  },
  history: [],
  historyBusy: false,
  historyEnabled: true,
  libraryLabel: 'Lumina Demo',
  librarySummary: { notes: 4, documents: 3, relationships: 2 },
  noteState: {
    kind: 'loaded',
    path: 'project-overview.md',
    content: '# Project overview\n\nA deterministic note used only by the browser test fixture.',
  },
  query: '',
  selectedNodeId: 'overview',
  restoredFocus: 'graph',
  workspaceTree: [{
    id: 'wiki',
    name: 'wiki',
    path: 'wiki',
    kind: 'directory',
    children: [
      { id: 'overview-file', name: 'project-overview.md', path: 'wiki/project-overview.md', kind: 'file', size: 96 },
      { id: 'research-file', name: 'research-map.md', path: 'wiki/research-map.md', kind: 'file', size: 72 },
    ],
  }],
  onCancelChat: () => {},
  onCitation: async () => true,
  onDeleteAllHistory: () => {},
  onDeleteHistory: () => {},
  onLoadHistory: () => {},
  onNewChat: () => {},
  onOpenLibrary: () => {},
  onProfilesChange: () => {},
  onQueryChange: () => {},
  onRefreshGraph: () => {},
  onRefreshHistory: () => {},
  onRetryChat: () => {},
  onSelectNode: () => {},
  onSubmitChat: () => true,
  onToggleHistory: () => {},
  onWorkspaceFocusChange: () => {},
};

function VisualFixture(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const mode = new URLSearchParams(window.location.search).get('view');
  if (mode === 'welcome' || mode === 'recovery' || mode === 'current-recovery') {
    return (
      <WelcomeScreen
        busy={false}
        currentLibraryLabel={mode === 'current-recovery' ? 'Lumina Demo' : undefined}
        notice={null}
        recentLibraries={mode === 'welcome' ? [{
          workspaceId: 'workspace-recent',
          label: 'Research notes',
          activatedAt: '2026-07-27T09:00:00Z',
          status: 'available',
          focus: 'graph',
        }, {
          workspaceId: 'workspace-missing',
          label: 'Reading library',
          activatedAt: '2026-07-26T09:00:00Z',
          status: 'unavailable',
          focus: 'note',
        }] : []}
        recovery={mode === 'recovery' || mode === 'current-recovery' ? {
          recoveryId: 'recovery-1',
          libraryLabel: 'Lumina Library',
          message: 'Creation was interrupted before this library opened.',
        } : null}
        onCreate={() => {}}
        onOpen={() => {}}
        onRemoveRecovery={() => {}}
        onRetryRecovery={() => {}}
        onReturnToLibrary={mode === 'current-recovery' ? () => {} : undefined}
        onRestoreRecent={() => {}}
        onFindRecent={() => {}}
        onRemoveRecent={() => {}}
        onClearRecentActivity={() => {}}
      />
    );
  }

  const empty = mode === 'empty';
  return (
    <AppShell
      {...deterministicShell}
      activationLabel={mode === 'activation' ? 'Opening your library…' : null}
      restoredFocus={mode === 'focus-note'
        ? 'note'
        : mode === 'focus-chat'
          ? 'chat'
          : 'graph'}
      graph={empty ? { nodes: [], edges: [] } : deterministicShell.graph}
      librarySummary={empty ? { notes: 0, documents: 0, relationships: 0 } : deterministicShell.librarySummary}
      noteState={empty ? {
        kind: 'idle',
        path: '',
        content: 'Select a note to read it here.',
      } : deterministicShell.noteState}
      query={query}
      selectedNodeId={empty ? '' : deterministicShell.selectedNodeId}
      workspaceTree={empty ? [] : deterministicShell.workspaceTree}
      onQueryChange={setQuery}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<VisualFixture />);
