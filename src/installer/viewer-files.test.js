/**
 * Tests for src/installer/viewer-files.js: the list is complete, shipped,
 * and copies byte-for-byte; a missing source fails before any write.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWER_FILES, VIEWER_ENGINE_FILES, VIEWER_SRC_DIR, assertViewerFilesPresent, copyViewerFiles } from './viewer-files.js';
import { pathExists } from './fs.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

const isExcluded = (rel) =>
  rel.split('/').pop().startsWith('.') || rel.startsWith('ui/') || rel.startsWith('test-fixtures/') || rel.endsWith('.test.mjs');

async function withTmp(fn) {
  const dirs = [];
  const mk = async () => { const d = await mkdtemp(join(tmpdir(), 'lumina-viewer-files-')); dirs.push(d); return d; };
  try { await fn(mk); } finally { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); }
}

describe('VIEWER_FILES', () => {
  test('every listed file exists on disk', async () => {
    for (const rel of VIEWER_FILES) {
      assert.ok(await pathExists(join(VIEWER_SRC_DIR, ...rel.split('/'))), `${rel} missing`);
    }
  });

  test('completeness: every server-side file under src/viewer is listed, none excluded is', async () => {
    const found = (await walk(VIEWER_SRC_DIR)).filter((f) => !isExcluded(f));
    const listed = new Set(VIEWER_FILES);
    assert.deepEqual(found.filter((f) => !listed.has(f)), [], 'on disk but not listed');
    assert.deepEqual(VIEWER_FILES.filter(isExcluded), [], 'listed but must not ship');
  });

  test('every listed file and the module are in package.json files', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
    const files = new Set(pkg.files);
    const missing = VIEWER_FILES.map((f) => `src/viewer/${f}`).filter((f) => !files.has(f));
    assert.deepEqual(missing, []);
    assert.ok(files.has('src/installer/viewer-files.js'));
  });

  test('assertViewerFilesPresent resolves for the real package', async () => {
    await assertViewerFilesPresent();
  });
});

describe('VIEWER_ENGINE_FILES', () => {
  const SRC = join(REPO_ROOT, 'src');

  test('equals the engine files reachable by import from view.mjs', async () => {
    const seen = new Set();
    const queue = [join(SRC, 'viewer', 'view.mjs')];
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = await readFile(file, 'utf8');
      assert.doesNotMatch(text, /\bimport\s*\(\s*[^'"\s]/, `${file}: non-literal import() is not covered by this walk`);
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
        queue.push(resolve(dirname(file), m[1]));
      }
    }
    const rels = [...seen].map((f) => relative(SRC, f).split(sep).join('/'));
    const engine = rels.filter((r) => r.startsWith('scripts/')).map((r) => r.slice('scripts/'.length));
    const viewer = rels.filter((r) => r.startsWith('viewer/')).map((r) => r.slice('viewer/'.length));
    assert.deepEqual(engine.sort(), [...VIEWER_ENGINE_FILES].sort());
    assert.deepEqual(viewer.filter((f) => !VIEWER_FILES.includes(f)), [], 'imported but not in VIEWER_FILES');
    assert.equal(engine.length + viewer.length, rels.length, 'import reaches outside src/viewer and src/scripts');
  });

  test('every entry is in package.json files', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
    const files = new Set(pkg.files);
    const covered = (f) => files.has(f) || files.has(`${dirname(f)}/*.mjs`);
    assert.deepEqual(VIEWER_ENGINE_FILES.map((f) => `src/scripts/${f}`).filter((f) => !covered(f)), []);
  });

  test('a missing engine file rejects with code 3 naming it', async () => {
    await withTmp(async (mk) => {
      const scripts = await mk();
      await cp(join(REPO_ROOT, 'src', 'scripts'), scripts, { recursive: true });
      await rm(join(scripts, 'lib', 'slug.mjs'));
      await assert.rejects(assertViewerFilesPresent(VIEWER_SRC_DIR, scripts), (err) => {
        assert.equal(err.code, 3);
        assert.match(err.message, /lib\/slug\.mjs/);
        return true;
      });
    });
  });
});

describe('copyViewerFiles', () => {
  test('copies exactly the listed files, byte-equal, and is repeatable', async () => {
    await withTmp(async (mk) => {
      const proj = await mk();
      for (let i = 0; i < 2; i++) {
        await copyViewerFiles(proj);
        const dest = join(proj, '_lumina', 'viewer');
        assert.deepEqual((await walk(dest)).sort(), [...VIEWER_FILES].sort());
        for (const rel of VIEWER_FILES) {
          const parts = rel.split('/');
          const a = await readFile(join(VIEWER_SRC_DIR, ...parts));
          const b = await readFile(join(dest, ...parts));
          assert.ok(a.equals(b), `${rel} differs`);
        }
      }
    });
  });

  test('a missing source rejects with code 3 and writes nothing', async () => {
    await withTmp(async (mk) => {
      const src = await mk();
      const proj = await mk();
      for (const rel of VIEWER_FILES) {
        const parts = rel.split('/');
        await cp(join(VIEWER_SRC_DIR, ...parts), join(src, ...parts), { recursive: true });
      }
      await rm(join(src, 'lib', 'data.mjs'));
      await assert.rejects(copyViewerFiles(proj, src), (err) => {
        assert.equal(err.code, 3);
        assert.match(err.message, /lib\/data\.mjs/);
        return true;
      });
      assert.equal(await pathExists(join(proj, '_lumina', 'viewer')), false);
    });
  });
});
