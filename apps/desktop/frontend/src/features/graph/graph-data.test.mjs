import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  linkedNodeSelectionId,
  linkedNodes,
  resolveGraphEmphasis,
  resolveSelectedNodeId,
  toFlowEdges,
  toFlowNodes,
} from './graph-data.ts';

const sampleGraph = {
  nodes: [
    { id: 'ai-social-impact', title: 'AI Social Impact', type: 'source', path: 'sources/ai-social-impact.md', preview: 'Source note.' },
    { id: 'ethics', title: 'Ethics', type: 'concept', path: 'concepts/ethics.md', preview: 'Ethics note.' },
    { id: 'privacy', title: 'Privacy', type: 'concept', path: 'concepts/privacy.md', preview: 'Privacy note.' },
    { id: 'education', title: 'Education', type: 'concept', path: 'concepts/education.md', preview: 'Education note.' },
    { id: 'ada-lovelace', title: 'Ada Lovelace', type: 'person', path: 'people/ada-lovelace.md', preview: 'Person note.' },
    { id: 'outputs/social-impact-brief', title: 'Social Impact Brief', type: 'output', path: 'outputs/social-impact-brief.md', preview: 'Output note.' },
  ],
  edges: [
    { from: 'ai-social-impact', type: 'defines', to: 'ethics' },
    { from: 'ai-social-impact', type: 'defines', to: 'privacy' },
    { from: 'ai-social-impact', type: 'mentions', to: 'ada-lovelace' },
    { from: 'ethics', type: 'related_to', to: 'privacy' },
    { from: 'privacy', type: 'related_to', to: 'education' },
    { from: 'ai-social-impact', type: 'produced', to: 'outputs/social-impact-brief' },
  ],
};

describe('graph-data', () => {
  it('dims nonmatches without deleting real graph data', () => {
    const emphasis = resolveGraphEmphasis(sampleGraph, 'privacy', '');
    assert.equal(emphasis.get('privacy'), 'match');
    assert.equal(emphasis.get('education'), 'dim');
    assert.equal(emphasis.size, sampleGraph.nodes.length);
  });

  it('keeps the selected node and its neighbors prominent during search', () => {
    const emphasis = resolveGraphEmphasis(sampleGraph, 'education', 'ai-social-impact');
    assert.equal(emphasis.get('ai-social-impact'), 'selected');
    assert.equal(emphasis.get('education'), 'match');
    assert.equal(emphasis.get('ethics'), 'neighbor');
    assert.equal(emphasis.get('privacy'), 'neighbor');
  });

  it('returns sorted linked nodes for selected node', () => {
    assert.deepEqual(linkedNodes(sampleGraph, 'ai-social-impact').map((node) => node.title), [
      'Ada Lovelace',
      'Ethics',
      'Privacy',
      'Social Impact Brief',
    ]);
  });

  it('marks selected flow nodes and emphasizes connected edges', () => {
    const emphasis = resolveGraphEmphasis(sampleGraph, '', 'privacy');
    const flowNodes = toFlowNodes(sampleGraph, emphasis);
    assert.match(flowNodes.find((node) => node.id === 'privacy')?.className ?? '', /selected/);
    assert.equal(flowNodes.every((node) => node.type === 'lumina'), true);

    const flowEdges = toFlowEdges(sampleGraph.edges, emphasis);
    assert.equal(flowEdges.length, sampleGraph.edges.length);
    assert.match(flowEdges.find((edge) => edge.id === 'ethics-related_to-privacy')?.className ?? '', /focused/);
  });

  it('keeps a valid selected node or falls back to the first loaded node', () => {
    assert.equal(resolveSelectedNodeId(sampleGraph, 'privacy'), 'privacy');
    assert.equal(resolveSelectedNodeId(sampleGraph, 'missing'), 'ai-social-impact');
    assert.equal(resolveSelectedNodeId({ nodes: [], edges: [] }, 'missing'), '');
  });

  it('uses the linked node id as the inspector selection target', () => {
    assert.equal(linkedNodeSelectionId(sampleGraph.nodes[2]), 'privacy');
  });
});
