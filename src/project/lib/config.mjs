/**
 * @file config.mjs
 * @description Project config: root discovery (AD-25), `project.yaml` load +
 * validation (AD-8), and `ontologyVersion` (AD-21). The engine's only YAML
 * parser call site; every subcommand validates through `loadConfig` and
 * exits 2 (invalid) or 3 (newer schemaVersion) on failure.
 */

import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { load as loadYaml, CORE_SCHEMA } from '../vendor/js-yaml.mjs';
import { assertSafeRelPath } from './fsx.mjs';
import { sha256Hex, canonicalJson } from './hash.mjs';
import { slug } from './markdown.mjs';
import { META_TYPES, META_RELATIONS } from '../ontology.mjs';

const CONFIG_REL_PATH = '_lumina/config/project.yaml';
export const CURRENT_SCHEMA_VERSION = 1;

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'sources', 'types', 'relations', 'relatedRules', 'externalIds', 'concepts',
]);
const SOURCES_KEYS = new Set(['include', 'exclude']);
const TYPE_KEYS = new Set(['metaType', 'paths', 'frontmatter', 'idPattern', 'status']);
const STATUS_KEYS = new Set(['heading', 'frontmatter']);
const RELATED_RULE_KEYS = new Set(['source', 'target', 'relation', 'inverse']);
const EXTERNAL_ID_KEYS = new Set(['pattern']);
const CONCEPT_KEYS = new Set(['name', 'aliases']);

/** Thrown by `loadConfig` when `project.yaml` fails validation. `code: 2`. */
export class ConfigError extends Error {
  constructor(errors) {
    super(`invalid project config: ${errors.join('; ')}`);
    this.name = 'ConfigError';
    this.code = 2;
    this.errors = errors;
  }
}

