import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const VALID_SCHEDULES = new Set(['manual', 'daily', 'weekly', 'monthly']);
const VALID_SOURCES = new Set(['arxiv', 's2', 'openalex']);
const VALID_ITEM_TYPES = new Set(['topic', 'feed']);
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const HTTPS_URL_RE = /^https:\/\//i;

export class WatchlistConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WatchlistConfigError';
    this.code = 2;
  }
}

export async function loadWatchlistConfig(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new WatchlistConfigError(
        `Watchlist not found at ${filePath}. Create one with /lumi-research-watchlist or see docs/user-guide/advanced-scheduled-discovery.en.md.`,
      );
    }
    throw err;
  }

  let parsed;
  try {
    parsed = await parseYaml(raw);
  } catch (err) {
    throw new WatchlistConfigError(`Invalid watchlist YAML: ${err.message}`);
  }

  return normalizeWatchlistConfig(parsed);
}

async function parseYaml(raw) {
  try {
    const yaml = (await import('js-yaml')).default;
    return yaml.load(raw) ?? {};
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND' && err.code !== 'MODULE_NOT_FOUND') throw err;
    return parseSimpleWatchlistYaml(raw);
  }
}

export function parseSimpleWatchlistYaml(raw) {
  const config = {};
  let section = null;
  let currentItem = null;

  for (const originalLine of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const line = stripComment(originalLine);
    if (!line.trim()) continue;

    if (!line.startsWith(' ')) {
      const [key, value] = splitKeyValue(line);
      section = key;
      currentItem = null;
      if (value !== '') {
        config[key] = parseScalar(value);
        section = null;
      } else if (key === 'defaults') {
        config.defaults = {};
      } else if (key === 'items' || key === 'watchlist' || key === 'topics') {
        config[key] = [];
      } else {
        config[key] = {};
      }
      continue;
    }

    if (section === 'defaults') {
      const [key, value] = splitKeyValue(line.trim());
      config.defaults[key] = parseScalar(value);
      continue;
    }

    if (section === 'items' || section === 'watchlist' || section === 'topics') {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        currentItem = {};
        config[section].push(currentItem);
        const rest = trimmed.slice(2).trim();
        if (rest) {
          const [key, value] = splitKeyValue(rest);
          currentItem[key] = parseScalar(value);
        }
        continue;
      }
      if (!currentItem) throw new Error(`Unexpected line outside an item: ${originalLine.trim()}`);
      const [key, value] = splitKeyValue(trimmed);
      currentItem[key] = parseScalar(value);
      continue;
    }

    throw new Error(`Unsupported watchlist YAML line: ${originalLine.trim()}`);
  }

  return config;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === '#' && !quote) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function splitKeyValue(line) {
  const index = line.indexOf(':');
  if (index === -1) throw new Error(`Expected key: value line, got: ${line}`);
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseScalar(value) {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(part => parseScalar(part.trim()));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeWatchlistConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new WatchlistConfigError('Watchlist must be a YAML object.');
  }
  if (config.version !== 1) {
    throw new WatchlistConfigError('Watchlist version must be 1.');
  }

  const defaults = normalizeDefaults(config.defaults ?? {});
  const rawItems = config.items ?? config.watchlist ?? config.topics ?? [];
  if (!Array.isArray(rawItems)) {
    throw new WatchlistConfigError('Watchlist items must be a list.');
  }

  const ids = new Set();
  const items = rawItems.map((item, index) => {
    const normalized = normalizeItem(item, index, defaults);
    if (ids.has(normalized.id)) {
      throw new WatchlistConfigError(`Duplicate watchlist id: ${normalized.id}`);
    }
    ids.add(normalized.id);
    return normalized;
  });

  return { version: 1, defaults, items };
}

function normalizeDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw new WatchlistConfigError('Watchlist defaults must be an object.');
  }
  return {
    sources: normalizeSources(defaults.sources ?? ['arxiv'], 'defaults.sources'),
    schedule: normalizeSchedule(defaults.schedule ?? defaults.cadence ?? 'manual', 'defaults.schedule'),
    limit: normalizeLimit(defaults.limit ?? DEFAULT_LIMIT, 'defaults.limit'),
    maxNew: normalizeOptionalLimit(defaults.max_new ?? defaults.maxNew, 'defaults.max_new'),
  };
}

