import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, readdir, cp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  compileGlob, selectScope, findCaseFoldCollisions, ScopeCollisionError, resolveIncludeRootForPattern,
} from './scope.mjs';
import { matchGlob } from '../../scripts/lib/globs.mjs'; // test-only parity exception (AD-9)

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'test-fixtures');
const SCOPE_BASIC_SRC = join(FIXTURES, 'scope-basic');
const CONFIG_CRLF = join(FIXTURES, 'config-crlf');

// scope-basic is checked in without `.git/` or `node_modules/` (git cannot
// track either; the second is globally gitignored). Each run copies the
// fixture into a throwaway mkdtemp dir and adds those there, so the
// checked-in fixture is never written to and nothing needs cleaning up in it.
let SCOPE_BASIC;

before(async () => {
  SCOPE_BASIC = await mkdtemp(join(tmpdir(), 'lumina-scope-basic-'));
  await cp(SCOPE_BASIC_SRC, SCOPE_BASIC, { recursive: true });
  for (const rel of ['.git/HEAD.md', 'node_modules/somepkg/README.md', 'docs/node_modules/pkg/README.md']) {
    await mkdir(dirname(join(SCOPE_BASIC, rel)), { recursive: true });
    await writeFile(join(SCOPE_BASIC, rel), '# x\n');
  }
});

