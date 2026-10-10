import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from './strings.mjs';

test('STRINGS is frozen', () => assert.ok(Object.isFrozen(STRINGS)));

test('every key is camelCase and every value is a non-empty string', () => {
  for (const [k, v] of Object.entries(STRINGS)) {
    assert.match(k, /^[a-z][A-Za-z]*$/, k);
    assert.equal(typeof v, 'string', k);
    assert.ok(v.length > 0, k);
  }
});
