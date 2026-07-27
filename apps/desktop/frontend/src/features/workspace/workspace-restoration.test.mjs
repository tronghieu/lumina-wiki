import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  continuityWarningMessage,
  normalizeRecentLibraries,
  resolvePreparedContinuity,
  resetRecentActivityMessage,
} from './workspace-restoration.ts';

const emptyPrepared = {
  preparationToken: 'prepared',
  snapshot: {
    libraryLabel: 'Research',
    accessMode: 'read-write',
    summary: { notes: 0, documents: 0, relationships: 0 },
    graph: { nodes: [], edges: [] },
    tree: [],
    warnings: [],
  },
};

describe('workspace restoration', () => {
  it('keeps at most twelve path-free recent cards', () => {
    const recents = normalizeRecentLibraries(Array.from({ length: 13 }, (_, index) => ({
      workspaceId: `workspace-${index}`,
      label: `Library ${index}`,
      activatedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      status: index === 0 ? 'unavailable' : 'available',
      focus: 'chat',
      root: `/private/library-${index}`,
    })));

    assert.equal(recents.length, 12);
    assert.deepEqual(Object.keys(recents[0]).sort(), [
      'activatedAt', 'focus', 'label', 'status', 'workspaceId',
    ]);
  });

  it('applies only a valid wiki note and falls back safely for stale artifacts', () => {
    const prepared = {
      ...emptyPrepared,
      snapshot: {
        ...emptyPrepared.snapshot,
        graph: {
          nodes: [{
            id: 'overview',
            title: 'Overview',
            type: 'concept',
            path: 'overview.md',
            preview: '',
          }],
          edges: [],
        },
      },
    };
    assert.deepEqual(resolvePreparedContinuity({
      prepared,
      focus: 'note',
      artifactStatus: 'loaded',
      artifact: {
        artifact: { version: 1, kind: 'wiki_note', relativePath: 'wiki/overview.md' },
        content: '# Overview',
      },
      historyStatus: 'empty',
    }), {
      prepared,
      focus: 'note',
      selectedNodeId: 'overview',
      note: { kind: 'loaded', path: 'wiki/overview.md', content: '# Overview' },
      historyStatus: 'empty',
      conversationId: null,
      fallbackNotice: null,
    });

    const stale = resolvePreparedContinuity({
      prepared,
      focus: 'note',
      artifactStatus: 'loaded',
      artifact: {
        artifact: { version: 1, kind: 'wiki_note', relativePath: '../private.md' },
        content: 'secret',
      },
      historyStatus: 'corrupt',
    });
    assert.equal(stale.focus, 'graph');
    assert.equal(stale.note, null);
    assert.equal(stale.fallbackNotice, 'Your library opened, but some recent activity could not be restored.');
    assert.doesNotMatch(JSON.stringify(stale), /secret|private\.md/);

    const historyOnly = resolvePreparedContinuity({
      prepared,
      focus: 'chat',
      artifactStatus: 'empty',
      artifact: null,
      historyStatus: 'unavailable',
    });
    assert.equal(
      historyOnly.fallbackNotice,
      'Your library opened, but recent conversations are unavailable right now.',
    );
  });

  it('distinguishes clear outcomes in everyday language', () => {
    assert.equal(resetRecentActivityMessage('reset'), 'Recent activity was cleared.');
    assert.equal(resetRecentActivityMessage('already_reset'), 'There was no recent activity to clear.');
    assert.equal(
      resetRecentActivityMessage('failed_preserved'),
      'Recent activity could not be cleared. Nothing was changed.',
    );
  });

  it('maps retained recovery to a nonblocking continuity warning', () => {
    assert.equal(
      continuityWarningMessage(true, false),
      'Your library opened. An unfinished library is still available from Welcome.',
    );
    assert.equal(
      continuityWarningMessage(false, true),
      'Your library opened, but some recent activity could not be restored.',
    );
  });
});
