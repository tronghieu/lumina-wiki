/**
 * @file schemas.test.mjs
 * @description Tests for schemas.mjs — entity dirs, exemption globs, and required frontmatter.
 * Run with: node --test src/scripts/schemas.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITY_DIRS, EXEMPTION_GLOBS, REQUIRED_FRONTMATTER } from './schemas.mjs';

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
