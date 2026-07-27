import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finalizeReadyState } from './ready-library-state.ts';

describe('ready-library-state', () => {
  it('combines a prepared snapshot and commit into one capability-free ready state', () => {
    const prepared = {
      preparationToken: 'opaque-preparation',
      snapshot: {
        libraryLabel: 'Research notes',
        accessMode: 'read-write',
        summary: { notes: 0, documents: 0, relationships: 0 },
        graph: { nodes: [], edges: [] },
        tree: [],
        warnings: [],
      },
    };

    assert.deepEqual(
      finalizeReadyState(prepared, {
        status: 'created_and_active',
        session: { sessionId: 'opaque-session', generation: 4 },
      }),
      {
        libraryLabel: 'Research notes',
        accessMode: 'read-write',
        summary: { notes: 0, documents: 0, relationships: 0 },
        graph: { nodes: [], edges: [] },
        tree: [],
        warnings: [],
        session: { sessionId: 'opaque-session', generation: 4 },
      },
    );
  });

  it('rejects a commit that did not activate a library', () => {
    assert.throws(
      () => finalizeReadyState(
        {
          preparationToken: 'opaque-preparation',
          snapshot: {
            libraryLabel: 'Research notes',
            accessMode: 'read-write',
            summary: { notes: 0, documents: 0, relationships: 0 },
            graph: { nodes: [], edges: [] },
            tree: [],
            warnings: [],
          },
        },
        {
          status: 'created_not_active',
          session: null,
        },
      ),
      /not active/i,
    );
  });
});
