import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCredentialSecret } from './ai-settings.ts';

test('credential gateway encodes UTF-8 bytes for the Go byte-slice contract', () => {
  const encoded = encodeCredentialSecret('khóa bí mật');
  assert.notEqual(encoded, 'khóa bí mật');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'khóa bí mật');
});
