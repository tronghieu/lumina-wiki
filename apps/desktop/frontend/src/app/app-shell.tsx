import { GraphView } from '../features/graph/graph-view';
import { NodeInspector } from '../features/graph/node-inspector';
import type { KnowledgeGraph } from '../features/graph/graph-types';
import type { WorkspaceActionState } from '../features/workspace/workspace-actions';

const navItems = ['Home', 'Graph', 'Chat', 'Nodes', 'Media', 'Settings'];
const recentItems = ['AI Social Impact', 'Privacy Brief', 'Research Notes', 'Reading Map'];
const favoriteItems = ['Ethics', 'Privacy', 'Education', 'Ada Lovelace'];

type AppShellProps = {
  actionState: WorkspaceActionState;
  graph: KnowledgeGraph;
  query: string;
  selectedNodeId: string;
  sourcePath: string;
  workspaceRoot: string;
  onImportSource: () => void;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onLoadWorkspace: () => void;
  onQueryChange: (query: string) => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
  onSourcePathChange: (path: string) => void;
  onWorkspaceRootChange: (path: string) => void;
};

export function AppShell({
  actionState,
  graph,
  query,
  selectedNodeId,
  sourcePath,
  workspaceRoot,
  onImportSource,
  onChooseSourcePath,
  onChooseWorkspace,
  onLoadWorkspace,
  onQueryChange,
  onRunCheck,
  onSelectNode,
  onSourcePathChange,
  onWorkspaceRootChange,
}: AppShellProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  const workspaceLabel = workspaceRoot || 'Sample graph';

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span>Lumina Wiki</span>
        </div>
        <button className="primary-action" type="button">New Chat</button>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button className={item === 'Graph' ? 'nav-item active' : 'nav-item'} key={item} type="button">
              <span className="nav-dot" />
              {item}
            </button>
          ))}
        </nav>
        <SidebarSection title="Recent Chats" items={recentItems} />
        <SidebarSection title="Favorite Nodes" items={favoriteItems} />
        <div className="workspace-card">
          <div className="avatar">LH</div>
          <div>
            <strong>tronghieu</strong>
            <span>Local Workspace</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Graph / {workspaceRoot ? 'Loaded workspace' : 'Sample graph'}</p>
            <h1>
              Knowledge Graph <span>{graph.nodes.length} nodes</span>
            </h1>
          </div>
          <div className="toolbar">
            <button type="button" onClick={onChooseWorkspace}>Open Workspace</button>
            <button type="button" onClick={onRunCheck}>Run Check</button>
            <button type="button" onClick={onImportSource}>Import</button>
            <input
              aria-label="Search nodes"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search nodes..."
              value={query}
            />
          </div>
        </header>
        <GraphView graph={graph} query={query} selectedNodeId={selectedNode?.id ?? ''} onSelectNode={onSelectNode} />
      </section>

      <NodeInspector
        actionState={actionState}
        graph={graph}
        selectedNodeId={selectedNode?.id ?? ''}
        sourcePath={sourcePath}
        workspaceRoot={workspaceRoot}
        workspaceLabel={workspaceLabel}
        onChooseSourcePath={onChooseSourcePath}
        onChooseWorkspace={onChooseWorkspace}
        onImportSource={onImportSource}
        onLoadWorkspace={onLoadWorkspace}
        onRunCheck={onRunCheck}
        onSourcePathChange={onSourcePathChange}
        onWorkspaceRootChange={onWorkspaceRootChange}
      />
    </main>
  );
}

function SidebarSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="sidebar-section">
      <h2>{title}</h2>
      {items.map((item) => (
        <button className="sidebar-link" key={item} type="button">{item}</button>
      ))}
    </section>
  );
}
