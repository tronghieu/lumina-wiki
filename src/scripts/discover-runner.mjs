#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadWatchlistConfig, WatchlistConfigError } from './lib/watchlist-config.mjs';
import {
  getItemState,
  hasSeen,
  markSeen,
  readDiscoveryState,
  writeDiscoveryState,
} from './lib/discovery-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VALID_SCHEDULES = new Set(['manual', 'daily', 'weekly', 'monthly']);
const VALID_SOURCES = new Set(['arxiv', 's2']);

export async function runDiscover(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const date = nowIso.slice(0, 10);
  const json = Boolean(options.json);
  const dryRun = Boolean(options.dryRun);
  const configPath = resolve(projectRoot, options.config ?? '_lumina/config/watchlist.yml');
  const statePath = resolve(projectRoot, options.state ?? '_lumina/_state/discovery-runner.json');
  const sourceFilter = normalizeSourceFilter(options.source);
  const scheduleFilter = normalizeScheduleFilter(options.schedule);
  const globalLimit = normalizeOptionalPositiveInt(options.limit, '--limit');

  const config = await loadWatchlistConfig(configPath);
  const state = await readDiscoveryState(statePath);
  const existingKeys = await collectExistingDedupKeys(join(projectRoot, 'raw', 'discovered'));
  const summary = {
    runAt: nowIso,
    dryRun,
    checked: config.items.length,
    queriesRun: 0,
    fetched: 0,
    new: 0,
    duplicates: 0,
    skipped: [],
    errors: [],
    written: [],
    candidates: [],
  };

  for (const item of config.items) {
    if (!item.enabled) {
      summary.skipped.push({ id: item.id, reason: 'disabled' });
      continue;
    }
    if (scheduleFilter && item.schedule !== scheduleFilter) {
      summary.skipped.push({ id: item.id, reason: `schedule:${item.schedule}` });
      continue;
    }

    const sources = sourceFilter ? item.sources.filter(source => source === sourceFilter) : item.sources;
    if (sources.length === 0) {
      summary.skipped.push({ id: item.id, reason: 'no matching source' });
      continue;
    }

    summary.queriesRun += 1;
    const itemState = getItemState(state, item.id);
    const itemLimit = globalLimit ?? item.limit;
    const maxNew = item.maxNew ?? itemLimit;

    for (const source of sources) {
      let fetched;
      try {
        fetched = fetchSource({ projectRoot, source, query: item.query, limit: itemLimit });
      } catch (err) {
        if (source === 's2' && /SEMANTIC_SCHOLAR_API_KEY|API key/i.test(err.message)) {
          summary.skipped.push({ id: item.id, source, reason: 'missing optional key' });
          continue;
        }
        summary.errors.push({ id: item.id, source, message: err.message });
        continue;
      }

      summary.fetched += fetched.length;
      const ranked = rankCandidates({ projectRoot, query: item.query, candidates: fetched });
      let writtenForItem = 0;

      for (const candidate of ranked) {
        const record = normalizeCandidate({
          item,
          source,
          candidate,
          nowIso,
        });

        if (hasSeen(itemState, record.dedupKey) || existingKeys.has(record.dedupKey)) {
          summary.duplicates += 1;
          markSeen(itemState, record.dedupKey, nowIso);
          continue;
        }
        if (writtenForItem >= maxNew) {
          summary.skipped.push({ id: item.id, source, reason: 'max_new reached' });
          break;
        }

        const relPath = join('raw', 'discovered', date, item.id, `${safeFilePart(record.source)}-${safeFilePart(record.sourceId)}.json`);
        const absPath = join(projectRoot, relPath);
        record.outputPath = relPath;
        summary.candidates.push(record);
        summary.new += 1;
        summary.written.push(relPath);
        writtenForItem += 1;
        markSeen(itemState, record.dedupKey, nowIso);
        existingKeys.add(record.dedupKey);

        if (!dryRun) {
          await writeCandidate(absPath, record);
        }
      }
    }

    itemState.lastRunAt = nowIso;
  }

  if (!dryRun && summary.queriesRun > 0) {
    await writeDiscoveryState(statePath, state);
  }

  summary.skippedCount = summary.skipped.length;
  summary.errorsCount = summary.errors.length;
  if (!json) printSummary(summary);
  return summary;
}

