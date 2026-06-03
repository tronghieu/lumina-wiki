import { linkedNodeSelectionId, linkedNodes } from './graph-data';
import type { CheckResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';
import type { WorkspaceSummary } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/models';
import type { KnowledgeGraph } from './graph-types';
import type { NoteContentState } from './note-content';
import {
  formatCheckDetails,
  formatWorkspaceMissingFolders,
  formatWorkspacePacks,
  type WorkspaceActionState,
} from '../workspace/workspace-actions';

type NodeInspectorProps = {
  actionState: WorkspaceActionState;
  graph: KnowledgeGraph;
  lastCheckResult: CheckResult | null;
  noteState: NoteContentState;
  selectedNodeId: string;
  sourcePath: string;
  workspaceLabel: string;
  workspaceSummary: WorkspaceSummary | null;
  workspaceRoot: string;
  onChooseSourcePath: () => void;
  onChooseWorkspace: () => void;
  onImportSource: () => void;
  onRefreshGraph: () => void;
  onRunCheck: () => void;
  onSelectNode: (nodeId: string) => void;
  onSourcePathChange: (path: string) => void;
  onWorkspaceRootChange: (path: string) => void;
};

export function NodeInspector({
  actionState,
  graph,
  lastCheckResult,
  noteState,
  selectedNodeId,
  sourcePath,
  workspaceLabel,
  workspaceSummary,
  workspaceRoot,
  onChooseSourcePath,
  onChooseWorkspace,
  onImportSource,
  onRefreshGraph,
  onRunCheck,
  onSelectNode,
  onSourcePathChange,
  onWorkspaceRootChange,
}: NodeInspectorProps) {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0];
  const links = selectedNode ? linkedNodes(graph, selectedNode.id) : [];
  const checkDetails = lastCheckResult ? formatCheckDetails(lastCheckResult) : null;

  return (
    <aside className="agent-panel" aria-label="Agent panel">
      <header className="agent-panel-header">
        <div>
          <h2>Agent Panel</h2>
          <span>{selectedNode?.path ?? 'Select a node'}</span>
        </div>
      </header>

      <div className="agent-panel-scroll">
        {selectedNode && (
          <>
            <section className="agent-card selected-context">
              <span className="type-pill">{selectedNode.type}</span>
              <h3>{selectedNode.title}</h3>
              <p>{selectedNode.preview}</p>
            </section>

            <section className="agent-card action-panel">
              <h3>Workspace</h3>
              <p className="workspace-label">{workspaceLabel}</p>
              <input
                aria-label="Workspace root"
                onChange={(event) => onWorkspaceRootChange(event.target.value)}
                placeholder="Workspace root path"
                value={workspaceRoot}
              />
              <input
                aria-label="Source file path"
                onChange={(event) => onSourcePathChange(event.target.value)}
                placeholder="Source file path"
                value={sourcePath}
              />
              <div className="action-buttons">
                <button type="button" onClick={onChooseWorkspace}>Open</button>
                <button type="button" onClick={onRefreshGraph}>Refresh</button>
                <button type="button" onClick={onChooseSourcePath}>Source</button>
                <button type="button" onClick={onRunCheck}>Check</button>
                <button type="button" onClick={onImportSource}>Import</button>
              </div>
              <div className={`action-result ${actionState.kind}`}>
                <strong>{actionState.title}</strong>
                <span>{actionState.message}</span>
              </div>
              {workspaceSummary && (
                <div className="workspace-inventory">
                  <span>Packs</span>
                  <strong>{formatWorkspacePacks(workspaceSummary)}</strong>
                  <span>Folders</span>
                  <strong>{formatWorkspaceMissingFolders(workspaceSummary)}</strong>
                </div>
              )}
            </section>

          <section className={`note-card ${noteState.kind}`}>
            <h3>Note Content</h3>
            <span>{noteState.path || selectedNode.path}</span>
            <pre>{noteState.content}</pre>
          </section>

          <section className="agent-card linked-list">
            <h3>Linked Nodes</h3>
            {links.length === 0 && <p>No linked nodes.</p>}
            {links.map((node) => (
              <button key={node.id} type="button" onClick={() => onSelectNode(linkedNodeSelectionId(node))}>
                <strong>{node.title}</strong>
                <span>{node.type} / {node.path}</span>
              </button>
            ))}
          </section>

          {checkDetails && (
            <section className="agent-card check-card">
              <h3>Check Details</h3>
              <div className="check-summary-grid">
                <span>Status</span>
                <strong>{checkDetails.status}</strong>
                <span>Exit</span>
                <strong>{checkDetails.exitCode}</strong>
                <span>Counts</span>
                <strong>{checkDetails.counts}</strong>
              </div>
              <div className="check-list">
                {(checkDetails.byCheck.length ? checkDetails.byCheck : ['No check-specific issues.']).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <CheckOutput title="Stdout" value={checkDetails.stdout} />
              <CheckOutput title="Stderr" value={checkDetails.stderr} />
            </section>
          )}
          </>
        )}
      </div>

    </aside>
  );
}

function CheckOutput({ title, value }: { title: string; value: string }) {
  return (
    <div className="check-output">
      <span>{title}</span>
      <pre>{value}</pre>
    </div>
  );
}
