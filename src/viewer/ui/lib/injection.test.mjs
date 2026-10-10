// Page text is untrusted: the renderer's output is the only HTML the client's own code may inject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(jsx|mjs)$/.test(e.name) && !e.name.endsWith('.test.mjs') ? [p] : [];
  });
}

// Drops comments; string contents stay so injected markup in literals is still caught.
function stripComments(src) {
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
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const files = walk(root).map((p) => ({
  rel: path.relative(root, p).split(path.sep).join('/'),
  code: stripComments(fs.readFileSync(p, 'utf8')),
}));

const BANNED = [
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
  'createContextualFragment', 'DOMParser', 'srcdoc', 'eval(', 'new Function',
];

test('dangerouslySetInnerHTML appears once, in ReaderPane.jsx', () => {
  const hits = files.flatMap((f) => (f.code.match(/dangerouslySetInnerHTML/g) ?? []).map(() => f.rel));
  assert.deepEqual(hits, ['panes/ReaderPane.jsx'], `found in: ${hits.join(', ') || 'nowhere'}`);
});

test('no other HTML or code injection sink exists', () => {
  for (const f of files) {
    for (const b of BANNED) assert.ok(!f.code.includes(b), `${f.rel} uses ${b}`);
  }
});
