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

import { readFile, stat } from 'node:fs/promises';
import { join, basename, isAbsolute, resolve } from 'node:path';
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
// pathsEqual
// ---------------------------------------------------------------------------

/**
 * True when `a` and `b` are the same absolute path, independent of
 * Unicode normalization form. macOS/APFS commonly hands filesystem-derived
 * strings back NFD-decomposed (diacritics split into base letter + combining
 * mark) even when the path was originally typed/stored NFC-composed — e.g.
 * Vietnamese "dự án" — so a plain `===` on two otherwise-identical paths can
 * spuriously disagree. `resolve()` first so `.`/`..`/trailing-slash
 * differences don't cause a false negative either.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function pathsEqual(a, b) {
  return resolve(a).normalize('NFC') === resolve(b).normalize('NFC');
}

// ---------------------------------------------------------------------------
// sameDirectory
// ---------------------------------------------------------------------------

/**
 * True when two `fs.Stats`-like objects (or plain `{dev, ino}` pairs) refer
 * to the same file/directory. Both inode numbers must be truthy — on
 * Windows, `ino` (populated from `BY_HANDLE_FILE_INFORMATION`) can come
 * back as `0` on some filesystems/configurations, and so can `dev`. Treating
 * a falsy value as a real identifier would make two genuinely DIFFERENT
 * directories that both happen to report `ino: 0` on the same `dev` compare
 * as identical — the opposite failure mode from the one dev+ino exists to
 * fix, and a worse one: a user registering their second real wiki would be
 * told it's already registered as the first, with no way to proceed.
 * Falsy/missing `dev` or `ino` is therefore INCONCLUSIVE, not a match.
 *
 * Pure and synchronous on purpose — this is the part of the identity check
 * that can't be exercised against a real zero-inode filesystem in CI, so it
 * is unit-tested directly with injected stat-like objects rather than
 * through a real `stat()` call.
 *
 * @param {{dev?: number, ino?: number}} statA
 * @param {{dev?: number, ino?: number}} statB
 * @returns {boolean}
 */
export function sameFileIdentity(statA, statB) {
  if (!statA || !statB) return false;
  if (!statA.ino || !statB.ino) return false;
  if (statA.dev == null || statB.dev == null) return false;
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

/**
 * True when `a` and `b` refer to the same directory. `pathsEqual` alone is
 * not enough to protect the "one directory, one registry entry" invariant:
 * three ways the same directory still compares unequal as strings —
 *   1. Case. macOS (APFS default) and Windows are case-insensitive:
 *      "/Users/x/Wiki" and "/Users/x/wiki" are the same directory.
 *   2. Symlinks. "/tmp/w" vs "/private/tmp/w" on macOS, or any path reached
 *      through a symlinked parent — same directory, different string.
 *   3. Hardlinked/bind-mounted paths — rarer, same class of problem.
 * `stat().dev` + `.ino` (via `sameFileIdentity`) is definitive on every
 * platform and immune to all three, with no case-sensitivity detection or
 * platform branching needed — EXCEPT that `ino`/`dev` themselves are not
 * always trustworthy (see `sameFileIdentity`), which is why that comparison
 * is a separate, explicitly-inconclusive-aware step rather than a bare
 * `===`.
 *
 * Fast path: `pathsEqual` first — no `stat` calls when the strings already
 * match, so a fleet with many registered wikis doesn't pay a stat per
 * existing entry when the common case (identical string) already resolves
 * it. Slow path, only when the strings differ: stat both sides and defer to
 * `sameFileIdentity`.
 *
 * Fallback to the (already-computed, negative) string comparison — never a
 * bare hardcoded `false` — covers two distinct situations, kept as separate
 * branches for clarity even though both currently resolve to the same
 * value: (a) `ENOENT`, meaning a path genuinely doesn't exist (a registered
 * wiki's directory may have been moved or deleted since it was added;
 * addWiki() itself guarantees the NEW dirPath being registered always
 * exists, since it already required the manifest to be readable there) —
 * here the string comparison's answer is simply correct; (b) any other stat
 * failure (e.g. a permissions error), where identity is genuinely UNKNOWN,
 * not "different" — silently assuming "different" would let the same
 * protected directory register twice under two different names, so this
 * still defers to the string comparison rather than inventing a "not a
 * duplicate" answer from an error it can't interpret.
 *
 * @param {string} a
 * @param {string} b
 * @returns {Promise<boolean>}
 */
export async function sameDirectory(a, b) {
  const stringsEqual = pathsEqual(a, b);
  if (stringsEqual) return true;

  let statA;
  let statB;
  try {
    [statA, statB] = await Promise.all([stat(a), stat(b)]);
  } catch (err) {
    if (err.code === 'ENOENT') return stringsEqual;
    // Non-ENOENT (permissions, ENOTDIR, ...): identity unknown — fall back
    // rather than silently answering "different".
    return stringsEqual;
  }

  return sameFileIdentity(statA, statB);
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

  // A directory that is already registered under a DIFFERENT key must not
  // get a second entry: nothing downstream benefits from it — wikis list
  // would show the same wiki twice, doctor would check and report it
  // twice, and an agent summarizing the fleet in chat would overcount. The
  // key/alias checks above already catch "same name, different directory";
  // this is the mirror case, "same directory, different name". It applies
  // to every caller of addWiki (plain `add` and `add --provision` alike) —
  // this is a registry invariant, not something specific to one CLI path.
  // sameDirectory() (not just pathsEqual()) so case-insensitive filesystems,
  // symlinked parents, and hardlinks are all caught, not just literal
  // string/Unicode-normalization matches.
  for (const [existingKey, entry] of Object.entries(reg.wikis)) {
    if (await sameDirectory(entry.path, dirPath)) {
      const err = new Error(
        `"${dirPath}" is already registered as "${entry.name}" (key "${existingKey}"). ` +
        `A directory can only be registered once — add "${displayName}" as an alias on that ` +
        `entry instead of registering it again, or run "lumina wikis remove ${existingKey}" ` +
        `first if you want to re-register this path under a different name.`,
      );
      err.code = 1;
      throw err;
    }
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
