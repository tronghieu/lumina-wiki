import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { main, runDiscover } from './discover-runner.mjs';
import {
  normalizeWatchlistConfig,
  parseSimpleWatchlistYaml,
  WatchlistConfigError,
} from './lib/watchlist-config.mjs';

async function makeWorkspace() {
  const ws = join(tmpdir(), `lumina-discover-runner-${randomBytes(6).toString('hex')}`);
  await mkdir(join(ws, '_lumina', 'config'), { recursive: true });
  await mkdir(join(ws, '_lumina', 'tools'), { recursive: true });
  await mkdir(join(ws, 'raw', 'discovered'), { recursive: true });
  await writeFakeTools(ws);
  return ws;
}

async function writeFakeTools(ws, options = {}) {
  const arxivScript = options.arxivScript ?? [
    'import json, sys',
    'query = sys.argv[2]',
    'print(json.dumps([',
    '  {"id":"2401.00001","title":"Agent Evaluation Frameworks","summary":"AI agent evaluation frameworks","published":"2026-05-01T00:00:00Z","authors":["A"],"url":"https://arxiv.org/abs/2401.00001","citationCount":3},',
    '  {"id":"2401.00002","title":"Unrelated Widgets","summary":"widgets","published":"2020-01-01T00:00:00Z","authors":["B"],"url":"https://arxiv.org/abs/2401.00002","citationCount":1}',
    ']))',
    '',
  ].join('\n');

  const s2Script = options.s2Script ?? [
    'import sys',
    'print("Error: SEMANTIC_SCHOLAR_API_KEY is not set.", file=sys.stderr)',
    'sys.exit(2)',
    '',
  ].join('\n');

  await writeFile(join(ws, '_lumina', 'tools', 'fetch_arxiv.py'), arxivScript, 'utf8');
  await writeFile(join(ws, '_lumina', 'tools', 'fetch_s2.py'), s2Script, 'utf8');

  await writeFile(join(ws, '_lumina', 'tools', 'discover.py'), [
    'import json, sys',
    'data = json.loads(sys.stdin.read())',
    'for i, item in enumerate(data):',
    '    item["_score"] = 10 - i',
    'print(json.dumps(data))',
    '',
  ].join('\n'), 'utf8');
}

async function writeWatchlist(ws, body) {
  await writeFile(join(ws, '_lumina', 'config', 'watchlist.yml'), body, 'utf8');
}

async function listJsonFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

function enabledWatchlist() {
  return [
    'version: 1',
    'defaults:',
    '  sources: [arxiv]',
    '  schedule: weekly',
    '  limit: 2',
    '  max_new: 2',
    'items:',
    '  - id: ai-agents',
    '    enabled: true',
    '    query: "AI agent evaluation frameworks"',
    '    sources: [arxiv]',
    '    schedule: weekly',
    '    limit: 2',
    '    max_new: 2',
    '',
  ].join('\n');
}

function enabledWatchlistWithS2() {
  return enabledWatchlist().replaceAll('sources: [arxiv]', 'sources: [arxiv, s2]');
}

test('invalid watchlist id is rejected', () => {
  assert.throws(
    () => normalizeWatchlistConfig({
      version: 1,
      items: [{ id: '../bad', enabled: true, query: 'x', sources: ['arxiv'], schedule: 'weekly', limit: 1 }],
    }),
    WatchlistConfigError,
  );
});

test('simple watchlist YAML parser supports installed runner fallback', () => {
  const parsed = parseSimpleWatchlistYaml(enabledWatchlist());
  const normalized = normalizeWatchlistConfig(parsed);

  assert.equal(normalized.items[0].id, 'ai-agents');
  assert.equal(normalized.items[0].enabled, true);
  assert.deepEqual(normalized.items[0].sources, ['arxiv']);
  assert.equal(normalized.items[0].schedule, 'weekly');
});

test('dry-run reports candidates without writing raw or state', async () => {
  const ws = await makeWorkspace();
  await writeWatchlist(ws, enabledWatchlist());

  const summary = await runDiscover({
    projectRoot: ws,
    dryRun: true,
    json: true,
    now: new Date('2026-05-05T03:00:00.000Z'),
  });

  assert.equal(summary.new, 2);
  assert.equal((await listJsonFiles(join(ws, 'raw', 'discovered'))).length, 0);
  assert.equal(existsSync(join(ws, '_lumina', '_state', 'discovery-runner.json')), false);
});

