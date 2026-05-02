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
