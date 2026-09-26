/**
 * @file markdown.mjs
 * @description The one heading-slug function used for fragment identity
 * (AD-20): NFC-normalize, lowercase, drop any character that is not a
 * letter, mark, number, `_`, `-`, or space, then turn spaces into hyphens.
 * Unicode-preserving, so Vietnamese (and other non-ASCII) headings keep
 * their diacritics instead of being transliterated away. Pure — no I/O.
 *
 * Also: `renderedText` (strip inline markup for anchor slugging), `scanBody`
 * (headings/links/scannable-lines over a doc body, skipping fenced code,
 * HTML comments, and `<!-- lumina:project -->` blocks), and the two regex
 * helpers (`escapeRegex`, `matchAll`) every ID- and concept-mention matcher
 * in the parse layer builds on (contract: Unicode lookarounds, `u`
 * flag, `\b` forbidden, trailing `.,;:-` stripped from a body match).
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

/**
 * Strip inline markup from heading/link text before slugging or display:
 * code spans -> their content verbatim, `[t](u)` -> `t`, HTML tags removed,
 * emphasis `*`/`_` delimiters removed (keeping their content). `_` delimits
 * only at a word edge, so `snake_case_name` and `` `user_id` `` keep their
 * underscores, as GitHub's anchors do (AD-20). Pure text transform, not a
 * markdown renderer -- good enough for anchor text and quotes.
 * @param {string} markdown
 * @returns {string}
 */
export function renderedText(markdown) {
  let text = String(markdown);
  // Code spans set aside first (as NUL-delimited placeholders) so no later
  // step touches their content; restored at the end.
  const codes = [];
  let out = '';
  let pos = 0;
  for (const { start, end } of findCodeSpans(text)) {
    const ticks = /^`+/.exec(text.slice(start))[0].length;
    codes.push(text.slice(start + ticks, end - ticks));
    out += `${text.slice(pos, start)}\u0000${codes.length - 1}\u0000`;
    pos = end;
  }
  text = out + text.slice(pos);
  // An unmatched backtick run is not a span; drop it.
  text = text.replace(/`+/g, '');
  // `[text](url "title")` -> `text`.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // HTML tags removed, content kept.
  text = text.replace(/<[^>]+>/g, '');
  // Paired emphasis delimiters (`*`, `**`, `***`, `_`, `__`, `___`) -> content.
  // Re-applied until stable so nested pairs (`**_x_**`) fully unwrap.
  let prev;
  do {
    prev = text;
    text = text.replace(/(\*{1,3})([^*]+?)\1/g, '$2');
    text = text.replace(/(?<![\p{L}\p{N}_])(_{1,3})([^_]+?)\1(?![\p{L}\p{N}_])/gu, '$2');
  } while (text !== prev);
  // A leftover `*` from malformed input is noise; a leftover `_` is a literal
  // (intraword) underscore and stays.
  text = text.replace(/\*/g, '');
  return text.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)] ?? m);
}

/**
 * Escape a literal string for embedding inside a `RegExp` source.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find every match of `source` (a regex source string, not yet compiled)
 * inside `text`, wrapped in the Unicode word-boundary lookarounds every ID-
 * and concept-mention matcher must use instead of `\b` (`\b` is ASCII-only
 * and would split a match in the middle of a non-Latin word). Trailing
 * `.,;:-` is stripped from each match (a body match swallowing the end of a
 * sentence or a trailing dash).
 * @param {string} source regex source, e.g. an `idPattern` or `escapeRegex(name)`.
 * @param {string} text the text to search.
 * @param {{ignoreCase?: boolean}} [options]
 * @returns {{match: string, index: number}[]}
 */
// Compiled-pattern cache, keyed by (source, flags): parse.mjs calls
// `matchAll` once per (idPattern|concept alias) per scanned line, so
// recompiling the same RegExp on every call is wasted work across a whole
// doc tree.
const compiledPatternCache = new Map();

function compilePattern(source, flags) {
  const key = `${flags}\u0000${source}`;
  let re = compiledPatternCache.get(key);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, flags);
    compiledPatternCache.set(key, re);
  }
  re.lastIndex = 0; // a cached, `g`-flagged RegExp carries state between calls
  return re;
}

export function matchAll(source, text, { ignoreCase = false } = {}) {
  const flags = ignoreCase ? 'gui' : 'gu';
  const re = compilePattern(source, flags);
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const match = m[0].replace(/[.,;:-]+$/, '');
    results.push({ match, index: m.index });
    if (m[0].length === 0) re.lastIndex += 1; // guard against a zero-width source
  }
  return results;
}

