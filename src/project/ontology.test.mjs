import { test } from 'node:test';
import assert from 'node:assert/strict';
import { META_TYPES, META_RELATIONS, RULES } from './ontology.mjs';

test('META_TYPES has the eleven fixed meta-types with governance on the first three', () => {
  const names = Object.keys(META_TYPES);
  assert.deepEqual(names, [
    'Decision', 'Requirement', 'Rule', 'Capability', 'Process',
    'Structure', 'Concept', 'Actor', 'Issue', 'Evidence', 'Document',
  ]);
  assert.equal(META_TYPES.Decision.governance, true);
  assert.equal(META_TYPES.Requirement.governance, true);
  assert.equal(META_TYPES.Rule.governance, true);
  for (const name of names.slice(3)) {
    assert.equal(META_TYPES[name].governance, false, `${name} must not be governance`);
  }
});

test('Decision carries the six-state lifecycle; no other meta-type does', () => {
  assert.deepEqual(META_TYPES.Decision.lifecycle, ['proposed', 'accepted', 'rejected', 'partially-superseded', 'superseded', 'deprecated']);
  for (const [name, entry] of Object.entries(META_TYPES)) {
    if (name === 'Decision') continue;
    assert.equal(entry.lifecycle, undefined, `${name} must not carry a lifecycle`);
  }
});

test('META_RELATIONS is the fixed ten relations, references last', () => {
  assert.deepEqual(META_RELATIONS, [
    'supersedes', 'satisfies', 'governs', 'depends-on', 'part-of',
    'contradicts', 'justified-by', 'owned-by', 'mentions', 'references',
  ]);
});

test('RULES ids are unique', () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('RULES owners are each a meta-relation or "engine"', () => {
  const validOwners = new Set([...META_RELATIONS, 'engine']);
  for (const rule of RULES) {
    assert.ok(validOwners.has(rule.owner), `${rule.id} has invalid owner ${rule.owner}`);
  }
});

test('RULES severities are one of error, warning, info', () => {
  const validSeverities = new Set(['error', 'warning', 'info']);
  for (const rule of RULES) {
    assert.ok(validSeverities.has(rule.severity), `${rule.id} has invalid severity ${rule.severity}`);
  }
});

test('every relation-owned rule id P01-P08 maps to the relation named in ontology.md', () => {
  const expected = {
    P01: 'supersedes', P02: 'supersedes', P03: 'supersedes',
    P04: 'satisfies', P05: 'governs', P06: 'depends-on',
    P07: 'part-of', P08: 'contradicts',
  };
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));
  for (const [id, owner] of Object.entries(expected)) {
    assert.equal(byId[id].owner, owner, `${id} owner mismatch`);
  }
});

test('engine rules P09-P21 are all owned by "engine"', () => {
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));
  for (const id of ['P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21']) {
    assert.equal(byId[id].owner, 'engine', `${id} must be owned by engine`);
  }
});

test('all exports are frozen (pure data)', () => {
  assert.ok(Object.isFrozen(META_TYPES));
  for (const entry of Object.values(META_TYPES)) assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(META_RELATIONS));
  assert.ok(Object.isFrozen(RULES));
  for (const rule of RULES) assert.ok(Object.isFrozen(rule));
});
