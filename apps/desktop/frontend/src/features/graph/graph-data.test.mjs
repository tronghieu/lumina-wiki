import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkedNodes, sampleGraph, searchGraph, toFlowEdges, toFlowNodes } from './graph-data.ts';

describe('graph-data', () => {
  it('filters nodes by title, type, and path', () => {
    assert.deepEqual(searchGraph(sampleGraph, 'privacy').nodes.map((node) => node.id), ['privacy']);
    assert.deepEqual(searchGraph(sampleGraph, 'people/').nodes.map((node) => node.id), ['ada-lovelace']);
    assert.deepEqual(searchGraph(sampleGraph, 'concept').nodes.map((node) => node.id), ['ethics', 'privacy', 'education']);
  });

  it('keeps only edges whose endpoints are visible after search', () => {
    const filtered = searchGraph(sampleGraph, 'concept');
    assert.deepEqual(filtered.edges.map((edge) => `${edge.from}:${edge.to}`), ['ethics:privacy', 'privacy:education']);
  });

  it('returns sorted linked nodes for selected node', () => {
    assert.deepEqual(linkedNodes(sampleGraph, 'ai-social-impact').map((node) => node.title), [
      'Ada Lovelace',
      'Ethics',
      'Privacy',
      'Social Impact Brief',
    ]);
  });

  it('marks selected React Flow node and filters edge endpoints', () => {
    const flowNodes = toFlowNodes(sampleGraph.nodes, 'privacy');
    assert.equal(flowNodes.find((node) => node.id === 'privacy')?.className, 'flow-node selected');

    const visibleNodeIds = new Set(['ethics', 'privacy']);
    assert.deepEqual(toFlowEdges(sampleGraph.edges, visibleNodeIds).map((edge) => edge.id), ['ethics-related_to-privacy']);
  });
});