const LUMINA_BLOCK_OPEN = '<!-- lumina:project -->';
const LUMINA_BLOCK_CLOSE = '<!-- /lumina:project -->';
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^(`{3,}|~{3,})\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
// `(?<!!)` excludes an image `![alt](url)`: the same syntax with a `!` right
// before the bracket.
const LINK_INLINE_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// `(?!\^)` excludes a footnote definition `[^1]: ...`, which is not a link.
const LINK_REF_DEF_RE = /^ {0,3}\[(?!\^)([^\]]+)\]:\s*(\S+)(?:\s+.*)?$/;

/**
 * Find inline code spans (`` `x` ``, `` ``x`` ``, ...) in one line: a run of
 * N backticks opens a span, closed by the next run of exactly N backticks.
 * An unmatched opening run is not a span (CommonMark). Intra-line only, to
 * match this module's per-line design.
 * @param {string} text
 * @returns {{start: number, end: number}[]} end is exclusive.
 */
function findCodeSpans(text) {
  const ticks = [];
  const re = /`+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ticks.push({ index: m.index, length: m[0].length });
  }
  const spans = [];
  let i = 0;
  while (i < ticks.length) {
    const open = ticks[i];
    let j = i + 1;
    while (j < ticks.length && ticks[j].length !== open.length) j += 1;
    if (j < ticks.length) {
      spans.push({ start: open.index, end: ticks[j].index + ticks[j].length });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return spans;
}

function isInsideSpans(index, spans) {
  return spans.some((s) => index >= s.start && index < s.end);
}

// Next index of `needle` in `text` at or after `fromIndex`, skipping any
// occurrence that falls inside a code span (so `` `<!--` `` is inert text,
// not a comment opener).
function findOutsideSpans(text, needle, fromIndex, spans) {
  let idx = text.indexOf(needle, fromIndex);
  while (idx !== -1 && isInsideSpans(idx, spans)) {
    idx = text.indexOf(needle, idx + 1);
  }
  return idx;
}

/**
 * Strip HTML comments from one line, code-span-aware, carrying `inComment`
 * state across lines. Handles a comment that opens and never closes on this
 * line, one that closes and immediately reopens another on the same line
 * (`--> kept text <!--`), and any number of complete comments in between.
 * @param {string} rawLine
 * @param {boolean} startInComment
 * @returns {{text: string, inComment: boolean}}
 */
function stripComments(rawLine, startInComment) {
  const spans = findCodeSpans(rawLine);
  let inComment = startInComment;
  let result = '';
  let pos = 0;

  for (;;) {
    if (inComment) {
      const closeIdx = findOutsideSpans(rawLine, '-->', pos, spans);
      if (closeIdx === -1) return { text: result, inComment: true };
      pos = closeIdx + 3;
      inComment = false;
    } else {
      const openIdx = findOutsideSpans(rawLine, '<!--', pos, spans);
      if (openIdx === -1) {
        result += rawLine.slice(pos);
        return { text: result, inComment: false };
      }
      result += rawLine.slice(pos, openIdx);
      pos = openIdx + 4;
      inComment = true;
    }
  }
}

/**
 * Scan a document body for headings, links, and the plain-text lines a
 * later ID/concept-mention pass can search -- with fenced code (``` / ~~~),
 * HTML comments, and `<!-- lumina:project -->` blocks removed first (inline
 * code is left alone; only whole comments/blocks are dropped).
 * @param {string} body the document body (post-frontmatter).
 * @param {number} startLine 1-based file line where `body`'s first line sits.
 * @returns {{
 *   headings: {level: number, text: string, anchor: string, line: number}[],
 *   links: {target: string, line: number, quote: string}[],
 *   lines: {line: number, text: string}[],
 * }}
 */
export function scanBody(body, startLine) {
  const rawLines = String(body).split(/\r\n|\r|\n/);
  const headings = [];
  const links = [];
  const lines = [];
  const usedAnchors = new Set();

  function reserveAnchor(base) {
    if (!usedAnchors.has(base)) {
      usedAnchors.add(base);
      return base;
    }
    let n = 1;
    let candidate = `${base}-${n}`;
    while (usedAnchors.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    usedAnchors.add(candidate);
    return candidate;
  }

  function scanHeadingAndLinks(text, line) {
    const hm = HEADING_RE.exec(text);
    if (hm) {
      const level = hm[1].length;
      const headingText = (hm[2] ?? '').trim();
      const anchor = reserveAnchor(slug(renderedText(headingText).trim()));
      headings.push({ level, text: headingText, anchor, line });
    }

    const codeSpans = findCodeSpans(text);

    LINK_INLINE_RE.lastIndex = 0;
    let lm;
    while ((lm = LINK_INLINE_RE.exec(text)) !== null) {
      if (!isInsideSpans(lm.index, codeSpans)) {
        links.push({ target: lm[2], line, quote: lm[0] });
      }
    }

    const rm = LINK_REF_DEF_RE.exec(text);
    if (rm && !isInsideSpans(rm.index, codeSpans)) {
      links.push({ target: rm[2], line, quote: text.trim() });
    }
  }

  let fenceChar = null;
  let fenceLen = 0;
  let inComment = false;
  let inLuminaBlock = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const line = startLine + i;
    const trimmed = raw.trim();

    if (inLuminaBlock) {
      if (trimmed === LUMINA_BLOCK_CLOSE) inLuminaBlock = false;
      continue;
    }
    if (fenceChar) {
      const m = FENCE_CLOSE_RE.exec(trimmed);
      if (m && m[1][0] === fenceChar && m[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }
    if (inComment) {
      const res = stripComments(raw, true);
      inComment = res.inComment;
      lines.push({ line, text: res.text });
      scanHeadingAndLinks(res.text, line);
      continue;
    }
    if (trimmed === LUMINA_BLOCK_OPEN) {
      inLuminaBlock = true;
      continue;
    }
    const fenceOpen = FENCE_OPEN_RE.exec(trimmed);
    if (fenceOpen) {
      fenceChar = fenceOpen[1][0];
      fenceLen = fenceOpen[1].length;
      continue;
    }

    const res = stripComments(raw, false);
    inComment = res.inComment;
    lines.push({ line, text: res.text });
    scanHeadingAndLinks(res.text, line);
  }

  return { headings, links, lines };
}
