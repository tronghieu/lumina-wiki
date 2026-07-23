import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeWorkspaceTree } from './workspace-tree-data.ts';

const directory = (name, path, children = []) => ({
  id: `node-${path}`,
  name,
  path,
  kind: 'directory',
  children,
});

const file = (name, path, size = 1) => ({
  id: `node-${path}`,
  name,
  path,
  kind: 'file',
  size,
});

describe('workspace-tree-data', () => {
  it('returns no phantom roots for an empty workspace tree', () => {
    assert.deepEqual(normalizeWorkspaceTree([]), []);
  });

  it('keeps only real bounded workspace roots in reference order', () => {
    const groups = normalizeWorkspaceTree([
      directory('wiki', 'wiki'),
      directory('other', 'other'),
      directory('raw', 'raw'),
    ]);

    assert.deepEqual(groups.map((group) => group.path), ['raw', 'wiki']);
  });

  it('sorts directories before files without mutating the backend DTO', () => {
    const nodes = [
      directory('wiki', 'wiki', [
        file('zeta.md', 'wiki/zeta.md'),
        directory('concepts', 'wiki/concepts', [file('ethics.md', 'wiki/concepts/ethics.md')]),
        file('index.md', 'wiki/index.md'),
      ]),
      directory('_lumina', '_lumina'),
    ];
    const original = structuredClone(nodes);

    const groups = normalizeWorkspaceTree(nodes);

    assert.deepEqual(groups.map((group) => group.path), ['_lumina', 'wiki']);
    assert.deepEqual(groups[1].children.map((node) => node.name), ['concepts', 'index.md', 'zeta.md']);
    assert.deepEqual(nodes, original);
  });

  it('drops malformed descendants instead of inventing replacement rows', () => {
    const groups = normalizeWorkspaceTree([
      directory('wiki', 'wiki', [
        directory('concepts', 'raw/concepts'),
        file('note.md', 'wiki/note.md'),
      ]),
    ]);

    assert.deepEqual(groups[0].children.map((node) => node.path), ['wiki/note.md']);
  });
});
