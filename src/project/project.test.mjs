import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { contentHash } from './lib/hash.mjs';
import { loadConfig, ontologyVersion } from './lib/config.mjs';
import { makeFact } from './lib/fact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_MJS = join(HERE, 'project.mjs');
const FIXTURES = join(HERE, 'test-fixtures');
const PARSE_PILOT = join(FIXTURES, 'parse-pilot');

function run(cwd, args) {
  const result = spawnSync(process.execPath, [PROJECT_MJS, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

// ---------------------------------------------------------------------------
// build/status test helpers. `parse-pilot` is checked in read-only (same
// convention as scope.test.mjs's `SCOPE_BASIC`): every test that writes
// `_lumina/facts/` works on a throwaway `mkdtemp` copy, never the fixture
// itself.
// ---------------------------------------------------------------------------

async function copyParsePilot() {
  const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-build-'));
  await cp(PARSE_PILOT, dir, { recursive: true });
  return dir;
}

async function writeFactsEnvelope(root, docPath, envelope) {
  const dest = join(root, '_lumina', 'facts', `${docPath}.json`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(envelope));
}

async function currentOntologyVersion(root) {
  return ontologyVersion(await loadConfig(root));
}

async function hashOfFile(root, docPath) {
  return contentHash(await readFile(join(root, docPath)));
}

/** sha256 over every file's (relative path, bytes) under `root`, sorted -- a whole-tree fingerprint. */
async function hashTree(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(rel);
      else files.push(rel);
    }
  }
  await walk('');
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update(await readFile(join(root, f)));
  }
  return hash.digest('hex');
}

describe('bad arguments / unknown subcommand -> exit 1', () => {
  test('no subcommand', () => {
    const { status } = run(join(FIXTURES, 'scope-basic'), []);
    assert.equal(status, 1);
  });

  test('unknown subcommand', () => {
    const { status, stderr } = run(join(FIXTURES, 'scope-basic'), ['bogus']);
    assert.equal(status, 1);
    assert.match(stderr, /"code":1/);
  });

  test('extra arguments', () => {
    const { status } = run(join(FIXTURES, 'scope-basic'), ['scope', 'extra']);
    assert.equal(status, 1);
  });
});

