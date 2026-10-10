// The same modules are tested under `node --test`, so they must run without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const entries = fs.readdirSync(dir).filter((f) => !f.endsWith('.test.mjs'));
const files = entries.filter((f) => f.endsWith('.mjs'));

const BANNED_PKG = '(?:react|react-dom|force-graph)(?:/[^\'"]*)?';
const importRes = [
  new RegExp(`\\bfrom\\s*['"]${BANNED_PKG}['"]`),
  new RegExp(`\\bimport\\s*['"]${BANNED_PKG}['"]`),
  new RegExp(`\\bimport\\s*\\(\\s*['"]${BANNED_PKG}['"]`),
];
const NAMES =
  'window|document|navigator|location|localStorage|sessionStorage|history|fetch|getComputedStyle|requestAnimationFrame|alert';
const globalRes = [
  new RegExp(`(?<![.\\w$])(?:${NAMES})\\b`),
  new RegExp(`\\b(?:globalThis|self)\\s*\\.\\s*(?:${NAMES})\\b`),
];

// One pass that knows strings from comments. keepStrings=false blanks literal contents.
function strip(src, keepStrings) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      const lit = src.slice(i, j + 1);
      const blank = c === '`' && lit.includes('${') ? true : !keepStrings;
      out += c === '`' && lit.includes('${') ? lit : blank ? c + c : lit;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function scan(src) {
  const found = [];
  const withStrings = strip(src, true);
  for (const re of importRes) {
    const m = withStrings.match(re);
    if (m) found.push(`banned import ${m[0]}`);
  }
  const code = strip(src, false);
  for (const re of globalRes) {
    const m = code.match(re);
    if (m) found.push(`browser global ${m[0]}`);
  }
  return found;
}

test('scan reports browser access', () => {
  for (const s of [
    "import x from 'react-dom/server'",
    "import 'force-graph/dist/force-graph.js'",
    'globalThis.document.title',
    'self.location.hash',
    'window.x',
    "fetch('/x')",
    "const u = 'a//b'; window.location.hash",
  ]) {
    assert.notEqual(scan(s).length, 0, s);
  }
});

test('scan passes pure code', () => {
  for (const s of [
    "const s = 'Open in a new window';",
    '// window is not used here',
    'obj.location',
    "import x from './hash.mjs'",
    "import MarkdownIt from 'markdown-it'",
  ]) {
    assert.deepEqual(scan(s), [], s);
  }
});

test('lib folder has at least one module', () => {
  assert.ok(files.length > 0);
});

test('every non-test module is .mjs so it is scanned', () => {
  assert.deepEqual(entries.filter((f) => !f.endsWith('.mjs')), []);
});

for (const f of files) {
  test(`${f} runs without a browser`, () => {
    assert.deepEqual(scan(fs.readFileSync(new URL(f, dir), 'utf8')), [], f);
  });
}
