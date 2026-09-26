/**
 * @file frontmatter.mjs
 * @description Split a document's leading YAML frontmatter block (`---` ...
 * `---`) from its body, and report the 1-based file line where the body
 * starts, so every downstream line number (headings, links, ID/concept
 * mentions) stays anchored to the real file. Pure -- no I/O. The engine's
 * only other YAML parser call site besides `config.mjs` (both use the
 * vendored js-yaml with `CORE_SCHEMA`, so dates and other YAML tags never
 * turn into anything but plain strings/numbers/booleans).
 */

import { load as loadYaml, CORE_SCHEMA } from '../vendor/js-yaml.mjs';

const BOM = '﻿';
const DELIMITER_RE = /^---\s*$/;

/**
 * BOM-stripped `text` split on any line ending (`\n`, `\r\n`, or bare `\r`)
 * -- the one line-splitting rule this module, `parse.mjs`'s frontmatter-line
 * lookups, and `query.mjs`'s `at.quote` line recovery all share, instead of
 * three copies.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  const input = String(text ?? '');
  return (input.startsWith(BOM) ? input.slice(1) : input).split(/\r\n|\r|\n/);
}

/**
 * Split `text` into frontmatter data and body.
 * @param {string} text raw file content, as read (may carry a leading BOM).
 * @returns {{data: object|null, error: string|null, body: string, bodyStartLine: number}}
 *   `data` is the parsed mapping, or null when there is no frontmatter block,
 *   the block is empty, or it parses to `null`/`undefined`. `error` is set
 *   only when a frontmatter block is present but fails to parse or does not
 *   parse to a mapping. `bodyStartLine` is the 1-based line in the original
 *   file where `body` begins.
 */
export function splitFrontmatter(text) {
  const input = String(text).startsWith(BOM) ? String(text).slice(1) : String(text);
  const lines = splitLines(text);

  if (!DELIMITER_RE.test(lines[0] ?? '')) {
    return { data: null, error: null, body: input, bodyStartLine: 1 };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER_RE.test(lines[i])) {
      closeIndex = i;
      break;
    }
  }
  // No closing delimiter: not a real frontmatter block, whole text is body.
  if (closeIndex === -1) {
    return { data: null, error: null, body: input, bodyStartLine: 1 };
  }

  const yamlText = lines.slice(1, closeIndex).join('\n');
  const body = lines.slice(closeIndex + 1).join('\n');
  const bodyStartLine = closeIndex + 2;

  let data = null;
  let error = null;
  try {
    const parsed = loadYaml(yamlText, { schema: CORE_SCHEMA });
    if (parsed === undefined || parsed === null) {
      data = null;
    } else if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      error = 'frontmatter is not a mapping';
    } else {
      data = parsed;
    }
  } catch (e) {
    error = e.message;
  }

  // A doc that opens with a `---` thematic break, then prose, then a later
  // `---` looks like a frontmatter block but isn't one: the "YAML" between
  // fails to parse (or isn't a mapping). Don't drop that prose from body --
  // return the whole input, so the caller sees it as an ordinary doc with a
  // bad-frontmatter finding, not as a doc missing its first paragraphs.
  if (error !== null) {
    return { data: null, error, body: input, bodyStartLine: 1 };
  }

  return { data, error, body, bodyStartLine };
}
