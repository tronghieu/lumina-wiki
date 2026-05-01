/**
 * @file wiki.test.mjs
 * @description Tests for wiki.mjs using Node built-in test runner.
 * Run with: node --test src/scripts/wiki.test.mjs
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, open } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';

// ---------------------------------------------------------------------------
// Helper: run wiki.mjs as a child process
// ---------------------------------------------------------------------------

const WIKI_MJS = resolve(new URL('.', import.meta.url).pathname, 'wiki.mjs');

/**
 * Invoke wiki.mjs synchronously, return { stdout, stderr, status }.
 * @param {string[]} args
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.input] - stdin data
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runWiki(args, opts = {}) {
  const result = spawnSync(
    process.execPath,
    [WIKI_MJS, ...args],
    {
      cwd: opts.cwd || process.cwd(),
      encoding: 'utf8',
      input: opts.input,
      timeout: 10000,
    },
  );
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? -1,
  };
}

/**
 * Parse JSON from stdout output.
 */
function parseJson(output) {
  return JSON.parse(output.trim());
}

/**
 * Compute SHA-256 hash of a file's content.
 */
async function hashFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return createHash('sha256').update(content, 'utf8').digest('hex');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Hash all files in a directory recursively, returning a sorted record.
 * @param {string} dir
 * @returns {Promise<Record<string, string>>}
 */
async function hashDir(dir) {
  const { readdirSync, statSync } = await import('node:fs');
  const result = {};

  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current);
    } catch (_) { return; }
    for (const entry of entries) {
      const full = join(current, entry);
      let s;
      try { s = statSync(full); } catch (_) { continue; }
      if (s.isDirectory()) {
        walk(full);
      } else {
        const hash = createHash('sha256')
          .update(require('fs').readFileSync(full))
          .digest('hex');
        result[full] = hash;
      }
    }
  }

  // Use async version instead
  const { readdir, stat } = await import('node:fs/promises');

  async function walkAsync(current, acc) {
    let entries;
    try {
      entries = await readdir(current);
    } catch (_) { return; }
    for (const entry of entries) {
      const full = join(current, entry);
      let s;
      try { s = await stat(full); } catch (_) { continue; }
      if (s.isDirectory()) {
        await walkAsync(full, acc);
      } else {
        const content = await readFile(full, 'utf8').catch(() => readFile(full));
        acc[full] = createHash('sha256').update(content).digest('hex');
      }
    }
  }

  await walkAsync(dir, result);
  return result;
}

/**
 * Create a temporary directory for a test.
 * @returns {Promise<string>}
 */
async function makeTmp() {
  return mkdtemp(join(tmpdir(), 'wiki-test-'));
}

/**
 * Remove a temporary directory.
 * @param {string} dir
 */
async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Initialize a workspace in a temp dir (creates wiki/ dirs).
 * @param {string} dir
 * @param {string[]} [extraArgs]
 */
function initWorkspace(dir, extraArgs = []) {
  const result = runWiki(['init', ...extraArgs], { cwd: dir });
  assert.equal(result.status, 0, `init failed: ${result.stderr}`);
  return parseJson(result.stdout);
}

// ---------------------------------------------------------------------------
// Tests: slug
// ---------------------------------------------------------------------------

describe('slug', () => {
  test('converts title to kebab-case', () => {
    const r = runWiki(['slug', 'Hello World Test']);
    assert.equal(r.status, 0);
    const json = parseJson(r.stdout);
    assert.equal(json.slug, 'hello-world-test');
  });

  test('strips punctuation', () => {
    const r = runWiki(['slug', 'Flash-Attention: A Fast (Variant)!']);
    assert.equal(r.status, 0);
    const json = parseJson(r.stdout);
    assert.ok(!json.slug.includes(':'), 'no colon');
    assert.ok(!json.slug.includes('('), 'no paren');
    assert.ok(!json.slug.includes('!'), 'no exclamation');
    assert.ok(json.slug.length > 0, 'non-empty');
  });

  test('collapses multiple spaces/hyphens', () => {
    const r = runWiki(['slug', '  multiple   spaces  ']);
    assert.equal(r.status, 0);
    const json = parseJson(r.stdout);
    assert.ok(!json.slug.startsWith('-'), 'no leading hyphen');
    assert.ok(!json.slug.endsWith('-'), 'no trailing hyphen');
    assert.ok(!json.slug.includes('--'), 'no double hyphen');
  });

  test('returns error for missing title', () => {
    const r = runWiki(['slug']);
    assert.equal(r.status, 2);
  });

  test('is deterministic — same input same output', () => {
    const r1 = runWiki(['slug', 'Attention Is All You Need']);
    const r2 = runWiki(['slug', 'Attention Is All You Need']);
    assert.equal(parseJson(r1.stdout).slug, parseJson(r2.stdout).slug);
  });
});

