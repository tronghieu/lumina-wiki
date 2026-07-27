#!/usr/bin/env node
/**
 * @module build-source
 * Thin CLI wrapper around buildSourceEntry. Emits one JSON entry for the
 * `sources` frontmatter array. Skills compose the array externally and pass
 * to `wiki.mjs set-meta <slug> sources <json> --json-value`.
 *
 * Usage:  node build-source.mjs <provider> [url]
 * Output: JSON object — {"provider":"…","fetched_at":"…Z","url":"…"}
 * Exit:   0 on success, 2 on invalid args.
 */

import { buildSourceEntry } from './external-ids.mjs';

const provider = process.argv[2];
const url = process.argv[3];

if (!provider) {
  process.stderr.write(JSON.stringify({ error: 'build-source: missing <provider> argument', code: 2 }) + '\n');
  process.exit(2);
}

let entry;
try {
  entry = buildSourceEntry(provider, url ? { url } : {});
} catch (err) {
  process.stderr.write(JSON.stringify({ error: `build-source: ${err.message}`, code: 2 }) + '\n');
  process.exit(2);
}

process.stdout.write(JSON.stringify(entry) + '\n');