function fetchSource({ projectRoot, source, query, limit }) {
  if (!VALID_SOURCES.has(source)) throw new Error(`Unknown source: ${source}`);
  const toolsDir = join(projectRoot, '_lumina', 'tools');
  const script = source === 'arxiv' ? 'fetch_arxiv.py' : 'fetch_s2.py';
  const args = source === 'arxiv'
    ? [join(toolsDir, script), 'search', query, '--max', String(limit)]
    : [join(toolsDir, script), 'search', query, '--limit', String(limit)];
  const result = spawnSync('python3', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} failed`).trim());
  }
  const parsed = JSON.parse(result.stdout || '[]');
  if (source === 's2' && parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
    return parsed.data;
  }
  if (!Array.isArray(parsed)) throw new Error(`${script} returned an unexpected shape.`);
  return parsed;
}

function rankCandidates({ projectRoot, query, candidates }) {
  if (candidates.length === 0) return [];
  const toolPath = join(projectRoot, '_lumina', 'tools', 'discover.py');
  const result = spawnSync('python3', [toolPath, '--topic', query, '--top', String(candidates.length)], {
    cwd: projectRoot,
    input: JSON.stringify(candidates),
    encoding: 'utf8',
    timeout: 60000,
    env: process.env,
  });
  if (result.status !== 0) {
    return candidates.map(candidate => ({ ...candidate, _score: 0 }));
  }
  const parsed = JSON.parse(result.stdout || '[]');
  return Array.isArray(parsed) ? parsed : candidates;
}

function normalizeCandidate({ item, source, candidate, nowIso }) {
  const sourceId = extractSourceId(source, candidate);
  const scoreTotal = scoreToInt(candidate._score);
  const title = String(candidate.title ?? '').trim();
  const url = candidate.url ?? (candidate.externalIds?.ArXiv ? `https://arxiv.org/abs/${candidate.externalIds.ArXiv}` : '');
  const year = candidate.year ?? extractYear(candidate.published ?? candidate.publicationDate);
  const dedupKey = buildDedupKey({ source, sourceId, candidate, title, url, year });

  return {
    schema: 'lumina.discovered.v1',
    watchlistId: item.id,
    source,
    sourceId,
    externalId: sourceId,
    dedupKey,
    title,
    url,
    authors: normalizeAuthors(candidate.authors),
    publishedAt: candidate.published ?? candidate.publicationDate ?? (year ? String(year) : ''),
    summary: candidate.summary ?? candidate.abstract ?? '',
    query: item.query,
    discoveredAt: nowIso,
    status: 'new',
    score: {
      total: scoreTotal,
      ranking: Number(candidate._score ?? 0),
      topicMatch: null,
      recency: null,
      citationSignal: Number(candidate.citationCount ?? candidate.citation_count ?? 0),
      metadataCompleteness: metadataCompleteness(candidate),
    },
    rationale: buildRationale(candidate),
    runner: 'scheduled-discovery',
  };
}

function extractSourceId(source, candidate) {
  if (source === 's2') return String(candidate.paperId ?? candidate.id ?? candidate.externalIds?.ArXiv ?? hashObject(candidate)).trim();
  return String(candidate.id ?? candidate.arxivId ?? candidate.externalIds?.ArXiv ?? hashObject(candidate)).trim();
}

function buildDedupKey({ source, sourceId, candidate, title, url, year }) {
  const doi = candidate.doi ?? candidate.externalIds?.DOI;
  if (sourceId) return `${source}:${String(sourceId).toLowerCase()}`;
  if (doi) return `doi:${String(doi).toLowerCase()}`;
  if (url) return `url:${sha256(canonicalUrl(url))}`;
  return `title:${sha256([title.toLowerCase(), normalizeAuthors(candidate.authors).join('|').toLowerCase(), year ?? ''].join('|'))}`;
}

