import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug } from './markdown.mjs';

test('slug lowercases and turns spaces into hyphens', () => {
  assert.equal(slug('Getting Started'), 'getting-started');
});

test('slug drops punctuation not in the keep set', () => {
  assert.equal(slug("What's New?"), 'whats-new');
  assert.equal(slug('Section 1: Overview!'), 'section-1-overview');
  assert.equal(slug('Two  spaces'), 'two--spaces');
});

test('slug keeps underscore, hyphen, and numbers as-is', () => {
  assert.equal(slug('foo_bar-baz 2'), 'foo_bar-baz-2');
});

test('slug preserves Vietnamese diacritics', () => {
  assert.equal(slug('Hạn mức tín dụng'), 'hạn-mức-tín-dụng');
  assert.equal(slug('Đặc điểm'), 'đặc-điểm');
});

test('slug NFC-normalizes so NFD and precomposed input match', () => {
  const precomposed = 'café'; // é = U+00E9
  const decomposed = 'café'; // e + combining acute (U+0301)
  assert.equal(slug(precomposed), slug(decomposed));
  assert.equal(slug(decomposed), 'café');
});

test('slug is idempotent on already-slugged input', () => {
  const once = slug('Hello World Again');
  assert.equal(slug(once), once);
});
