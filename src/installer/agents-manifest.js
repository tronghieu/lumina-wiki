/**
 * @module installer/agents-manifest
 * @description Sole reader/writer of the global per-platform agent-host
 * skills manifest.
 *
 * File: <LUMINA_HOME or ~/.lumina>/agents/<platform>-manifest.json
 * Schema: { version: 1, platform, skills: [canonicalId], installedAt }
 *
 * Tracks which lumi-* canonicalIds this machine's AI-agent global install
 * (OpenClaw, Hermes, ...) owns, so uninstall/deselect never deletes a
 * foreign skill living in the same global skills directory (AD-8).
 *
 * All writes go through atomicWrite from fs.js.
 * Reads are defensive: missing manifest -> null; a schema version newer
 * than supported throws err.code = 3.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { atomicWrite, ensureDir } from './fs.js';

export const AGENTS_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Root directory for all hub state. Overridable via LUMINA_HOME so tests
 * never touch the real home directory. Mirrors registry.js's luminaHome().
 *
 * @returns {string}
 */
function luminaHome() {
  return process.env.LUMINA_HOME || join(homedir(), '.lumina');
}

/**
 * Absolute path to a platform's global agents manifest file.
 *
 * @param {string} platform - e.g. 'openclaw' | 'hermes'.
 * @returns {string}
 */
export function agentsManifestPath(platform) {
  return join(luminaHome(), 'agents', `${platform}-manifest.json`);
}

/**
 * @typedef {Object} AgentsManifest
 * @property {number} version
 * @property {string} platform
 * @property {string[]} skills - canonicalIds owned by this platform's global install.
 * @property {string} installedAt
 */

/**
 * Read a platform's global agents manifest.
 * Returns null when the file does not exist (nothing installed yet).
 * Throws err.code = 3 on corrupt JSON or a schema version newer than
 * supported.
 *
 * @param {string} platform
 * @returns {Promise<AgentsManifest|null>}
 */
export async function readAgentsManifest(platform) {
  const path = agentsManifestPath(platform);
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Corrupt agents manifest at "${path}": ${err.message}`);
    e.code = 3;
    throw e;
  }

  if (typeof parsed.version === 'number' && parsed.version > AGENTS_MANIFEST_SCHEMA_VERSION) {
    const e = new Error(
      `Agents manifest at "${path}" has schema version ${parsed.version}, newer than ` +
      `supported (${AGENTS_MANIFEST_SCHEMA_VERSION}). Update lumina-wiki.`,
    );
    e.code = 3;
    throw e;
  }

  return parsed;
}

/**
 * Write a platform's global agents manifest atomically.
 *
 * @param {string} platform
 * @param {string[]} skills - canonicalIds owned by this platform's global install.
 * @returns {Promise<void>}
 */
export async function writeAgentsManifest(platform, skills) {
  const path = agentsManifestPath(platform);
  const manifest = {
    version: AGENTS_MANIFEST_SCHEMA_VERSION,
    platform,
    skills: [...skills],
    installedAt: new Date().toISOString(),
  };
  await ensureDir(dirname(path));
  await atomicWrite(path, JSON.stringify(manifest, null, 2) + '\n');
}
