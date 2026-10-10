import test from 'node:test';
import assert from 'node:assert/strict';
import { externalHref, urlNodeHref } from './links.mjs';

test('externalHref accepts web and mail addresses unchanged', () => {
  for (const a of ['https://example.org/a?b=1', 'HTTP://EXAMPLE.ORG', 'mailto:a@b.c']) {
    assert.equal(externalHref(a), a);
  }
});

test('externalHref refuses everything else', () => {
  for (const a of [
    'javascript:alert(1)', 'javascript://%0aalert(1)', 'JAVASCRIPT://x', ' https://x',
    'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://x', 'http:foo', 'https:foo', 'ms-msdt:/id',
    'obsidian://open', '//evil.example/x', '/api/wiki', 'other.md', '#top', '',
    null, undefined, 5,
  ]) {
    assert.equal(externalHref(a), null, String(a));
  }
});

test('urlNodeHref', () => {
  assert.equal(urlNodeHref('url:https://example.org/lora'), 'https://example.org/lora');
  for (const id of ['url:javascript://x', 'url:mailto:a@b.c', 'sources/lora', 'missing:x']) {
    assert.equal(urlNodeHref(id), null, id);
  }
});
