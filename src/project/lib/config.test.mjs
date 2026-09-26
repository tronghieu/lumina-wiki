import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  findRoot, loadConfig, ontologyVersion, ConfigError, SchemaVersionError, CURRENT_SCHEMA_VERSION,
} from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test-fixtures');

describe('findRoot', () => {
  test('finds the root at the given directory', async () => {
    const root = join(FIXTURES, 'config-valid');
    assert.equal(await findRoot(root), root);
  });

  test('finds the root when starting from a subdirectory', async () => {
    const root = join(FIXTURES, 'scope-basic');
    assert.equal(await findRoot(join(root, 'docs', 'adr')), root);
  });

  test('returns null when no ancestor holds _lumina/config/project.yaml', async () => {
    // A fresh empty dir outside any repo tree, so no real filesystem
    // ancestor can accidentally supply a project.yaml.
    const dir = await mkdtemp(join(tmpdir(), 'lumina-project-no-root-'));
    try {
      assert.equal(await findRoot(dir), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfig: valid', () => {
  test('loads and defaults a valid config', async () => {
    const root = join(FIXTURES, 'config-valid');
    const config = await loadConfig(root);
    assert.equal(config.schemaVersion, 1);
    assert.deepEqual(config.sources, { include: ['docs'], exclude: [] });
    assert.equal(config.types.ADR.metaType, 'Decision');
    assert.equal(config.relations.implements, 'satisfies');
    assert.equal(config.relatedRules.length, 1);
    assert.equal(config.externalIds.length, 1);
    assert.equal(config.concepts.length, 1);
  });

  test('defaults sources to include: [docs] when absent', async () => {
    const root = join(FIXTURES, 'scope-basic');
    const config = await loadConfig(root);
    assert.deepEqual(config.sources, { include: ['docs'], exclude: [] });
    assert.deepEqual(config.types, {});
    assert.deepEqual(config.relations, {});
    assert.deepEqual(config.relatedRules, []);
    assert.deepEqual(config.externalIds, []);
    assert.deepEqual(config.concepts, []);
  });

  test('loading the same config twice is byte-identical', async () => {
    const root = join(FIXTURES, 'config-valid');
    const a = await loadConfig(root);
    const b = await loadConfig(root);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});

describe('loadConfig: invalid', () => {
  test('collects every problem at once: unknown key, unknown meta-type, bad regex, duplicate concept slug', async () => {
    const root = join(FIXTURES, 'config-invalid');
    await assert.rejects(loadConfig(root), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 2);
      assert.ok(err.errors.some((e) => /unknown top-level key "notARealKey"/.test(e)), 'unknown key');
      assert.ok(err.errors.some((e) => /unknown meta-type "NotAMetaType"/.test(e)), 'unknown meta-type');
      assert.ok(err.errors.some((e) => /bad regex/.test(e)), 'bad regex');
      assert.ok(err.errors.some((e) => /unknown meta-relation "not-a-real-relation"/.test(e)), 'unknown meta-relation');
      assert.ok(
        err.errors.includes('concepts: slug "hạn-mức" shared by "credit limit" and "Hạn Mức"'),
        'duplicate concept slug',
      );
      assert.ok(err.errors.some((e) => /\.\.\/escape/.test(e)), 'unsafe source pattern');
      assert.equal(err.errors.filter((e) => /negation and \{a,b\}/.test(e)).length, 2, 'negation and braces');
      return true;
    });
  });

  test('one bad entry per rule: status-both-keys, missing paths/frontmatter, nested unknown key, relatedRules bad source/target/relation/inverse, bad externalIds regex, missing schemaVersion, "?" glob, duplicate exact concept name, empty slug, empty include, prototype-key metaType', async () => {
    const root = join(FIXTURES, 'config-invalid-2');
    await assert.rejects(loadConfig(root), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 2);
      const errs = err.errors;
      assert.ok(errs.some((e) => /schemaVersion: must be an integer/.test(e)), 'missing schemaVersion');
      assert.ok(errs.some((e) => /sources\.include: must not be empty/.test(e)), 'empty include');
      assert.ok(errs.some((e) => /types\.TypeA\.status: must have exactly one/.test(e)), 'status both keys');
      assert.ok(errs.some((e) => /types\.TypeB: requires at least one/.test(e)), 'missing paths/frontmatter');
      assert.ok(errs.some((e) => /types\.TypeC: unknown key "bogusKey"/.test(e)), 'nested unknown key');
      assert.ok(errs.some((e) => /types\.TypeD\.metaType: unknown meta-type "toString"/.test(e)), 'prototype-key metaType');
      assert.ok(errs.some((e) => /types\.TypeE\.paths\[0\]/.test(e)), '"?" glob rejected');
      assert.ok(errs.some((e) => /relatedRules\[0\]\.source: unknown meta-type "BadSource"/.test(e)), 'relatedRules bad source');
      assert.ok(errs.some((e) => /relatedRules\[1\]\.target: unknown meta-type "BadTarget"/.test(e)), 'relatedRules bad target');
      assert.ok(errs.some((e) => /relatedRules\[2\]\.relation: unknown meta-relation "bad-relation"/.test(e)), 'relatedRules bad relation');
      assert.ok(errs.some((e) => /relatedRules\[3\]\.inverse: must be a boolean/.test(e)), 'relatedRules bad inverse');
      assert.ok(errs.some((e) => /externalIds\[0\]\.pattern: bad regex/.test(e)), 'bad externalIds regex');
      assert.ok(errs.includes('concepts: slug "foo" shared by "Foo" and "Foo"'), 'duplicate exact concept name');
      assert.ok(errs.some((e) => /concepts\[2\]: name or alias must not slug to an empty string/.test(e)), 'empty slug');
      return true;
    });
  });

  test('BOM + CRLF config with a Vietnamese concept loads', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-crlf'));
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.concepts[0].name, 'hạn mức tín dụng');
  });

  test('YAML syntax error surfaces the parser message with code 2', async () => {
    const root = join(FIXTURES, 'config-yaml-error');
    await assert.rejects(loadConfig(root), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 2);
      assert.ok(/YAML syntax error/.test(err.message));
      return true;
    });
  });
});

