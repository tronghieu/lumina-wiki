/**
 * Tests for src/installer/registry.js
 *
 * Uses node:test + node:assert. Every test sets LUMINA_HOME to its own
 * mkdtemp dir so the real home directory is never touched.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeKey,
  readRegistry,
  writeRegistry,
  addWiki,
  removeWiki,
  listWikis,
  resolveWiki,
  refreshPacks,
  registryPath,
  REGISTRY_SCHEMA_VERSION,
} from './registry.js';

let luminaHomeDir;
let previousLuminaHome;

beforeEach(async () => {
  previousLuminaHome = process.env.LUMINA_HOME;
  luminaHomeDir = await mkdtemp(join(tmpdir(), 'lumina-registry-test-'));
  process.env.LUMINA_HOME = luminaHomeDir;
});

afterEach(async () => {
  if (previousLuminaHome === undefined) delete process.env.LUMINA_HOME;
  else process.env.LUMINA_HOME = previousLuminaHome;
  await rm(luminaHomeDir, { recursive: true, force: true });
});

/**
 * Build a minimal but realistic fake wiki: mkdtemp + _lumina/manifest.json
 * mirroring the real installer manifest shape (packs is
 * Record<string, {version, source}>, matching src/installer/manifest.js).
 */
async function makeFakeWiki({ packs = { core: { version: '1.9.2', source: 'built-in' } } } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'lumina-fake-wiki-'));
  await mkdir(join(base, '_lumina', '_state'), { recursive: true });
  const manifest = {
    schemaVersion: 4,
    packageVersion: '1.9.2',
    locale: 'en',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    packs,
    ideTargets: ['claude_code'],
    symlinkStrategies: {},
    resolvedPaths: { projectRoot: base },
  };
  await writeFile(join(base, '_lumina', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return base;
}

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------

describe('normalizeKey', () => {
  test('turns "Kỹ Thuật AI" into "ky-thuat-ai"', () => {
    assert.equal(normalizeKey('Kỹ Thuật AI'), 'ky-thuat-ai');
  });

  test('is idempotent (normalizing an already-normalized key is a no-op)', () => {
    const once = normalizeKey('Kỹ Thuật AI');
    const twice = normalizeKey(once);
    assert.equal(once, twice);
    assert.equal(twice, 'ky-thuat-ai');
  });

  test('maps đ/Đ to d explicitly', () => {
    assert.equal(normalizeKey('Đà Nẵng'), 'da-nang');
  });

  test('collapses punctuation/whitespace runs to a single hyphen and trims edges', () => {
    assert.equal(normalizeKey('  --Weird__Name!! '), 'weird-name');
  });
});

// ---------------------------------------------------------------------------
// readRegistry / writeRegistry
// ---------------------------------------------------------------------------

describe('readRegistry', () => {
  test('returns {version: 1, wikis: {}} when the registry file does not exist', async () => {
    const reg = await readRegistry();
    assert.deepEqual(reg, { version: REGISTRY_SCHEMA_VERSION, wikis: {} });
  });

  test('round-trips via writeRegistry', async () => {
    const reg = { version: 1, wikis: { foo: { name: 'Foo', aliases: [], path: '/x', description: '', packs: [], addedAt: 'now' } } };
    await writeRegistry(reg);
    const result = await readRegistry();
    assert.deepEqual(result, reg);
  });

  test('throws err.code = 3 on corrupt JSON', async () => {
    await mkdir(luminaHomeDir, { recursive: true });
    await writeFile(registryPath(), '{ not json', 'utf8');
    await assert.rejects(() => readRegistry(), (err) => {
      assert.equal(err.code, 3);
      return true;
    });
  });

  test('throws err.code = 3 when version > 1', async () => {
    await mkdir(luminaHomeDir, { recursive: true });
    await writeFile(registryPath(), JSON.stringify({ version: 2, wikis: {} }), 'utf8');
    await assert.rejects(() => readRegistry(), (err) => {
      assert.equal(err.code, 3);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// addWiki
// ---------------------------------------------------------------------------

describe('addWiki', () => {
  test('adds a wiki and derives packs from its manifest', async () => {
    const dirPath = await makeFakeWiki({ packs: { core: { version: '1.9.2', source: 'built-in' }, research: { version: '1.9.2', source: 'built-in' } } });
    const { key, entry } = await addWiki({ dirPath, name: 'AI Engineering', aliases: ['ai-eng'], description: 'ML papers' });
    assert.equal(key, 'ai-engineering');
    assert.equal(entry.name, 'AI Engineering');
    assert.deepEqual(entry.packs, ['core', 'research']);
    assert.equal(entry.path, dirPath);

    const reg = await readRegistry();
    assert.ok(reg.wikis['ai-engineering']);
  });

  test('rejects (err.code = 2) a dirPath without _lumina/manifest.json', async () => {
    const dirPath = await mkdtemp(join(tmpdir(), 'lumina-not-a-wiki-'));
    await assert.rejects(() => addWiki({ dirPath, name: 'Nope' }), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.message, new RegExp(dirPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
  });

  test('rejects (err.code = 2) a non-absolute dirPath', async () => {
    await assert.rejects(() => addWiki({ dirPath: 'relative/path', name: 'X' }), (err) => {
      assert.equal(err.code, 2);
      return true;
    });
  });

  test('rejects (err.code = 1) re-adding under an already-registered key', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });
    const otherWiki = await makeFakeWiki();
    await assert.rejects(() => addWiki({ dirPath: otherWiki, name: 'AI Engineering' }), (err) => {
      assert.equal(err.code, 1);
      return true;
    });
  });

  test('rejects (err.code = 1) an alias that collides with a different wiki\'s name', async () => {
    const wikiA = await makeFakeWiki();
    await addWiki({ dirPath: wikiA, name: 'AI Engineering' });

    const wikiB = await makeFakeWiki();
    await assert.rejects(
      () => addWiki({ dirPath: wikiB, name: 'Social', aliases: ['AI Engineering'] }),
      (err) => {
        assert.equal(err.code, 1);
        return true;
      },
    );
  });

  test('rejects (err.code = 1) a name that collides with a different wiki\'s alias', async () => {
    const wikiA = await makeFakeWiki();
    await addWiki({ dirPath: wikiA, name: 'AI Work Social', aliases: ['kỹ thuật AI'] });

    const wikiB = await makeFakeWiki();
    await assert.rejects(
      () => addWiki({ dirPath: wikiB, name: 'Ky Thuat AI' }),
      (err) => {
        assert.equal(err.code, 1);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveWiki
// ---------------------------------------------------------------------------

describe('resolveWiki', () => {
  test('resolves by key', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });
    const { key } = await resolveWiki('ai-engineering');
    assert.equal(key, 'ai-engineering');
  });

  test('resolves "kỹ thuật AI" via a registered alias', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering', aliases: ['kỹ thuật AI', 'ai-eng'] });

    const { key, entry } = await resolveWiki('kỹ thuật AI');
    assert.equal(key, 'ai-engineering');
    assert.equal(entry.path, dirPath);

    // Also resolvable case/diacritic-insensitively.
    const again = await resolveWiki('KY THUAT ai');
    assert.equal(again.key, 'ai-engineering');
  });

  test('resolves by name', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });
    const { key } = await resolveWiki('AI Engineering');
    assert.equal(key, 'ai-engineering');
  });

  test('throws err.code = 2 with all candidates when there is no match', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });
    await assert.rejects(() => resolveWiki('nonexistent'), (err) => {
      assert.equal(err.code, 2);
      assert.ok(Array.isArray(err.candidates));
      assert.equal(err.candidates.length, 1);
      assert.equal(err.candidates[0].key, 'ai-engineering');
      return true;
    });
  });

  test('throws err.code = 2 with the colliding set when a query matches multiple wikis', async () => {
    // Force an ambiguous state by writing the registry directly: two
    // wikis whose aliases both normalize to the same query, which addWiki
    // itself would refuse to create (proving the registry format allows
    // it and resolveWiki must handle it defensively).
    const wikiA = await makeFakeWiki();
    const wikiB = await makeFakeWiki();
    await writeRegistry({
      version: 1,
      wikis: {
        'wiki-a': { name: 'Wiki A', aliases: ['shared'], path: wikiA, description: '', packs: [], addedAt: 'now' },
        'wiki-b': { name: 'Wiki B', aliases: ['shared'], path: wikiB, description: '', packs: [], addedAt: 'now' },
      },
    });

    await assert.rejects(() => resolveWiki('shared'), (err) => {
      assert.equal(err.code, 2);
      assert.equal(err.candidates.length, 2);
      const keys = err.candidates.map((c) => c.key).sort();
      assert.deepEqual(keys, ['wiki-a', 'wiki-b']);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// removeWiki
// ---------------------------------------------------------------------------

describe('removeWiki', () => {
  test('removes a wiki by resolving the query, registry write only', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });

    const { key } = await removeWiki('AI Engineering');
    assert.equal(key, 'ai-engineering');

    const reg = await readRegistry();
    assert.equal(reg.wikis['ai-engineering'], undefined);
  });

  test('throws err.code = 2 removing an unknown wiki', async () => {
    await assert.rejects(() => removeWiki('nope'), (err) => {
      assert.equal(err.code, 2);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// listWikis
// ---------------------------------------------------------------------------

describe('listWikis', () => {
  test('returns the full registry object', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });
    const reg = await listWikis();
    assert.equal(reg.version, 1);
    assert.ok(reg.wikis['ai-engineering']);
  });
});

// ---------------------------------------------------------------------------
// refreshPacks
// ---------------------------------------------------------------------------

describe('refreshPacks', () => {
  test('detects a pack change in the live manifest and persists it', async () => {
    const dirPath = await makeFakeWiki({ packs: { core: { version: '1.9.2', source: 'built-in' } } });
    const { key } = await addWiki({ dirPath, name: 'AI Engineering' });

    // Simulate the wiki being upgraded with a new pack.
    const manifestPath = join(dirPath, '_lumina', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.packs.research = { version: '1.9.2', source: 'built-in' };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const result = await refreshPacks(key);
    assert.equal(result.refreshed, true);
    assert.deepEqual(result.packs, ['core', 'research']);

    const reg = await readRegistry();
    assert.deepEqual(reg.wikis[key].packs, ['core', 'research']);
  });

  test('returns {refreshed: false} when packs are unchanged', async () => {
    const dirPath = await makeFakeWiki();
    const { key } = await addWiki({ dirPath, name: 'AI Engineering' });
    const result = await refreshPacks(key);
    assert.equal(result.refreshed, false);
  });

  test('tolerates an unreachable wiki path without throwing', async () => {
    const dirPath = await makeFakeWiki();
    const { key } = await addWiki({ dirPath, name: 'AI Engineering' });
    await rm(dirPath, { recursive: true, force: true });

    const result = await refreshPacks(key);
    assert.equal(result.refreshed, false);
    assert.ok(result.reason);
  });

  test('returns {refreshed: false} for an unknown key', async () => {
    const result = await refreshPacks('does-not-exist');
    assert.equal(result.refreshed, false);
    assert.ok(result.reason);
  });
});
