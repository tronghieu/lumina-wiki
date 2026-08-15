/**
 * ─────────────────────────────────────────────────────────────────────────────
 * slug.mjs — title/basename to kebab-case slug
 *
 * One definition, shared. `wiki.mjs slug` names new pages with it and
 * `lint.mjs` renames existing ones to it (L03), so the two must agree: a
 * second, hand-written kebab transform in the fixer meant `lint --fix` could
 * rename a page to something `wiki.mjs slug` would never have produced for the
 * same title. Pure function, no I/O — importable from either side.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// U+0300..U+036F — the Combining Diacritical Marks block, i.e. exactly what
// NFD scatters a decomposable accented letter into. Written as escapes: the
// literal characters are invisible in an editor and do not survive a careless
// copy between files.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Convert a title string to a kebab-case slug.
 * Lowercase, hyphenate, strip punctuation, collapse whitespace.
 *
 * Letters with no canonical decomposition (`đ`, `ø`, `æ`, `ß`, `ł`, `þ`)
 * survive NFD intact and are then dropped as punctuation rather than
 * transliterated — `Đổi Mới` slugs to `oi-moi`. That is a known wart, left
 * alone deliberately: changing it changes the slug for a title a wiki may
 * already have a page under, so it needs a migration path, not a patch.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    // Replace accented chars with ascii equivalents where possible
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    // Replace non-alphanumeric (except spaces and hyphens) with space
    .replace(/[^a-z0-9\s-]/g, ' ')
    // Collapse any whitespace and hyphens to a single hyphen
    .trim()
    .replace(/[\s-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}