function normalizeItem(item, index, defaults) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new WatchlistConfigError(`Watchlist item ${index + 1} must be an object.`);
  }

  const id = normalizeId(item.id, index);
  const itemType = normalizeItemType(item.type, id);
  const schedule = normalizeSchedule(item.schedule ?? item.cadence ?? defaults.schedule, `${id}.schedule`);
  const limit = normalizeLimit(item.limit ?? item.max_results ?? defaults.limit, `${id}.limit`);
  const maxNew = normalizeOptionalLimit(item.max_new ?? item.maxNew ?? defaults.maxNew, `${id}.max_new`);

  if (itemType === 'feed') {
    // Feeds don't carry a search query or per-source list — they have a URL
    // that fetch_rss.py hits directly. We deliberately do NOT inherit
    // `defaults.sources` so existing watchlist v1 files keep validating after
    // a defaults.sources expansion that doesn't include the rss provider.
    const url = normalizeFeedUrl(item.url, id);
    const extractDois = item.extract_dois === false ? false : true;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
    return {
      id,
      type: 'feed',
      enabled: item.enabled === true,
      url,
      name,
      extractDois,
      sources: [],          // intentional empty — fetch_rss owns provenance
      schedule,
      limit,
      maxNew,
    };
  }

  // type: 'topic' (default)
  const query = normalizeQuery(item.query ?? item.topic, id);
  const sources = normalizeSources(item.sources ?? defaults.sources, `${id}.sources`);
  return {
    id,
    type: 'topic',
    enabled: item.enabled === true,
    query,
    sources,
    schedule,
    limit,
    maxNew,
  };
}

function normalizeItemType(value, id) {
  if (value === undefined || value === null || value === '') return 'topic';
  if (typeof value !== 'string') {
    throw new WatchlistConfigError(`${id}.type must be a string (topic or feed).`);
  }
  const t = value.trim().toLowerCase();
  if (!VALID_ITEM_TYPES.has(t)) {
    throw new WatchlistConfigError(`${id}.type must be 'topic' or 'feed', got ${JSON.stringify(value)}.`);
  }
  return t;
}

function normalizeFeedUrl(value, id) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WatchlistConfigError(`${id}.url is required for type: feed.`);
  }
  const url = value.trim();
  if (url.startsWith('--')) {
    throw new WatchlistConfigError(`${id}.url must not start with '--' (flag-injection guard).`);
  }
  if (!HTTPS_URL_RE.test(url)) {
    throw new WatchlistConfigError(`${id}.url must use https:// (got ${url.slice(0, 80)}).`);
  }
  return url;
}

function normalizeId(value, index) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WatchlistConfigError(`Watchlist item ${index + 1} needs an id.`);
  }
  const id = value.trim();
  if (
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\') ||
    isAbsolute(id) ||
    /^[A-Za-z]:[\\/]/.test(id) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
  ) {
    throw new WatchlistConfigError(
      `Invalid watchlist id "${id}". Use lowercase letters, numbers, and hyphens only.`,
    );
  }
  return id;
}

function normalizeQuery(value, id) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && Array.isArray(value.terms)) {
    const terms = value.terms
      .filter(term => typeof term === 'string' && term.trim())
      .map(term => term.trim());
    if (terms.length > 0) return terms.join(' OR ');
  }
  throw new WatchlistConfigError(`Watchlist item "${id}" needs a query.`);
}

function normalizeSources(value, label) {
  const sources = Array.isArray(value) ? value : [value];
  const normalized = sources
    .filter(source => typeof source === 'string' && source.trim())
    .map(source => source.trim().toLowerCase());
  if (normalized.length === 0) {
    throw new WatchlistConfigError(`${label} must include at least one source.`);
  }
  for (const source of normalized) {
    if (!VALID_SOURCES.has(source)) {
      throw new WatchlistConfigError(`Unknown source "${source}" in ${label}. Supported sources: arxiv, s2, openalex.`);
    }
  }
  return [...new Set(normalized)];
}

function normalizeSchedule(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WatchlistConfigError(`${label} must be manual, daily, weekly, or monthly.`);
  }
  const schedule = value.trim().toLowerCase();
  if (!VALID_SCHEDULES.has(schedule)) {
    throw new WatchlistConfigError(`${label} must be manual, daily, weekly, or monthly.`);
  }
  return schedule;
}

function normalizeLimit(value, label) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new WatchlistConfigError(`${label} must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
}

function normalizeOptionalLimit(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeLimit(value, label);
}
