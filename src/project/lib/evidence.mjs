/**
 * @file evidence.mjs
 * @description The one evidence-quote matcher (AD-22): a quote is a match
 * when it is a substring of the source after NFC normalization and
 * whitespace-run collapsing. `facts-write` and `verify-evidence`
 * both build on `quoteMatches`; `parse.mjs` uses `findQuoteLine`
 * to recompute a mention's line the same way. Pure -- no I/O.
 */

export function normalizeForMatch(text) {
  return String(text).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * A matcher closed over one doc's already-normalized source text -- the
 * per-doc cost of `normalizeForMatch(source)` is paid once here instead of
 * once per fact when many facts are checked against the same doc.
 * @param {string} source full document text.
 * @returns {(quote: string) => boolean}
 */
export function makeQuoteMatcher(source) {
  const normalizedSource = normalizeForMatch(source);
  return (quote) => {
    const needle = normalizeForMatch(quote);
    return needle !== '' && normalizedSource.includes(needle);
  };
}

/**
 * Does `quote` occur verbatim (after NFC + whitespace-collapse) in `source`?
 * @param {string} source full document text.
 * @param {string} quote evidence quote to look for.
 * @returns {boolean}
 */
export function quoteMatches(source, quote) {
  return makeQuoteMatcher(source)(quote);
}

/**
 * A locator closed over one doc's already-built collapsed-text/line-map
 * index -- the per-doc cost of building it (an O(doc length) scan) is paid
 * once here instead of once per fact when many facts are located against
 * the same doc.
 * @param {string} source full document text.
 * @returns {(quote: string) => number|null} 1-based line, or null when no match is found.
 */
export function makeQuoteLocator(source) {
  const nfcSource = String(source).normalize('NFC');
  const collapsedChars = [];
  const charLines = [];
  let line = 1;
  let lastWasSpace = false;

  for (const ch of nfcSource) {
    const charLine = line;
    if (ch === '\n') line += 1;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        collapsedChars.push(' ');
        charLines.push(charLine);
        lastWasSpace = true;
      }
    } else {
      collapsedChars.push(ch);
      // One entry per UTF-16 unit, not per code point: `indexOf` below
      // returns a UTF-16 index, and an astral char (emoji) is two units.
      for (let k = 0; k < ch.length; k++) charLines.push(charLine);
      lastWasSpace = false;
    }
  }

  const collapsedSource = collapsedChars.join('');
  return (quote) => {
    const needle = normalizeForMatch(quote);
    if (needle === '') return null;
    const idx = collapsedSource.indexOf(needle);
    if (idx === -1) return null;
    return charLines[idx] ?? null;
  };
}

/**
 * 1-based line of the first character of the first match of `quote` in
 * `source`, after the same NFC + whitespace-collapse normalization (so a
 * quote whose whitespace was reflowed still resolves to the line its match
 * starts on).
 * @param {string} source full document text.
 * @param {string} quote evidence quote to look for.
 * @returns {number|null} 1-based line, or null when no match is found.
 */
export function findQuoteLine(source, quote) {
  return makeQuoteLocator(source)(quote);
}
