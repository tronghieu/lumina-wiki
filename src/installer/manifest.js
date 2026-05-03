/**
 * @module installer/manifest
 * @description Reader/writer for the three Lumina installer state files.
 *
 * Three state files (single concern each, atomic write per file):
 *   1. _lumina/manifest.json       — install state
 *   2. _lumina/_state/skills-manifest.csv — skill inventory
 *   3. _lumina/_state/files-manifest.csv  — hash tracking
 *
 * All writes go through atomicWrite from fs.js.
 * Reads are defensive: missing file → null; truncated CSV → empty rows + warning.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, ensureDir } from './fs.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MANIFEST_SCHEMA_VERSION = 3;

export const SKILLS_CSV_HEADER = 'canonical_id,display_name,pack,source,relative_path,target_link_path,version';
export const FILES_CSV_HEADER = 'relative_path,sha256,source_pack,installed_version';

// ---------------------------------------------------------------------------
// JSON manifest
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PackEntry
 * @property {string} version
 * @property {'built-in'|'external'} source
 */

/**
 * @typedef {Object} LuminaManifest
 * @property {number} schemaVersion
 * @property {string} packageVersion
 * @property {string} installedAt
 * @property {string} updatedAt
 * @property {Record<string, PackEntry>} packs
 * @property {string[]} ideTargets
 * @property {Record<string, import('./fs.js').LinkStrategy>} symlinkStrategies
 * @property {Record<string, string>} resolvedPaths
 */

/**
 * Read _lumina/manifest.json from a project root.
 * Returns null when the file does not exist (fresh install).
 * Throws if the file exists but is not valid JSON (hard failure triggering --re-link).
 *
 * @param {string} projectRoot
 * @returns {Promise<LuminaManifest|null>}
 */
export async function readManifest(projectRoot) {
  const manifestPath = join(projectRoot, '_lumina', 'manifest.json');
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}

/**
 * Write _lumina/manifest.json atomically.
 *
 * @param {string}         projectRoot
 * @param {LuminaManifest} manifest
 * @returns {Promise<void>}
 */
