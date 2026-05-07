#!/usr/bin/env node
/**
 * @module parse-ids
 * Thin CLI wrapper around parseUrlToExternalIds + sanitizeExternalIdsObject
 * + expandExternalIds. URL is read from process.argv[2] (NOT shell-interpolated)
 * to eliminate command-injection risk in skill-prompt invocations.
 *
 * Usage:  node parse-ids.mjs <url>
 * Output: JSON map (e.g. {"url": "...", "doi": "...", "arxiv": "..."})
 * Exit:   0 on success, 2 on missing/invalid URL.
 */

import { parseUrlToExternalIds, sanitizeExternalIdsObject, expandExternalIds } from './external-ids.mjs';

const url = process.argv[2];
if (!url) {
  process.stderr.write(JSON.stringify({ error: 'parse-ids: missing URL argument', code: 2 }) + '\n');
  process.exit(2);
}

const parsed = parseUrlToExternalIds(url);
if (!parsed.url) {
  process.stderr.write(JSON.stringify({ error: `parse-ids: invalid URL: ${url}`, code: 2 }) + '\n');
  process.exit(2);
}

// Expand cross-namespace equivalents (arxiv ↔ arxiv-DOI), then sanitize.
const expanded = expandExternalIds(parsed);
// Preserve `url` key (sanitize keeps it; expand kept it).
const merged = { ...expanded };
if (parsed.url) merged.url = parsed.url;
const safe = sanitizeExternalIdsObject(merged);

process.stdout.write(JSON.stringify(safe) + '\n');
