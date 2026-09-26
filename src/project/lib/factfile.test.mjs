import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { prepareEnvelope, serializeEnvelope, verifyEvidence } from './factfile.mjs';
import { makeResolverContext, resolveFactRef } from './graph.mjs';
import { CURRENT_SCHEMA_VERSION } from './config.mjs';

// ---------------------------------------------------------------------------
// Test fixtures: two docs sharing an in-memory "parse" -- hand-built, same
// convention as graph.test.mjs, so this stays a unit test of factfile.mjs's
// own validation/canonicalization logic rather than an integration test of
// the whole parser.
// ---------------------------------------------------------------------------

const SOURCE = 'docs/adr/0052-new.md';
const TARGET = 'docs/adr/0009-partial.md';
const SOURCE_TEXT = '# ADR-0052\n\n## Status\n\nAccepted\n\nSupersedes ADR-0009 in part.\n';
const TARGET_TEXT = '# ADR-0009\n\n## Status\n\nAccepted\n';

function doc(overrides = {}) {
  return {
    path: SOURCE,
    hash: 'source-hash',
    includeRoot: 'docs',
    frontmatterType: null,
    type: 'ADR',
    metaType: 'Decision',
    declares: null,
    declaresLine: null,
    status: 'accepted',
    headings: [
      { level: 1, text: 'ADR-0052', anchor: 'adr-0052', line: 1 },
      { level: 2, text: 'Status', anchor: 'status', line: 3 },
    ],
    facts: [],
    findings: [],
    ...overrides,
  };
}

function cfg(overrides = {}) {
  return {
    sources: { include: ['docs'], exclude: [] },
    types: {
      ADR: { metaType: 'Decision', paths: ['docs/adr/**'], idPattern: 'ADR-\\d{4}' },
    },
    relations: {},
    relatedRules: [],
    externalIds: [],
    concepts: [{ name: 'credit limit', aliases: ['hạn mức'] }],
    ...overrides,
  };
}

function makeParsed({ docs, texts }) {
  return { docs, texts };
}

function makeDeps({
  docs = [
    doc(),
    doc({
      path: TARGET,
      declares: 'ADR-0009',
      headings: [
        { level: 1, text: 'ADR-0009', anchor: 'adr-0009', line: 1 },
        { level: 2, text: 'Status', anchor: 'status', line: 3 },
      ],
    }),
  ],
  texts = new Map([[SOURCE, SOURCE_TEXT], [TARGET, TARGET_TEXT]]),
  config = cfg(),
  exists = () => false,
} = {}) {
  const parsed = makeParsed({ docs, texts });
  const ctx = makeResolverContext({ config, parsed, exists });
  const resolve = (raw, citingDoc) => resolveFactRef(raw, citingDoc, ctx);
  return { config, parsed, texts, resolve, ontologyVersion: 'test-ontology-version' };
}

function basicInput(overrides = {}) {
  return {
    source: SOURCE,
    sourceHash: 'source-hash',
    facts: [],
    ...overrides,
  };
}

