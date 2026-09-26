import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lintGraph } from './lint.mjs';

// ---------------------------------------------------------------------------
// Test helpers: hand-built graph/parsed objects (post-`buildGraph` shape),
// same convention as `graph.test.mjs`'s hand-built parsed docs -- `lint.mjs`
// is exercised in isolation from `buildGraph`, as a pure function of
// {nodes, edges} and `parsed.docs` (for P04's `declaresLine`).
// ---------------------------------------------------------------------------

function node(overrides = {}) {
  return { id: 'doc:docs/a.md', kind: 'doc', inScope: true, ...overrides };
}

function ev({
  file, line, quote = 'evidence', provenance = 'extracted', scope,
}) {
  return { file, line, quote, provenance, ...(scope !== undefined ? { scope } : {}) };
}

function edge({ from, relation, to, evidence }) {
  return { from, relation, to, evidence };
}

function run({ nodes, edges, docs = [] }) {
  return lintGraph({ graph: { nodes, edges }, parsed: { docs } });
}

function findingsOf(findings, id) {
  return findings.filter((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Cycles: P01 (supersedes), P06 (depends-on), P07 (part-of).
// ---------------------------------------------------------------------------

describe('cycles', () => {
  for (const [relation, ruleId] of [['supersedes', 'P01'], ['depends-on', 'P06'], ['part-of', 'P07']]) {
    test(`a 2-node ${relation} cycle is one ${ruleId}, at the smallest edge's evidence, members sorted`, () => {
      const nodes = [node({ id: 'doc:docs/a.md' }), node({ id: 'doc:docs/b.md' })];
      const edges = [
        edge({
          from: 'doc:docs/a.md', relation, to: 'doc:docs/b.md', evidence: [ev({ file: 'docs/a.md', line: 3 })],
        }),
        edge({
          from: 'doc:docs/b.md', relation, to: 'doc:docs/a.md', evidence: [ev({ file: 'docs/b.md', line: 9 })],
        }),
      ];
      const findings = findingsOf(run({ nodes, edges }), ruleId);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].file, 'docs/a.md');
      assert.equal(findings[0].line, 3);
      assert.match(findings[0].message, /doc:docs\/a\.md, doc:docs\/b\.md/);
    });
  }

  test('no cycle -> no P01', () => {
    const nodes = [node({ id: 'doc:docs/a.md' }), node({ id: 'doc:docs/b.md' })];
    const edges = [
      edge({
        from: 'doc:docs/a.md', relation: 'supersedes', to: 'doc:docs/b.md', evidence: [ev({ file: 'docs/a.md', line: 1 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P01').length, 0);
  });

  test('a frag: id normalizes to its own doc: doc:A depends-on frag:B#x + doc:B depends-on doc:A is a 2-node cycle', () => {
    const nodes = [
      node({ id: 'doc:docs/a.md' }),
      node({ id: 'doc:docs/b.md' }),
      node({ id: 'frag:docs/b.md#x', kind: 'frag' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/a.md', relation: 'depends-on', to: 'frag:docs/b.md#x', evidence: [ev({ file: 'docs/a.md', line: 3 })],
      }),
      edge({
        from: 'doc:docs/b.md', relation: 'depends-on', to: 'doc:docs/a.md', evidence: [ev({ file: 'docs/b.md', line: 9 })],
      }),
    ];
    const findings = findingsOf(run({ nodes, edges }), 'P06');
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /doc:docs\/a\.md, doc:docs\/b\.md/);
  });

  test('a doc depending on its own fragment is a self-loop after normalizing, never a cycle', () => {
    const nodes = [node({ id: 'doc:docs/a.md' }), node({ id: 'frag:docs/a.md#x', kind: 'frag' })];
    const edges = [
      edge({
        from: 'doc:docs/a.md', relation: 'depends-on', to: 'frag:docs/a.md#x', evidence: [ev({ file: 'docs/a.md', line: 3 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P06').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Supersedes: P02 (target status), P03 (citers).
// ---------------------------------------------------------------------------

describe('supersedes: full', () => {
  test('P03 fires for every other edge into the fully-superseded doc, except from the superseding doc', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
      node({ id: 'doc:docs/citer.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
      edge({
        from: 'doc:docs/citer.md', relation: 'references', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/citer.md', line: 7 })],
      }),
    ];
    const findings = run({ nodes, edges });
    assert.equal(findingsOf(findings, 'P02').length, 0); // target status is superseded: no P02
    const p03 = findingsOf(findings, 'P03');
    assert.equal(p03.length, 1);
    assert.equal(p03[0].file, 'docs/citer.md');
    assert.equal(p03[0].line, 7);
  });

  test('P02 fires when the full target status is not superseded', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
    ];
    const p02 = findingsOf(run({ nodes, edges }), 'P02');
    assert.equal(p02.length, 1);
    assert.equal(p02[0].file, 'docs/s.md');
    assert.equal(p02[0].line, 5);
  });

  test('no status on the target -> no P02', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision' }), // no status
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P02').length, 0);
  });
});

describe('supersedes: partial, fragment', () => {
  test('P03 fires only for edges into the exact fragment, not the whole doc', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'partially-superseded' }),
      node({ id: 'frag:docs/t.md#row-a', kind: 'frag' }),
      node({ id: 'doc:docs/citer-a.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/citer-whole.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'frag:docs/t.md#row-a', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
      edge({
        from: 'doc:docs/citer-a.md', relation: 'references', to: 'frag:docs/t.md#row-a', evidence: [ev({ file: 'docs/citer-a.md', line: 2 })],
      }),
      edge({
        from: 'doc:docs/citer-whole.md', relation: 'references', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/citer-whole.md', line: 2 })],
      }),
    ];
    const p03 = findingsOf(run({ nodes, edges }), 'P03');
    assert.equal(p03.length, 1);
    assert.equal(p03[0].file, 'docs/citer-a.md');
  });

  test('P02 accepts superseded or partially-superseded for a partial target', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'frag:docs/t.md#row-a', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P02').length, 0);
  });

  test('P02 fires for a partial target whose status is neither superseded nor partially-superseded', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'frag:docs/t.md#row-a', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P02').length, 1);
  });

  test('a frag: node\'s own status wins over its doc\'s for P02 (frag superseded under an accepted doc -> no P02)', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'frag:docs/t.md#row-a', kind: 'frag', status: 'superseded' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'frag:docs/t.md#row-a', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P02').length, 0);
  });
});

describe('supersedes: mutual-superseder and self-reference exclusion', () => {
  test('two superseders of one target give no P03 on each other', () => {
    const nodes = [
      node({ id: 'doc:docs/s1.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/s2.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s1.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/t.md', line: 2 })],
      }),
      edge({
        from: 'doc:docs/s2.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/t.md', line: 3 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P03').length, 0);
  });

  test('a fragment citer of a fully superseded doc gets P03', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
      node({ id: 'frag:docs/t.md#row', kind: 'frag' }),
      node({ id: 'doc:docs/citer.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
      edge({
        from: 'doc:docs/citer.md', relation: 'references', to: 'frag:docs/t.md#row', evidence: [ev({ file: 'docs/citer.md', line: 2 })],
      }),
    ];
    const p03 = findingsOf(run({ nodes, edges }), 'P03');
    assert.equal(p03.length, 1);
    assert.equal(p03[0].file, 'docs/citer.md');
  });

  test('the target doc\'s own edge into its own fragment is never a P03 citer of itself', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
      node({ id: 'frag:docs/t.md#row', kind: 'frag' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
      edge({
        from: 'doc:docs/t.md', relation: 'references', to: 'frag:docs/t.md#row', evidence: [ev({ file: 'docs/t.md', line: 2 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P03').length, 0);
  });

  test('the superseding doc\'s own fragment citing the target is never a P03 citer', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'superseded' }),
      node({ id: 'frag:docs/s.md#note', kind: 'frag' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md', relation: 'supersedes', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 5 })],
      }),
      edge({
        from: 'frag:docs/s.md#note', relation: 'references', to: 'doc:docs/t.md', evidence: [ev({ file: 'docs/s.md', line: 8 })],
      }),
    ];
    assert.equal(findingsOf(run({ nodes, edges }), 'P03').length, 0);
  });
});

describe('supersedes: partial, scope', () => {
  test('P03 fires only for citing evidence with the matching scope; scope-less citers are not flagged', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'partially-superseded' }),
      node({ id: 'doc:docs/citer.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/scopeless.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md',
        relation: 'supersedes',
        to: 'doc:docs/t.md',
        evidence: [ev({
          file: 'docs/s.md', line: 5, scope: 'row: Retry policy',
        })],
      }),
      edge({
        from: 'doc:docs/citer.md',
        relation: 'references',
        to: 'doc:docs/t.md',
        evidence: [
          ev({
            file: 'docs/citer.md', line: 2, quote: 'matches', scope: 'row: Retry policy',
          }),
          ev({
            file: 'docs/citer.md', line: 3, quote: 'no scope here',
          }),
          ev({
            file: 'docs/citer.md', line: 4, quote: 'different scope', scope: 'row: Something else',
          }),
        ],
      }),
      edge({
        from: 'doc:docs/scopeless.md',
        relation: 'references',
        to: 'doc:docs/t.md',
        evidence: [ev({ file: 'docs/scopeless.md', line: 2 })],
      }),
    ];
    const p03 = findingsOf(run({ nodes, edges }), 'P03');
    assert.equal(p03.length, 1);
    assert.equal(p03[0].file, 'docs/citer.md');
    assert.equal(p03[0].line, 2);
  });
});

describe('supersedes: mixed evidence (unscoped + scoped on the same pair)', () => {
  test('treated as partial: P02 accepts partially-superseded, P03 keys on the scoped citers only', () => {
    const nodes = [
      node({ id: 'doc:docs/s.md', metaType: 'Decision', status: 'accepted' }),
      node({ id: 'doc:docs/t.md', metaType: 'Decision', status: 'partially-superseded' }),
      node({ id: 'doc:docs/citer.md', metaType: 'Decision', status: 'accepted' }),
    ];
    const edges = [
      edge({
        from: 'doc:docs/s.md',
        relation: 'supersedes',
        to: 'doc:docs/t.md',
        evidence: [
          ev({ file: 'docs/s.md', line: 4, quote: 'related: parsed link' }), // unscoped, e.g. a parsed frontmatter link
          ev({
            file: 'docs/s.md', line: 5, quote: 'agent scoped fact', scope: 'row: Retry policy',
          }),
        ],
      }),
      edge({
        from: 'doc:docs/citer.md',
        relation: 'references',
        to: 'doc:docs/t.md',
        evidence: [ev({
          file: 'docs/citer.md', line: 2, scope: 'row: Retry policy',
        })],
      }),
    ];
    const findings = run({ nodes, edges });
    assert.equal(findingsOf(findings, 'P02').length, 0); // partially-superseded accepted
    assert.equal(findingsOf(findings, 'P03').length, 1);
  });
});

// ---------------------------------------------------------------------------
// P04 (satisfies), P05 (governs), P08 (contradicts).
// ---------------------------------------------------------------------------

describe('satisfies (P04)', () => {
  test('an in-scope Requirement doc with no incoming satisfies is flagged at declaresLine', () => {
    const nodes = [node({ id: 'doc:docs/fr.md', metaType: 'Requirement', inScope: true })];
    const docs = [{ path: 'docs/fr.md', declaresLine: 3 }];
    const findings = findingsOf(run({ nodes, edges: [], docs }), 'P04');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'docs/fr.md');
    assert.equal(findings[0].line, 3);
  });

  test('falls back to line 1 when declaresLine is missing', () => {
    const nodes = [node({ id: 'doc:docs/fr.md', metaType: 'Requirement', inScope: true })];
    const findings = findingsOf(run({ nodes, edges: [] }), 'P04');
    assert.equal(findings[0].line, 1);
  });

  test('a satisfied requirement is not flagged', () => {
    const nodes = [
      node({ id: 'doc:docs/fr.md', metaType: 'Requirement', inScope: true }),
      node({ id: 'doc:docs/dec.md', metaType: 'Decision', inScope: true }),
    ];
    const edges = [edge({
      from: 'doc:docs/dec.md', relation: 'satisfies', to: 'doc:docs/fr.md', evidence: [ev({ file: 'docs/dec.md', line: 1 })],
    })];
    assert.equal(findingsOf(run({ nodes, edges }), 'P04').length, 0);
  });

  test('an out-of-scope Requirement node is not flagged', () => {
    const nodes = [node({ id: 'doc:docs/fr.md', metaType: 'Requirement', inScope: false })];
    assert.equal(findingsOf(run({ nodes, edges: [] }), 'P04').length, 0);
  });

  test('a satisfies edge into a fragment of the Requirement doc satisfies the whole doc', () => {
    const nodes = [
      node({ id: 'doc:docs/fr.md', metaType: 'Requirement', inScope: true }),
      node({ id: 'frag:docs/fr.md#fr-1', kind: 'frag' }),
      node({ id: 'doc:docs/dec.md', metaType: 'Decision', inScope: true }),
    ];
    const edges = [edge({
      from: 'doc:docs/dec.md', relation: 'satisfies', to: 'frag:docs/fr.md#fr-1', evidence: [ev({ file: 'docs/dec.md', line: 1 })],
    })];
    assert.equal(findingsOf(run({ nodes, edges }), 'P04').length, 0);
  });
});

describe('governs (P05)', () => {
  test('a governor whose status is superseded is flagged at every evidence of the edge', () => {
    const nodes = [
      node({ id: 'doc:docs/gov.md', metaType: 'Decision', status: 'superseded' }),
      node({ id: 'doc:docs/cap.md', metaType: 'Capability' }),
    ];
    const edges = [edge({
      from: 'doc:docs/gov.md',
      relation: 'governs',
      to: 'doc:docs/cap.md',
      evidence: [ev({ file: 'docs/gov.md', line: 1 }), ev({ file: 'docs/gov.md', line: 8 })],
    })];
    const findings = findingsOf(run({ nodes, edges }), 'P05');
    assert.equal(findings.length, 2);
  });

  test('a partially-superseded governor is not flagged', () => {
    const nodes = [
      node({ id: 'doc:docs/gov.md', metaType: 'Decision', status: 'partially-superseded' }),
      node({ id: 'doc:docs/cap.md', metaType: 'Capability' }),
    ];
    const edges = [edge({
      from: 'doc:docs/gov.md', relation: 'governs', to: 'doc:docs/cap.md', evidence: [ev({ file: 'docs/gov.md', line: 1 })],
    })];
    assert.equal(findingsOf(run({ nodes, edges }), 'P05').length, 0);
  });
});

describe('contradicts (P08)', () => {
  test('any contradicts edge is flagged at its first evidence', () => {
    const nodes = [
      node({ id: 'doc:docs/a.md', metaType: 'Decision' }),
      node({ id: 'doc:docs/b.md', metaType: 'Decision' }),
    ];
    const edges = [edge({
      from: 'doc:docs/a.md',
      relation: 'contradicts',
      to: 'doc:docs/b.md',
      evidence: [ev({ file: 'docs/a.md', line: 9 }), ev({ file: 'docs/a.md', line: 20 })],
    })];
    const findings = findingsOf(run({ nodes, edges }), 'P08');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 9);
  });
});

// ---------------------------------------------------------------------------
// Output is sorted (byte-identical on unchanged input is the CLI's job;
// here just confirm lintGraph itself returns a stably sorted list).
// ---------------------------------------------------------------------------

test('findings are sorted by (file, line, id, message)', () => {
  const nodes = [
    node({ id: 'doc:docs/a.md', metaType: 'Decision' }),
    node({ id: 'doc:docs/b.md', metaType: 'Decision' }),
  ];
  const edges = [
    edge({
      from: 'doc:docs/b.md', relation: 'contradicts', to: 'doc:docs/a.md', evidence: [ev({ file: 'docs/b.md', line: 1 })],
    }),
    edge({
      from: 'doc:docs/a.md', relation: 'contradicts', to: 'doc:docs/b.md', evidence: [ev({ file: 'docs/a.md', line: 1 })],
    }),
  ];
  const findings = run({ nodes, edges });
  const files = findings.map((f) => f.file);
  assert.deepEqual(files, [...files].sort());
});
