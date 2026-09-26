import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeRelPath } from './fsx.mjs';

describe('assertSafeRelPath', () => {
  test('accepts a plain repo-relative path', () => {
    assert.equal(assertSafeRelPath('docs/adr'), 'docs/adr');
  });

  test('accepts a glob pattern', () => {
    assert.equal(assertSafeRelPath('packages/*/docs'), 'packages/*/docs');
  });

  for (const bad of ['../x', '/abs', 'C:/x', 'c:\\x', 'a\\b', '', 'docs/../x']) {
    test(`rejects unsafe pattern ${JSON.stringify(bad)}`, () => {
      assert.throws(() => assertSafeRelPath(bad), RangeError);
    });
  }

  test('error message names the offending pattern', () => {
    assert.throws(() => assertSafeRelPath('../x'), (err) => {
      assert.match(err.message, /\.\.\/x/);
      return true;
    });
  });
});
