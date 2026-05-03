/**
 * @file wiki.test.mjs
 * @description Tests for wiki.mjs using Node built-in test runner.
 * Run with: node --test src/scripts/wiki.test.mjs
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, open } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Helper: run wiki.mjs as a child process
// ---------------------------------------------------------------------------

const WIKI_MJS = fileURLToPath(new URL('wiki.mjs', import.meta.url));

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

  test('uses LUMINA_SESSION_ID env var when valid', async () => {
    const tmp = await makeTmp();
    const savedEnv = process.env.LUMINA_SESSION_ID;
    try {
      initWorkspace(tmp);
      process.env.LUMINA_SESSION_ID = 'deadbeef';

      runWiki(['log', 'lumi-ingest', 'entry alpha'], { cwd: tmp });
      runWiki(['log', 'lumi-ask', 'entry beta'], { cwd: tmp });

      const logContent = await readFile(join(tmp, 'wiki', 'log.md'), 'utf8');
      const lines = logContent.split('\n').filter(l => l.startsWith('## '));
      assert.equal(lines.length, 2, 'two log entries');
      assert.ok(lines[0].includes('session:deadbeef'), 'first entry uses env session id');
      assert.ok(lines[1].includes('session:deadbeef'), 'second entry uses env session id');
    } finally {
      if (savedEnv === undefined) {
        delete process.env.LUMINA_SESSION_ID;
      } else {
        process.env.LUMINA_SESSION_ID = savedEnv;
      }
      await cleanTmp(tmp);
    }
  });

  test('generates a session id when LUMINA_SESSION_ID is not set', async () => {
    const tmp = await makeTmp();
    const savedEnv = process.env.LUMINA_SESSION_ID;
    try {
      initWorkspace(tmp);
      delete process.env.LUMINA_SESSION_ID;

      runWiki(['log', 'lumi-ingest', 'entry gamma'], { cwd: tmp });

      const logContent = await readFile(join(tmp, 'wiki', 'log.md'), 'utf8');
      assert.match(logContent, /session:[0-9a-f]{8}/, 'log entry contains session:<8hex>');
    } finally {
      if (savedEnv === undefined) {
        delete process.env.LUMINA_SESSION_ID;
      } else {
        process.env.LUMINA_SESSION_ID = savedEnv;
      }
      await cleanTmp(tmp);
    }
  });

  test('generates different session ids for separate calls without env var', async () => {
    const tmp = await makeTmp();
    const savedEnv = process.env.LUMINA_SESSION_ID;
    try {
      initWorkspace(tmp);
      delete process.env.LUMINA_SESSION_ID;

      runWiki(['log', 'lumi-ingest', 'entry one'], { cwd: tmp });
      runWiki(['log', 'lumi-ask', 'entry two'], { cwd: tmp });

      const logContent = await readFile(join(tmp, 'wiki', 'log.md'), 'utf8');
      const matches = [...logContent.matchAll(/session:([0-9a-f]{8})/g)];
      assert.equal(matches.length, 2, 'two session id occurrences');
      assert.notEqual(matches[0][1], matches[1][1], 'session ids differ between calls');
    } finally {
      if (savedEnv === undefined) {
        delete process.env.LUMINA_SESSION_ID;
      } else {
        process.env.LUMINA_SESSION_ID = savedEnv;
      }
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

  test('read-meta and set-meta support typed path slugs', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeFile(join(tmp, 'wiki', 'concepts', 'typed-concept.md'), '---\nid: concepts/typed-concept\ntitle: Typed Concept\ntype: concept\ncreated: 2024-01-01\nupdated: 2024-01-01\nkey_sources: []\nrelated_concepts: []\n---\n', 'utf8');

      const read = runWiki(['read-meta', 'concepts/typed-concept'], { cwd: tmp });
      assert.equal(read.status, 0, `read-meta failed: ${read.stderr}`);
      assert.equal(parseJson(read.stdout).frontmatter.title, 'Typed Concept');

      const set = runWiki(['set-meta', 'concepts/typed-concept', 'updated', '2024-02-01'], { cwd: tmp });
      assert.equal(set.status, 0, `set-meta failed: ${set.stderr}`);

      const readAfter = runWiki(['read-meta', 'concepts/typed-concept'], { cwd: tmp });
      assert.equal(parseJson(readAfter.stdout).frontmatter.updated, '2024-02-01');
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

  test('lists nested entities by typed prefix', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'reading']);
      await mkdir(join(tmp, 'wiki', 'chapters', 'great-gatsby'), { recursive: true });
      await writeFile(join(tmp, 'wiki', 'chapters', 'great-gatsby', 'chapter-1.md'), '---\nid: chapters/great-gatsby/chapter-1\ntitle: Chapter 1\ntype: chapter\ncreated: 2024-01-01\nupdated: 2024-01-01\nbook: great-gatsby\nnumber: 1\n---\n', 'utf8');

      const r = runWiki(['list-entities', 'chapters/great-gatsby'], { cwd: tmp });
      assert.equal(r.status, 0, `list-entities failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.count, 1);
      assert.equal(json.entities[0].slug, 'chapters/great-gatsby/chapter-1');
      assert.equal(json.entities[0].path, 'chapters/great-gatsby/chapter-1');
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

  test('read-edges supports --from, --type, and --direction filters', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'reading']);
      runWiki(['add-edge', 'chapters/book/ch1', 'features', 'characters/book/alice'], { cwd: tmp });
      runWiki(['add-edge', 'chapters/book/ch1', 'tagged_with', 'themes/book/loneliness'], { cwd: tmp });

      const r = runWiki(['read-edges', '--from', 'chapters/book/ch1', '--type', 'features', '--direction', 'outbound'], { cwd: tmp });
      assert.equal(r.status, 0, `read-edges failed: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.outbound.length, 1);
      assert.equal(json.outbound[0].type, 'features');
      assert.equal(json.inbound.length, 0);
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
      await writeFile(join(sourceDir, 'valid-src.md'), `---\nid: valid-src\ntitle: Valid Source\ntype: source\ncreated: 2024-01-01\nupdated: 2024-01-01\nauthors:\n  - Auth\nyear: 2024\nimportance: 3\nprovenance: replayable\n---\n`, 'utf8');

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
// Tests: migrate --add-defaults
// ---------------------------------------------------------------------------

describe('migrate --add-defaults', () => {
  async function writeSource(tmp, slug, fm) {
    const dir = join(tmp, 'wiki', 'sources');
    await mkdir(dir, { recursive: true });
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
    lines.push('---', '', 'Body.', '');
    await writeFile(join(dir, `${slug}.md`), lines.join('\n'), 'utf8');
  }

  async function writeConcept(tmp, slug, fm) {
    const dir = join(tmp, 'wiki', 'concepts');
    await mkdir(dir, { recursive: true });
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
    lines.push('---', '', 'Body.', '');
    await writeFile(join(dir, `${slug}.md`), lines.join('\n'), 'utf8');
  }

  test('exits 2 without --add-defaults flag', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      const r = runWiki(['migrate'], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally { await cleanTmp(tmp); }
  });

  test('backfills provenance + confidence on legacy source', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeSource(tmp, 'legacy-src', {
        id: 'legacy-src', title: 'Legacy', type: 'source',
        created: '2024-01-01', updated: '2024-01-01',
        authors: '[Alice]', year: 2024, importance: 3,
      });

      const r = runWiki(['migrate', '--add-defaults'], { cwd: tmp });
      assert.equal(r.status, 0, r.stderr);
      const json = parseJson(r.stdout);
      assert.equal(json.dryRun, false);
      assert.equal(json.updated.length, 1);
      assert.equal(json.updated[0].slug, 'legacy-src');
      assert.deepEqual(json.updated[0].added, {
        provenance: 'missing',
        confidence: 'unverified',
      });

      const meta = parseJson(runWiki(['read-meta', 'legacy-src'], { cwd: tmp }).stdout);
      assert.equal(meta.frontmatter.provenance, 'missing');
      assert.equal(meta.frontmatter.confidence, 'unverified');
    } finally { await cleanTmp(tmp); }
  });

  test('backfills only confidence on legacy concept', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeConcept(tmp, 'legacy-cpt', {
        id: 'legacy-cpt', title: 'Concept', type: 'concept',
        created: '2024-01-01', updated: '2024-01-01',
      });

      const r = runWiki(['migrate', '--add-defaults'], { cwd: tmp });
      assert.equal(r.status, 0, r.stderr);
      const json = parseJson(r.stdout);
      assert.equal(json.updated.length, 1);
      assert.deepEqual(json.updated[0].added, { confidence: 'unverified' });

      const meta = parseJson(runWiki(['read-meta', 'legacy-cpt'], { cwd: tmp }).stdout);
      assert.equal(meta.frontmatter.confidence, 'unverified');
      assert.equal(meta.frontmatter.provenance, undefined);
    } finally { await cleanTmp(tmp); }
  });

  test('preserves existing values — does not overwrite', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeSource(tmp, 'has-prov', {
        id: 'has-prov', title: 'Has Prov', type: 'source',
        created: '2024-01-01', updated: '2024-01-01',
        authors: '[A]', year: 2024, importance: 2,
        provenance: 'replayable', confidence: 'high',
      });

      const r = runWiki(['migrate', '--add-defaults'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.updated.length, 0);

      const meta = parseJson(runWiki(['read-meta', 'has-prov'], { cwd: tmp }).stdout);
      assert.equal(meta.frontmatter.provenance, 'replayable');
      assert.equal(meta.frontmatter.confidence, 'high');
    } finally { await cleanTmp(tmp); }
  });

  test('idempotent: second run reports zero updates', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeSource(tmp, 'src-a', {
        id: 'src-a', title: 'A', type: 'source',
        created: '2024-01-01', updated: '2024-01-01',
        authors: '[A]', year: 2024, importance: 1,
      });

      const first = parseJson(runWiki(['migrate', '--add-defaults'], { cwd: tmp }).stdout);
      assert.equal(first.updated.length, 1);

      const second = parseJson(runWiki(['migrate', '--add-defaults'], { cwd: tmp }).stdout);
      assert.equal(second.updated.length, 0);
    } finally { await cleanTmp(tmp); }
  });

  test('--dry-run reports updates but does not write', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp);
      await writeSource(tmp, 'dry-src', {
        id: 'dry-src', title: 'Dry', type: 'source',
        created: '2024-01-01', updated: '2024-01-01',
        authors: '[A]', year: 2024, importance: 1,
      });

      const r = runWiki(['migrate', '--add-defaults', '--dry-run'], { cwd: tmp });
      assert.equal(r.status, 0);
      const json = parseJson(r.stdout);
      assert.equal(json.dryRun, true);
      assert.equal(json.updated.length, 1);

      const meta = parseJson(runWiki(['read-meta', 'dry-src'], { cwd: tmp }).stdout);
      assert.equal(meta.frontmatter.provenance, undefined);
      assert.equal(meta.frontmatter.confidence, undefined);
    } finally { await cleanTmp(tmp); }
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
// Tests: resolve-alias
// ---------------------------------------------------------------------------

describe('resolve-alias', () => {
  /**
   * Helper: create a foundations entity .md file in tmp workspace.
   * @param {string} tmp - project root
   * @param {string} slug - e.g. "reinforcement-learning-from-human-feedback"
   * @param {string} title - frontmatter title
   * @param {string[]|null} aliases - optional aliases array
   */
  async function makeFoundation(tmp, slug, title, aliases = null) {
    const foundationsDir = join(tmp, 'wiki', 'foundations');
    await mkdir(foundationsDir, { recursive: true });
    let aliasBlock = '';
    if (Array.isArray(aliases) && aliases.length > 0) {
      aliasBlock = `aliases:\n${aliases.map(a => `  - ${a}`).join('\n')}\n`;
    } else if (aliases !== null && !Array.isArray(aliases)) {
      // For defensive test: write malformed aliases
      aliasBlock = `aliases: ${String(aliases)}\n`;
    }
    const content = `---\nid: ${slug}\ntitle: ${title}\ntype: foundation\ncreated: 2024-01-01\nupdated: 2024-01-01\n${aliasBlock}---\n\nBody.\n`;
    await writeFile(join(foundationsDir, `${slug}.md`), content, 'utf8');
  }

  test('slug match — query equals slug exactly', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'reinforcement-learning', 'Reinforcement Learning', null);
      const r = runWiki(['resolve-alias', 'reinforcement-learning'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.query, 'reinforcement-learning');
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].slug, 'reinforcement-learning');
      assert.equal(json.matches[0].source, 'slug');
      assert.equal(json.ambiguous, false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('title match — query equals frontmatter title (case-insensitive), no aliases field', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'rl-foundation', 'Reinforcement Learning', null);
      const r = runWiki(['resolve-alias', 'Reinforcement Learning'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].slug, 'rl-foundation');
      assert.equal(json.matches[0].source, 'title');
      assert.equal(json.ambiguous, false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('alias match — query found in aliases array', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'reinforcement-learning-from-human-feedback', 'Reinforcement Learning from Human Feedback', ['RLHF', 'RL from HF']);
      const r = runWiki(['resolve-alias', 'RLHF'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].slug, 'reinforcement-learning-from-human-feedback');
      assert.equal(json.matches[0].source, 'alias');
      assert.equal(json.ambiguous, false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('case-insensitive — query "rlhf" matches alias "RLHF"', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'rlhf-foundation', 'RLHF Full Name', ['RLHF']);
      const r = runWiki(['resolve-alias', 'rlhf'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].source, 'alias');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('whitespace-trimmed — query "  RLHF  " matches alias "RLHF"', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'rlhf-ws', 'RLHF Trimmed', ['RLHF']);
      const r = runWiki(['resolve-alias', '  RLHF  '], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].source, 'alias');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('no match — exits 2 and stderr includes query', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'some-foundation', 'Some Foundation', null);
      const r = runWiki(['resolve-alias', 'totally-unknown-query'], { cwd: tmp });
      assert.equal(r.status, 2);
      assert.ok(r.stderr.includes('totally-unknown-query'), `stderr should include query, got: ${r.stderr}`);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('ambiguous — two foundations share the same alias, exit 0, ambiguous true, sorted by slug', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      await makeFoundation(tmp, 'alpha-foundation', 'Alpha', ['common']);
      await makeFoundation(tmp, 'beta-foundation', 'Beta', ['common']);
      const r = runWiki(['resolve-alias', 'common'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.ambiguous, true);
      assert.equal(json.matches.length, 2);
      // Sorted ascending by slug
      assert.equal(json.matches[0].slug, 'alpha-foundation');
      assert.equal(json.matches[1].slug, 'beta-foundation');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('non-foundations excluded — concept with matching title is not returned', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      // Create a concept file with the same title as our query
      const conceptsDir = join(tmp, 'wiki', 'concepts');
      await mkdir(conceptsDir, { recursive: true });
      await writeFile(
        join(conceptsDir, 'rlhf-concept.md'),
        `---\nid: rlhf-concept\ntitle: RLHF\ntype: concept\ncreated: 2024-01-01\nupdated: 2024-01-01\nkey_sources: []\nrelated_concepts: []\n---\n`,
        'utf8',
      );
      const r = runWiki(['resolve-alias', 'RLHF'], { cwd: tmp });
      // No foundations exist with that query — should be no match
      assert.equal(r.status, 2, `expected no-match exit 2, got stdout: ${r.stdout}`);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('defensive: malformed aliases field (string instead of array) does not crash', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      // Write a foundation where aliases is a plain string (not an array)
      const foundationsDir = join(tmp, 'wiki', 'foundations');
      await mkdir(foundationsDir, { recursive: true });
      await writeFile(
        join(foundationsDir, 'malformed-aliases.md'),
        `---\nid: malformed-aliases\ntitle: Malformed Aliases\ntype: foundation\ncreated: 2024-01-01\nupdated: 2024-01-01\naliases: not-an-array\n---\n\nBody.\n`,
        'utf8',
      );
      // Query that won't match slug or title — should get no-match exit 2 without crashing
      const r = runWiki(['resolve-alias', 'not-an-array'], { cwd: tmp });
      // The aliases field is a string, not an array, so it is skipped.
      // The query "not-an-array" happens to match the slug here:
      assert.ok(r.status === 0 || r.status === 2, `exit code should be 0 or 2, got: ${r.status} stderr: ${r.stderr}`);
      // More importantly: no crash (status should not be 3)
      assert.notEqual(r.status, 3, `unexpected internal error: ${r.stderr}`);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('defensive: aliases array with non-string entries — only string entries matched', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      const foundationsDir = join(tmp, 'wiki', 'foundations');
      await mkdir(foundationsDir, { recursive: true });
      // Write YAML with a mixed alias list: [123, "valid-alias"]
      await writeFile(
        join(foundationsDir, 'mixed-aliases.md'),
        `---\nid: mixed-aliases\ntitle: Mixed Aliases\ntype: foundation\ncreated: 2024-01-01\nupdated: 2024-01-01\naliases:\n  - 123\n  - valid-alias\n---\n\nBody.\n`,
        'utf8',
      );
      // "valid-alias" should match
      const r = runWiki(['resolve-alias', 'valid-alias'], { cwd: tmp });
      assert.equal(r.status, 0, `unexpected failure: ${r.stderr}`);
      const json = parseJson(r.stdout);
      assert.equal(json.matches.length, 1);
      assert.equal(json.matches[0].source, 'alias');
      // Should not crash on numeric alias entry
      assert.notEqual(r.status, 3, `unexpected internal error: ${r.stderr}`);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('empty text — exits 2', async () => {
    const tmp = await makeTmp();
    try {
      initWorkspace(tmp, ['--pack', 'research']);
      const r = runWiki(['resolve-alias', ''], { cwd: tmp });
      assert.equal(r.status, 2);
    } finally {
      await cleanTmp(tmp);
    }
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
