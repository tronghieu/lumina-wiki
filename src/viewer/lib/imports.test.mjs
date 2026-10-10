/**
 * @file imports.test.mjs
 * Import rules of AD-18 for installed viewer code.
 * Run: node --test src/viewer/lib/imports.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = dirname(fileURLToPath(import.meta.url));
const VIEW = join(LIB, '..', 'view.mjs');

// Installed workspaces have no node_modules, so only builtins, siblings, and the engine may be imported.
const STATIC_RES = [
  /\bimport\s*(?:[\w*${}\s,]*?\s*from\s*)?['"]([^'"]+)['"]/g,
  /\bexport\s*(?:\*(?:\s*as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
];
// A dynamic import is checkable only with a plain string or a template literal without `${`.
const DYNAMIC_PLAIN = /import\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)\s*(?:,[^)]*)?\)/y;
const UNCHECKABLE = /\bcreateRequire\b|\brequire\s*\(/g;

// Comments may mention forbidden forms; only code counts.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

function specifierAllowed(spec, kind) {
  const [sibling, engine] = kind === 'view' ? ['./lib/', '../scripts/'] : ['./', '../../scripts/'];
  if (spec.startsWith('node:')) return true;
  if (spec.startsWith(sibling)) {
    const rest = spec.slice(sibling.length);
    return spec.endsWith('.mjs') && !rest.includes('/') && rest !== 'wiki.mjs';
  }
  if (spec.startsWith(engine)) {
    const parts = spec.slice(engine.length).split('/');
    return !parts.includes('..') && parts.at(-1) !== 'wiki.mjs';
  }
  return false;
}

export function violations(sourceText, kind) {
  const src = stripComments(sourceText);
  const out = [];
  const specs = [];
  for (const re of STATIC_RES) for (const m of src.matchAll(re)) specs.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(/g)) {
    DYNAMIC_PLAIN.lastIndex = m.index;
    const p = DYNAMIC_PLAIN.exec(src);
    if (p) specs.push(p[1] ?? p[2] ?? p[3]);
    else out.push(`unverifiable dynamic import: ${src.slice(m.index, m.index + 40)}`);
  }
  for (const m of src.matchAll(UNCHECKABLE)) out.push(`unverifiable module access: ${m[0]}`);
  for (const spec of specs) if (!specifierAllowed(spec, kind)) out.push(`disallowed import "${spec}"`);
  return out;
}

async function check(file, kind) {
  const found = violations(await readFile(file, 'utf8'), kind);
  assert.deepEqual(found, [], `${file}: ${found.join('; ')}`);
}

test('checker passes every allowed form', () => {
  const allowed = [
    "import fs from 'node:fs'",
    "import{a}from'node:fs'",
    "import 'node:fs'",
    "import { a } from './a.mjs'",
    "import x from '../../scripts/lint.mjs'",
    "export { a } from './a.mjs'",
    "export * as ns from './a.mjs'",
    "export * from 'node:path'",
    "const m = await import('../../scripts/lint.mjs')",
    "const m = await import('./a.mjs', { with: {} })",
    'const m = await import(`node:fs`)',
    "// import x from 'react'\nconst y = 1;",
  ];
  for (const s of allowed) assert.deepEqual(violations(s, 'lib'), [], s);
  assert.deepEqual(violations("await import('./lib/server.mjs')", 'view'), []);
  assert.deepEqual(violations("await import('../scripts/lint.mjs')", 'view'), []);
});

test('checker reports every forbidden form', () => {
  const bad = [
    "import x from 'react'",
    "import{a}from'pkg'",
    "import 'pkg'",
    "export * from 'pkg'",
    "await import('pkg')",
    'await import(name)',
    'await import(`./${name}.mjs`)',
    "import x from '../../scripts/../project/lib/view.mjs'",
    "import x from '../../scripts/../../node_modules/x/index.js'",
    "import x from '../../scripts/wiki.mjs'",
    "import x from '../../project/lib/view.mjs'",
    'const r = createRequire(import.meta.url)',
    "const r = require('x')",
  ];
  for (const s of bad) assert.ok(violations(s, 'lib').length > 0, `not reported: ${s}`);
  assert.ok(violations("import x from '../scripts/wiki.mjs'", 'view').length > 0);
});

test('lib/*.mjs imports only node:, siblings, and the engine', async () => {
  const files = (await readdir(LIB)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  assert.ok(files.length > 0);
  for (const f of files) await check(join(LIB, f), 'lib');
});

test('view.mjs, when present, imports only node:, lib siblings, and the engine', async (t) => {
  try { await access(VIEW); } catch { t.skip('view.mjs not present'); return; }
  await check(VIEW, 'view');
});
