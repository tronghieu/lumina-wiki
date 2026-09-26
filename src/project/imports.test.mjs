/**
 * @file imports.test.mjs
 * @description Acceptance criterion (story 1): every `from '...'` /
 * `import('...')` specifier in non-test `src/project/**\/*.mjs` starts with
 * `node:` or `./`/`../`, and none resolves outside `src/project/`. Skips
 * `vendor/` (third-party code, not subject to this engine's own import
 * discipline) and `test-fixtures/` (synthetic repos, not engine code).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['vendor', 'test-fixtures', 'node_modules']);

function collectMjsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectMjsFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const IMPORT_SPECIFIER_RE = /\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractSpecifiers(source) {
  const specs = [];
  for (const m of source.matchAll(IMPORT_SPECIFIER_RE)) {
    specs.push(m[1] ?? m[2]);
  }
  return specs;
}

test('every non-test src/project/**/*.mjs import specifier is node: or relative and resolves inside src/project/', () => {
  const files = collectMjsFiles(PROJECT_ROOT);
  assert.ok(files.length > 0, 'expected to find at least one non-test .mjs file');

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      const isNodeBuiltin = spec.startsWith('node:');
      const isRelative = spec.startsWith('./') || spec.startsWith('../');
      assert.ok(
        isNodeBuiltin || isRelative,
        `${relative(PROJECT_ROOT, file)}: import specifier "${spec}" must start with "node:" or "./"/"../"`,
      );
      if (isRelative) {
        const resolved = resolve(dirname(file), spec);
        assert.ok(
          resolved === PROJECT_ROOT || resolved.startsWith(PROJECT_ROOT + '/'),
          `${relative(PROJECT_ROOT, file)}: import "${spec}" resolves outside src/project/`,
        );
      }
    }
  }
});
