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

/** The `ConfigError.errors` array for a fixture expected to reject. */
async function invalidErrors(dir) {
  try {
    await loadConfig(join(FIXTURES, dir));
  } catch (err) {
    if (err instanceof ConfigError) return err.errors;
    throw err;
  }
  throw new Error(`expected loadConfig(${dir}) to reject`);
}

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
    assert.deepEqual(config.relations.implements, { relation: 'satisfies', inverse: false });
    assert.equal(config.relatedRules.length, 1);
    assert.equal(config.externalIds.length, 1);
    assert.equal(config.concepts.length, 1);
  });

  test('normalizes a single-source status object with a map', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.types.ADR.status, {
      sources: [{ heading: 'Status' }],
      map: { 'Đã duyệt': 'accepted' },
    });
  });

  test('normalizes an ordered-list status with no map to map: {}', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.types.Convention.status, {
      sources: [{ frontmatter: 'status' }, { heading: 'Status' }],
      map: {},
    });
  });

  test('normalizes the wrapped {sources, map} shape (ordered list with a map, the Seli pilot case)', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.types.RFC.status, {
      sources: [{ frontmatter: 'status' }, { heading: 'Status' }],
      map: { 'Đã duyệt': 'accepted' },
    });
  });

  test('normalizes an NFD-spelled status map key to NFC', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.types.KEP.status.map, { ['Đã duyệt'.normalize('NFC')]: 'accepted' });
  });

  test('normalizes a relations object-shape value to {relation, inverse}', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.relations.supersededBy, { relation: 'supersedes', inverse: true });
  });

  test('externalIds keeps an optional metaType', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    assert.deepEqual(config.externalIds[0], { pattern: 'FR[\\w.-]+', metaType: 'Requirement' });
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
  test('config-invalid rejects with a ConfigError, code 2', async () => {
    await assert.rejects(
      loadConfig(join(FIXTURES, 'config-invalid')),
      (err) => err instanceof ConfigError && err.code === 2,
    );
  });

  test('unknown top-level key is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.some((e) => /unknown top-level key "notARealKey"/.test(e)));
  });

  test('unknown meta-type is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.some((e) => /unknown meta-type "NotAMetaType"/.test(e)));
  });

  test('bad idPattern regex is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.some((e) => /bad regex/.test(e)));
  });

  test('unknown meta-relation (string form) is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.some((e) => /unknown meta-relation "not-a-real-relation"/.test(e)));
  });

  test('duplicate concept slug is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.includes('concepts: slug "hạn-mức" shared by "credit limit" and "Hạn Mức"'));
  });

  test('unsafe source pattern ("../escape") is reported', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.ok(errs.some((e) => /\.\.\/escape/.test(e)));
  });

  test('both "!" negation and "{a,b}" patterns are rejected', async () => {
    const errs = await invalidErrors('config-invalid');
    assert.equal(errs.filter((e) => /negation and \{a,b\}/.test(e)).length, 2);
  });

  test('config-invalid-2 rejects with a ConfigError, code 2', async () => {
    await assert.rejects(
      loadConfig(join(FIXTURES, 'config-invalid-2')),
      (err) => err instanceof ConfigError && err.code === 2,
    );
  });

  test('missing schemaVersion is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /schemaVersion: must be an integer/.test(e)));
  });

  test('empty sources.include is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /sources\.include: must not be empty/.test(e)));
  });

  test('status with both "heading" and "frontmatter" is reported (TypeA)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeA\.status: must have exactly one/.test(e)));
  });

  test('type missing both "paths" and "frontmatter" is reported (TypeB)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeB: requires at least one/.test(e)));
  });

  test('unknown nested type key is reported (TypeC)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeC: unknown key "bogusKey"/.test(e)));
  });

  test('a prototype-property name is not a valid metaType (TypeD)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeD\.metaType: unknown meta-type "toString"/.test(e)));
  });

  test('a "?" glob character is rejected (TypeE)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeE\.paths\[0\]/.test(e)));
  });

  test('an empty status list is rejected (TypeF)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeF\.status: must not be an empty list/.test(e)));
  });

  test('a non-string status map value is rejected (TypeG)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeG\.status\.map\.ok: must be a non-empty string/.test(e)));
  });

  test('an empty wrapped status "sources" list is rejected (TypeH)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeH\.status\.sources: must be a non-empty list/.test(e)));
  });

  test('an empty status map key is rejected (TypeI)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeI\.status\.map: key must not be empty/.test(e)));
  });

  test('the wrapped form reports a status map error even when "sources" is also invalid (TypeJ)', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /types\.TypeJ\.status\.map\.ok: must be a non-empty string/.test(e)));
  });

  test('relations object-shape unknown key is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relations\.badOne: unknown key "bogus"/.test(e)));
  });

  test('relations object-shape bad relation is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relations\.badOne\.relation: unknown meta-relation "not-a-real"/.test(e)));
  });

  test('relations object-shape bad inverse is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relations\.badOne\.inverse: must be a boolean/.test(e)));
  });

  test('relations object-shape with no "relation" key reports "relation is required"', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relations\.noRelation\.relation: relation is required/.test(e)));
  });

  test('relatedRules bad source is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relatedRules\[0\]\.source: unknown meta-type "BadSource"/.test(e)));
  });

  test('relatedRules bad target is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relatedRules\[1\]\.target: unknown meta-type "BadTarget"/.test(e)));
  });

  test('relatedRules bad relation is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relatedRules\[2\]\.relation: unknown meta-relation "bad-relation"/.test(e)));
  });

  test('relatedRules bad inverse is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /relatedRules\[3\]\.inverse: must be a boolean/.test(e)));
  });

  test('bad externalIds regex is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /externalIds\[0\]\.pattern: bad regex/.test(e)));
  });

  test('bad externalIds metaType is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /externalIds\[0\]\.metaType: unknown meta-type "NotAType"/.test(e)));
  });

  test('duplicate exact concept name is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.includes('concepts: slug "foo" shared by "Foo" and "Foo"'));
  });

  test('a concept slugging to an empty string is reported', async () => {
    const errs = await invalidErrors('config-invalid-2');
    assert.ok(errs.some((e) => /concepts\[2\]: name or alias must not slug to an empty string/.test(e)));
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

  test('changes when externalIds changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = { ...config, externalIds: [...config.externalIds, { pattern: 'ADR-\\d+' }] };
    assert.notEqual(ontologyVersion(config), ontologyVersion(changed));
  });

  test('changes when a status map changes', async () => {
    const config = await loadConfig(join(FIXTURES, 'config-valid'));
    const changed = {
      ...config,
      types: { ...config.types, ADR: { ...config.types.ADR, status: { ...config.types.ADR.status, map: {} } } },
    };
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
