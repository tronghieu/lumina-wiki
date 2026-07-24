/**
 * @module installer/registry
 * @description Sole reader/writer of the global wiki registry.
 *
 * File: <LUMINA_HOME or ~/.lumina>/wikis.json
 * Schema: { version: 1, wikis: { <key>: WikiEntry } }
 *
 * This module never writes inside a wiki directory — registry state lives
 * entirely under the hub (`~/.lumina/`), never inside a spoke. See AD-1/AD-2
 * in the librarian-mode architecture spine.
 *
 * All writes go through atomicWrite from fs.js.
 * Reads are defensive: missing registry file -> {version: 1, wikis: {}};
 * corrupt JSON or a schema version newer than supported both throw with
 * err.code = 3.
 */

import { readFile } from 'node:fs/promises';
import { join, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { atomicWrite, ensureDir } from './fs.js';

// ---------------------------------------------------------------------------
// Base dir / paths
// ---------------------------------------------------------------------------

export const REGISTRY_SCHEMA_VERSION = 1;

/**
 * Root directory for all hub state. Overridable via LUMINA_HOME so tests
 * never touch the real home directory.
 *
 * @returns {string}
 */
export function luminaHome() {
  return process.env.LUMINA_HOME || join(homedir(), '.lumina');
}

/**
 * Absolute path to the registry file.
 *
 * @returns {string}
 */
export function registryPath() {
  return join(luminaHome(), 'wikis.json');
}

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------

// Combining diacritical marks block (what NFD decomposition scatters
// diacritics into). Vietnamese đ/Đ are independent letters, not decomposable
// this way, so they are mapped explicitly before the NFD pass.
const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALNUM_RUN = /[^a-z0-9]+/g;

/**
 * Normalize an arbitrary user-facing string (name, alias, or query) into a
 * stable kebab-case key: NFC -> lowercase -> đ/Đ -> d -> NFD + strip
 * combining marks -> collapse non [a-z0-9] runs to a single hyphen -> trim
 * hyphens.
 *
 * This is the ONE shared normalizer for both write-side key computation and
 * read-side resolve matching (AD-3) — never compare a normalized query
 * against a raw stored value.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeKey(input) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFC').toLowerCase();
  s = s.replace(/đ/g, 'd');
  s = s.normalize('NFD').replace(COMBINING_MARKS, '');
  s = s.replace(NON_ALNUM_RUN, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

// ---------------------------------------------------------------------------
// readRegistry / writeRegistry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WikiEntry
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} path
 * @property {string} description
 * @property {string[]} packs
 * @property {string} addedAt
 */

/**
 * @typedef {Object} WikiRegistry
 * @property {number} version
 * @property {Record<string, WikiEntry>} wikis
 */

/**
 * Read the registry file.
 * Returns {version: 1, wikis: {}} when the file does not exist.
 * Throws err.code = 3 on corrupt JSON or a schema version newer than
 * supported.
 *
 * @returns {Promise<WikiRegistry>}
 */
export async function readRegistry() {
  const path = registryPath();
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { version: REGISTRY_SCHEMA_VERSION, wikis: {} };
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Corrupt wiki registry at "${path}": ${err.message}`);
    e.code = 3;
    throw e;
  }

  if (typeof parsed.version === 'number' && parsed.version > REGISTRY_SCHEMA_VERSION) {
    const e = new Error(
      `Wiki registry at "${path}" has schema version ${parsed.version}, newer than ` +
      `supported (${REGISTRY_SCHEMA_VERSION}). Update lumina-wiki.`,
    );
    e.code = 3;
    throw e;
  }

  if (!parsed.wikis || typeof parsed.wikis !== 'object') parsed.wikis = {};
  return parsed;
}

/**
 * Write the registry file atomically.
 *
 * @param {WikiRegistry} reg
 * @returns {Promise<void>}
 */
export async function writeRegistry(reg) {
  await ensureDir(luminaHome());
  await atomicWrite(registryPath(), JSON.stringify(reg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Internal resolution helper (shared by resolveWiki / removeWiki)
// ---------------------------------------------------------------------------

/**
 * Resolve `query` against an already-loaded registry object.
 * Match priority: key > name > aliases. Never compares a normalized query
 * against a raw stored value.
 *
 * @param {WikiRegistry} reg
 * @param {string} query
 * @returns {{key: string, entry: WikiEntry}}
 */
function resolveAgainst(reg, query) {
  const normQuery = normalizeKey(query);
  const entries = Object.entries(reg.wikis);

  let matches = entries.filter(([key]) => normalizeKey(key) === normQuery);
  if (matches.length === 0) {
    matches = entries.filter(([, entry]) => normalizeKey(entry.name) === normQuery);
  }
  if (matches.length === 0) {
    matches = entries.filter(([, entry]) =>
      (entry.aliases || []).some((alias) => normalizeKey(alias) === normQuery));
  }

  if (matches.length === 1) {
    const [key, entry] = matches[0];
    return { key, entry };
  }

  const ambiguous = matches.length > 1;
  const err = new Error(
    ambiguous
      ? `Ambiguous wiki reference "${query}" matches ${matches.length} wikis.`
      : `No wiki found matching "${query}".`,
  );
  err.code = 2;
  err.candidates = (ambiguous ? matches : entries).map(([key, entry]) => ({ key, name: entry.name }));
  throw err;
}

// ---------------------------------------------------------------------------
// addWiki
// ---------------------------------------------------------------------------

/**
 * Register a wiki directory in the global registry. Writes only the
 * registry file — never anything inside `dirPath`.
 *
 * @param {Object} opts
 * @param {string} opts.dirPath - Absolute path to an existing wiki, must
 *   contain `_lumina/manifest.json`.
 * @param {string} [opts.name] - Display name. Defaults to basename(dirPath).
 * @param {string[]} [opts.aliases]
 * @param {string} [opts.description]
 * @returns {Promise<{key: string, entry: WikiEntry}>}
 */
export async function addWiki({ dirPath, name, aliases = [], description = '' }) {
  if (typeof dirPath !== 'string' || !isAbsolute(dirPath)) {
    const err = new Error(`Wiki path must be an absolute path: "${dirPath}"`);
    err.code = 2;
    throw err;
  }

  const manifestPath = join(dirPath, '_lumina', 'manifest.json');
  let manifest;
  try {
    const raw = await readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    const e = new Error(
      `No Lumina wiki found at "${dirPath}" (missing or unreadable ${manifestPath}): ${err.message}`,
    );
    e.code = 2;
    throw e;
  }

  const packs = Object.keys(manifest.packs || {});
  const displayName = name || basename(dirPath);
  const key = normalizeKey(displayName);

  const reg = await readRegistry();

  if (reg.wikis[key]) {
    const err = new Error(`A wiki is already registered under key "${key}".`);
    err.code = 1;
    throw err;
  }

  const candidates = [normalizeKey(displayName), ...aliases.map((a) => normalizeKey(a))];
  for (const [existingKey, entry] of Object.entries(reg.wikis)) {
    const existingIdentifiers = new Set([
      normalizeKey(existingKey),
      normalizeKey(entry.name),
      ...(entry.aliases || []).map((a) => normalizeKey(a)),
    ]);
    for (const candidate of candidates) {
      if (candidate && existingIdentifiers.has(candidate)) {
        const err = new Error(
          `"${candidate}" already resolves to a different wiki ("${existingKey}").`,
        );
        err.code = 1;
        throw err;
      }
    }
  }

  const entry = {
    name: displayName,
    aliases,
    path: dirPath,
    description,
    packs,
    addedAt: new Date().toISOString(),
  };
  reg.wikis[key] = entry;
  await writeRegistry(reg);
  return { key, entry };
}

// ---------------------------------------------------------------------------
// removeWiki
// ---------------------------------------------------------------------------

/**
 * Remove a wiki from the registry by name/alias/key. Registry write only —
 * never touches the wiki directory.
 *
 * @param {string} query
 * @returns {Promise<{key: string, entry: WikiEntry}>}
 */
export async function removeWiki(query) {
  const reg = await readRegistry();
  const { key, entry } = resolveAgainst(reg, query);
  delete reg.wikis[key];
  await writeRegistry(reg);
  return { key, entry };
}

// ---------------------------------------------------------------------------
// listWikis
// ---------------------------------------------------------------------------

/**
 * Return the full registry object.
 *
 * @returns {Promise<WikiRegistry>}
 */
export async function listWikis() {
  return readRegistry();
}

// ---------------------------------------------------------------------------
// resolveWiki
// ---------------------------------------------------------------------------

/**
 * Resolve a name/alias/key query to exactly one wiki entry.
 * Zero or multiple matches throw err.code = 2 with err.candidates set.
 *
 * @param {string} query
 * @returns {Promise<{key: string, entry: WikiEntry}>}
 */
export async function resolveWiki(query) {
  const reg = await readRegistry();
  return resolveAgainst(reg, query);
}

// ---------------------------------------------------------------------------
// refreshPacks
// ---------------------------------------------------------------------------

/**
 * Re-read a registered wiki's own _lumina/manifest.json packs and persist
 * the refreshed list only if it changed. Tolerates an unreachable wiki path
 * (returns {refreshed: false, reason} instead of throwing).
 *
 * @param {string} key
 * @returns {Promise<{refreshed: boolean, reason?: string, packs?: string[]}>}
 */
export async function refreshPacks(key) {
  const reg = await readRegistry();
  const entry = reg.wikis[key];
  if (!entry) {
    return { refreshed: false, reason: `No wiki registered under key "${key}".` };
  }

  const manifestPath = join(entry.path, '_lumina', 'manifest.json');
  let manifest;
  try {
    const raw = await readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    return { refreshed: false, reason: `Could not read "${manifestPath}": ${err.message}` };
  }

  const packs = Object.keys(manifest.packs || {});
  const unchanged = JSON.stringify(packs) === JSON.stringify(entry.packs || []);
  if (unchanged) {
    return { refreshed: false, reason: 'packs unchanged' };
  }

  entry.packs = packs;
  reg.wikis[key] = entry;
  await writeRegistry(reg);
  return { refreshed: true, packs };
}
