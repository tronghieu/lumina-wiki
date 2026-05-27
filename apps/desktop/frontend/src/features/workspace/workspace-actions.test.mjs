import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatActionError,
  formatCheckDetails,
  formatCheckResult,
  formatImportResult,
  formatWorkspaceLoaded,
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
});