// ---------------------------------------------------------------------------
// Tests: init
// ---------------------------------------------------------------------------

describe('init', () => {
  test('creates core wiki directories', async () => {
    const tmp = await makeTmp();
    try {
      const r = runWiki(['init'], { cwd: tmp });
      assert.equal(r.status, 0, `init failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.ok(json.ok);
      assert.ok(json.created.includes('wiki/sources'));
      assert.ok(json.created.includes('wiki/concepts'));
      assert.ok(json.created.includes('wiki/graph'));
      assert.ok(json.created.includes('wiki/index.md'));
      assert.ok(json.created.includes('wiki/log.md'));

      // Verify directories exist
      for (const dir of ['wiki/sources', 'wiki/concepts', 'wiki/people', 'wiki/summary', 'wiki/outputs', 'wiki/graph']) {
        await access(join(tmp, dir), fsConstants.F_OK);
      }
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('creates research pack directories with --pack research', async () => {
    const tmp = await makeTmp();
    try {
      const r = runWiki(['init', '--pack', 'research'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(json.created.includes('wiki/foundations'));
      assert.ok(json.created.includes('wiki/topics'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('creates reading pack directories with --pack reading', async () => {
    const tmp = await makeTmp();
    try {
      const r = runWiki(['init', '--pack', 'reading'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(json.created.includes('wiki/chapters'));
      assert.ok(json.created.includes('wiki/characters'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects invalid --pack value', async () => {
    const tmp = await makeTmp();
    try {
      const r = runWiki(['init', '--pack', 'invalid'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('idempotency: running init twice produces byte-identical workspace', async () => {
    const tmp = await makeTmp();
    try {
      // First init
      runWiki(['init'], { cwd: tmp });
      const hashes1 = await hashDir(join(tmp, 'wiki'));

      // Second init
      runWiki(['init'], { cwd: tmp });
      const hashes2 = await hashDir(join(tmp, 'wiki'));

      // All keys should be the same
      const keys1 = Object.keys(hashes1).sort();
      const keys2 = Object.keys(hashes2).sort();
      assert.deepEqual(keys1, keys2, 'same file set');

      // All hashes should be identical
      for (const key of keys1) {
        assert.equal(hashes1[key], hashes2[key], `hash mismatch for ${key}`);
      }
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('init marks already-existing dirs as skipped', async () => {
    const tmp = await makeTmp();
    try {
      runWiki(['init'], { cwd: tmp });
      const r = runWiki(['init'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(json.skipped.length > 0, 'some dirs skipped on second run');
      assert.equal(json.created.length, 0, 'nothing new created on second run');
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: log
// ---------------------------------------------------------------------------

describe('log', () => {
  test('appends a log entry to wiki/log.md', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['log', 'lumi-ingest', 'Ingested paper attention-2024'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(json.ok);

      const logContent = await readFile(join(tmp, 'wiki', 'log.md'), 'utf8');
      assert.ok(logContent.includes('lumi-ingest'), 'contains skill');
      assert.ok(logContent.includes('Ingested paper attention-2024'), 'contains details');
      assert.match(logContent, /## \[\d{4}-\d{2}-\d{2}\]/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('appends multiple log entries', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['log', 'lumi-ingest', 'entry one'], { cwd: tmp });
      runWiki(['log', 'lumi-ask', 'entry two'], { cwd: tmp });

      const logContent = await readFile(join(tmp, 'wiki', 'log.md'), 'utf8');
      assert.ok(logContent.includes('entry one'));
      assert.ok(logContent.includes('entry two'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('returns error for missing skill argument', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['log'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: read-meta and set-meta
// ---------------------------------------------------------------------------

describe('read-meta and set-meta', () => {
  test('read-meta returns frontmatter JSON', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      // Create a test entity file
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      const content = `---
id: test-source
title: Test Source
type: source
created: 2024-01-01
updated: 2024-01-01
authors:
  - Alice Smith
year: 2024
importance: 3
---

Body text here.
`;
      await writeFile(join(sourceDir, 'test-source.md'), content, 'utf8');

      const r = runWiki(['read-meta', 'test-source'], { cwd: tmp });
      assert.equal(r.status, 0, `read-meta failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.slug, 'test-source');
      assert.equal(json.frontmatter.id, 'test-source');
      assert.equal(json.frontmatter.title, 'Test Source');
      assert.equal(json.frontmatter.year, 2024);
      assert.deepEqual(json.frontmatter.authors, ['Alice Smith']);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('read-meta exits 2 for unknown slug', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['read-meta', 'nonexistent-slug'], { cwd: tmp });
      assert.equal(r.status, 2);
      const errJson = parseJson(r.stderr);
      assert.equal(errJson.code, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('set-meta updates a frontmatter key', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      const content = `---
id: my-source
title: My Source
type: source
created: 2024-01-01
updated: 2024-01-01
authors:
  - Bob
year: 2023
importance: 2
---

Body.
`;
      await writeFile(join(sourceDir, 'my-source.md'), content, 'utf8');

      const r = runWiki(['set-meta', 'my-source', 'importance', '5'], { cwd: tmp });
      assert.equal(r.status, 0, `set-meta failed: ${r.stderr}`);

      // Verify change
      const r2 = runWiki(['read-meta', 'my-source'], { cwd: tmp });
      const json = parseJson(r2.stdout);
      assert.equal(json.frontmatter.importance, 5);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('set-meta with --json-value parses JSON value', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const conceptsDir = join(tmp, 'wiki', 'concepts');
      await mkdir(conceptsDir, { recursive: true });
      const content = `---
id: my-concept
title: My Concept
type: concept
created: 2024-01-01
updated: 2024-01-01
key_sources: []
related_concepts: []
---
`;
      await writeFile(join(conceptsDir, 'my-concept.md'), content, 'utf8');

      const r = runWiki(
        ['set-meta', 'my-concept', 'key_sources', '["src-a","src-b"]', '--json-value'],
        { cwd: tmp },
      );
      assert.equal(r.status, 0, `set-meta --json-value failed: ${r.stderr}`);

      const r2 = runWiki(['read-meta', 'my-concept'], { cwd: tmp });
      const json = parseJson(r2.stdout);
      assert.deepEqual(json.frontmatter.key_sources, ['src-a', 'src-b']);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('read-meta rejects .. in slug', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['read-meta', '../etc/passwd'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: add-edge
// ---------------------------------------------------------------------------

describe('add-edge', () => {
  test('adds a forward edge and its reverse', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);

      const r = runWiki(
        ['add-edge', 'source-a', 'builds_on', 'source-b'],
        { cwd: tmp },
      );
      assert.equal(r.status, 0, `add-edge failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.ok(json.added);

      const edgesFile = join(tmp, 'wiki', 'graph', 'edges.jsonl');
      const content = await readFile(edgesFile, 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));

      const fwd = edges.find(e => e.from === 'source-a' && e.type === 'builds_on' && e.to === 'source-b');
      const rev = edges.find(e => e.from === 'source-b' && e.type === 'built_upon_by' && e.to === 'source-a');
      assert.ok(fwd, 'forward edge present');
      assert.ok(rev, 'reverse edge present');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('idempotency: add-edge twice produces byte-identical edges.jsonl', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'src-x', 'builds_on', 'src-y'], { cwd: tmp });
      const hash1 = await hashFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'));
      runWiki(['add-edge', 'src-x', 'builds_on', 'src-y'], { cwd: tmp });
      const hash2 = await hashFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'));
      assert.equal(hash1, hash2, 'edges.jsonl byte-identical after second add-edge');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('returns added:false on duplicate edge', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'src-a', 'builds_on', 'src-b'], { cwd: tmp });
      const r = runWiki(['add-edge', 'src-a', 'builds_on', 'src-b'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.added, false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('symmetric edge stored once with sorted endpoints', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'source-z', 'same_problem_as', 'source-a'], { cwd: tmp });
      const content = await readFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'), 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));

      // Only one edge should be stored for symmetric type
      const symEdges = edges.filter(e => e.type === 'same_problem_as');
      assert.equal(symEdges.length, 1, 'symmetric edge stored once');

      // Endpoints should be sorted
      const edge = symEdges[0];
      assert.ok(edge.from <= edge.to, 'endpoints are sorted');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('exempt: add-edge with foundations target writes only forward edge', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'concept-x', 'grounded_in', 'foundations/theory-y'], { cwd: tmp });
      const content = await readFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'), 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));

      // grounded_in is terminal, so only forward edge
      assert.equal(edges.length, 1, 'only one edge for terminal edge type');
      assert.equal(edges[0].type, 'grounded_in');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('exempt: outputs/** target writes only forward edge', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'concept-a', 'produced', 'outputs/report-x'], { cwd: tmp });
      const content = await readFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'), 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));
      assert.equal(edges.length, 1, 'only one edge for exempt target');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects unknown edge type', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-edge', 'a', 'nonexistent_type', 'b'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects .. in slug args', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-edge', '..', 'builds_on', 'target'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('add-edge with --confidence stores confidence', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(
        ['add-edge', 'src-p', 'builds_on', 'src-q', '--confidence', 'high'],
        { cwd: tmp },
      );
      const content = await readFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'), 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));
      const fwd = edges.find(e => e.from === 'src-p' && e.type === 'builds_on');
      assert.equal(fwd.confidence, 'high');
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: add-citation
// ---------------------------------------------------------------------------

describe('add-citation', () => {
  test('adds a citation to citations.jsonl', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-citation', 'src-alpha', 'src-beta'], { cwd: tmp });
      assert.equal(r.status, 0, `add-citation failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.ok(json.added);

      const content = await readFile(join(tmp, 'wiki', 'graph', 'citations.jsonl'), 'utf8');
      const citations = content.trim().split('\n').map(l => JSON.parse(l));
      assert.equal(citations.length, 1);
      assert.equal(citations[0].from, 'src-alpha');
      assert.equal(citations[0].to, 'src-beta');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('idempotency: add-citation twice produces byte-identical citations.jsonl', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-citation', 'src-a', 'src-b'], { cwd: tmp });
      const hash1 = await hashFile(join(tmp, 'wiki', 'graph', 'citations.jsonl'));
      runWiki(['add-citation', 'src-a', 'src-b'], { cwd: tmp });
      const hash2 = await hashFile(join(tmp, 'wiki', 'graph', 'citations.jsonl'));
      assert.equal(hash1, hash2, 'citations.jsonl byte-identical after second add-citation');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('returns added:false for duplicate citation', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-citation', 'src-a', 'src-b'], { cwd: tmp });
      const r = runWiki(['add-citation', 'src-a', 'src-b'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.added, false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects .. in args', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-citation', '..', 'src-b'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: batch-edges
// ---------------------------------------------------------------------------

describe('batch-edges', () => {
  test('applies multiple edges from a JSON file', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const batchFile = join(tmp, 'batch.json');
      const batch = [
        { from: 'src-1', type: 'builds_on', to: 'src-2' },
        { from: 'src-3', type: 'challenges', to: 'src-4' },
      ];
      await writeFile(batchFile, JSON.stringify(batch), 'utf8');

      const r = runWiki(['batch-edges', batchFile], { cwd: tmp });
      assert.equal(r.status, 0, `batch-edges failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.processed, 2);
      assert.equal(json.added, 2);

      const content = await readFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'), 'utf8');
      const edges = content.trim().split('\n').map(l => JSON.parse(l));
      // 2 forward + 2 reverse = 4 edges
      assert.equal(edges.length, 4);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('idempotency: batch-edges twice produces byte-identical edges.jsonl', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const batchFile = join(tmp, 'batch.json');
      await writeFile(batchFile, JSON.stringify([
        { from: 'src-1', type: 'builds_on', to: 'src-2' },
      ]), 'utf8');

      runWiki(['batch-edges', batchFile], { cwd: tmp });
      const hash1 = await hashFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'));
      runWiki(['batch-edges', batchFile], { cwd: tmp });
      const hash2 = await hashFile(join(tmp, 'wiki', 'graph', 'edges.jsonl'));
      assert.equal(hash1, hash2, 'byte-identical after second batch-edges');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('skips duplicates', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      // Pre-add an edge
      runWiki(['add-edge', 'src-1', 'builds_on', 'src-2'], { cwd: tmp });

      const batchFile = join(tmp, 'batch.json');
      await writeFile(batchFile, JSON.stringify([
        { from: 'src-1', type: 'builds_on', to: 'src-2' },
        { from: 'src-3', type: 'challenges', to: 'src-4' },
      ]), 'utf8');

      const r = runWiki(['batch-edges', batchFile], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.skipped, 1);
      assert.equal(json.added, 1);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects invalid batch file (bad JSON)', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const batchFile = join(tmp, 'bad.json');
      await writeFile(batchFile, 'not json', 'utf8');
      const r = runWiki(['batch-edges', batchFile], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('rejects batch file with unknown edge type', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const batchFile = join(tmp, 'batch.json');
      await writeFile(batchFile, JSON.stringify([
        { from: 'a', type: 'totally_fake_type', to: 'b' },
      ]), 'utf8');
      const r = runWiki(['batch-edges', batchFile], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: dedup-edges
// ---------------------------------------------------------------------------

describe('dedup-edges', () => {
  test('removes duplicate edges', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const graphDir = join(tmp, 'wiki', 'graph');
      await mkdir(graphDir, { recursive: true });
      const edgesFile = join(graphDir, 'edges.jsonl');

      // Write a file with duplicate entries
      const lines = [
        JSON.stringify({ from: 'a', type: 'builds_on', to: 'b' }),
        JSON.stringify({ from: 'a', type: 'builds_on', to: 'b' }), // duplicate
        JSON.stringify({ from: 'c', type: 'challenges', to: 'd' }),
      ].join('\n') + '\n';
      await writeFile(edgesFile, lines, 'utf8');

      const r = runWiki(['dedup-edges'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.before, 3);
      assert.equal(json.after, 2);
      assert.equal(json.removed, 1);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('handles empty edges.jsonl', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const graphDir = join(tmp, 'wiki', 'graph');
      await mkdir(graphDir, { recursive: true });
      const edgesFile = join(graphDir, 'edges.jsonl');
      await writeFile(edgesFile, '', 'utf8');

      const r = runWiki(['dedup-edges'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.before, 0);
      assert.equal(json.after, 0);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: checkpoint-read and checkpoint-write
// ---------------------------------------------------------------------------

describe('checkpoint ops', () => {
  test('checkpoint-read returns {} for missing checkpoint', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['checkpoint-read', 'lumi-ingest', 'phase1'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.deepEqual(json, {});
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('checkpoint-write then checkpoint-read returns stored data', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);

      const cpFile = join(tmp, 'cp.json');
      const data = { status: 'done', count: 42, items: ['a', 'b'] };
      await writeFile(cpFile, JSON.stringify(data), 'utf8');

      const wr = runWiki(['checkpoint-write', 'lumi-ingest', 'phase1', cpFile], { cwd: tmp });
      assert.equal(wr.status, 0, `checkpoint-write failed: ${wr.stderr}`);

      const rr = runWiki(['checkpoint-read', 'lumi-ingest', 'phase1'], { cwd: tmp });
      assert.equal(rr.status, 0);
      const json = parseJson(rr.stdout);
      assert.deepEqual(json, data);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('checkpoint-write via stdin', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);

      const data = { mode: 'stdin-test' };
      const r = runWiki(
        ['checkpoint-write', 'my-skill', 'phase2', '-'],
        { cwd: tmp, input: JSON.stringify(data) },
      );
      assert.equal(r.status, 0, `checkpoint-write stdin failed: ${r.stderr}`);

      const rr = runWiki(['checkpoint-read', 'my-skill', 'phase2'], { cwd: tmp });
      const json = parseJson(rr.stdout);
      assert.deepEqual(json, data);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('checkpoint-write is atomic (writes to _state/)', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);

      const cpFile = join(tmp, 'cp.json');
      await writeFile(cpFile, JSON.stringify({ x: 1 }), 'utf8');
      runWiki(['checkpoint-write', 'skill-a', 'phaseA', cpFile], { cwd: tmp });

      const stateFile = join(tmp, '_lumina', '_state', 'skill-a-phaseA.json');
      await access(stateFile, fsConstants.F_OK);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: path safety
// ---------------------------------------------------------------------------

describe('path safety', () => {
  test('read-meta with absolute path slug exits 2', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['read-meta', '/etc/passwd'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('read-meta with .. in slug exits 2', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['read-meta', '../outside'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('add-edge with .. in from-slug exits 2', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-edge', '..', 'builds_on', 'target'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('add-edge with .. in to-slug exits 2', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['add-edge', 'source', 'builds_on', '..'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: atomic write
// ---------------------------------------------------------------------------

describe('atomicWrite helper (via set-meta)', () => {
  test('writes produce no leftover .tmp file on success', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      const content = `---
id: atomic-test
title: Atomic Test
type: source
created: 2024-01-01
updated: 2024-01-01
authors:
  - Test Author
year: 2024
importance: 1
---
`;
      await writeFile(join(sourceDir, 'atomic-test.md'), content, 'utf8');

      runWiki(['set-meta', 'atomic-test', 'importance', '4'], { cwd: tmp });

      // Confirm no .tmp file left over
      try {
        await access(join(sourceDir, 'atomic-test.md.tmp'), fsConstants.F_OK);
        assert.fail('.tmp file should not exist after successful write');
      } catch (err) {
        assert.equal(err.code, 'ENOENT', '.tmp file correctly absent');
      }
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: error when no workspace found
// ---------------------------------------------------------------------------

describe('workspace detection', () => {
  test('commands that require workspace exit 2 when no wiki/ found', async () => {
    const tmp = await makeTmp();
    try {
      // Do NOT call initWorkspace — so no wiki/ dir exists
      const r = runWiki(['read-meta', 'some-slug'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('log command exits 2 when no wiki/ found', async () => {
    const tmp = await makeTmp();
    try {
      const r = runWiki(['log', 'skill', 'details'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: list-entities
// ---------------------------------------------------------------------------

describe('list-entities', () => {
  test('returns empty list with no entity files', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['list-entities'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.count, 0);
      assert.deepEqual(json.entities, []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('lists entities after creating files', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, 'paper-a.md'), `---\nid: paper-a\ntitle: Paper A\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nauthors:\n  - Auth\nyear: 2024\nimportance: 3\n---\n`, 'utf8');

      const r = runWiki(['list-entities'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.count, 1);
      assert.equal(json.entities[0].slug, 'paper-a');
      assert.equal(json.entities[0].type, 'sources');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('filters by --type', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      const conceptDir = join(tmp, 'wiki', 'concepts');
      await mkdir(sourceDir, { recursive: true });
      await mkdir(conceptDir, { recursive: true });
      await writeFile(join(sourceDir, 'src-1.md'), '---\nid: src-1\ntitle: S\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nauthors: []\nyear: 2024\nimportance: 1\n---\n', 'utf8');
      await writeFile(join(conceptDir, 'con-1.md'), '---\nid: con-1\ntitle: C\ntype: concept\ncreated: 2024-01-01\nupdated: 2024-01-01\nkey_sources: []\nrelated_concepts: []\n---\n', 'utf8');

      const r = runWiki(['list-entities', '--type', 'sources'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.count, 1);
      assert.equal(json.entities[0].type, 'sources');
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: read-edges and read-citations
// ---------------------------------------------------------------------------

describe('read-edges and read-citations', () => {
  test('read-edges returns outbound and inbound edges', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-edge', 'src-a', 'builds_on', 'src-b'], { cwd: tmp });

      const r = runWiki(['read-edges', 'src-a'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.slug, 'src-a');
      assert.equal(json.outbound.length, 1);
      assert.equal(json.outbound[0].type, 'builds_on');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('read-citations returns citing and citedBy', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      runWiki(['add-citation', 'paper-x', 'paper-y'], { cwd: tmp });

      const r = runWiki(['read-citations', 'paper-x'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.citing.length, 1);
      assert.equal(json.citedBy.length, 0);

      const r2 = runWiki(['read-citations', 'paper-y'], { cwd: tmp });
      const json2 = parseJson(r2.stdout);
      assert.equal(json2.citing.length, 0);
      assert.equal(json2.citedBy.length, 1);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: verify-frontmatter
// ---------------------------------------------------------------------------

describe('verify-frontmatter', () => {
  test('returns valid:true for complete frontmatter', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, 'valid-src.md'), `---\nid: valid-src\ntitle: Valid Source\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nauthors:\n  - Auth\nyear: 2024\nimportance: 3\n---\n`, 'utf8');

      const r = runWiki(['verify-frontmatter', 'valid-src'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(json.valid);
      assert.deepEqual(json.errors, []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('returns valid:false for missing required field', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      // Missing 'authors' field
      await writeFile(join(sourceDir, 'missing-fields.md'), `---\nid: missing-fields\ntitle: Test\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nyear: 2024\nimportance: 3\n---\n`, 'utf8');

      const r = runWiki(['verify-frontmatter', 'missing-fields'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.ok(!json.valid);
      assert.ok(json.errors.length > 0);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: unknown subcommand
// ---------------------------------------------------------------------------

describe('unknown subcommand', () => {
  test('exits 2 for unknown subcommand', () => {
    const r = runWiki(['totally-unknown-command']);
    assert.equal(r.status, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: B1 regression — atomic-write does not leak .tmp on failure
// ---------------------------------------------------------------------------

describe('atomicWrite tmp cleanup on success', () => {
  test('no .tmp file remains in workspace after a successful set-meta', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const sourceDir = join(tmp, 'wiki', 'sources');
      await mkdir(sourceDir, { recursive: true });
      // Create a valid source file
      await writeFile(join(sourceDir, 'cleanup-test.md'),
        `---\nid: cleanup-test\ntitle: Cleanup Test\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nyear: 2024\nimportance: 3\nauthors:\n  - Tester\n---\n`,
        'utf8');

      const r = runWiki(['set-meta', 'cleanup-test', 'title', 'Updated'], { cwd: tmp });
      assert.equal(r.status, 0, `set-meta failed: ${r.stderr}`);

      // Scan workspace for any .tmp files
      const { readdir: rd } = await import('node:fs/promises');
      async function findTmp(dir) {
        let leaks = [];
        let entries;
        try { entries = await rd(dir, { withFileTypes: true }); } catch { return leaks; }
        for (const e of entries) {
          if (e.isDirectory()) {
            leaks = leaks.concat(await findTmp(join(dir, e.name)));
          } else if (e.name.endsWith('.tmp')) {
            leaks.push(join(dir, e.name));
          }
        }
        return leaks;
      }
      const tmpFiles = await findTmp(tmp);
      assert.deepEqual(tmpFiles, [], `Leaked .tmp files: ${tmpFiles.join(', ')}`);
    } finally {
      await cleanTmp(tmp);
    }
  });
});
