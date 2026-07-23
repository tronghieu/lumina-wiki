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

const rootOrder = new Map([
  ['_lumina', 0],
  ['raw', 1],
  ['wiki', 2],
]);

export function normalizeWorkspaceTree(nodes: WorkspaceTreeNode[]): WorkspaceTreeGroup[] {
  return nodes
    .filter((node) => node.kind === 'directory' && rootOrder.has(node.path) && node.name === node.path)
    .map((node) => normalizeNode(node) as WorkspaceTreeGroup)
    .sort((left, right) => (rootOrder.get(left.path) ?? 0) - (rootOrder.get(right.path) ?? 0));
}

function normalizeNode(node: WorkspaceTreeNode): WorkspaceTreeItem {
  const children = node.kind === 'directory'
    ? (node.children ?? [])
        .filter((child) => isValidChild(child, node.path))
        .map((child) => normalizeNode(child))
        .sort(compareTreeItems)
    : [];

  return {
    id: node.id,
    name: node.name,
    path: node.path,
    kind: node.kind === 'directory' ? 'directory' : 'file',
    size: node.kind === 'file' && Number.isFinite(node.size) ? Math.max(0, node.size ?? 0) : 0,
    children,
    truncated: node.truncated === true,
  };
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
