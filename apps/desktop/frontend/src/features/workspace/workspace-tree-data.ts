export type WorkspaceTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: string;
  size?: number;
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
};

export type WorkspaceTreeItem = {
  id: string;
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
  children: WorkspaceTreeItem[];
  truncated: boolean;
};

export type WorkspaceTreeGroup = WorkspaceTreeItem & {
  kind: 'directory';
};

export function normalizeWorkspaceTree(nodes: WorkspaceTreeNode[]): WorkspaceTreeGroup[] {
  return nodes
    .filter((node) => (
      node.kind === 'directory'
      && node.name === node.path
      && !node.name.startsWith('_')
      && node.name !== 'raw'
    ))
    .map((node) => normalizeNode(node, true) as WorkspaceTreeGroup)
    .sort(compareTreeItems);
}

function normalizeNode(node: WorkspaceTreeNode, root = false): WorkspaceTreeItem {
  const children = node.kind === 'directory'
    ? (node.children ?? [])
        .filter((child) => isValidChild(child, node.path))
        .map((child) => normalizeNode(child))
        .sort(compareTreeItems)
    : [];

  return {
    id: node.id,
    name: friendlyTreeName(node.name, root),
    path: node.path,
    kind: node.kind === 'directory' ? 'directory' : 'file',
    size: node.kind === 'file' && Number.isFinite(node.size) ? Math.max(0, node.size ?? 0) : 0,
    children,
    truncated: node.truncated === true,
  };
}

function friendlyTreeName(name: string, root: boolean): string {
  if (root && name === 'wiki') return 'Notes';
  const directoryNames: Record<string, string> = {
    concepts: 'Topics',
    sources: 'Documents',
    people: 'People',
    summary: 'Summaries',
    outputs: 'Writing',
  };
  return directoryNames[name] ?? name;
}

function isValidChild(node: WorkspaceTreeNode, parentPath: string): boolean {
  if (node.kind !== 'directory' && node.kind !== 'file') {
    return false;
  }
  const expectedPrefix = `${parentPath}/`;
  const relativeName = node.path.slice(expectedPrefix.length);
  return (
    node.path.startsWith(expectedPrefix)
    && relativeName.length > 0
    && !relativeName.includes('/')
    && node.name === relativeName
  );
}

function compareTreeItems(left: WorkspaceTreeItem, right: WorkspaceTreeItem): number {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1;
  }
  if (left.name === right.name) {
    return 0;
  }
  return left.name < right.name ? -1 : 1;
}
