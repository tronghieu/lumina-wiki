import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatActionError, formatCheckResult, formatImportResult } from './workspace-actions.ts';

describe('workspace-actions', () => {
  it('formats clean and failing check summaries', () => {
    assert.equal(formatCheckResult({ summary: { errors: 0, warnings: 0, fixable: 0 } }).kind, 'success');
    assert.deepEqual(formatCheckResult({ summary: { errors: 1, warnings: 2, fixable: 1 } }), {
      kind: 'error',
      title: 'Check found issues',
      message: '1 errors, 2 warnings, 1 fixable.',
    });
  });

  it('formats import result and unknown errors', () => {
    assert.deepEqual(formatImportResult({ relativePath: 'raw/sources/paper.md', bytes: 12 }), {
      kind: 'success',
      title: 'Import complete',
      message: 'raw/sources/paper.md (12 bytes)',
    });
    assert.equal(formatActionError('boom').message, 'boom');
  });
});
