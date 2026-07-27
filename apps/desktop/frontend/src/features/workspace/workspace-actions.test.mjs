import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createWorkspaceRequestGuard,
  formatActionError,
  formatCheckDetails,
  formatCheckResult,
  formatGraphRefreshed,
  formatImportResult,
  formatWorkspaceLoaded,
  formatWorkspaceMissingFolders,
  formatWorkspaceOverviewStats,
  formatWorkspacePacks,
  workspaceLoadCanceledState,
} from './workspace-actions.ts';

describe('workspace-actions', () => {
  it('formats clean and failing check summaries', () => {
    assert.equal(formatCheckResult({ summary: { errors: 0, warnings: 0, fixable: 0 } }).kind, 'success');
    assert.deepEqual(formatCheckResult({ summary: { errors: 1, warnings: 2, fixable: 1 } }), {
      kind: 'error',
      title: 'Check found issues',
      message: '1 errors, 2 warnings, 1 fixable.',
    });
  });

  it('formats detailed check results with sorted check counts and raw output placeholders', () => {
    assert.deepEqual(
      formatCheckDetails({
        status: 'issues',
        exitCode: 1,
        stdout: '',
        stderr: 'warning line',
        summary: { errors: 2, warnings: 1, fixable: 1, by_check: { L09: 1, L01: 2 } },
      }),
      {
        status: 'issues',
        exitCode: '1',
        counts: '2 errors, 1 warning, 1 fixable',
        byCheck: ['L01: 2', 'L09: 1'],
        stdout: 'No stdout captured.',
        stderr: 'warning line',
      },
    );
  });

  it('formats import result and unknown errors', () => {
    assert.deepEqual(formatImportResult({ relativePath: 'raw/sources/paper.md', bytes: 12 }), {
      kind: 'success',
      title: 'Import complete',
      message: 'raw/sources/paper.md (12 bytes)',
    });
    assert.equal(formatActionError('boom').message, 'boom');
  });

  it('formats workspace load status', () => {
    assert.deepEqual(formatWorkspaceLoaded('/tmp/wiki', { nodes: [1, 2], edges: [1] }), {
      kind: 'success',
      title: 'Workspace loaded',
      message: '/tmp/wiki · 2 nodes, 1 edge',
    });
    assert.equal(workspaceLoadCanceledState.kind, 'idle');
  });

  it('formats graph refresh status', () => {
    assert.deepEqual(formatGraphRefreshed({ nodes: [1], edges: [1, 2] }), {
      kind: 'success',
      title: 'Graph refreshed',
      message: '1 node, 2 edges loaded from workspace.',
    });
  });

  it('marks older workspace requests stale when a newer one starts', () => {
    const guard = createWorkspaceRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
  });

  it('formats workspace overview inventory', () => {
    const summary = {
      packs: ['core', 'research'],
      wikiNotes: 5,
      rawSources: 1,
      rawNotes: 0,
      graphEdges: 6,
      graphCitations: 2,
      missingExpectedFolders: ['raw/notes'],
    };

    assert.deepEqual(formatWorkspaceOverviewStats(summary), [
      { label: 'Packs', value: '2' },
      { label: 'Wiki notes', value: '5' },
      { label: 'Raw sources', value: '1' },
      { label: 'Raw notes', value: '0' },
      { label: 'Graph edges', value: '6' },
      { label: 'Citations', value: '2' },
    ]);
    assert.equal(formatWorkspacePacks(summary), 'core, research');
    assert.equal(formatWorkspaceMissingFolders(summary), 'Missing: raw/notes');
  });

  it('formats empty workspace overview fallbacks', () => {
    assert.equal(formatWorkspacePacks({ packs: [] }), 'No packs detected');
    assert.equal(formatWorkspaceMissingFolders({ missingExpectedFolders: [] }), 'All expected folders present.');
  });
});
