#!/usr/bin/env node
/**
 * @module merge-ids
 * Stdin-driven non-destructive merge for `external_ids` maps.
 *
 * Reads a JSON map from stdin (existing keys), parses argv[2] as a URL,
 * extracts external_ids from the URL, merges so EXISTING keys win, and
 * writes the merged JSON to stdout. All values pass through
 * sanitizeExternalIdsObject before output.
 *
 * Designed for use in skill recipes (e.g. /lumi-migrate-legacy --backfill-ids)
 * so no shell-interpolated `python -c` or `node -e` is ever needed.
 *
 * Usage:
 *   echo '{"doi":"10.x/y"}' | node merge-ids.mjs https://arxiv.org/abs/X
 *
 * Exit: 0 success, 2 invalid input, 3 stdin read failure.
 */

import { parseUrlToExternalIds, sanitizeExternalIdsObject, expandExternalIds } from './external-ids.mjs';

const url = process.argv[2];
if (!url) {
  process.stderr.write(JSON.stringify({ error: 'merge-ids: missing URL argument', code: 2 }) + '\n');
  process.exit(2);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('error', err => {
  process.stderr.write(JSON.stringify({ error: `merge-ids: stdin: ${err.message}`, code: 3 }) + '\n');
  process.exit(3);
});
process.stdin.on('end', () => {
  let existing = {};
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      existing = JSON.parse(trimmed);
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: `merge-ids: invalid stdin JSON: ${err.message}`, code: 2 }) + '\n');
      process.exit(2);
    }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      process.stderr.write(JSON.stringify({ error: 'merge-ids: stdin must be a JSON object', code: 2 }) + '\n');
      process.exit(2);
    }
  }

  let fromUrl;
  try {
    fromUrl = parseUrlToExternalIds(url);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: `merge-ids: parse failed: ${err.message}`, code: 2 }) + '\n');
    process.exit(2);
  }
  if (!fromUrl.url) {
    process.stderr.write(JSON.stringify({ error: `merge-ids: invalid URL: ${url}`, code: 2 }) + '\n');
    process.exit(2);
  }

  // Sanitize existing first (drops __proto__, unknown ns, non-string vals).
  const safeExisting = sanitizeExternalIdsObject(existing);

  // Expand URL-derived ids (arxiv ↔ arxiv-DOI), then non-destructive merge.
  const expanded = expandExternalIds(fromUrl);
  const mergeIn = sanitizeExternalIdsObject({ ...expanded, url: fromUrl.url });

  const merged = Object.create(null);
  for (const [k, v] of Object.entries(safeExisting)) merged[k] = v;
  for (const [k, v] of Object.entries(mergeIn)) {
    if (!(k in merged)) merged[k] = v;
  }
  process.stdout.write(JSON.stringify(merged) + '\n');
});