describe('prepareEnvelope: happy path', () => {
  test('canonicalizes a declared-ID object to its doc: node id, keeps ref as written', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge',
        subject: `doc:${SOURCE}`,
        relation: 'supersedes',
        object: 'ADR-0009',
        scope: 'row: Retry policy',
        evidence: { quote: 'Supersedes ADR-0009' },
        provenance: 'extracted',
      }],
    });
    const envelope = prepareEnvelope(input, deps);
    assert.equal(envelope.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(envelope.source, SOURCE);
    assert.equal(envelope.sourceHash, 'source-hash');
    assert.equal(envelope.ontologyVersion, 'test-ontology-version');
    assert.equal(envelope.facts.length, 1);
    const fact = envelope.facts[0];
    assert.equal(fact.object, `doc:${TARGET}`);
    assert.equal(fact.ref, 'ADR-0009');
    assert.equal(fact.scope, 'row: Retry policy');
    assert.equal(fact.provenance, 'extracted');
    assert.equal(fact.evidence.line, 7); // recomputed, not taken from input
  });

  test('ignores an input evidence.line and recomputes it with findQuoteLine', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge',
        subject: `doc:${SOURCE}`,
        relation: 'references',
        object: 'ADR-0009',
        evidence: { line: 999, quote: 'Supersedes ADR-0009' },
        provenance: 'extracted',
      }],
    });
    const envelope = prepareEnvelope(input, deps);
    assert.equal(envelope.facts[0].evidence.line, 7);
  });

  test('empty facts[] still produces a written envelope', () => {
    const deps = makeDeps();
    const envelope = prepareEnvelope(basicInput(), deps);
    assert.deepEqual(envelope.facts, []);
  });

  test('deterministic: same facts in either input order produce byte-identical serialized output', () => {
    const deps = makeDeps();
    const factA = {
      kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
      evidence: { quote: 'Supersedes ADR-0009' }, provenance: 'extracted',
    };
    const factB = {
      kind: 'edge', subject: `doc:${SOURCE}`, relation: 'mentions', object: 'concept:credit-limit',
      evidence: { quote: 'Accepted' }, provenance: 'extracted',
    };
    const e1 = prepareEnvelope(basicInput({ facts: [factA, factB] }), deps);
    const e2 = prepareEnvelope(basicInput({ facts: [factB, factA] }), deps);
    assert.equal(serializeEnvelope(e1), serializeEnvelope(e2));
  });

  test('two facts sharing an id (same kind/relation/subject/object) but different quotes keep the first', () => {
    const deps = makeDeps();
    const first = {
      kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
      evidence: { quote: 'Supersedes ADR-0009 in part.' }, provenance: 'extracted',
    };
    const second = {
      kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
      evidence: { quote: 'Accepted' }, provenance: 'extracted', // different quote, same id-determining fields
    };
    const envelope = prepareEnvelope(basicInput({ facts: [first, second] }), deps);
    assert.equal(envelope.facts.length, 1);
    assert.equal(envelope.facts[0].evidence.quote, 'Supersedes ADR-0009 in part.');
  });

  test('ref defaults to the written subject for an attr fact', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'attr',
        subject: `frag:${SOURCE}#status`,
        relation: 'status',
        value: 'accepted',
        evidence: { quote: 'Accepted' },
        provenance: 'inferred',
      }],
    });
    const envelope = prepareEnvelope(input, deps);
    assert.equal(envelope.facts[0].ref, `frag:${SOURCE}#status`);
  });

  test('an unknown anchor is retried once through slug()', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'attr',
        subject: `frag:${SOURCE}#Status`,
        relation: 'status',
        value: 'accepted',
        evidence: { quote: 'Accepted' },
        provenance: 'inferred',
      }],
    });
    const envelope = prepareEnvelope(input, deps);
    assert.equal(envelope.facts[0].subject, `frag:${SOURCE}#status`);
  });

  test('a dangling written (unprefixed) object is kept as written, not rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge',
        subject: `doc:${SOURCE}`,
        relation: 'references',
        object: 'ADR-9999',
        evidence: { quote: 'Supersedes ADR-0009' },
        provenance: 'extracted',
      }],
    });
    const envelope = prepareEnvelope(input, deps);
    assert.equal(envelope.facts[0].object, 'ADR-9999');
  });
});

describe('prepareEnvelope: all-or-nothing validation', () => {
  test('a quote not present in the source is rejected with every bad index listed', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [
        {
          kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
          evidence: { quote: 'this text is nowhere in the doc' }, provenance: 'extracted',
        },
        {
          kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
          evidence: { quote: 'also nowhere' }, provenance: 'extracted',
        },
      ],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 2);
      assert.deepEqual(err.errors.map((e) => e.index), [0, 1]);
      return true;
    });
  });

  test('a subject naming another doc is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${TARGET}`, relation: 'references', object: 'ADR-0009',
        evidence: { quote: 'Supersedes ADR-0009' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.match(err.errors[0].message, /subject/);
      return true;
    });
  });

  test('an unknown anchor that still fails after the slug() retry is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'attr', subject: `frag:${SOURCE}#nope`, relation: 'status', value: 'accepted',
        evidence: { quote: 'Accepted' }, provenance: 'inferred',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].index, 0);
      assert.match(err.errors[0].message, /subject/);
      assert.match(err.errors[0].message, /#nope/);
      return true;
    });
  });

  test('a dangling frag: object (unknown anchor) is rejected -- prefixed and does not resolve', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: `frag:${TARGET}#no-such-anchor`,
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].index, 0);
      assert.match(err.errors[0].message, /does not resolve/);
      return true;
    });
  });

  test('an unprefixed path#anchor object with an unknown anchor is rejected, not widened to the doc', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'supersedes', object: `${TARGET}#no-such-anchor`,
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.match(err.errors[0].message, /anchor the target doc does not have/);
      return true;
    });
  });

  test('an unprefixed path#anchor object with a known anchor resolves to the fragment', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'supersedes', object: `${TARGET}#status`,
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.equal(prepareEnvelope(input, deps).facts[0].object, `frag:${TARGET}#status`);
  });

  test('an out-of-scope path#anchor object stays a doc: reference (its anchors are never parsed)', () => {
    const deps = makeDeps({ exists: (p) => p === 'README.md' });
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'README.md#install',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.equal(prepareEnvelope(input, deps).facts[0].object, 'doc:README.md');
  });

  test('an unknown concept object is rejected (prefixed and does not resolve)', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'mentions', object: 'concept:not-a-real-concept',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.match(err.errors[0].message, /does not resolve/);
      return true;
    });
  });

  test('a doc: object that does not resolve is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'doc:docs/does-not-exist.md',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].index, 0);
      assert.match(err.errors[0].message, /does not resolve/);
      return true;
    });
  });

  test('a doc: object with a path-traversal segment is rejected even when it would exist outside the root', () => {
    // `exists` always true here simulates a `doc:../../etc/hosts` whose
    // traversed target happens to exist on disk -- must still be rejected,
    // never statted outside the repo root.
    const deps = makeDeps({ exists: () => true });
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'doc:../../etc/hosts',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].index, 0);
      assert.match(err.errors[0].message, /does not resolve/);
      return true;
    });
  });

  test('scope: an empty string is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009', scope: '',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.match(err.errors[0].message, /scope/);
      return true;
    });
  });

  test('scope: a non-string (number) is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009', scope: 42,
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.match(err.errors[0].message, /scope/);
      return true;
    });
  });

  test('a bad kind is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'nope', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
        evidence: { quote: 'Accepted' }, provenance: 'extracted',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.match(err.errors[0].message, /kind/);
      return true;
    });
  });

  test('a bad provenance is rejected', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [{
        kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
        evidence: { quote: 'Accepted' }, provenance: 'guessed',
      }],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.match(err.errors[0].message, /provenance/);
      return true;
    });
  });

  test('one bad fact rejects the whole call: nothing is built, not even the valid facts', () => {
    const deps = makeDeps();
    const input = basicInput({
      facts: [
        {
          kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
          evidence: { quote: 'Supersedes ADR-0009' }, provenance: 'extracted',
        },
        {
          kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'ADR-0009',
          evidence: { quote: 'not in the doc anywhere' }, provenance: 'extracted',
        },
      ],
    });
    assert.throws(() => prepareEnvelope(input, deps), (err) => {
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].index, 1);
      return true;
    });
  });
});