after(async () => {
  if (SCOPE_BASIC) await rm(SCOPE_BASIC, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// compileGlob parity vs classic matchGlob
// ---------------------------------------------------------------------------

describe('compileGlob', () => {
  test('* matches within one segment', () => {
    assert.equal(compileGlob('docs/*.md').test('docs/readme.md'), true);
    assert.equal(compileGlob('docs/*.md').test('docs/adr/readme.md'), false);
  });

  test('** matches any depth', () => {
    assert.equal(compileGlob('docs/**').test('docs/a.md'), true);
    assert.equal(compileGlob('docs/**').test('docs/adr/0001.md'), true);
    assert.equal(compileGlob('docs/**').test('other/a.md'), false);
  });

  test('parity with classic matchGlob on a shared pattern/path list', () => {
    const patterns = [
      'docs/**',
      'docs/*.md',
      'packages/*/docs/**',
      'packages/*/docs/*.md',
      '**',
      'a/*/b/**',
      'docs/user-guide/**',
    ];
    const paths = [
      'docs/a.md',
      'docs/adr/0001.md',
      'docs/readme.md',
      'packages/alpha/docs/guide.md',
      'packages/alpha/docs/sub/guide.md',
      'packages/alpha/src/guide.md',
      'a/x/b/c.md',
      'a/x/y/b/c.md',
      'docs/user-guide/intro.md',
      'other/file.md',
    ];
    for (const pattern of patterns) {
      for (const path of paths) {
        assert.equal(
          compileGlob(pattern).test(path),
          matchGlob(pattern, path),
          `compileGlob(${JSON.stringify(pattern)}).test(${JSON.stringify(path)})`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// findCaseFoldCollisions (pure, no filesystem — a checked-out fixture on a
// case-insensitive filesystem cannot itself hold two really-existing files
// whose names differ only by case; the real-fs path is covered below)
// ---------------------------------------------------------------------------

describe('findCaseFoldCollisions', () => {
  test('finds a colliding pair', () => {
    const pairs = findCaseFoldCollisions(['docs/A.md', 'docs/a.md', 'docs/b.md']);
    assert.deepEqual(pairs, [['docs/A.md', 'docs/a.md']]);
  });

  test('finds no collision when case-folded names are unique', () => {
    assert.deepEqual(findCaseFoldCollisions(['docs/a.md', 'docs/b.md']), []);
  });

  test('folds NFC vs NFD (Vietnamese) to the same key', () => {
    const nfc = 'docs/qu\u1EBFt.md'; // precomposed 'e with circumflex and acute'
    const nfd = nfc.normalize('NFD'); // same text, decomposed into base + combining marks
    assert.notEqual(nfc, nfd, 'precondition: NFC and NFD forms must differ in code units');
    const pairs = findCaseFoldCollisions([nfc, nfd]);
    assert.deepEqual(pairs, [[nfc, nfd]]);
  });
});

// ---------------------------------------------------------------------------
// resolveIncludeRootForPattern
// ---------------------------------------------------------------------------

describe('resolveIncludeRootForPattern', () => {
  test('a file-level glob (mixed wildcard segment) stops before that segment', () => {
    assert.equal(resolveIncludeRootForPattern('docs/*.md', 'docs/readme.md'), 'docs');
  });

  test('an exact-file pattern stops before its own last (file) segment', () => {
    assert.equal(resolveIncludeRootForPattern('docs/readme.md', 'docs/readme.md'), 'docs');
  });

  test('a mixed wildcard directory segment plus an exact filename resolves only the fixed/`*` prefix', () => {
    assert.equal(resolveIncludeRootForPattern('docs/*/README.md', 'docs/adr/README.md'), 'docs/adr');
  });

  test('bare-dir expansion (unaffected by the own-match fix)', () => {
    assert.equal(resolveIncludeRootForPattern('packages/*/docs', 'packages/alpha/docs/guide.md'), 'packages/alpha/docs');
    assert.equal(resolveIncludeRootForPattern('docs', 'docs/adr/x.md'), 'docs');
  });
});

// ---------------------------------------------------------------------------
// selectScope
// ---------------------------------------------------------------------------

describe('selectScope', () => {
  test('happy path: multiple include/exclude globs, exclude wins', async () => {
    const { files, warnings } = await selectScope(SCOPE_BASIC, {
      include: ['docs', 'packages/*/docs'],
      exclude: ['docs/user-guide'],
    });
    assert.deepEqual(files, [
      'docs/adr/0001-init.md',
      'docs/readme.md',
      'packages/alpha/docs/guide.md',
    ]);
    assert.deepEqual(warnings, []);
  });

  test('bare directory means everything under it', async () => {
    const bare = await selectScope(SCOPE_BASIC, { include: ['docs'] });
    const explicit = await selectScope(SCOPE_BASIC, { include: ['docs/**'] });
    assert.deepEqual(bare.files, explicit.files);
    assert.deepEqual(bare.files, [
      'docs/adr/0001-init.md',
      'docs/readme.md',
      'docs/user-guide/intro.md',
    ]);
  });

  test('"docs/" and "./docs" behave like the bare "docs"', async () => {
    const bare = await selectScope(SCOPE_BASIC, { include: ['docs'] });
    const trailingSlash = await selectScope(SCOPE_BASIC, { include: ['docs/'] });
    const dotSlash = await selectScope(SCOPE_BASIC, { include: ['./docs'] });
    assert.deepEqual(trailingSlash.files, bare.files);
    assert.deepEqual(dotSlash.files, bare.files);
  });

  test('file-level include glob selects only the matching files at that level', async () => {
    const { files } = await selectScope(SCOPE_BASIC, { include: ['docs/*.md'] });
    assert.deepEqual(files, ['docs/readme.md']);
  });

  test('file-level include (exact path, no wildcard) selects only that file', async () => {
    const { files } = await selectScope(SCOPE_BASIC, { include: ['docs/readme.md'] });
    assert.deepEqual(files, ['docs/readme.md']);
  });

  test('file-level exclude removes only the matching file', async () => {
    const { files } = await selectScope(SCOPE_BASIC, {
      include: ['docs'],
      exclude: ['docs/readme.md'],
    });
    assert.deepEqual(files, ['docs/adr/0001-init.md', 'docs/user-guide/intro.md']);
  });

  test('defaults include to docs when sources.include is absent', async () => {
    const { files } = await selectScope(SCOPE_BASIC, {});
    assert.deepEqual(files, [
      'docs/adr/0001-init.md',
      'docs/readme.md',
      'docs/user-guide/intro.md',
    ]);
  });

  test('empty include produces a P16 warning naming the pattern; exit-0 shape (no throw)', async () => {
    const { files, warnings } = await selectScope(SCOPE_BASIC, { include: ['docs', 'nope'] });
    assert.equal(files.includes('docs/readme.md'), true);
    assert.deepEqual(warnings, [
      { rule: 'P16', pattern: 'nope', message: 'include pattern matches no files: nope' },
    ]);
  });

  test('always-excluded dirs are never listed even when explicitly included, at any depth', async () => {
    const { files } = await selectScope(SCOPE_BASIC, {
      include: ['node_modules', '.git', '_lumina', 'docs'],
    });
    assert.equal(files.some((f) => /(^|\/)(node_modules|\.git|_lumina)\//.test(f)), false);
    assert.ok(files.length > 0);
  });

  test('default-excluded root dir is excluded unless an include pattern names it', async () => {
    const withoutOverride = await selectScope(SCOPE_BASIC, { include: ['docs'] });
    assert.equal(withoutOverride.files.some((f) => f.startsWith('.claude/')), false);

    const withOverride = await selectScope(SCOPE_BASIC, { include: ['.claude'] });
    assert.deepEqual(withOverride.files, ['.claude/skills/test.md']);
  });

  test('file outside every include pattern is not selected', async () => {
    const { files } = await selectScope(SCOPE_BASIC, { include: ['docs'] });
    assert.equal(files.includes('other/file.md'), false);
  });

  test('unsafe include pattern throws RangeError naming the pattern', async () => {
    await assert.rejects(
      selectScope(SCOPE_BASIC, { include: ['../x'] }),
      (err) => err instanceof RangeError && /\.\.\/x/.test(err.message),
    );
  });

  for (const bad of ['/abs', 'C:/x', 'a\\b']) {
    test(`unsafe pattern ${JSON.stringify(bad)} throws RangeError`, async () => {
      await assert.rejects(selectScope(SCOPE_BASIC, { include: [bad] }), RangeError);
    });
  }

  test('case-fold collision throws an Error with code 2 and the colliding pair (real fs)', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-scope-collision-'));
    try {
      await mkdir(join(dir, 'docs'), { recursive: true });
      await writeFile(join(dir, 'docs', 'A.md'), '# A\n');
      await writeFile(join(dir, 'docs', 'a.md'), '# a\n');
      const entries = await readdir(join(dir, 'docs'));
      if (entries.length < 2) {
        t.skip('filesystem is case-insensitive; cannot hold both docs/A.md and docs/a.md');
        return;
      }
      await assert.rejects(
        selectScope(dir, { include: ['docs'] }),
        (err) => {
          assert.ok(err instanceof ScopeCollisionError);
          assert.equal(err.code, 2);
          assert.equal(err.pairs.length, 1);
          assert.deepEqual(new Set(err.pairs[0]), new Set(['docs/A.md', 'docs/a.md']));
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('scope runs twice on unchanged input produce byte-identical output', async () => {
    const sources = { include: ['docs', 'packages/*/docs'], exclude: ['docs/user-guide'] };
    const first = await selectScope(SCOPE_BASIC, sources);
    const second = await selectScope(SCOPE_BASIC, sources);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  test('config-crlf fixture: lists the BOM+CRLF Vietnamese doc', async () => {
    const { files } = await selectScope(CONFIG_CRLF, { include: ['docs'] });
    assert.deepEqual(files, ['docs/quyet-dinh.md']);
  });

  test('selects .markdown, .mdx, and upper-case .MD; skips other extensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-scope-ext-'));
    try {
      await mkdir(join(dir, 'docs'));
      for (const name of ['a.markdown', 'b.mdx', 'C.MD', 'd.txt']) await writeFile(join(dir, 'docs', name), '# x\n');
      const { files } = await selectScope(dir, { include: ['docs'] });
      assert.deepEqual(files, ['docs/C.MD', 'docs/a.markdown', 'docs/b.mdx']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('"." and "./" include the whole repo, like "**"', async () => {
    const all = await selectScope(SCOPE_BASIC, { include: ['**'] });
    assert.ok(all.files.length > 0);
    for (const include of [['.'], ['./']]) {
      const res = await selectScope(SCOPE_BASIC, { include });
      assert.deepEqual(res.files, all.files, JSON.stringify(include));
      assert.deepEqual(res.warnings, []);
    }
  });

  test('an unreadable dir below the root is skipped with a warning, not thrown', async (t) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      t.skip('chmod 000 does not deny reads here (Windows, or running as root)');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'lumina-scope-eacces-'));
    const locked = join(dir, 'mnt', 'locked');
    try {
      await mkdir(join(dir, 'docs'));
      await writeFile(join(dir, 'docs', 'a.md'), '# a\n');
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);
      const { files, warnings } = await selectScope(dir, { include: ['docs'] });
      assert.deepEqual(files, ['docs/a.md']);
      assert.deepEqual(warnings, [
        { rule: 'P16', pattern: 'mnt/locked', message: 'directory not readable, skipped: mnt/locked' },
      ]);
    } finally {
      await chmod(locked, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });
});