test('writes scored candidate records and state', async () => {
  const ws = await makeWorkspace();
  await writeWatchlist(ws, enabledWatchlist());

  const summary = await runDiscover({
    projectRoot: ws,
    json: true,
    now: new Date('2026-05-05T03:00:00.000Z'),
  });

  assert.equal(summary.new, 2);
  assert.equal(summary.skippedCount, 0);
  assert.equal(summary.errorsCount, 0);
  const files = await listJsonFiles(join(ws, 'raw', 'discovered'));
  assert.equal(files.length, 2);
  const record = JSON.parse(await readFile(files[0], 'utf8'));
  assert.equal(record.schema, 'lumina.discovered.v1');
  assert.equal(record.status, 'new');
  assert.equal(typeof record.score.total, 'number');
  assert.equal(record.watchlistId, 'ai-agents');
  assert.equal(existsSync(join(ws, '_lumina', '_state', 'discovery-runner.json')), true);
});

test('immediate rerun does not write duplicate records', async () => {
  const ws = await makeWorkspace();
  await writeWatchlist(ws, enabledWatchlist());

  await runDiscover({ projectRoot: ws, json: true, now: new Date('2026-05-05T03:00:00.000Z') });
  const before = await listJsonFiles(join(ws, 'raw', 'discovered'));
  const beforeStats = await Promise.all(before.map(file => stat(file)));

  const summary = await runDiscover({ projectRoot: ws, json: true, now: new Date('2026-05-05T04:00:00.000Z') });
  const after = await listJsonFiles(join(ws, 'raw', 'discovered'));
  const afterStats = await Promise.all(after.map(file => stat(file)));

  assert.equal(summary.new, 0);
  assert.equal(summary.duplicates, 2);
  assert.deepEqual(after, before);
  assert.deepEqual(afterStats.map(s => s.mtimeMs), beforeStats.map(s => s.mtimeMs));
});

test('deduplicates the same paper returned by arxiv and s2 in one run', async () => {
  const ws = await makeWorkspace();
  await writeFakeTools(ws, {
    s2Script: [
      'import json',
      'print(json.dumps([',
      '  {"paperId":"s2-abc","externalIds":{"ArXiv":"2401.00001"},"title":"Agent Evaluation Frameworks","abstract":"same paper","publicationDate":"2026-05-01","authors":[{"name":"A"}],"url":"https://www.semanticscholar.org/paper/s2-abc","citationCount":4}',
      ']))',
      '',
    ].join('\n'),
  });
  await writeWatchlist(ws, enabledWatchlistWithS2());

  const summary = await runDiscover({
    projectRoot: ws,
    json: true,
    now: new Date('2026-05-05T03:00:00.000Z'),
  });

  assert.equal(summary.fetched, 3);
  assert.equal(summary.new, 2);
  assert.equal(summary.duplicates, 1);
  assert.equal((await listJsonFiles(join(ws, 'raw', 'discovered'))).length, 2);
});

test('main exits non-zero when a source fetch fails without new candidates', async () => {
  const ws = await makeWorkspace();
  await writeFakeTools(ws, {
    arxivScript: [
      'import sys',
      'print("arxiv unavailable", file=sys.stderr)',
      'sys.exit(3)',
      '',
    ].join('\n'),
  });
  await writeWatchlist(ws, enabledWatchlist());

  const previousCwd = process.cwd();
  const previousLog = console.log;
  process.chdir(ws);
  console.log = () => {};
  try {
    const code = await main(['--json']);
    assert.equal(code, 3);
  } finally {
    console.log = previousLog;
    process.chdir(previousCwd);
  }
});

test('source filter handles optional missing S2 key without writes', async () => {
  const ws = await makeWorkspace();
  await writeWatchlist(ws, enabledWatchlistWithS2());

  const summary = await runDiscover({
    projectRoot: ws,
    source: 's2',
    json: true,
    now: new Date('2026-05-05T03:00:00.000Z'),
  });

  assert.equal(summary.new, 0);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.errorsCount, 0);
  assert.equal(summary.skipped.some(item => item.source === 's2'), true);
  assert.equal((await listJsonFiles(join(ws, 'raw', 'discovered'))).length, 0);
});