/** Thrown by `loadConfig` when `schemaVersion` is newer than this engine knows. `code: 3`. */
export class SchemaVersionError extends Error {
  constructor(version) {
    super(`project.yaml schemaVersion ${version} is newer than supported (${CURRENT_SCHEMA_VERSION})`);
    this.name = 'SchemaVersionError';
    this.code = 3;
    this.schemaVersion = version;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `cwd` to the nearest ancestor holding `_lumina/config/project.yaml`.
 * @param {string} cwd
 * @returns {Promise<string|null>} absolute repo root, or null when none is found.
 */
export async function findRoot(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if (await exists(join(dir, CONFIG_REL_PATH))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkSafePattern(errors, label, pattern) {
  if (typeof pattern !== 'string') {
    errors.push(`${label}: must be a string`);
    return;
  }
  if (pattern.startsWith('!') || /[{}?]/.test(pattern)) {
    errors.push(`${label}: "!" negation and {a,b} are not supported; list separate patterns`);
    return;
  }
  try {
    assertSafeRelPath(pattern);
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
  }
}

function checkRegex(errors, label, pattern) {
  if (typeof pattern !== 'string') {
    errors.push(`${label}: must be a string`);
    return;
  }
  try {
    new RegExp(pattern, 'u');
  } catch (e) {
    errors.push(`${label}: bad regex: ${e.message}`);
  }
}

function validateSources(errors, sources) {
  if (sources === undefined) return { include: ['docs'], exclude: [] };
  if (!isPlainObject(sources)) {
    errors.push('sources: must be a mapping');
    return { include: ['docs'], exclude: [] };
  }
  for (const key of Object.keys(sources)) {
    if (!SOURCES_KEYS.has(key)) errors.push(`sources: unknown key "${key}"`);
  }
  const include = sources.include ?? ['docs'];
  const exclude = sources.exclude ?? [];
  if (!Array.isArray(include)) errors.push('sources.include: must be an array');
  else if (include.length === 0) errors.push('sources.include: must not be empty');
  if (!Array.isArray(exclude)) errors.push('sources.exclude: must be an array');
  for (const [i, p] of (Array.isArray(include) ? include : []).entries()) {
    checkSafePattern(errors, `sources.include[${i}]`, p);
  }
  for (const [i, p] of (Array.isArray(exclude) ? exclude : []).entries()) {
    checkSafePattern(errors, `sources.exclude[${i}]`, p);
  }
  return {
    include: Array.isArray(include) ? include : ['docs'],
    exclude: Array.isArray(exclude) ? exclude : [],
  };
}

function validateStatus(errors, label, status) {
  if (status === undefined) return;
  if (!isPlainObject(status)) {
    errors.push(`${label}.status: must be a mapping`);
    return;
  }
  const keys = Object.keys(status).filter((k) => STATUS_KEYS.has(k));
  for (const key of Object.keys(status)) {
    if (!STATUS_KEYS.has(key)) errors.push(`${label}.status: unknown key "${key}"`);
  }
  if (keys.length !== 1) {
    errors.push(`${label}.status: must have exactly one of "heading" or "frontmatter"`);
    return;
  }
  const [key] = keys;
  if (typeof status[key] !== 'string' || status[key].length === 0) {
    errors.push(`${label}.status.${key}: must be a non-empty string`);
  }
}

function validateTypes(errors, types) {
  if (types === undefined) return {};
  if (!isPlainObject(types)) {
    errors.push('types: must be a mapping');
    return {};
  }
  for (const [name, entry] of Object.entries(types)) {
    const label = `types.${name}`;
    if (!isPlainObject(entry)) {
      errors.push(`${label}: must be a mapping`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!TYPE_KEYS.has(key)) errors.push(`${label}: unknown key "${key}"`);
    }
    if (typeof entry.metaType !== 'string' || !Object.hasOwn(META_TYPES, entry.metaType)) {
      errors.push(`${label}.metaType: unknown meta-type "${entry.metaType}"`);
    }
    const hasPaths = entry.paths !== undefined;
    const hasFrontmatter = entry.frontmatter !== undefined;
    const pathsNonEmpty = Array.isArray(entry.paths) && entry.paths.length > 0;
    if (!pathsNonEmpty && !hasFrontmatter) {
      errors.push(`${label}: requires at least one of "paths" or "frontmatter"`);
    }
    if (hasPaths) {
      if (!Array.isArray(entry.paths)) {
        errors.push(`${label}.paths: must be an array`);
      } else {
        for (const [i, p] of entry.paths.entries()) checkSafePattern(errors, `${label}.paths[${i}]`, p);
      }
    }
    if (hasFrontmatter && !isPlainObject(entry.frontmatter)) {
      errors.push(`${label}.frontmatter: must be a mapping`);
    }
    if (entry.idPattern !== undefined) checkRegex(errors, `${label}.idPattern`, entry.idPattern);
    validateStatus(errors, label, entry.status);
  }
  return types;
}

function validateRelations(errors, relations) {
  if (relations === undefined) return {};
  if (!isPlainObject(relations)) {
    errors.push('relations: must be a mapping');
    return {};
  }
  for (const [name, target] of Object.entries(relations)) {
    if (!META_RELATIONS.includes(target)) {
      errors.push(`relations.${name}: unknown meta-relation "${target}"`);
    }
  }
  return relations;
}

function validateRelatedRules(errors, relatedRules) {
  if (relatedRules === undefined) return [];
  if (!Array.isArray(relatedRules)) {
    errors.push('relatedRules: must be an array');
    return [];
  }
  for (const [i, rule] of relatedRules.entries()) {
    const label = `relatedRules[${i}]`;
    if (!isPlainObject(rule)) {
      errors.push(`${label}: must be a mapping`);
      continue;
    }
    for (const key of Object.keys(rule)) {
      if (!RELATED_RULE_KEYS.has(key)) errors.push(`${label}: unknown key "${key}"`);
    }
    if (typeof rule.source !== 'string' || !Object.hasOwn(META_TYPES, rule.source)) {
      errors.push(`${label}.source: unknown meta-type "${rule.source}"`);
    }
    if (typeof rule.target !== 'string' || !Object.hasOwn(META_TYPES, rule.target)) {
      errors.push(`${label}.target: unknown meta-type "${rule.target}"`);
    }
    if (typeof rule.relation !== 'string' || !META_RELATIONS.includes(rule.relation)) {
      errors.push(`${label}.relation: unknown meta-relation "${rule.relation}"`);
    }
    if (rule.inverse !== undefined && typeof rule.inverse !== 'boolean') {
      errors.push(`${label}.inverse: must be a boolean`);
    }
  }
  return relatedRules;
}

function validateExternalIds(errors, externalIds) {
  if (externalIds === undefined) return [];
  if (!Array.isArray(externalIds)) {
    errors.push('externalIds: must be an array');
    return [];
  }
  for (const [i, entry] of externalIds.entries()) {
    const label = `externalIds[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label}: must be a mapping`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!EXTERNAL_ID_KEYS.has(key)) errors.push(`${label}: unknown key "${key}"`);
    }
    checkRegex(errors, `${label}.pattern`, entry.pattern);
  }
  return externalIds;
}

function validateConcepts(errors, concepts) {
  if (concepts === undefined) return [];
  if (!Array.isArray(concepts)) {
    errors.push('concepts: must be an array');
    return [];
  }
  const slugOwner = new Map(); // slug -> owning concept index (not name: two
                                // concepts may share a name and must still collide)
  for (const [i, entry] of concepts.entries()) {
    const label = `concepts[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label}: must be a mapping`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!CONCEPT_KEYS.has(key)) errors.push(`${label}: unknown key "${key}"`);
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      errors.push(`${label}.name: must be a non-empty string`);
      continue;
    }
    const aliases = entry.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== 'string' || a.length === 0)) {
      errors.push(`${label}.aliases: must be an array of non-empty strings`);
      continue;
    }
    const nameSlug = slug(entry.name);
    const aliasSlugs = aliases.map((a) => slug(a));
    if ([nameSlug, ...aliasSlugs].some((s) => s === '')) {
      errors.push(`${label}: name or alias must not slug to an empty string`);
      continue;
    }
    const ownSlugs = new Set([nameSlug, ...aliasSlugs]);
    for (const s of ownSlugs) {
      const ownerIndex = slugOwner.get(s);
      if (ownerIndex !== undefined && ownerIndex !== i) {
        errors.push(`concepts: slug "${s}" shared by "${concepts[ownerIndex].name}" and "${entry.name}"`);
      } else if (ownerIndex === undefined) {
        slugOwner.set(s, i);
      }
    }
  }
  return concepts;
}

