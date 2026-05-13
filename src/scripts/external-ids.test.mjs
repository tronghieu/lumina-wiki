import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  EXTERNAL_ID_NAMESPACES,
  CANONICAL_URL_V,
  normalizeExternalId,
  parseUrlToExternalIds,
  canonicalizeUrl,
  externalIdMatchKey,
  expandExternalIds,
  safeIdToken,
  sanitizeExternalIdsObject,
  buildSourceEntry,
} from './external-ids.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../tools/tests/fixtures/id-cases.json');
const F = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

test('namespaces locked', () => {
  assert.deepEqual([...EXTERNAL_ID_NAMESPACES], ['doi', 'arxiv', 's2', 'url', 'openalex']);
});

test('CANONICAL_URL_V is a positive integer', () => {
  assert.ok(Number.isInteger(CANONICAL_URL_V) && CANONICAL_URL_V >= 1);
});

test('normalize cases', () => {
  for (const c of F.normalize) {
    const r = normalizeExternalId(c.kind, c.raw);
    assert.equal(r.id, c.expected.id, `id mismatch for ${c.kind}:${c.raw}`);
    assert.equal(r.valid, c.expected.valid, `valid mismatch for ${c.kind}:${c.raw}`);
    if (c.expected.extras) {
      for (const [k, v] of Object.entries(c.expected.extras)) {
        assert.equal(r.extras[k], v, `extras.${k} mismatch for ${c.kind}:${c.raw}`);
      }
    }
  }
});

test('parseUrl cases', () => {
  for (const c of F.parseUrl) {
    const r = parseUrlToExternalIds(c.url);
    assert.deepEqual(r, c.expected, `parseUrl ${c.url}`);
  }
});

test('canonicalize cases', () => {
  for (const c of F.canonicalize) {
    if (c.expected === null) {
      assert.throws(() => canonicalizeUrl(c.url), `canonicalize should throw on ${c.url}`);
    } else {
      assert.equal(canonicalizeUrl(c.url), c.expected, `canonicalize ${c.url}`);
    }
  }
});

test('matchKey cases', () => {
  for (const c of F.matchKey) {
    assert.equal(externalIdMatchKey(c.ids), c.expected, `matchKey ${JSON.stringify(c.ids)}`);
  }
});

test('expand cases', () => {
  for (const c of F.expand) {
    const r = expandExternalIds(c.ids);
    assert.deepEqual({ ...r }, c.expected, `expand ${JSON.stringify(c.ids)}`);
  }
});

test('safeIdToken cases', () => {
  for (const c of F.safeIdToken) {
    if (c.valid) {
      assert.equal(safeIdToken(c.kind, c.val), c.val);
    } else {
      assert.throws(() => safeIdToken(c.kind, c.val), `safeIdToken should reject ${c.kind}:${c.val}`);
    }
  }
});

test('sanitize cases', () => {
  for (const c of F.sanitize) {
    const out = sanitizeExternalIdsObject(c.input);
    assert.deepEqual(Object.keys(out).sort(), c.expectedKeys.slice().sort());
    // Prototype pollution guard.
    assert.equal(Object.getPrototypeOf(out), null);
  }
});

test('buildSourceEntry: minimal valid', () => {
  const e = buildSourceEntry('arxiv');
  assert.equal(e.provider, 'arxiv');
  assert.match(e.fetched_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(!('url' in e));
});

test('buildSourceEntry: with url', () => {
  const e = buildSourceEntry('s2', { url: 'https://api.semanticscholar.org/x' });
  assert.equal(e.url, 'https://api.semanticscholar.org/x');
});

test('buildSourceEntry: respects fetched_at override', () => {
  const e = buildSourceEntry('pdf', { fetched_at: '2026-01-01T00:00:00Z' });
  assert.equal(e.fetched_at, '2026-01-01T00:00:00Z');
});

test('buildSourceEntry: rejects invalid provider', () => {
  for (const bad of ['', 'BadCase', 'has space', '1leading', '../traverse', 'a'.repeat(33)]) {
    assert.throws(() => buildSourceEntry(bad), `should reject "${bad}"`);
  }
});

test('buildSourceEntry: drops oversize url silently', () => {
  const huge = 'https://x.test/' + 'a'.repeat(3000);
  const e = buildSourceEntry('pdf', { url: huge });
  assert.ok(!('url' in e));
});

test('buildSourceEntry: with ns/value persists both', () => {
  const e = buildSourceEntry('openalex', { ns: 'openalex', value: 'W4392834756' });
  assert.equal(e.ns, 'openalex');
  assert.equal(e.value, 'W4392834756');
  assert.equal(e.provider, 'openalex');
});

test('buildSourceEntry: ns + value + url all together', () => {
  const e = buildSourceEntry('openalex', {
    ns: 'doi',
    value: '10.48550/arxiv.2401.12345',
    url: 'https://api.openalex.org/works/W123',
  });
  assert.equal(e.ns, 'doi');
  assert.equal(e.value, '10.48550/arxiv.2401.12345');
  assert.equal(e.url, 'https://api.openalex.org/works/W123');
});

test('buildSourceEntry: drops ns/value when ns not in registry', () => {
  const e = buildSourceEntry('openalex', { ns: 'isbn', value: '9780000000000' });
  assert.ok(!('ns' in e));
  assert.ok(!('value' in e));
});

test('buildSourceEntry: drops ns/value when only one provided', () => {
  const e1 = buildSourceEntry('openalex', { ns: 'doi' });
  assert.ok(!('ns' in e1) && !('value' in e1));
  const e2 = buildSourceEntry('openalex', { value: 'W123' });
  assert.ok(!('ns' in e2) && !('value' in e2));
});

test('buildSourceEntry: drops oversize value silently', () => {
  const huge = 'x'.repeat(3000);
  const e = buildSourceEntry('openalex', { ns: 'doi', value: huge });
  assert.ok(!('ns' in e) && !('value' in e));
});

test('buildSourceEntry: backward-compat — opts without ns/value unchanged', () => {
  const e = buildSourceEntry('arxiv');
  assert.deepEqual(Object.keys(e).sort(), ['fetched_at', 'provider']);
});

test('redos adversarial inputs complete under budget', () => {
  for (const c of F.redos) {
    const raw = c.raw_template + c.pad_char.repeat(c.pad_count) + c.tail;
    const start = process.hrtime.bigint();
    normalizeExternalId(c.kind, raw);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < c.must_complete_under_ms, `${c.kind} took ${ms.toFixed(2)}ms (budget ${c.must_complete_under_ms}ms)`);
  }
});