describe('loadConfig: newer schemaVersion', () => {
  test('throws SchemaVersionError with code 3', async () => {
    const root = join(FIXTURES, 'config-newer-schema');
    await assert.rejects(loadConfig(root), (err) => {
      assert.ok(err instanceof SchemaVersionError);
      assert.equal(err.code, 3);
      assert.equal(err.schemaVersion, 2);
      return true;
    });
  });
});

describe('ontologyVersion', () => {
  test('is a 64-char lowercase hex digest', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const v = ontologyVersion(config);
    assert.match(v, /^[0-9a-f]{64}$/);
  });

  test('is stable across repeated calls on the same config', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.equal(ontologyVersion(config), ontologyVersion(config));
  });

  test('changes when the type map changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = { ...config, types: { ...config.types, Other: { metaType: 'Issue' } } };
    assert.notEqual(ontologyVersion(config), ontologyVersion(changed));
  });

  test('changes when relations changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = { ...config, relations: { ...config.relations, tracks: 'mentions' } };
    assert.notEqual(ontologyVersion(config), ontologyVersion(changed));
  });

  test('changes when relatedRules changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = {
      ...config,
      relatedRules: [...config.relatedRules, { source: 'Decision', target: 'Requirement', relation: 'satisfies' }],
    };
    assert.notEqual(ontologyVersion(config), ontologyVersion(changed));
  });

  test('changes when concepts changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = { ...config, concepts: [...config.concepts, { name: 'another concept' }] };
    assert.notEqual(ontologyVersion(config), ontologyVersion(changed));
  });

  test('does not depend on sources (not an ontology-relevant section)', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = { ...config, sources: { include: ['somewhere-else'], exclude: [] } };
    assert.equal(ontologyVersion(config), ontologyVersion(changed));
  });
});

test('CURRENT_SCHEMA_VERSION is 1', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
});