/**
 * Load and validate `_lumina/config/project.yaml` under `root`. Collects
 * every validation problem before throwing, per the I/O matrix.
 * @param {string} root absolute repo root, as returned by `findRoot`.
 * @returns {Promise<object>} the validated, defaulted config.
 * @throws {ConfigError} invalid YAML or config shape (code 2).
 * @throws {SchemaVersionError} `schemaVersion` newer than supported (code 3).
 */
export async function loadConfig(root) {
  const text = await readFile(join(root, CONFIG_REL_PATH), 'utf8');

  let raw;
  try {
    raw = loadYaml(text, { schema: CORE_SCHEMA });
  } catch (e) {
    throw new ConfigError([`YAML syntax error: ${e.message}`]);
  }

  if (!isPlainObject(raw)) {
    throw new ConfigError(['project.yaml: must be a mapping at the top level']);
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(schemaVersion);
  }

  const errors = [];

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown top-level key "${key}"`);
  }
  if (!(typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion >= 1)) {
    errors.push(`schemaVersion: must be an integer >= 1, got ${JSON.stringify(schemaVersion)}`);
  }

  const sources = validateSources(errors, raw.sources);
  const types = validateTypes(errors, raw.types);
  const relations = validateRelations(errors, raw.relations);
  const relatedRules = validateRelatedRules(errors, raw.relatedRules);
  const externalIds = validateExternalIds(errors, raw.externalIds);
  const concepts = validateConcepts(errors, raw.concepts);

  if (errors.length > 0) throw new ConfigError(errors);

  return { schemaVersion, sources, types, relations, relatedRules, externalIds, concepts };
}

/**
 * `ontologyVersion` (AD-21): a hash of the ontology-relevant `project.yaml`
 * sections, per the Design Notes formula.
 * @param {{types?: object, relations?: object, relatedRules?: unknown[], concepts?: unknown[]}} config
 * @returns {string} 64-char lowercase hex sha256 digest.
 */
export function ontologyVersion(config) {
  const { types = {}, relations = {}, relatedRules = [], concepts = [] } = config;
  return sha256Hex(canonicalJson({ types, relations, relatedRules, concepts }));
}
