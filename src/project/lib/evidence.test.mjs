import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { quoteMatches, findQuoteLine } from './evidence.mjs';

describe('quoteMatches', () => {
  test('true for an exact substring', () => {
    const source = 'Line one.\nADR-0009 is partially superseded by ADR-0052.\nLine three.';
    assert.equal(quoteMatches(source, 'partially superseded by ADR-0052'), true);
  });

  test('false when the quote is not present', () => {
    const source = 'ADR-0009 is accepted.';
    assert.equal(quoteMatches(source, 'ADR-0009 is deprecated'), false);
  });

  test('matches after whitespace collapse (a quote reflowed across a line wrap)', () => {
    const source = 'ADR-0009 is\npartially   superseded\nby ADR-0052.';
    assert.equal(quoteMatches(source, 'ADR-0009 is partially superseded by ADR-0052.'), true);
  });

  test('matches after NFC normalization (decomposed vs precomposed)', () => {
    const decomposed = 'café credit limit'; // e + combining acute
    const precomposed = 'café credit limit';
    assert.equal(quoteMatches(decomposed, precomposed), true);
  });

  test('matches a Vietnamese quote', () => {
    const source = 'Điều khoản mới: Hạn mức tín dụng tăng lên 20 triệu.';
    assert.equal(quoteMatches(source, 'Hạn mức tín dụng tăng lên 20 triệu'), true);
  });

  test('false for an empty quote', () => {
    assert.equal(quoteMatches('any source text', ''), false);
    assert.equal(quoteMatches('any source text', '   '), false);
  });
});

describe('findQuoteLine', () => {
  test('returns the 1-based line of the first match', () => {
    const source = 'Line one.\nADR-0009 is partially superseded by ADR-0052.\nLine three.';
    assert.equal(findQuoteLine(source, 'partially superseded by ADR-0052'), 2);
  });

  test('returns the line where a reflowed (multi-line) quote starts', () => {
    const source = 'Header\nADR-0009 is\npartially   superseded\nby ADR-0052.\nFooter';
    assert.equal(findQuoteLine(source, 'ADR-0009 is partially superseded by ADR-0052.'), 2);
  });

  test('returns null when the quote is not found', () => {
    const source = 'ADR-0009 is accepted.';
    assert.equal(findQuoteLine(source, 'ADR-0009 is deprecated'), null);
  });

  test('returns null for an empty quote', () => {
    assert.equal(findQuoteLine('any source text', ''), null);
  });

  test('finds the first of two occurrences', () => {
    const source = 'first\nADR-0009 cited here.\nmiddle\nADR-0009 cited here.\nlast';
    assert.equal(findQuoteLine(source, 'ADR-0009 cited here.'), 2);
  });

  test('finds a Vietnamese quote on its own line', () => {
    const source = '# Tiêu đề\n\nHạn mức tín dụng đã tăng.\n\nGhi chú thêm.';
    assert.equal(findQuoteLine(source, 'Hạn mức tín dụng đã tăng.'), 3);
  });

  test('counts an astral char (emoji) as two UTF-16 units, not one', () => {
    assert.equal(findQuoteLine('a \u{1F600}\u{1F600}\u{1F600}\nb\nc\nd target', 'c'), 3);
  });

  test('locates every quote quoteMatches accepts, past emoji', () => {
    const source = '\u{1F600}\u{1F600}\u{1F600}\u{1F600} x\nyz';
    assert.equal(quoteMatches(source, 'yz'), true);
    assert.equal(findQuoteLine(source, 'yz'), 2);
  });
});