export async function writeManifest(projectRoot, manifest) {
  const manifestPath = join(projectRoot, '_lumina', 'manifest.json');
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Skills CSV
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SkillRow
 * @property {string} canonical_id
 * @property {string} display_name
 * @property {string} pack
 * @property {string} source
 * @property {string} relative_path
 * @property {string} target_link_path
 * @property {string} version
 */

/**
 * Parse CSV text into an array of row objects.
 * The first line must be the header; columns are mapped by position.
 * On parse error or empty content, returns [] and calls warn(message).
 *
 * @param {string}   csvText
 * @param {string[]} expectedColumns
 * @param {Function} warn
 * @returns {Record<string,string>[]}
 */
function parseCsv(csvText, expectedColumns, warn) {
  if (!csvText || !csvText.trim()) return [];
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const header = lines[0].split(',');
  // Validate header columns
  const mismatched = expectedColumns.filter((col, i) => header[i] !== col);
  if (mismatched.length > 0) {
    warn(`CSV header mismatch: expected "${expectedColumns.join(',')}" got "${header.join(',')}"`);
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = splitCsvLine(line);
    if (values.length !== expectedColumns.length) {
      warn(`CSV row ${i} has ${values.length} columns, expected ${expectedColumns.length}: "${line}"`);
      continue;
    }
    const row = {};
    for (let j = 0; j < expectedColumns.length; j++) {
      row[expectedColumns[j]] = values[j];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Split a CSV line respecting double-quoted fields.
 * Handles commas inside quoted fields.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Escape a single CSV field value (wrap in quotes if contains comma/quote/newline).
 *
 * @param {string} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Serialize an array of row objects to CSV text (with header).
 *
 * @param {Record<string,string>[]} rows
 * @param {string[]}                columns
 * @returns {string}
 */
function serializeCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(col => escapeCsvField(row[col] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Read skills-manifest.csv.
 * Returns [] on ENOENT or parse errors (with warning emitted).
 *
 * @param {string}   projectRoot
 * @param {Function} [warn]      - Optional warning callback (message: string) => void
 * @returns {Promise<SkillRow[]>}
 */
export async function readSkillsManifest(projectRoot, warn = () => {}) {
  const csvPath = join(projectRoot, '_lumina', '_state', 'skills-manifest.csv');
  let raw;
  try {
    raw = await readFile(csvPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const cols = SKILLS_CSV_HEADER.split(',');
  return parseCsv(raw, cols, warn);
}

/**
 * Write skills-manifest.csv atomically.
 *
 * @param {string}     projectRoot
 * @param {SkillRow[]} rows
 * @returns {Promise<void>}
 */
export async function writeSkillsManifest(projectRoot, rows) {
  const csvPath = join(projectRoot, '_lumina', '_state', 'skills-manifest.csv');
  const cols = SKILLS_CSV_HEADER.split(',');
  await atomicWrite(csvPath, serializeCsv(rows, cols));
}

// ---------------------------------------------------------------------------
// Files CSV
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FileRow
 * @property {string} relative_path
 * @property {string} sha256
 * @property {string} source_pack
 * @property {string} installed_version
 */

/**
 * Read files-manifest.csv.
 * Returns [] on ENOENT or parse errors.
 *
 * @param {string}   projectRoot
 * @param {Function} [warn]
 * @returns {Promise<FileRow[]>}
 */
export async function readFilesManifest(projectRoot, warn = () => {}) {
  const csvPath = join(projectRoot, '_lumina', '_state', 'files-manifest.csv');
  let raw;
  try {
    raw = await readFile(csvPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const cols = FILES_CSV_HEADER.split(',');
  return parseCsv(raw, cols, warn);
}

/**
 * Write files-manifest.csv atomically.
 *
 * @param {string}    projectRoot
 * @param {FileRow[]} rows
 * @returns {Promise<void>}
 */
export async function writeFilesManifest(projectRoot, rows) {
  const csvPath = join(projectRoot, '_lumina', '_state', 'files-manifest.csv');
  const cols = FILES_CSV_HEADER.split(',');
  await atomicWrite(csvPath, serializeCsv(rows, cols));
}

// ---------------------------------------------------------------------------
// Manifest migration
// ---------------------------------------------------------------------------

/**
 * Migration registry shape (for future entries):
 *
 * const MIGRATIONS = {
 *   '1->2': (m) => ({ ...m, newField: 'default' }),
 *   '2->3': (m) => { ... return updatedManifest; },
 * };
 *
 * To add a migration from version N to N+1:
 *   1. Bump MANIFEST_SCHEMA_VERSION to N+1.
 *   2. Add `'N->N+1': (m) => { ...transform... }` to MIGRATIONS.
 *   3. The loop below will apply it automatically.
 */
const MIGRATIONS = {
  '1->2': (m) => ({ ...m, legacyMigrationNeeded: true }),
  // 2->3 (v0.8): workspace schema additions — raw_paths field, raw/download/ dir,
  // lint L12, source frontmatter url (string) -> urls (array). All additive /
  // backward-compatible at the manifest level. Wiki content migration is handled
  // by /lumi-migrate-legacy, not by the installer. No manifest shape change.
  '2->3': (m) => ({ ...m }),
};

/**
 * Migrate a manifest object to the target schema version.
 *
 * - If `manifest.schemaVersion === targetVersion` — no-op, returns manifest unchanged.
 * - If `manifest.schemaVersion` is missing (legacy install) — sets it to 1 and returns.
 * - If `manifest.schemaVersion > targetVersion` — throws (downgrade not supported, code 3).
 * - If `manifest.schemaVersion < targetVersion` — applies registered migrations in order.
 *
 * @param {object} manifest      - Parsed manifest object (may lack schemaVersion).
 * @param {number} targetVersion - The schema version to migrate to.
 * @returns {object}             - The migrated manifest (new object if changed).
 */
export function migrateManifest(manifest, targetVersion) {
  // Legacy install: schemaVersion was not recorded before this constant existed.
  if (manifest.schemaVersion === undefined || manifest.schemaVersion === null) {
    return { ...manifest, schemaVersion: 1 };
  }

  const current = manifest.schemaVersion;

  if (current === targetVersion) {
    return manifest;
  }

  if (current > targetVersion) {
    const err = new Error(
      `Manifest schemaVersion ${current} is newer than installer target ${targetVersion}. ` +
      'Downgrade is not supported. Update lumina-wiki to the latest version.',
    );
    err.code = 3;
    throw err;
  }

  // Apply migrations step-by-step (current → current+1 → … → targetVersion).
  let m = manifest;
  for (let v = current; v < targetVersion; v++) {
    const key = `${v}->${v + 1}`;
    const migrate = MIGRATIONS[key];
    if (!migrate) {
      const err = new Error(
        `No migration found for schemaVersion ${key}. ` +
        'This is an internal error — please file an issue.',
      );
      err.code = 3;
      throw err;
    }
    m = { ...migrate(m), schemaVersion: v + 1 };
  }
  return m;
}

// ---------------------------------------------------------------------------
// State file paths helper
// ---------------------------------------------------------------------------

/**
 * Return the canonical paths for all three state files.
 *
 * @param {string} projectRoot
 * @returns {{ manifestJson: string, skillsCsv: string, filesCsv: string }}
 */
export function statePaths(projectRoot) {
  return {
    manifestJson: join(projectRoot, '_lumina', 'manifest.json'),
    skillsCsv:    join(projectRoot, '_lumina', '_state', 'skills-manifest.csv'),
    filesCsv:     join(projectRoot, '_lumina', '_state', 'files-manifest.csv'),
  };
}
