/**
 * Tests for src/installer/registry.js
 *
 * Uses node:test + node:assert. Every test sets LUMINA_HOME to its own
 * mkdtemp dir so the real home directory is never touched.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
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
  pathsEqual,
  sameDirectory,
  sameFileIdentity,
} from './registry.js';

/**
 * Detect whether `dir` sits on a case-insensitive filesystem (macOS/APFS
 * default, Windows) vs case-sensitive (most Linux/ext4, and case-sensitive
 * APFS volumes) by probing it directly — never branch on `process.platform`,
 * which gets this wrong for case-sensitive APFS volumes and macOS-formatted
 * external drives.
 */
async function isCaseInsensitiveFs(dir) {
  const probePath = join(dir, 'CaseProbe.tmp');
  await writeFile(probePath, 'x', 'utf8');
  try {
    await stat(join(dir, 'caseprobe.tmp'));
    return true;
  } catch (_) {
    return false;
  } finally {
    await rm(probePath, { force: true });
  }
}

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
 * Write a minimal but realistic fake manifest.json at a caller-chosen path
 * (mirroring the real installer manifest shape — packs is
 * Record<string, {version, source}>, matching src/installer/manifest.js).
 * Creates `dirPath` if it doesn't exist yet.
 */
async function writeFakeManifestAt(dirPath, { packs = { core: { version: '1.9.2', source: 'built-in' } } } = {}) {
  await mkdir(join(dirPath, '_lumina', '_state'), { recursive: true });
  const manifest = {
    schemaVersion: 4,
    packageVersion: '1.9.2',
    locale: 'en',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    packs,
    ideTargets: ['claude_code'],
    symlinkStrategies: {},
    resolvedPaths: { projectRoot: dirPath },
  };
  await writeFile(join(dirPath, '_lumina', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Build a minimal but realistic fake wiki in a fresh mkdtemp directory.
 */
async function makeFakeWiki({ packs = { core: { version: '1.9.2', source: 'built-in' } } } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'lumina-fake-wiki-'));
  await writeFakeManifestAt(base, { packs });
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
// pathsEqual
// ---------------------------------------------------------------------------
//
// Pure-function tests, deliberately not routed through the filesystem: on
// macOS/APFS, opening a path via an NFD-equivalent string transparently
// resolves to an NFC-stored file (APFS normalizes on lookup), but on Linux
// (ext4) filenames are opaque byte sequences and the same round-trip would
// just ENOENT — that would make an FS-based version of this test flaky
// across platforms without actually proving anything about the comparison
// logic itself. Testing pathsEqual() directly is deterministic everywhere
// and is the precise claim that matters: "two spellings of the same
// directory must compare equal."
// ---------------------------------------------------------------------------

describe('pathsEqual', () => {
  test('an NFC-composed and NFD-decomposed spelling of the same Vietnamese path compare equal', () => {
    const nfc = '/tmp/dự-án-nghiên-cứu'.normalize('NFC');
    const nfd = '/tmp/dự-án-nghiên-cứu'.normalize('NFD');
    assert.notEqual(nfc, nfd, 'sanity: the two byte sequences really do differ before normalization');
    assert.equal(pathsEqual(nfc, nfd), true);
  });

  test('genuinely different paths (even Vietnamese ones) are not equal', () => {
    assert.equal(pathsEqual('/tmp/dự-án-một', '/tmp/dự-án-hai'), false);
  });

  test('trailing slash and redundant segments do not cause a false negative', () => {
    assert.equal(pathsEqual('/tmp/wiki/', '/tmp/wiki'), true);
    assert.equal(pathsEqual('/tmp/./wiki', '/tmp/wiki'), true);
    assert.equal(pathsEqual('/tmp/sub/../wiki', '/tmp/wiki'), true);
  });
});

// ---------------------------------------------------------------------------
// sameDirectory — pathsEqual plus filesystem-identity (dev+ino) escalation.
// ---------------------------------------------------------------------------

describe('sameDirectory', () => {
  test('falls back to (NFC) string comparison when neither path exists on disk — same as pathsEqual', async () => {
    assert.equal(await sameDirectory('/no/such/lumina-path/here', '/no/such/lumina-path/here'), true);
    assert.equal(await sameDirectory('/no/such/lumina-path/a', '/no/such/lumina-path/b'), false);
    const nfc = '/no/such/lumina-path/dự-án'.normalize('NFC');
    const nfd = '/no/such/lumina-path/dự-án'.normalize('NFD');
    assert.equal(await sameDirectory(nfc, nfd), true);
  });

  test('falls back to string comparison (false) when only one side exists on disk', async () => {
    const real = await mkdtemp(join(tmpdir(), 'lumina-samedir-real-'));
    assert.equal(await sameDirectory(real, '/no/such/lumina-path/here'), false);
  });

  test('two different real directories are not the same directory', async () => {
    const a = await mkdtemp(join(tmpdir(), 'lumina-samedir-a-'));
    const b = await mkdtemp(join(tmpdir(), 'lumina-samedir-b-'));
    assert.equal(await sameDirectory(a, b), false);
  });

  test('the same real directory reached through a symlinked parent is the same directory (dev+ino, not string)', async (t) => {
    const container = await mkdtemp(join(tmpdir(), 'lumina-samedir-symlink-'));
    const realDir = join(container, 'real');
    await mkdir(realDir, { recursive: true });
    const linkParent = join(container, 'linked');

    try {
      await symlink(realDir, linkParent);
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        t.skip('host does not permit directory symlinks');
        return;
      }
      throw err;
    }

    assert.notEqual(realDir, linkParent, 'sanity: the two path strings really do differ');
    assert.equal(await sameDirectory(realDir, linkParent), true);
  });

  test('a stat failure that is not ENOENT (e.g. ENOTDIR) falls back to the string comparison, not a hardcoded "different"', async () => {
    const base = await mkdtemp(join(tmpdir(), 'lumina-samedir-enotdir-'));
    const fileNotDir = join(base, 'a-file.txt');
    await writeFile(fileNotDir, 'x', 'utf8');
    // Treating a file as if it were a directory's parent -> ENOTDIR, not
    // ENOENT, when stat'd. Deterministic and portable (unlike EACCES, which
    // root-in-CI would silently bypass).
    const bogusPath = join(fileNotDir, 'nonsense');

    // Different strings, one side errors with ENOTDIR -> falls back to the
    // (already negative) string comparison, same outcome as any other
    // unreachable path — not a distinct "assume identical".
    assert.equal(await sameDirectory(bogusPath, '/no/such/other/lumina-path'), false);

    // Identical strings on both sides short-circuit via the fast path
    // before any stat is attempted — the ENOTDIR branch is never even
    // reached when the strings already agree.
    assert.equal(await sameDirectory(bogusPath, bogusPath), true);
  });
});

// ---------------------------------------------------------------------------
// sameFileIdentity — pure dev+ino comparison, the part sameDirectory can't
// exercise against a real zero-inode filesystem in CI.
// ---------------------------------------------------------------------------

describe('sameFileIdentity', () => {
  test('matching truthy dev+ino is identical', () => {
    assert.equal(sameFileIdentity({ dev: 1, ino: 42 }, { dev: 1, ino: 42 }), true);
  });

  test('different dev or different ino is not identical', () => {
    assert.equal(sameFileIdentity({ dev: 1, ino: 42 }, { dev: 2, ino: 42 }), false);
    assert.equal(sameFileIdentity({ dev: 1, ino: 42 }, { dev: 1, ino: 43 }), false);
  });

  // The Windows case this whole fix is for: two GENUINELY DIFFERENT
  // directories that both happen to report a falsy ino (0) on the same
  // dev must NOT compare as identical — that would be the opposite,
  // worse failure mode (blocking a user's second real wiki, telling them
  // it's already registered as their first, with no way to proceed).
  test('two different stats both reporting ino: 0 on the same dev do NOT compare as identical', () => {
    assert.equal(sameFileIdentity({ dev: 1, ino: 0 }, { dev: 1, ino: 0 }), false);
  });

  test('a falsy ino on either side alone is inconclusive, not a match', () => {
    assert.equal(sameFileIdentity({ dev: 1, ino: 0 }, { dev: 1, ino: 42 }), false);
    assert.equal(sameFileIdentity({ dev: 1, ino: 42 }, { dev: 1, ino: 0 }), false);
  });

  test('a missing/null dev is inconclusive, not a match, even with matching ino', () => {
    assert.equal(sameFileIdentity({ dev: null, ino: 42 }, { dev: null, ino: 42 }), false);
    assert.equal(sameFileIdentity({ ino: 42 }, { ino: 42 }), false);
  });

  test('null/undefined stat objects are not identical', () => {
    assert.equal(sameFileIdentity(null, { dev: 1, ino: 42 }), false);
    assert.equal(sameFileIdentity({ dev: 1, ino: 42 }, undefined), false);
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

  // Mirror of the two collision tests above ("same name, different
  // directory"): "same directory, different name" — a path that is already
  // registered under one key must not get a second entry under another.
  // Nothing downstream benefits from it (wikis list / doctor would show the
  // same wiki twice), so this is enforced here in addWiki itself, not just
  // in the --provision CLI path, so every caller is covered.
  test('rejects (err.code = 1) registering an already-registered directory under a second, different name', async () => {
    const dirPath = await makeFakeWiki();
    const first = await addWiki({ dirPath, name: 'AI Engineering' });

    await assert.rejects(
      () => addWiki({ dirPath, name: 'Something Else Entirely' }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.message, /already registered as "AI Engineering"/);
        assert.match(err.message, new RegExp(first.key));
        return true;
      },
    );

    const reg = await readRegistry();
    assert.equal(Object.keys(reg.wikis).length, 1, 'must not create a second entry for the same directory');
  });

  test('the same-directory rejection does not fire for a genuinely different directory that merely shares a name prefix', async () => {
    const wikiA = await makeFakeWiki();
    await addWiki({ dirPath: wikiA, name: 'Notes' });

    // A different physical directory, unrelated name — must succeed exactly
    // as before; the new check must not over-match.
    const wikiB = await makeFakeWiki();
    const { key } = await addWiki({ dirPath: wikiB, name: 'Notes Two' });
    assert.equal(key, 'notes-two');

    const reg = await readRegistry();
    assert.equal(Object.keys(reg.wikis).length, 2);
  });

  test('rejects (err.code = 1) registering the same wiki twice when reached through a symlinked parent directory', async (t) => {
    // Mirrors the real-world case this project's own tests run under on
    // macOS: /tmp -> /private/tmp. Constructed here rather than relied on,
    // so it also exercises Linux CI.
    const container = await mkdtemp(join(tmpdir(), 'lumina-addwiki-symlink-'));
    const realParent = join(container, 'real-parent');
    await mkdir(realParent, { recursive: true });
    const linkedParent = join(container, 'linked-parent');

    try {
      await symlink(realParent, linkedParent);
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        t.skip('host does not permit directory symlinks');
        return;
      }
      throw err;
    }

    const dirPathViaReal = join(realParent, 'my-wiki');
    await writeFakeManifestAt(dirPathViaReal);
    const first = await addWiki({ dirPath: dirPathViaReal, name: 'Real Path Wiki' });
    assert.equal(first.key, 'real-path-wiki');

    const dirPathViaLink = join(linkedParent, 'my-wiki');
    assert.notEqual(dirPathViaReal, dirPathViaLink, 'sanity: the two path strings really do differ');
    await assert.rejects(
      () => addWiki({ dirPath: dirPathViaLink, name: 'Linked Path Wiki' }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.message, /already registered as "Real Path Wiki"/);
        return true;
      },
    );

    const reg = await readRegistry();
    assert.equal(Object.keys(reg.wikis).length, 1, 'must not create a second entry reached via a symlinked parent');
  });

  test('a case-variant path is rejected as a duplicate on case-insensitive filesystems, and is a distinct (nonexistent) path on case-sensitive ones', async () => {
    const base = await mkdtemp(join(tmpdir(), 'lumina-addwiki-case-'));
    const caseInsensitive = await isCaseInsensitiveFs(base);

    const dirPath = join(base, 'MyWikiDir');
    await writeFakeManifestAt(dirPath);
    await addWiki({ dirPath, name: 'Case Wiki' });

    const variantPath = join(base, 'mywikidir');
    if (caseInsensitive) {
      await assert.rejects(
        () => addWiki({ dirPath: variantPath, name: 'Case Wiki Two' }),
        (err) => {
          assert.equal(err.code, 1);
          assert.match(err.message, /already registered as "Case Wiki"/);
          return true;
        },
      );
      const reg = await readRegistry();
      assert.equal(Object.keys(reg.wikis).length, 1);
    } else {
      // Case-sensitive FS: "mywikidir" genuinely does not exist on disk — a
      // distinct, unrelated failure (no manifest there), never mistaken for
      // a duplicate-path rejection.
      await assert.rejects(
        () => addWiki({ dirPath: variantPath, name: 'Case Wiki Two' }),
        (err) => {
          assert.equal(err.code, 2);
          return true;
        },
      );
    }
  });

  test('rejects (err.code = 1) a name that normalizes to empty (all non-Latin script, e.g. Chinese)', async () => {
    const dirPath = await makeFakeWiki();
    await assert.rejects(() => addWiki({ dirPath, name: '维基百科' }), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.message, /no Latin letters or digits/);
      return true;
    });

    const reg = await readRegistry();
    assert.deepEqual(reg.wikis, {}, 'nothing must be written to the registry');
  });

  test('rejects (err.code = 1) an alias that normalizes to empty, even when the name is fine', async () => {
    const dirPath = await makeFakeWiki();
    await assert.rejects(
      () => addWiki({ dirPath, name: 'Wikipedia', aliases: ['维基百科'] }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.message, /no Latin letters or digits/);
        return true;
      },
    );

    const reg = await readRegistry();
    assert.deepEqual(reg.wikis, {}, 'nothing must be written to the registry');
  });

  test('a second all-non-Latin name is rejected the same way, not treated as a duplicate of the first', async () => {
    const dirPath1 = await makeFakeWiki();
    await assert.rejects(() => addWiki({ dirPath: dirPath1, name: '维基百科' }), (err) => {
      assert.equal(err.code, 1);
      return true;
    });

    const dirPath2 = await makeFakeWiki();
    await assert.rejects(() => addWiki({ dirPath: dirPath2, name: 'Википедия' }), (err) => {
      assert.equal(err.code, 1);
      return true;
    });

    const reg = await readRegistry();
    assert.deepEqual(reg.wikis, {});
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

  test('an all-non-Latin query (normalizes to empty) never matches anything — unknown-query error, not a silent match', async () => {
    const dirPath = await makeFakeWiki();
    await addWiki({ dirPath, name: 'AI Engineering' });

    // Force a "" key into the registry directly, bypassing addWiki()'s own
    // guard, to prove resolveAgainst() itself refuses to match an empty
    // normalized query rather than relying solely on the write-side guard.
    const reg = await readRegistry();
    reg.wikis[''] = { name: '维基百科', aliases: [], path: dirPath, description: '', packs: [], addedAt: 'now' };
    await writeRegistry(reg);

    await assert.rejects(() => resolveWiki('维基百科'), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.message, /No wiki found/);
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
