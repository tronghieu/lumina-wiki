/**
 * @file schemas.test.mjs
 * @description Tests for schemas.mjs — entity dirs, exemption globs, and required frontmatter.
 * Run with: node --test src/scripts/schemas.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITY_DIRS, EDGE_TYPES, EXEMPTION_GLOBS, REQUIRED_FRONTMATTER } from './schemas.mjs';

test('ENTITY_DIRS contains reflections entry with pack learning', () => {
  assert.ok('reflections' in ENTITY_DIRS, 'reflections key missing from ENTITY_DIRS');
  assert.equal(ENTITY_DIRS.reflections.pack, 'learning', 'reflections pack must be learning');
  assert.ok(
    ENTITY_DIRS.reflections.dir.includes('reflections'),
    'reflections dir path must include reflections',
  );
});

test('EXEMPTION_GLOBS contains reflections/**', () => {
  assert.ok(
    EXEMPTION_GLOBS.includes('reflections/**'),
    'reflections/** must be in EXEMPTION_GLOBS',
  );
});

test('REQUIRED_FRONTMATTER.reflections has all required keys', () => {
  assert.ok(
    Array.isArray(REQUIRED_FRONTMATTER.reflections),
    'REQUIRED_FRONTMATTER.reflections must be an array',
  );
  const requiredKeys = ['id', 'title', 'type', 'created', 'updated', 'related_concepts', 'related_sources', 'evolution_count'];
  const definedKeys = REQUIRED_FRONTMATTER.reflections.map(f => f.key);
  for (const key of requiredKeys) {
    assert.ok(
      definedKeys.includes(key),
      `REQUIRED_FRONTMATTER.reflections missing key: ${key}`,
    );
  }
});

test('REQUIRED_FRONTMATTER.reflections all entries have pack learning', () => {
  for (const field of REQUIRED_FRONTMATTER.reflections) {
    assert.equal(
      field.pack, 'learning',
      `field ${field.key}: pack must be learning, got ${field.pack}`,
    );
  }
});

test('REQUIRED_FRONTMATTER.reflections required fields are all marked required', () => {
  for (const field of REQUIRED_FRONTMATTER.reflections) {
    assert.equal(
      field.required, true,
      `field ${field.key}: required must be true`,
    );
  }
});

test('EDGE_TYPES defines topic organization edges with consistent reverse pairs', () => {
  const byName = Object.fromEntries(EDGE_TYPES.map(e => [e.name, e]));
  const pairs = [
    ['includes_source', 'topics', 'sources', 'included_in_topic'],
    ['included_in_topic', 'sources', 'topics', 'includes_source'],
    ['covers_concept', 'topics', 'concepts', 'covered_by_topic'],
    ['covered_by_topic', 'concepts', 'topics', 'covers_concept'],
  ];
  for (const [name, from, to, reverse] of pairs) {
    const edge = byName[name];
    assert.ok(edge, `EDGE_TYPES missing ${name}`);
    assert.equal(edge.from, from, `${name}.from mismatch`);
    assert.equal(edge.to, to, `${name}.to mismatch`);
    assert.equal(edge.reverse, reverse, `${name}.reverse mismatch`);
    assert.equal(edge.symmetric, false, `${name} must not be symmetric`);
    assert.equal(edge.pack, 'research', `${name} must be pack: research`);
    // Reverse pair must point back consistently.
    const reverseEdge = byName[reverse];
    assert.ok(reverseEdge, `EDGE_TYPES missing reverse ${reverse}`);
    assert.equal(reverseEdge.reverse, name, `${reverse}.reverse must be ${name}`);
    assert.equal(reverseEdge.from, to, `${reverse}.from must equal ${name}.to`);
    assert.equal(reverseEdge.to, from, `${reverse}.to must equal ${name}.from`);
  }
});

test('ENTITY_DIRS contains readings entry with pack core', () => {
  assert.ok('readings' in ENTITY_DIRS, 'readings key missing from ENTITY_DIRS');
  assert.equal(ENTITY_DIRS.readings.pack, 'core', 'readings pack must be core');
  assert.equal(ENTITY_DIRS.readings.dir, 'readings/', 'readings dir must be readings/');
});

test('EDGE_TYPES defines annotates/annotated_by as a consistent core reverse pair', () => {
  const byName = Object.fromEntries(EDGE_TYPES.map(e => [e.name, e]));
  const annotates = byName.annotates;
  const annotatedBy = byName.annotated_by;
  assert.ok(annotates, 'EDGE_TYPES missing annotates');
  assert.ok(annotatedBy, 'EDGE_TYPES missing annotated_by');
  assert.equal(annotates.from, 'readings');
  assert.equal(annotates.to, 'sources');
  assert.equal(annotates.reverse, 'annotated_by');
  assert.equal(annotates.symmetric, false);
  assert.equal(annotates.pack, 'core');
  assert.equal(annotatedBy.from, 'sources');
  assert.equal(annotatedBy.to, 'readings');
  assert.equal(annotatedBy.reverse, 'annotates');
  assert.equal(annotatedBy.pack, 'core');
});

test('REQUIRED_FRONTMATTER.readings has base keys plus source and part', () => {
  assert.ok(Array.isArray(REQUIRED_FRONTMATTER.readings), 'REQUIRED_FRONTMATTER.readings must be an array');
  const definedKeys = REQUIRED_FRONTMATTER.readings.map(f => f.key);
  for (const key of ['id', 'title', 'type', 'created', 'updated', 'source', 'part']) {
    assert.ok(definedKeys.includes(key), `REQUIRED_FRONTMATTER.readings missing key: ${key}`);
  }
  const source = REQUIRED_FRONTMATTER.readings.find(f => f.key === 'source');
  assert.equal(source.type, 'string');
  assert.equal(source.required, true);
  const part = REQUIRED_FRONTMATTER.readings.find(f => f.key === 'part');
  assert.equal(part.type, 'number');
  assert.equal(part.required, true);
  const pages = REQUIRED_FRONTMATTER.readings.find(f => f.key === 'pages');
  assert.ok(pages, 'readings must define optional pages field');
  assert.equal(pages.required, false);
});

test('REQUIRED_FRONTMATTER.sources has optional ranking object field', () => {
  const ranking = REQUIRED_FRONTMATTER.sources.find(f => f.key === 'ranking');
  assert.ok(ranking, 'sources must define a ranking field');
  assert.equal(ranking.type, 'object', 'ranking must be an object field');
  assert.equal(ranking.required, false, 'ranking must be optional (un-ranked pages lint clean)');
});
