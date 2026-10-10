import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const count = (re) => (html.match(re) || []).length;
const tags = (name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];

test('shell has no inline script, style, handler, or javascript: URL', () => {
  assert.equal(count(/<script(?![^>]*\ssrc=)[^>]*>/gi), 0);
  assert.equal(count(/<style/gi), 0);
  assert.equal(count(/\sstyle=/gi), 0);
  assert.equal(count(/\son[a-z]+\s*=/gi), 0);
  assert.equal(count(/javascript:/gi), 0);
});

test('shell loads no external resource', () => {
  const values = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  for (const v of values) {
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(v) || /^data:/i.test(v), `external scheme: ${v}`);
    assert.ok(!v.startsWith('//'), `protocol-relative: ${v}`);
  }
});

test('shell links the stylesheet, the icon, and the script, and holds the root', () => {
  const links = tags('link');
  assert.equal(links.length, 2);
  assert.equal(links.filter((l) => /\brel="stylesheet"/i.test(l) && /\bhref="\/assets\/viewer\.css"/i.test(l)).length, 1);
  assert.equal(links.filter((l) => /\brel="icon"/i.test(l) && /\bhref="data:,"/i.test(l)).length, 1);
  const scripts = tags('script');
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /\sdefer\b/i);
  assert.match(scripts[0], /\ssrc="\/assets\/viewer\.js"/i);
  assert.equal(count(/\bid="root"/g), 1);
});