describe('serializeEnvelope', () => {
  test('pretty JSON with a trailing newline, key order preserved', () => {
    const envelope = {
      schemaVersion: 1, source: SOURCE, sourceHash: 'h', ontologyVersion: 'v', facts: [],
    };
    const text = serializeEnvelope(envelope);
    assert.ok(text.endsWith('\n'));
    assert.equal(text, `${JSON.stringify(envelope, null, 2)}\n`);
    assert.deepEqual(Object.keys(JSON.parse(text)), ['schemaVersion', 'source', 'sourceHash', 'ontologyVersion', 'facts']);
  });
});

describe('verifyEvidence', () => {
  function parsedWith(docs, texts) {
    return { docs, texts };
  }

  test('a broken quote produces one P14 naming the fact id and quote', () => {
    const docA = doc();
    const parsed = parsedWith([docA], new Map([[SOURCE, SOURCE_TEXT]]));
    const facts = new Map([[SOURCE, {
      schemaVersion: 1,
      source: SOURCE,
      sourceHash: docA.hash,
      ontologyVersion: 'v',
      facts: [{
        id: 'abc123', kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'x', ref: 'x',
        evidence: { line: 7, quote: 'this sentence is gone' }, provenance: 'extracted',
      }],
    }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
    assert.equal(findings[0].file, SOURCE);
    assert.equal(findings[0].line, 7);
    assert.match(findings[0].message, /abc123/);
    assert.match(findings[0].message, /this sentence is gone/);
  });

  test('a quote that still matches produces no finding', () => {
    const docA = doc();
    const parsed = parsedWith([docA], new Map([[SOURCE, SOURCE_TEXT]]));
    const facts = new Map([[SOURCE, {
      schemaVersion: 1,
      source: SOURCE,
      sourceHash: docA.hash,
      ontologyVersion: 'v',
      facts: [{
        id: 'abc123', kind: 'edge', subject: `doc:${SOURCE}`, relation: 'references', object: 'x', ref: 'x',
        evidence: { line: 7, quote: 'Supersedes ADR-0009 in part.' }, provenance: 'extracted',
      }],
    }]]);
    assert.deepEqual(verifyEvidence({ parsed, texts: parsed.texts, facts }), []);
  });

  test('an orphan file whose sourceHash matches an in-scope doc is a P15 rename candidate at the new path', () => {
    const renamedDoc = doc({ path: 'docs/adr/0052-renamed.md', hash: 'same-hash' });
    const parsed = parsedWith([renamedDoc], new Map([['docs/adr/0052-renamed.md', SOURCE_TEXT]]));
    const facts = new Map([[SOURCE, {
      schemaVersion: 1, source: SOURCE, sourceHash: 'same-hash', ontologyVersion: 'v', facts: [],
    }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P15');
    assert.equal(findings[0].file, 'docs/adr/0052-renamed.md');
    assert.match(findings[0].message, new RegExp(SOURCE.replace(/[/.]/g, '\\$&')));
  });

  test('an orphan file with no hash match gives one P14 "source gone"', () => {
    const parsed = parsedWith([], new Map());
    const facts = new Map([[SOURCE, {
      schemaVersion: 1, source: SOURCE, sourceHash: 'gone-hash', ontologyVersion: 'v', facts: [],
    }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
    assert.equal(findings[0].file, SOURCE);
    assert.match(findings[0].message, /source gone/);
  });

  test('a malformed (bad JSON) fact file gives one P14 for that file', () => {
    const parsed = parsedWith([], new Map());
    const facts = new Map([[SOURCE, { error: 'Unexpected token' }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
    assert.equal(findings[0].file, SOURCE);
    assert.match(findings[0].message, /malformed/);
  });

  test('an envelope missing required v1 fields gives one P14', () => {
    const parsed = parsedWith([], new Map());
    const facts = new Map([[SOURCE, { schemaVersion: 1, facts: [] }]]); // missing source/sourceHash
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
  });

  test('a newer schemaVersion than the engine understands gives one P14 (not a v1 envelope)', () => {
    const parsed = parsedWith([], new Map());
    const facts = new Map([[SOURCE, {
      schemaVersion: 2, source: SOURCE, sourceHash: 'h', ontologyVersion: 'v', facts: [],
    }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
    assert.equal(findings[0].file, SOURCE);
  });

  test('envelope.source not matching its own loadFacts key gives one P14 naming the fact file', () => {
    const docA = doc();
    const parsed = parsedWith([docA], new Map([[SOURCE, SOURCE_TEXT]]));
    // Committed under key SOURCE, but the envelope claims a different source.
    const facts = new Map([[SOURCE, {
      schemaVersion: 1, source: 'docs/adr/somewhere-else.md', sourceHash: 'h', ontologyVersion: 'v', facts: [],
    }]]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'P14');
    assert.equal(findings[0].file, SOURCE);
    assert.match(findings[0].message, /_lumina\/facts\/docs\/adr\/0052-new\.md\.json/);
  });

  test('P15 is suppressed once the renamed doc has its own committed envelope', () => {
    const renamedPath = 'docs/adr/0052-renamed.md';
    const renamedDoc = doc({ path: renamedPath, hash: 'same-hash' });
    const parsed = parsedWith([renamedDoc], new Map([[renamedPath, SOURCE_TEXT]]));
    const facts = new Map([
      // Orphan: old path, content hash matches the renamed doc.
      [SOURCE, { schemaVersion: 1, source: SOURCE, sourceHash: 'same-hash', ontologyVersion: 'v', facts: [] }],
      // The renamed doc has already been (re-)ingested under its own path.
      [renamedPath, { schemaVersion: 1, source: renamedPath, sourceHash: 'same-hash', ontologyVersion: 'v', facts: [] }],
    ]);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    // No P15 (the only hash-matching doc already owns a committed envelope);
    // the orphaned old entry falls back to the "source gone" P14 instead.
    assert.deepEqual(findings.map((f) => f.id), ['P14']);
    assert.equal(findings[0].file, SOURCE);
    assert.match(findings[0].message, /source gone/);
  });

  test('findings are sorted', () => {
    const docA = doc({ path: 'docs/a.md', hash: 'ha' });
    const docB = doc({ path: 'docs/b.md', hash: 'hb' });
    const texts = new Map([['docs/a.md', 'text a'], ['docs/b.md', 'text b']]);
    const parsed = parsedWith([docA, docB], texts);
    const facts = new Map([
      ['docs/b.md', {
        schemaVersion: 1, source: 'docs/b.md', sourceHash: 'hb', ontologyVersion: 'v',
        facts: [{ id: 'z', kind: 'edge', subject: 'doc:docs/b.md', relation: 'references', object: 'x', ref: 'x', evidence: { line: 1, quote: 'nope' }, provenance: 'extracted' }],
      }],
      ['docs/a.md', {
        schemaVersion: 1, source: 'docs/a.md', sourceHash: 'ha', ontologyVersion: 'v',
        facts: [{ id: 'a', kind: 'edge', subject: 'doc:docs/a.md', relation: 'references', object: 'x', ref: 'x', evidence: { line: 1, quote: 'nope' }, provenance: 'extracted' }],
      }],
    ]);
    const findings = verifyEvidence({ parsed, texts, facts });
    assert.deepEqual(findings.map((f) => f.file), ['docs/a.md', 'docs/b.md']);
  });
});
