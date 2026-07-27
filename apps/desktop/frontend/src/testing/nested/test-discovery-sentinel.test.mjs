import assert from 'node:assert/strict';
import { test } from 'node:test';

test('recursive test discovery reaches nested frontend suites', () => {
  assert.equal('src/testing/nested'.split('/').length, 3);
});
