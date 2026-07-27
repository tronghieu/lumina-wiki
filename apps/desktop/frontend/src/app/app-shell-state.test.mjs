import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveArtifactView,
  resolveResponsivePanels,
  resolveSemanticFocus,
} from './app-shell-state.ts';

describe('app-shell-state', () => {
  it('keeps note view unavailable until a real note is selected', () => {
    assert.equal(resolveArtifactView('note', ''), 'graph');
    assert.equal(resolveArtifactView('note', 'real-node'), 'note');
    assert.equal(resolveArtifactView('graph', 'real-node'), 'graph');
  });

  it('uses inline panels only at the reference desktop width', () => {
    assert.deepEqual(resolveResponsivePanels(1480), {
      mode: 'desktop',
      treeInitiallyOpen: true,
      agentInitiallyOpen: true,
    });
    assert.deepEqual(resolveResponsivePanels(1180), {
      mode: 'medium',
      treeInitiallyOpen: false,
      agentInitiallyOpen: false,
    });
    assert.deepEqual(resolveResponsivePanels(760), {
      mode: 'narrow',
      treeInitiallyOpen: false,
      agentInitiallyOpen: false,
    });
  });

  it('keeps one semantic focus and makes Note unavailable for an empty library', () => {
    assert.equal(resolveSemanticFocus('note', ''), 'graph');
    assert.equal(resolveSemanticFocus('note', 'real-note'), 'note');
    assert.equal(resolveSemanticFocus('chat', ''), 'chat');
  });
});
