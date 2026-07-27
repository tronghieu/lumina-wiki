import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../../../src/app.css';
import { AppShell } from '../../../src/app/app-shell';

type ShellProps = React.ComponentProps<typeof AppShell>;

const deterministicShell: ShellProps = {
  actionState: {
    kind: 'success',
    title: 'Workspace loaded',
    message: '/fixtures/lumina-demo · 4 nodes, 2 edges',
  },
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
  noteState: {
    kind: 'loaded',
    path: 'project-overview.md',
    content: '# Project overview\n\nA deterministic note used only by the browser test fixture.',
  },
  query: '',
  selectedNodeId: 'overview',
  sourcePath: '',
  workspaceDraftRoot: '/fixtures/lumina-demo',
  workspaceRoot: '/fixtures/lumina-demo',
  workspaceSummary: {
    root: '/fixtures/lumina-demo',
    valid: true,
    packs: ['core', 'research'],
    wikiNotes: 12,
    rawSources: 4,
    rawNotes: 1,
    graphEdges: 18,
    graphCitations: 7,
    missingExpectedFolders: [],
  },
  workspaceTree: [
    { id: 'config', name: '_lumina', path: '_lumina', kind: 'directory', children: [] },
    { id: 'raw', name: 'raw', path: 'raw', kind: 'directory', children: [] },
    {
      id: 'wiki',
      name: 'wiki',
      path: 'wiki',
      kind: 'directory',
      children: [
        { id: 'overview-file', name: 'project-overview.md', path: 'wiki/project-overview.md', kind: 'file', size: 96 },
        { id: 'research-file', name: 'research-map.md', path: 'wiki/research-map.md', kind: 'file', size: 72 },
      ],
    },
  ],
  onActivateWorkspace: () => {},
  onCancelChat: () => {},
  onChooseSourcePath: () => {},
  onChooseWorkspace: () => {},
  onCitation: async () => true,
  onDeleteAllHistory: () => {},
  onDeleteHistory: () => {},
  onImportSource: () => {},
  onLoadHistory: () => {},
  onNewChat: () => {},
  onProfilesChange: () => {},
  onQueryChange: () => {},
  onRefreshGraph: () => {},
  onRefreshHistory: () => {},
  onRetryChat: () => {},
  onRunCheck: () => {},
  onSelectNode: () => {},
  onSourcePathChange: () => {},
  onSubmitChat: () => true,
  onToggleHistory: () => {},
  onWorkspaceRootChange: () => {},
};

function VisualFixture() {
  const [query, setQuery] = React.useState('');
  return React.createElement(AppShell, {
    ...deterministicShell,
    query,
    onQueryChange: setQuery,
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(React.createElement(VisualFixture));
