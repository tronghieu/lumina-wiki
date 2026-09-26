/**
 * @file markdown.mjs
 * @description The one heading-slug function used for fragment identity
 * (AD-20): NFC-normalize, lowercase, drop any character that is not a
 * letter, mark, number, `_`, `-`, or space, then turn spaces into hyphens.
 * Unicode-preserving, so Vietnamese (and other non-ASCII) headings keep
 * their diacritics instead of being transliterated away. Pure — no I/O.
 */

/**
 * Slug a heading (or any text) into a fragment anchor.
 * @param {string} text
 * @returns {string}
 */
export function slug(text) {
  const nfc = String(text).normalize('NFC').toLowerCase();
  const kept = nfc.replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '');
  return kept.replace(/ /g, '-');
}
