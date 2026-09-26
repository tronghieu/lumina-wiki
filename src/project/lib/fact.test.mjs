import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFact, factId } from './fact.mjs';
import { sha256Hex, canonicalJson } from './hash.mjs';

function edgeInput(overrides = {}) {
  return {
    kind: 'edge',
    subject: 'doc:docs/adr/0009.md',
    relation: 'supersedes',
    object: 'doc:docs/adr/0052.md',
    ref: 'ADR-0052',
    evidence: { line: 12, quote: 'ADR-0009 supersedes ADR-0052' },
    provenance: 'extracted',
    ...overrides,
  };
}

test('makeFact builds an edge fact with the exact key order', () => {
  const fact = makeFact(edgeInput());
  assert.deepEqual(Object.keys(fact), [
    'id',
    'kind',
    'subject',
    'relation',
    'object',
    'ref',
    'evidence',
    'provenance',
  ]);
  assert.equal(fact.kind, 'edge');
  assert.equal(fact.object, 'doc:docs/adr/0052.md');
  assert.deepEqual(fact.evidence, { line: 12, quote: 'ADR-0009 supersedes ADR-0052' });
});

test('makeFact builds an attr fact using value instead of object', () => {
  const fact = makeFact({
    kind: 'attr',
    subject: 'doc:docs/adr/0009.md',
    relation: 'status',
    value: 'superseded',
    ref: 'ADR-0009',
    evidence: { line: 3, quote: 'Status: Superseded' },
    provenance: 'extracted',
  });
  assert.deepEqual(Object.keys(fact), [
    'id',
    'kind',
    'subject',
    'relation',
    'value',
    'ref',
    'evidence',
    'provenance',
  ]);
  assert.equal(fact.value, 'superseded');
});

test('makeFact includes scope only when provided', () => {
  const withScope = makeFact(edgeInput({ scope: 'row:3' }));
  assert.ok('scope' in withScope);
  assert.equal(withScope.scope, 'row:3');

  const withoutScope = makeFact(edgeInput());
  assert.ok(!('scope' in withoutScope));
});

test('factId includes scope: two facts differing only by scope get different ids', () => {
  assert.notEqual(makeFact(edgeInput({ scope: 'row:1' })).id, makeFact(edgeInput({ scope: 'row:2' })).id);
  assert.notEqual(makeFact(edgeInput({ scope: 'row:1' })).id, makeFact(edgeInput()).id);
});

test('makeFact omits scope when it is explicitly null', () => {
  const fact = makeFact(edgeInput({ scope: null }));
  assert.ok(!('scope' in fact));
});

test('factId matches the spec formula', () => {
  const parts = {
    kind: 'edge',
    relation: 'supersedes',
    subject: 'doc:docs/adr/0009.md',
    object: 'doc:docs/adr/0052.md',
    scope: undefined,
  };
  const expected = sha256Hex(
    canonicalJson([parts.kind, parts.relation, parts.subject, parts.object, null])
  ).slice(0, 16);
  assert.equal(factId(parts), expected);
  assert.equal(factId(parts).length, 16);
});

test('factId is unaffected by key order inside an object value (canonical JSON)', () => {
  const a = factId({
    kind: 'attr',
    relation: 'has-metadata',
    subject: 'doc:docs/adr/0009.md',
    value: { b: 1, a: 2 },
  });
  const b = factId({
    kind: 'attr',
    relation: 'has-metadata',
    subject: 'doc:docs/adr/0009.md',
    value: { a: 2, b: 1 },
  });
  assert.equal(a, b);
});

test('makeFact id matches factId for the same fields', () => {
  const input = edgeInput();
  const fact = makeFact(input);
  assert.equal(
    fact.id,
    factId({
      kind: input.kind,
      relation: input.relation,
      subject: input.subject,
      object: input.object,
      scope: input.scope,
    })
  );
});

test('attr fact id uses value in place of object', () => {
  const id = factId({
    kind: 'attr',
    relation: 'status',
    subject: 'doc:docs/adr/0009.md',
    value: 'superseded',
  });
  const expected = sha256Hex(
    canonicalJson(['attr', 'status', 'doc:docs/adr/0009.md', 'superseded', null])
  ).slice(0, 16);
  assert.equal(id, expected);
});

test('makeFact rejects an unknown kind', () => {
  assert.throws(() => makeFact(edgeInput({ kind: 'weird' })), TypeError);
});

test('makeFact rejects an edge fact without object', () => {
  assert.throws(() => makeFact(edgeInput({ object: undefined })), TypeError);
});

test('makeFact rejects an attr fact without value', () => {
  assert.throws(
    () =>
      makeFact({
        kind: 'attr',
        subject: 's',
        relation: 'status',
        ref: 'r',
        evidence: { line: 1, quote: 'q' },
        provenance: 'extracted',
      }),
    TypeError
  );
});

test('makeFact rejects a fact with both object and value', () => {
  assert.throws(() => makeFact(edgeInput({ value: 'nope' })), TypeError);
});

test('makeFact rejects a non-integer or sub-1 line', () => {
  assert.throws(() => makeFact(edgeInput({ evidence: { line: 0, quote: 'q' } })), TypeError);
  assert.throws(() => makeFact(edgeInput({ evidence: { line: 1.5, quote: 'q' } })), TypeError);
  assert.throws(() => makeFact(edgeInput({ evidence: { line: '1', quote: 'q' } })), TypeError);
});

test('makeFact rejects an empty quote', () => {
  assert.throws(() => makeFact(edgeInput({ evidence: { line: 1, quote: '' } })), TypeError);
});

test('makeFact rejects an invalid provenance', () => {
  assert.throws(() => makeFact(edgeInput({ provenance: 'guessed' })), TypeError);
});

test('makeFact rejects missing or non-string subject', () => {
  assert.throws(() => makeFact(edgeInput({ subject: undefined })), TypeError);
  assert.throws(() => makeFact(edgeInput({ subject: '' })), TypeError);
  assert.throws(() => makeFact(edgeInput({ subject: 42 })), TypeError);
});

test('makeFact rejects missing or non-string relation', () => {
  assert.throws(() => makeFact(edgeInput({ relation: undefined })), TypeError);
  assert.throws(() => makeFact(edgeInput({ relation: '' })), TypeError);
  assert.throws(() => makeFact(edgeInput({ relation: 42 })), TypeError);
});

test('makeFact rejects missing or non-string ref', () => {
  assert.throws(() => makeFact(edgeInput({ ref: undefined })), TypeError);
  assert.throws(() => makeFact(edgeInput({ ref: '' })), TypeError);
  assert.throws(() => makeFact(edgeInput({ ref: 42 })), TypeError);
});
