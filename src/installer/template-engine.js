/**
 * @module installer/template-engine
 * @description Lightweight Mustache-style template renderer for Lumina templates.
 *
 * Supported syntax:
 *   {{variable}}             — simple variable substitution
 *   {{#if condition}}        — conditional block open (truthy check)
 *   {{/if}}                  — conditional block close
 *   {{#if pack_research}}    — pack-specific conditional
 *
 * Variables are HTML-unescaped (raw substitution — templates are Markdown, not HTML).
 * Unknown variables render as empty string.
 * Nested conditionals are NOT supported (v0.1 scope).
 *
 * Line endings are normalized to LF on output regardless of host OS.
 */

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

/**
 * Render a template string with the given variables.
 *
 * @param {string}              template  - Template string with {{...}} tokens.
 * @param {Record<string, any>} variables - Key/value map for substitution.
 * @returns {string} Rendered output with LF line endings.
 */
export function render(template, variables = {}) {
  // Normalize input line endings to LF
  const normalized = template.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rendered = processTemplate(normalized, variables);
  return rendered;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Process template string — handle conditionals then variables.
 *
 * @param {string}              text
 * @param {Record<string, any>} vars
 * @returns {string}
 */
function processTemplate(text, vars) {
  // Process {{#if ...}} ... {{/if}} blocks first (outermost pass)
  const withBlocks = processConditionals(text, vars);
  // Then substitute {{variable}} tokens
  return substituteVariables(withBlocks, vars);
}

/**
 * Process all {{#if condition}} ... {{/if}} blocks.
 * Non-greedy matching so adjacent blocks don't merge.
 * Strips the entire block if condition is falsy; keeps inner content if truthy.
 *
 * @param {string}              text
 * @param {Record<string, any>} vars
 * @returns {string}
 */
function processConditionals(text, vars) {
  // Regex: {{#if CONDITION}}\n?...{{/if}}\n?
  // Non-greedy inner match to handle multiple blocks.
  // We use a loop to handle sequential (non-nested) blocks.
  const ifBlockRe = /\{\{#if ([^}]+)\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g;
  return text.replace(ifBlockRe, (_match, condition, inner) => {
    const condKey = condition.trim();
    const condValue = vars[condKey];
    const isTruthy = Boolean(condValue);
    if (isTruthy) {
      // Recursively process inner content (for nested variable substitutions inside)
      return inner;
    }
    return '';
  });
}

/**
 * Substitute {{variable}} tokens with their values from vars.
 * Unknown variables → empty string.
 *
 * @param {string}              text
 * @param {Record<string, any>} vars
 * @returns {string}
 */
function substituteVariables(text, vars) {
  return text.replace(/\{\{([^#/}][^}]*)\}\}/g, (_match, key) => {
    const trimmedKey = key.trim();
    const value = vars[trimmedKey];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// renderReadme — three-region structure
// ---------------------------------------------------------------------------

/**
 * Render README.md from template with three distinct regions:
 *   1. Title: "# {{project_name}}" (top)
 *   2. Purpose: verbatim from prompt, outside any markers
 *   3. Schema region: between <!-- lumina:schema --> markers
 *
 * @param {string}              template  - Full README template text.
 * @param {Record<string, any>} variables - Template variables.
 * @param {string}              [purpose] - Research purpose text (optional).
 * @returns {string} Fully rendered README.
 */
export function renderReadme(template, variables, purpose = '') {
  const rendered = render(template, variables);
  // Insert purpose section after the first H1 line
  const purposeText = purpose && purpose.trim()
    ? purpose.trim()
    : '_(Describe what this wiki is for. Edit freely — Lumina will not touch this section on upgrade.)_';

  // Wrap the rendered content in schema markers if they're not already there
  // The template itself may already include the markers
  if (!rendered.includes('<!-- lumina:schema -->')) {
    // Build three-region structure
    const titleLine = `# ${variables.project_name || 'My Wiki'}`;
    return [
      titleLine,
      '',
      '## Project Purpose',
      '',
      purposeText,
      '',
      '<!-- lumina:schema -->',
      rendered,
      '<!-- /lumina:schema -->',
    ].join('\n') + '\n';
  }

  // Template already has markers — inject purpose between title and schema
  const lines = rendered.split('\n');
  const schemaMarkerIdx = lines.findIndex(l => l.trim() === '<!-- lumina:schema -->');
  if (schemaMarkerIdx < 0) return rendered;

  // Find end of title block (first non-empty, non-H1 line before marker)
  let insertIdx = schemaMarkerIdx;
  // Insert purpose region before schema marker
  const purposeLines = ['', '## Project Purpose', '', purposeText, ''];
  lines.splice(insertIdx, 0, ...purposeLines);

  return lines.join('\n');
}

/**
 * Extract the schema region content from an existing README.md.
 * Returns null if the markers are not found.
 *
 * @param {string} readmeContent
 * @returns {string|null}
 */
export function extractSchemaRegion(readmeContent) {
  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const lines = readmeContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const startLine = lines.findIndex(line => line.trim() === openMarker);
  const endLine = lines.findIndex((line, idx) => idx > startLine && line.trim() === closeMarker);
  if (startLine === -1 || endLine === -1) return null;
  return lines.slice(startLine + 1, endLine).join('\n');
}

/**
 * Replace only the schema region in an existing README.md.
 * Content outside the markers is preserved byte-for-byte.
 *
 * @param {string} existingContent  - Current README.md content.
 * @param {string} newSchemaContent - New content for the schema region.
 * @returns {string}
 */
export function replaceSchemaRegion(existingContent, newSchemaContent) {
  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const normalized = existingContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const startLine = lines.findIndex(line => line.trim() === openMarker);
  const endLine = lines.findIndex((line, idx) => idx > startLine && line.trim() === closeMarker);
  if (startLine === -1 || endLine === -1) {
    // Markers not found — return existing content unchanged
    return existingContent;
  }
  const schemaLines = newSchemaContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return [
    ...lines.slice(0, startLine + 1),
    ...schemaLines,
    ...lines.slice(endLine),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// upsertMarkerBlock / stripMarkerBlock — generic marker-region editor
// (project-docs-overlay, story 7 / AD-3). Unlike replaceSchemaRegion/
// extractSchemaRegion above, these preserve the file's own line-ending
// style (LF or CRLF) instead of normalizing to LF, because they edit
// USER-owned files (AGENTS.md, CLAUDE.md, .gitignore) where every byte
// outside the marker block must stay exactly as it was.
// ---------------------------------------------------------------------------

/**
 * Thrown by `upsertMarkerBlock`/`stripMarkerBlock` when the marker pair is
 * missing a half, duplicated, or out of order — never silently repaired,
 * since a "fix" here would mean guessing which lines are the user's and
 * which are a stale Lumina block. Callers (e.g. project-mode.js) catch this
 * and re-throw with the file path attached and `code = 3`.
 */
export class MarkerBlockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarkerBlockError';
  }
}

/**
 * Split `content` into lines, each keeping its OWN original terminator
 * ('\n', '\r\n', or '' for a final line with no trailing newline). This is
 * what lets upsert/strip below preserve every byte outside the block
 * exactly, even in a file with mixed line endings.
 *
 * @param {string} content
 * @returns {{text: string, eol: ''|'\n'|'\r\n'}[]}
 */
function splitKeepingEol(content) {
  const lines = [];
  let i = 0;
  while (i < content.length) {
    const nl = content.indexOf('\n', i);
    if (nl === -1) {
      lines.push({ text: content.slice(i), eol: '' });
      break;
    }
    const hasCr = content[nl - 1] === '\r';
    lines.push({ text: content.slice(i, hasCr ? nl - 1 : nl), eol: hasCr ? '\r\n' : '\n' });
    i = nl + 1;
  }
  return lines;
}

/**
 * The more common of '\n'/'\r\n' among terminated lines (an unterminated
 * last line has no EOL to count); '\n' on a tie or no terminated lines.
 */
function dominantEol(lines) {
  let crlf = 0;
  let terminated = 0;
  for (const l of lines) {
    if (l.eol === '') continue;
    terminated += 1;
    if (l.eol === '\r\n') crlf += 1;
  }
  return crlf * 2 > terminated ? '\r\n' : '\n';
}

/**
 * Find the marker pair among line texts, refusing anything that isn't
 * exactly one open followed by exactly one close (each matched with
 * `line.trim() === marker`, same rule as the schema-region helpers).
 *
 * @param {string[]} texts
 * @param {string} open
 * @param {string} close
 * @returns {{present: false}|{present: true, startIdx: number, endIdx: number}}
 */
function locateMarkerBlock(texts, open, close) {
  const openIdxs = [];
  const closeIdxs = [];
  texts.forEach((t, i) => {
    if (t.trim() === open) openIdxs.push(i);
    if (t.trim() === close) closeIdxs.push(i);
  });
  if (openIdxs.length === 0 && closeIdxs.length === 0) return { present: false };
  if (openIdxs.length !== 1 || closeIdxs.length !== 1 || closeIdxs[0] <= openIdxs[0]) {
    throw new MarkerBlockError(
      `unbalanced or duplicated marker block (${JSON.stringify(open)} / ${JSON.stringify(close)}): ` +
      `found ${openIdxs.length} open marker(s) and ${closeIdxs.length} close marker(s)`,
    );
  }
  return { present: true, startIdx: openIdxs[0], endIdx: closeIdxs[0] };
}

/**
 * Insert or replace the region between `open` and `close` marker lines.
 * When the markers already exist, only the lines between them are
 * replaced; every other line keeps its own original terminator byte-for-
 * byte, and the close marker's own terminator is preserved too — so
 * replacing the block never adds a trailing newline the file didn't have.
 * When absent, the block is appended, using the file's dominant EOL for
 * every new line — with one blank separator line first when the file
 * already has content — so an absent file (`content === ''`) ends up
 * holding only the block. Throws `MarkerBlockError` on an unbalanced or
 * duplicated marker pair; never repairs one silently.
 *
 * @param {string} content - Existing file content, or '' for an absent file.
 * @param {string} open    - Opening marker line, e.g. '<!-- lumina:project -->'.
 * @param {string} close   - Closing marker line.
 * @param {string} body    - New content for the region (no surrounding markers).
 * @returns {string}
 */
export function upsertMarkerBlock(content, open, close, body) {
  const lines = splitKeepingEol(content ?? '');
  const located = locateMarkerBlock(lines.map(l => l.text), open, close);
  const eol = dominantEol(lines);
  const bodyLines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(text => ({ text, eol }));

  let outLines;
  if (located.present) {
    const { startIdx, endIdx } = located;
    const openLine = { text: open, eol: lines[startIdx].eol };
    const closeLine = { text: close, eol: lines[endIdx].eol };
    outLines = [...lines.slice(0, startIdx), openLine, ...bodyLines, closeLine, ...lines.slice(endIdx + 1)];
  } else if (lines.length === 0) {
    outLines = [{ text: open, eol }, ...bodyLines, { text: close, eol }];
  } else {
    // Appending after existing content: the previous last line must gain a
    // terminator if it didn't already have one — otherwise the separator
    // line below would run onto the same line — but every OTHER line's
    // original terminator is untouched.
    const last = lines[lines.length - 1];
    const fixedLines = last.eol === '' ? [...lines.slice(0, -1), { text: last.text, eol }] : lines;
    outLines = [...fixedLines, { text: '', eol }, { text: open, eol }, ...bodyLines, { text: close, eol }];
  }
  return outLines.map(l => l.text + l.eol).join('');
}

/**
 * Remove the region between `open` and `close` marker lines, including one
 * blank separator line immediately before the block if present. Every
 * surviving line keeps its own original terminator byte-for-byte. Returns
 * `content` unchanged when the markers are not found. When nothing is left
 * afterward, returns '' — callers should delete the file when the result's
 * `.trim()` is empty. Throws `MarkerBlockError` on an unbalanced or
 * duplicated marker pair; never repairs one silently.
 *
 * @param {string} content
 * @param {string} open
 * @param {string} close
 * @returns {string}
 */
export function stripMarkerBlock(content, open, close) {
  const original = content ?? '';
  const lines = splitKeepingEol(original);
  const located = locateMarkerBlock(lines.map(l => l.text), open, close);
  if (!located.present) return original;

  const { startIdx, endIdx } = located;
  let removeStart = startIdx;
  if (removeStart > 0 && lines[removeStart - 1].text === '') removeStart -= 1;

  const outLines = [...lines.slice(0, removeStart), ...lines.slice(endIdx + 1)];
  return outLines.length > 0 ? outLines.map(l => l.text + l.eol).join('') : '';
}