describe('no project root -> exit 2', () => {
  test('cwd with no ancestor holding _lumina/config/project.yaml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-no-root-'));
    try {
      const { status, stderr } = run(dir, ['scope']);
      assert.equal(status, 2);
      assert.match(stderr, /"code":2/);
      assert.match(stderr, /no project root/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('scope', () => {
  const EXPECTED_FILES = [
    'docs/adr/0001-init.md',
    'docs/readme.md',
    'docs/user-guide/intro.md',
  ];

  test('happy path from the fixture root', () => {
    const { status, stdout } = run(join(FIXTURES, 'scope-basic'), ['scope']);
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(stdout), { files: EXPECTED_FILES, warnings: [] });
  });

  test('same output when run from a subdirectory', () => {
    const fromRoot = run(join(FIXTURES, 'scope-basic'), ['scope']);
    const fromSubdir = run(join(FIXTURES, 'scope-basic', 'docs', 'adr'), ['scope']);
    assert.equal(fromSubdir.status, 0);
    assert.equal(fromSubdir.stdout, fromRoot.stdout);
  });

  test('running twice produces byte-identical stdout', () => {
    const first = run(join(FIXTURES, 'scope-basic'), ['scope']);
    const second = run(join(FIXTURES, 'scope-basic'), ['scope']);
    assert.equal(first.stdout, second.stdout);
  });

  test('invalid config makes scope exit 2 with errors, same as config-check', () => {
    const { status, stderr } = run(join(FIXTURES, 'config-invalid'), ['scope']);
    assert.equal(status, 2);
    const parsed = JSON.parse(stderr);
    assert.equal(parsed.code, 2);
    assert.ok(Array.isArray(parsed.errors) && parsed.errors.length > 0);
  });

  test('an include pattern matching zero files produces a P16 warning with exit 0', () => {
    const { status, stdout } = run(join(FIXTURES, 'config-p16-warning'), ['scope']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed.warnings, [
      { rule: 'P16', pattern: 'nope', message: 'include pattern matches no files: nope' },
    ]);
  });

  test('newer schemaVersion makes scope exit 3', () => {
    const { status, stderr } = run(join(FIXTURES, 'config-newer-schema'), ['scope']);
    assert.equal(status, 3);
    assert.match(stderr, /"code":3/);
  });
});

describe('config-check', () => {
  test('ok shape on a valid config', () => {
    const { status, stdout } = run(join(FIXTURES, 'config-valid'), ['config-check']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.schemaVersion, 1);
    assert.match(parsed.ontologyVersion, /^[0-9a-f]{64}$/);
  });

  test('invalid config exits 2 with an errors array on stderr', () => {
    const { status, stderr } = run(join(FIXTURES, 'config-invalid'), ['config-check']);
    assert.equal(status, 2);
    const parsed = JSON.parse(stderr);
    assert.equal(parsed.code, 2);
    assert.ok(Array.isArray(parsed.errors) && parsed.errors.length > 0);
  });

  test('newer schemaVersion exits 3', () => {
    const { status, stderr } = run(join(FIXTURES, 'config-newer-schema'), ['config-check']);
    assert.equal(status, 3);
    assert.match(stderr, /"code":3/);
  });

  test('YAML syntax error exits 2 with the parser message', () => {
    const { status, stderr } = run(join(FIXTURES, 'config-yaml-error'), ['config-check']);
    assert.equal(status, 2);
    const parsed = JSON.parse(stderr);
    assert.equal(parsed.code, 2);
    assert.match(parsed.error, /YAML syntax error/);
  });
});

describe('build', () => {
  test('running twice produces byte-identical stdout', () => {
    const first = run(PARSE_PILOT, ['build']);
    const second = run(PARSE_PILOT, ['build']);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, second.stdout);
  });

  test('build and status touch no file under the fixture tree', async () => {
    const before = await hashTree(PARSE_PILOT);
    const build = run(PARSE_PILOT, ['build']);
    const status = run(PARSE_PILOT, ['status']);
    assert.equal(build.status, 0);
    assert.equal(status.status, 0);
    const after = await hashTree(PARSE_PILOT);
    assert.equal(after, before);
  });

  test('every in-scope doc is a doc: node, sorted; no findings shape surprises', () => {
    const { status, stdout } = run(PARSE_PILOT, ['build']);
    assert.equal(status, 0);
    const graph = JSON.parse(stdout);
    assert.deepEqual(Object.keys(graph), ['nodes', 'edges', 'findings']);
    const docNodes = graph.nodes.filter((n) => n.kind === 'doc' && n.inScope);
    assert.ok(docNodes.some((n) => n.id === 'doc:docs/adr/0009-partial.md'));
    const ids = graph.nodes.map((n) => n.id);
    assert.deepEqual(ids, [...ids].sort());
  });

  test('an agent attr fact setting document-level status fires P18', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const fact = makeFact({
        kind: 'attr',
        subject: `doc:${docPath}`,
        relation: 'status',
        value: 'superseded',
        ref: 'agent note',
        evidence: { line: 10, quote: '**Accepted** - 2026-01-01' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      const { status, stdout } = run(root, ['build']);
      assert.equal(status, 0);
      const graph = JSON.parse(stdout);
      const p18 = graph.findings.find((f) => f.id === 'P18');
      assert.ok(p18, 'expected a P18 finding');
      assert.equal(p18.file, docPath);
      // The document's own status still comes from the parse, unaffected.
      const node = graph.nodes.find((n) => n.id === `doc:${docPath}`);
      assert.equal(node.status, 'accepted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('status', () => {
  test('every doc is never-ingested when there is no _lumina/facts', () => {
    const { status, stdout } = run(PARSE_PILOT, ['status']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.summary.fresh, 0);
    assert.equal(result.summary.changed, 0);
    assert.equal(result.summary.stale, 0);
    assert.ok(result.summary.neverIngested > 0);
    assert.ok(result.docs.every((d) => d.state === 'never-ingested'));
    assert.equal(result.summary.neverIngested, result.docs.length);
  });

  test('fresh: hash matches sourceHash, quote and ref both still check out', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: 'docs/adr/0009-partial.md',
        ref: 'docs/adr/0009-partial.md',
        evidence: { line: 12, quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'fresh');
      assert.equal(result.summary.fresh, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('changed: hash differs after an edit, but the quoted line and reference survive', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath); // hash of the ORIGINAL content
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: 'docs/adr/0009-partial.md',
        ref: 'docs/adr/0009-partial.md',
        evidence: { line: 12, quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      // Edit the doc, keeping the quoted line and the referenced doc intact.
      const filePath = join(root, docPath);
      const original = await readFile(filePath, 'utf8');
      await writeFile(filePath, `${original}\nA new trailing paragraph.\n`);

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'changed');
      assert.equal(result.summary.changed, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('stale: ontologyVersion no longer matches', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: 'not-the-current-version', facts: [],
      });

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'stale');
      assert.equal(result.summary.stale, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('stale: the evidence quote is gone from the doc', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath); // hash of the ORIGINAL content
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: 'docs/adr/0009-partial.md',
        ref: 'docs/adr/0009-partial.md',
        evidence: { line: 12, quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      // Remove the quoted line entirely.
      const filePath = join(root, docPath);
      const edited = (await readFile(filePath, 'utf8')).replace('Supersedes ADR-0009 in part.\n', '');
      await writeFile(filePath, edited);

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'stale');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a malformed fact file is stale', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const dest = join(root, '_lumina', 'facts', `${docPath}.json`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, '{ not json');

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'stale');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('stale: the quote is still present but the referenced target doc was deleted', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: 'docs/adr/0009-partial.md',
        ref: 'docs/adr/0009-partial.md',
        evidence: { line: 12, quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      // The quote itself is untouched -- only the cited doc disappears.
      await rm(join(root, 'docs/adr/0009-partial.md'));

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'stale');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('stale: an undeclared ID-shaped agent object no longer resolves', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: 'ADR-9999', // matches the ADR idPattern but no doc declares it
        ref: 'ADR-9999',
        evidence: { line: 10, quote: '**Accepted** - 2026-01-01' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'stale');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a self-loop fact does not make the doc stale', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const fact = makeFact({
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'related',
        object: `doc:${docPath}`, // cites itself
        ref: docPath,
        evidence: { line: 10, quote: '**Accepted** - 2026-01-01' },
        provenance: 'inferred',
      });
      await writeFactsEnvelope(root, docPath, {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [fact],
      });

      const { status, stdout } = run(root, ['status']);
      assert.equal(status, 0);
      const result = JSON.parse(stdout);
      const entry = result.docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'fresh');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a case-fold collision makes build/status exit 2 with the colliding pair (real fs)', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-collision-'));
    try {
      await mkdir(join(dir, '_lumina', 'config'), { recursive: true });
      await writeFile(join(dir, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\nsources:\n  include: [docs]\n');
      await mkdir(join(dir, 'docs'), { recursive: true });
      await writeFile(join(dir, 'docs', 'A.md'), '# A\n');
      await writeFile(join(dir, 'docs', 'a.md'), '# a\n');
      const entries = await readdir(join(dir, 'docs'));
      if (entries.length < 2) {
        t.skip('filesystem is case-insensitive; cannot hold both docs/A.md and docs/a.md');
        return;
      }

      for (const subcommand of ['build', 'status']) {
        const { status, stderr } = run(dir, [subcommand]);
        assert.equal(status, 2);
        const parsed = JSON.parse(stderr);
        assert.equal(parsed.code, 2);
        assert.ok(Array.isArray(parsed.pairs) && parsed.pairs.length === 1);
        assert.equal(parsed.error.startsWith('internal error:'), false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