async function collectExistingDedupKeys(discoveredDir) {
  const keys = new Set();
  for (const file of await listJsonFiles(discoveredDir)) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed.dedupKey) keys.add(parsed.dedupKey);
    } catch (_) {}
  }
  return keys;
}

async function listJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

async function writeCandidate(filePath, record) {
  try {
    await access(filePath, fsConstants.F_OK);
    return;
  } catch (_) {}
  await atomicWrite(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

async function atomicWrite(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  let fd;
  try {
    fd = await open(tmpPath, 'w');
    await fd.writeFile(content, 'utf8');
    await fd.datasync();
    await fd.close();
    fd = null;
    await rename(tmpPath, filePath);
  } catch (err) {
    if (fd) {
      try { await fd.close(); } catch (_) {}
    }
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function printSummary(summary) {
  console.log([
    `Scheduled discovery checked ${summary.checked} watchlist item(s).`,
    `Queries run: ${summary.queriesRun}`,
    `Fetched: ${summary.fetched}`,
    `New: ${summary.new}`,
    `Duplicates skipped: ${summary.duplicates}`,
    `Skipped: ${summary.skippedCount}`,
    `Errors: ${summary.errorsCount}`,
  ].join('\n'));
}

function buildRationale(candidate) {
  const reasons = [];
  if (candidate._score !== undefined) reasons.push('Ranked by citation, recency, and topic match signals.');
  if (candidate.citationCount || candidate.citation_count) reasons.push('Has citation signal.');
  if (candidate.abstract || candidate.summary) reasons.push('Has abstract or summary metadata.');
  return reasons;
}

function metadataCompleteness(candidate) {
  const fields = [
    candidate.title,
    candidate.url,
    candidate.authors?.length,
    candidate.abstract ?? candidate.summary,
    candidate.id ?? candidate.paperId,
  ];
  return fields.filter(Boolean).length;
}

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors.map(author => {
    if (typeof author === 'string') return author;
    return author?.name ?? '';
  }).filter(Boolean);
}

function scoreToInt(score) {
  const numeric = Number(score ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 10));
}

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function hashObject(value) {
  return sha256(JSON.stringify(value)).slice(0, 16);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalUrl(value) {
  return String(value).trim().replace(/\/$/, '');
}

function safeFilePart(value) {
  return basename(String(value || 'unknown').replace(/[<>:"/\\|?*\s]+/g, '-')).slice(0, 80) || 'unknown';
}

function normalizeSourceFilter(value) {
  if (!value || value === 'all') return null;
  const source = String(value).trim().toLowerCase();
  if (!VALID_SOURCES.has(source)) throw new WatchlistConfigError(`Unknown source "${source}".`);
  return source;
}

function normalizeScheduleFilter(value) {
  if (!value || value === 'all') return null;
  const schedule = String(value).trim().toLowerCase();
  if (!VALID_SCHEDULES.has(schedule)) throw new WatchlistConfigError(`Unknown schedule "${schedule}".`);
  return schedule;
}

function normalizeOptionalPositiveInt(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new WatchlistConfigError(`${label} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') opts.config = argv[++i];
    else if (arg === '--state') opts.state = argv[++i];
    else if (arg === '--schedule') opts.schedule = argv[++i];
    else if (arg === '--source') opts.source = argv[++i];
    else if (arg === '--limit') opts.limit = argv[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new WatchlistConfigError(`Unknown flag: ${arg}`);
  }
  return opts;
}

function usage() {
  return `Usage: lumina discover run [--config path] [--schedule daily|weekly|monthly|manual] [--source arxiv|s2] [--limit N] [--dry-run] [--json]`;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      console.log(usage());
      return 0;
    }
    const summary = await runDiscover(opts);
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    return summary.errors.length > 0 && summary.new > 0 ? 3 : 0;
  } catch (err) {
    const code = err.code === 2 || err instanceof WatchlistConfigError ? 2 : 3;
    console.error(`[error] ${err.message}`);
    return code;
  }
}

if (process.argv[1] === __filename) {
  const code = await main();
  process.exit(code);
}
