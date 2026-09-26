import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, canonicalJson, contentHash } from './hash.mjs';

test('sha256Hex matches known digests', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.slice(0, 64)
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('sha256Hex accepts a Buffer', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), sha256Hex('abc'));
});

test('canonicalJson sorts object keys recursively', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    canonicalJson({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] }),
    '{"a":[3,{"y":2,"z":1}],"b":{"c":2,"d":1}}'
  );
});

test('canonicalJson preserves array order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('canonicalJson output is stable regardless of input key order', () => {
  const a = canonicalJson({ x: 1, y: 2, z: { m: 1, n: 2 } });
  const b = canonicalJson({ z: { n: 2, m: 1 }, y: 2, x: 1 });
  assert.equal(a, b);
});

test('contentHash strips a leading UTF-8 BOM', () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from('hello world', 'utf8');
  const withBom = Buffer.concat([bom, body]);
  assert.equal(contentHash(withBom), contentHash(body));
});

test('contentHash normalizes CRLF and lone CR to LF', () => {
  const lf = Buffer.from('a\nb\nc\n', 'utf8');
  const crlf = Buffer.from('a\r\nb\r\nc\r\n', 'utf8');
  const cr = Buffer.from('a\rb\rc\r', 'utf8');
  assert.equal(contentHash(crlf), contentHash(lf));
  assert.equal(contentHash(cr), contentHash(lf));
});

test('contentHash leaves multi-byte UTF-8 content untouched', () => {
  const viet = Buffer.from('Hạn mức tín dụng\r\n', 'utf8');
  const vietLf = Buffer.from('Hạn mức tín dụng\n', 'utf8');
  assert.equal(contentHash(viet), contentHash(vietLf));
});

test('contentHash returns a 64-char lowercase hex digest', () => {
  const h = contentHash(Buffer.from('x'));
  assert.match(h, /^[0-9a-f]{64}$/);
});
