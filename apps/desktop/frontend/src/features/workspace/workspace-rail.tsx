import { useMemo, useState } from 'react';
import { normalizeWorkspaceTree, type WorkspaceTreeItem, type WorkspaceTreeNode } from './workspace-tree-data';
import type { ThemePreference } from '../../app/theme-preference';

type WorkspaceRailProps = {
  open: boolean;
  selectedPath: string;
  workspaceLabel: string;
  workspaceTree: WorkspaceTreeNode[];
  theme: ThemePreference;
  onClose: () => void;
  onOpen: () => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onSelectGraph: () => void;
  onSelectPath: (path: string) => void;
  onToggleTheme: () => void;
};

export function WorkspaceRail({
  open,
  selectedPath,
  workspaceLabel,
  workspaceTree,
  theme,
  onClose,
  onOpen,
  onOpenSettings,
  onOpenLibrary,
  onSelectGraph,
  onSelectPath,
  onToggleTheme,
}: WorkspaceRailProps) {
  const groups = useMemo(() => normalizeWorkspaceTree(workspaceTree), [workspaceTree]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['wiki']));

  function togglePath(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <aside className={open ? 'workspace-rail open' : 'workspace-rail'} aria-label="Library navigation">
      <div className="activity-rail">
        <button className="activity-button active" type="button" aria-label="Graph view" onClick={onSelectGraph}>
          <GraphIcon />
        </button>
        <button
          className="activity-button"
          type="button"
          aria-label={open ? 'Close library notes' : 'Open library notes'}
          aria-controls="workspace-tree-panel"
          aria-expanded={open}
          onClick={open ? onClose : onOpen}
        >
          <FilesIcon />
        </button>
        <div className="activity-rail-spacer" />
        <button
          className="activity-button"
          type="button"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          onClick={onToggleTheme}
        >
          <ThemeIcon theme={theme} />
        </button>
        <button className="activity-button" type="button" aria-label="Settings" onClick={onOpenSettings}>
          <SettingsIcon />
        </button>
      </div>
      {open && (
        <div className="workspace-tree-panel" id="workspace-tree-panel">
          <header>
            <strong>Library</strong>
            <button type="button" aria-label="Close library notes" aria-expanded={open} onClick={onClose}>‹</button>
          </header>
          <nav className="workspace-tree" aria-label="Library notes">
            {groups.length === 0 && <p>No notes yet.</p>}
            {groups.map((group) => (
              <TreeRow
                expandedPaths={expandedPaths}
                key={group.id}
                node={group}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onToggle={togglePath}
              />
            ))}
          </nav>
          <button className="workspace-switcher" type="button" title={workspaceLabel} onClick={onOpenLibrary}>
            <span aria-hidden="true">‹›</span>
            <span>
              <strong>{workspaceLabel}</strong>
              <small>Switch library</small>
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}

function TreeRow({
  expandedPaths,
  node,
  selectedPath,
  onSelectPath,
  onToggle,
}: {
  expandedPaths: Set<string>;
  node: WorkspaceTreeItem;
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const directory = node.kind === 'directory';
  const expanded = directory && expandedPaths.has(node.path);
  const selectable = !directory && node.path.startsWith('wiki/') && node.path.endsWith('.md');

  return (
    <div className="tree-branch">
      {directory || selectable ? (
        <button
          className={node.path === selectedPath ? 'tree-row selected' : 'tree-row'}
          type="button"
          aria-expanded={directory ? expanded : undefined}
          aria-current={selectable && node.path === selectedPath ? 'page' : undefined}
          onClick={() => directory ? onToggle(node.path) : onSelectPath(node.path)}
        >
          <span className="tree-disclosure" aria-hidden="true">{directory ? (expanded ? '⌄' : '›') : '·'}</span>
          <span>{node.name.replace(/\.md$/, '')}</span>
          {node.truncated && <span className="tree-limit">limited</span>}
        </button>
      ) : (
        <span className="tree-row static">
          <span className="tree-disclosure" aria-hidden="true">·</span>
          <span>{node.name}</span>
        </span>
      )}
      {expanded && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeRow
              expandedPaths={expandedPaths}
              key={child.id}
              node={child}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GraphIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="2" /><circle cx="6" cy="17" r="2" /><circle cx="18" cy="17" r="2" />
      <path d="M11 7 7 15M13 7l4 8M8 17h8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}
