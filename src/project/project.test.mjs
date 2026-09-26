import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm, utimes, chmod, realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { contentHash } from './lib/hash.mjs';
import { loadConfig, ontologyVersion } from './lib/config.mjs';
import { makeFact } from './lib/fact.mjs';
import { RULES } from './ontology.mjs';
import { readStdinText } from './project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_MJS = join(HERE, 'project.mjs');
const FIXTURES = join(HERE, 'test-fixtures');
const PARSE_PILOT = join(FIXTURES, 'parse-pilot');
const LINT_BASIC = join(FIXTURES, 'lint-basic');

function run(cwd, args, { input, env } = {}) {
  const result = spawnSync(process.execPath, [PROJECT_MJS, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runFactsWrite(cwd, input, env) {
  return run(cwd, ['facts-write'], { input: JSON.stringify(input), env });
}

/** Async, concurrent-friendly `facts-write` -- `runFactsWrite` above uses `spawnSync`, which blocks and can't run several at once. */
function spawnFactsWrite(cwd, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PROJECT_MJS, 'facts-write'], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(JSON.stringify(input));
  });
}

function factFilePath(root, source) {
  return join(root, '_lumina', 'facts', `${source}.json`);
}

async function readFactFile(root, source) {
  return JSON.parse(await readFile(factFilePath(root, source), 'utf8'));
}

async function factFileExists(root, source) {
  try {
    await readFile(factFilePath(root, source));
    return true;
  } catch {
    return false;
  }
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

describe('readStdinText', () => {
  test('a TTY stream is rejected (exit code 1), not read', async () => {
    await assert.rejects(readStdinText({ isTTY: true }), (err) => {
      assert.equal(err.projectExitCode, 1);
      assert.match(err.message, /TTY/);
      return true;
    });
  });
});

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
      // An attr fact has no reference to resolve: the doc stays fresh.
      const entry = JSON.parse(run(root, ['status']).stdout).docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'fresh');
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

  test('each doc carries its metaType, and type only when the doc resolved to a config type', () => {
    const { status, stdout } = run(PARSE_PILOT, ['status']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    const typed = result.docs.find((d) => d.path === 'docs/adr/0009-partial.md');
    assert.equal(typed.type, 'ADR');
    assert.equal(typed.metaType, 'Decision');
    const untyped = result.docs.find((d) => d.path === 'docs/misc/unmapped.md');
    assert.equal(untyped.metaType, 'Document');
    assert.equal(Object.hasOwn(untyped, 'type'), false);
  });

  test('every doc carries its current content hash', async () => {
    const { status, stdout } = run(PARSE_PILOT, ['status']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.ok(result.docs.length > 0);
    for (const entry of result.docs) {
      assert.match(entry.hash, /^[0-9a-f]{64}$/);
    }
    const entry = result.docs.find((d) => d.path === 'docs/adr/0052-new.md');
    assert.equal(entry.hash, await hashOfFile(PARSE_PILOT, 'docs/adr/0052-new.md'));
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
        object: 'doc:docs/adr/0009-partial.md', // canonicalized, as facts-write stores it
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

  test('an unprefixed agent object that never resolved (undeclared ADR-9999) does not make the doc stale', async () => {
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
      // Kept as written because it never resolved, so it can't have stopped resolving (CAP-8/AD-12).
      assert.equal(entry.state, 'fresh');
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

  test('a fact file whose name differs from its doc only by case (case-only rename) still backs that doc: fresh', async () => {
    const root = await copyParsePilot();
    try {
      const ver = await currentOntologyVersion(root);
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      await writeFactsEnvelope(root, 'docs/adr/0052-New.md', {
        schemaVersion: 1, source: docPath, sourceHash, ontologyVersion: ver, facts: [],
      });
      const entry = JSON.parse(run(root, ['status']).stdout).docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'fresh');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a case-fold collision makes build/status/config-check exit 2 with the colliding pair (real fs)', async (t) => {
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

      for (const subcommand of ['build', 'status', 'config-check']) {
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

describe('facts-write', () => {
  test('happy path: an ADR-0052 supersedes fact on ADR-0009 -- build has the edge, status is fresh', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const input = {
        source: docPath,
        sourceHash,
        facts: [{
          kind: 'edge',
          subject: `doc:${docPath}`,
          relation: 'supersedes',
          object: 'ADR-0009',
          scope: 'row: Retry policy',
          evidence: { quote: 'Supersedes ADR-0009' },
          provenance: 'extracted',
        }],
      };
      const write = runFactsWrite(root, input);
      assert.equal(write.status, 0);
      const writeResult = JSON.parse(write.stdout);
      assert.equal(writeResult.ok, true);
      assert.equal(writeResult.source, docPath);
      assert.equal(writeResult.facts, 1);

      const envelope = await readFactFile(root, docPath);
      assert.deepEqual(Object.keys(envelope), ['schemaVersion', 'source', 'sourceHash', 'ontologyVersion', 'facts']);
      assert.equal(envelope.facts[0].object, 'doc:docs/adr/0009-partial.md');
      assert.equal(envelope.facts[0].ref, 'ADR-0009');
      assert.equal(envelope.facts[0].provenance, 'extracted');

      const build = run(root, ['build']);
      assert.equal(build.status, 0);
      const graph = JSON.parse(build.stdout);
      const edge = graph.edges.find((e) => e.relation === 'supersedes' && e.from === `doc:${docPath}` && e.to === 'doc:docs/adr/0009-partial.md');
      assert.ok(edge, 'expected the supersedes edge in the graph');
      assert.ok(edge.evidence.some((e) => e.provenance === 'extracted'));

      const status = run(root, ['status']);
      const statusResult = JSON.parse(status.stdout);
      assert.equal(statusResult.docs.find((d) => d.path === docPath).state, 'fresh');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('acceptance: an unquoted edit -> changed; deleting the quoted sentence -> stale + verify-evidence P14', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const input = {
        source: docPath,
        sourceHash,
        facts: [{
          kind: 'edge',
          subject: `doc:${docPath}`,
          relation: 'supersedes',
          object: 'ADR-0009',
          evidence: { quote: 'Supersedes ADR-0009' },
          provenance: 'extracted',
        }],
      };
      assert.equal(runFactsWrite(root, input).status, 0);

      const filePath = join(root, docPath);
      const original = await readFile(filePath, 'utf8');
      await writeFile(filePath, `${original}\nAn unrelated trailing paragraph.\n`);

      const afterEdit = JSON.parse(run(root, ['status']).stdout);
      assert.equal(afterEdit.docs.find((d) => d.path === docPath).state, 'changed');

      const edited = (await readFile(filePath, 'utf8')).replace(/Supersedes ADR-0009 in part\.\n/, '');
      await writeFile(filePath, edited);

      const afterDelete = JSON.parse(run(root, ['status']).stdout);
      assert.equal(afterDelete.docs.find((d) => d.path === docPath).state, 'stale');

      const verify = run(root, ['verify-evidence']);
      assert.equal(verify.status, 0);
      const { findings } = JSON.parse(verify.stdout);
      assert.ok(findings.some((f) => f.id === 'P14' && f.file === docPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('deterministic: the same facts, in either input order, produce a byte-identical file', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0009-partial.md';
      const sourceHash = await hashOfFile(root, docPath);
      const factA = {
        kind: 'edge', subject: `doc:${docPath}`, relation: 'references', object: 'FR-102',
        evidence: { quote: 'FR-102' }, provenance: 'extracted',
      };
      const factB = {
        kind: 'edge', subject: `doc:${docPath}`, relation: 'mentions', object: 'concept:credit-limit',
        evidence: { quote: 'credit limit' }, provenance: 'extracted',
      };
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [factA, factB] }).status, 0);
      const first = await readFile(factFilePath(root, docPath), 'utf8');
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [factB, factA] }).status, 0);
      const second = await readFile(factFilePath(root, docPath), 'utf8');
      assert.equal(first, second);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('empty facts[] writes an envelope and moves the doc from never-ingested to fresh', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0011-inline-status.md';
      const sourceHash = await hashOfFile(root, docPath);
      const before = JSON.parse(run(root, ['status']).stdout);
      assert.equal(before.docs.find((d) => d.path === docPath).state, 'never-ingested');

      const write = runFactsWrite(root, { source: docPath, sourceHash, facts: [] });
      assert.equal(write.status, 0);
      assert.equal(JSON.parse(write.stdout).facts, 0);

      const after = JSON.parse(run(root, ['status']).stdout);
      assert.equal(after.docs.find((d) => d.path === docPath).state, 'fresh');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('hash mismatch: nothing written, exit 1', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const write = runFactsWrite(root, { source: docPath, sourceHash: 'not-the-real-hash', facts: [] });
      assert.equal(write.status, 1);
      assert.match(write.stderr, /re-read the doc/);
      assert.equal(await factFileExists(root, docPath), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad fact (quote not in source): nothing written, every bad index listed, exit 1', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const write = runFactsWrite(root, {
        source: docPath,
        sourceHash,
        facts: [
          { kind: 'edge', subject: `doc:${docPath}`, relation: 'references', object: 'ADR-0009', evidence: { quote: 'nowhere in the doc' }, provenance: 'extracted' },
          { kind: 'edge', subject: `doc:${docPath}`, relation: 'references', object: 'ADR-0009', evidence: { quote: 'also nowhere' }, provenance: 'extracted' },
        ],
      });
      assert.equal(write.status, 1);
      const err = JSON.parse(write.stderr);
      assert.equal(err.code, 1);
      assert.deepEqual(err.errors.map((e) => e.index), [0, 1]);
      assert.equal(await factFileExists(root, docPath), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('dangling written ref (object ADR-9999) is accepted as written, exit 0', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const write = runFactsWrite(root, {
        source: docPath,
        sourceHash,
        facts: [{
          kind: 'edge', subject: `doc:${docPath}`, relation: 'references', object: 'ADR-9999',
          evidence: { quote: 'Supersedes ADR-0009' }, provenance: 'extracted',
        }],
      });
      assert.equal(write.status, 0);
      const envelope = await readFactFile(root, docPath);
      assert.equal(envelope.facts[0].object, 'ADR-9999');

      const build = run(root, ['build']);
      const graph = JSON.parse(build.stdout);
      assert.ok(graph.findings.some((f) => f.id === 'P09' && f.file === docPath));

      // Never resolved, so never "no longer resolves": fresh, no P13; the P09 stays.
      const entry = JSON.parse(run(root, ['status']).stdout).docs.find((d) => d.path === docPath);
      assert.equal(entry.state, 'fresh');
      const lint = JSON.parse(run(root, ['lint']).stdout);
      assert.ok(lint.findings.some((f) => f.id === 'P09' && f.file === docPath));
      assert.ok(!lint.findings.some((f) => f.id === 'P13' && f.file === docPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad source: unsafe path exits 2, nothing written', async () => {
    const root = await copyParsePilot();
    try {
      const write = runFactsWrite(root, { source: '../escape.md', sourceHash: 'x', facts: [] });
      assert.equal(write.status, 2);
      assert.equal(JSON.parse(write.stderr).code, 2);
      // No source resolves to a sensible fact-file path here (it's unsafe by
      // construction) -- assert the write created no `_lumina/facts/` at all.
      await assert.rejects(readdir(join(root, '_lumina', 'facts')), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad source: not in scope exits 2, nothing written', async () => {
    const root = await copyParsePilot();
    try {
      const write = runFactsWrite(root, { source: 'docs/does-not-exist.md', sourceHash: 'x', facts: [] });
      assert.equal(write.status, 2);
      const err = JSON.parse(write.stderr);
      assert.equal(err.code, 2);
      assert.match(err.error, /not in scope/);
      assert.equal(await factFileExists(root, 'docs/does-not-exist.md'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad stdin: not JSON exits 1', async () => {
    const root = await copyParsePilot();
    try {
      const { status, stderr } = run(root, ['facts-write'], { input: 'not json at all' });
      assert.equal(status, 1);
      assert.equal(JSON.parse(stderr).code, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad stdin: missing required fields exits 1', async () => {
    const root = await copyParsePilot();
    try {
      const { status, stderr } = run(root, ['facts-write'], { input: JSON.stringify({ source: 'x' }) });
      assert.equal(status, 1);
      assert.equal(JSON.parse(stderr).code, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('extra CLI arguments exit 1 with the bad-arguments message, not stdin validation', async () => {
    const root = await copyParsePilot();
    try {
      // A fully valid payload, so the only possible reason for exit 1 is the
      // extra-argument gate in `main()`, never stdin/shape validation.
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const { status, stderr } = run(root, ['facts-write', 'extra'], {
        input: JSON.stringify({ source: docPath, sourceHash, facts: [] }),
      });
      assert.equal(status, 1);
      assert.match(JSON.parse(stderr).error, /unknown subcommand or bad arguments/);
      assert.equal(await factFileExists(root, docPath), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('newer schemaVersion in an existing fact file: untouched, exit 3', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const existing = {
        schemaVersion: 999, source: docPath, sourceHash: 'irrelevant', ontologyVersion: 'irrelevant', facts: [],
      };
      await writeFactsEnvelope(root, docPath, existing);

      const write = runFactsWrite(root, { source: docPath, sourceHash, facts: [] });
      assert.equal(write.status, 3);
      assert.equal(JSON.parse(write.stderr).code, 3);
      assert.deepEqual(await readFactFile(root, docPath), existing);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('lock: a fresh, held lock makes facts-write exit 3 (shortened timeout) and leaves the fact file unchanged', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const lockPath = join(root, '_lumina', '_state', 'lock');
      await mkdir(dirname(lockPath), { recursive: true });
      await writeFile(lockPath, 'held-by-another-process');

      const write = runFactsWrite(
        root,
        { source: docPath, sourceHash, facts: [] },
        { LUMINA_PROJECT_LOCK_TIMEOUT_MS: '150', LUMINA_PROJECT_LOCK_STALE_MS: '60000' },
      );
      assert.equal(write.status, 3);
      assert.equal(JSON.parse(write.stderr).code, 3);
      assert.equal(await factFileExists(root, docPath), false);
      // The (still-live) lock itself is left in place, not deleted by the timed-out caller.
      assert.equal(await readFile(lockPath, 'utf8'), 'held-by-another-process');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('lock: a lock older than the (shortened) stale threshold is taken over and the write succeeds', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const lockPath = join(root, '_lumina', '_state', 'lock');
      await mkdir(dirname(lockPath), { recursive: true });
      await writeFile(lockPath, 'stale-leftover');
      const longAgo = new Date(Date.now() - 60000);
      await utimes(lockPath, longAgo, longAgo);

      const write = runFactsWrite(
        root,
        { source: docPath, sourceHash, facts: [] },
        { LUMINA_PROJECT_LOCK_STALE_MS: '1000', LUMINA_PROJECT_LOCK_TIMEOUT_MS: '500' },
      );
      assert.equal(write.status, 0);
      assert.equal(await factFileExists(root, docPath), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('lock: the doc changing while facts-write waits for the lock is caught by the re-hash under it (exit 1, nothing written)', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const lockPath = join(root, '_lumina', '_state', 'lock');
      await mkdir(dirname(lockPath), { recursive: true });
      await writeFile(lockPath, 'held-by-another-process');

      const child = spawn(process.execPath, [PROJECT_MJS, 'facts-write'], {
        cwd: root,
        env: { ...process.env, LUMINA_PROJECT_LOCK_TIMEOUT_MS: '30000', LUMINA_PROJECT_LOCK_STALE_MS: '60000' },
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const exited = new Promise((resolve) => { child.on('close', resolve); });
      child.stdin.end(JSON.stringify({ source: docPath, sourceHash, facts: [] }));

      // Long enough to pass the pre-lock hash check and start waiting on the lock.
      await new Promise((resolve) => { setTimeout(resolve, 1500); });
      const filePath = join(root, docPath);
      await writeFile(filePath, `${await readFile(filePath, 'utf8')}\nEdited while facts-write waited.\n`);
      await rm(lockPath);

      assert.equal(await exited, 1);
      assert.match(stderr, /sourceHash does not match/);
      assert.equal(await factFileExists(root, docPath), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// facts-write concurrency (AD-23's lock): 20 distinct docs, 20 concurrent
// writers -- proves the lock serializes them into the same end state a
// sequential run would reach, and that it's released afterward.
// ---------------------------------------------------------------------------

const STRESS_DOC_COUNT = 20;

/** A fresh temp project with `STRESS_DOC_COUNT` in-scope docs, each with one quotable line. */
async function makeStressFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-stress-'));
  await mkdir(join(dir, '_lumina', 'config'), { recursive: true });
  await writeFile(join(dir, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');
  await mkdir(join(dir, 'docs'), { recursive: true });
  for (let i = 0; i < STRESS_DOC_COUNT; i += 1) {
    await writeFile(join(dir, 'docs', `doc-${String(i).padStart(2, '0')}.md`), `# Doc ${i}\n\nStress line ${i}.\n`);
  }
  return dir;
}

function stressInputs(root) {
  return Promise.all(Array.from({ length: STRESS_DOC_COUNT }, async (_, i) => {
    const docPath = `docs/doc-${String(i).padStart(2, '0')}.md`;
    return {
      source: docPath,
      sourceHash: await hashOfFile(root, docPath),
      facts: [{
        kind: 'attr',
        subject: `doc:${docPath}`,
        relation: 'status',
        value: 'accepted',
        ref: 'stress test',
        evidence: { quote: `Stress line ${i}.` },
        provenance: 'extracted',
      }],
    };
  }));
}

describe('facts-write concurrency', () => {
  test('20 concurrent writers, one per doc, converge to the same build as a sequential run, and release the lock', async () => {
    const concurrentRoot = await makeStressFixture();
    const sequentialRoot = await makeStressFixture();
    try {
      const inputs = await stressInputs(concurrentRoot); // same generated content in both roots -> same hashes/quotes apply to either

      const results = await Promise.all(inputs.map((input) => spawnFactsWrite(concurrentRoot, input)));
      for (const r of results) assert.equal(r.status, 0, r.stderr);

      for (const input of inputs) {
        assert.equal(runFactsWrite(sequentialRoot, input).status, 0);
      }

      const concurrentBuild = run(concurrentRoot, ['build']);
      const sequentialBuild = run(sequentialRoot, ['build']);
      assert.equal(concurrentBuild.status, 0);
      assert.equal(sequentialBuild.status, 0);
      assert.equal(concurrentBuild.stdout, sequentialBuild.stdout);

      await assert.rejects(readFile(join(concurrentRoot, '_lumina', '_state', 'lock')), { code: 'ENOENT' });
    } finally {
      await rm(concurrentRoot, { recursive: true, force: true });
      await rm(sequentialRoot, { recursive: true, force: true });
    }
  });
});

describe('verify-evidence', () => {
  test('exits 0 with no findings when nothing is committed', async () => {
    const root = await copyParsePilot();
    try {
      const { status, stdout } = run(root, ['verify-evidence']);
      assert.equal(status, 0);
      assert.deepEqual(JSON.parse(stdout), { findings: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a broken quote is reported as P14 and the subcommand still exits 0', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, {
        source: docPath,
        sourceHash,
        facts: [{
          kind: 'edge', subject: `doc:${docPath}`, relation: 'references', object: 'ADR-0009',
          evidence: { quote: 'Supersedes ADR-0009 in part.' }, provenance: 'extracted',
        }],
      }).status, 0);

      const filePath = join(root, docPath);
      const edited = (await readFile(filePath, 'utf8')).replace('Supersedes ADR-0009 in part.\n', '');
      await writeFile(filePath, edited);

      const { status, stdout } = run(root, ['verify-evidence']);
      assert.equal(status, 0);
      const { findings } = JSON.parse(stdout);
      assert.ok(findings.some((f) => f.id === 'P14' && f.file === docPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a malformed fact file is reported as one P14', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const dest = join(root, '_lumina', 'facts', `${docPath}.json`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, '{ not json');

      const { status, stdout } = run(root, ['verify-evidence']);
      assert.equal(status, 0);
      const { findings } = JSON.parse(stdout);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].id, 'P14');
      assert.equal(findings[0].file, docPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('an orphan fact file whose sourceHash matches a renamed in-scope doc is a P15 rename candidate', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);

      const renamedPath = 'docs/adr/0052-renamed.md';
      await cp(join(root, docPath), join(root, renamedPath));
      await rm(join(root, docPath));

      const { status, stdout } = run(root, ['verify-evidence']);
      assert.equal(status, 0);
      const { findings } = JSON.parse(stdout);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].id, 'P15');
      assert.equal(findings[0].file, renamedPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('lint', () => {
  test('output shape: schemaVersion, checks_run in RULES order, a P04 warning, no errors', () => {
    const { status, stdout } = run(LINT_BASIC, ['lint']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.deepEqual(Object.keys(result), ['schemaVersion', 'checks_run', 'findings', 'summary']);
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.checks_run, RULES.map((r) => r.id));
    assert.deepEqual(Object.keys(result.summary), ['errors', 'warnings', 'infos']);
    assert.equal(result.summary.errors, 0);
    assert.ok(result.summary.warnings >= 1);
    assert.ok(result.findings.some((f) => f.id === 'P04' && f.severity === 'warning'));
  });

  test('fail-on: warnings only -> exit 0 by default, exit 1 with --fail-on warning', () => {
    const byDefault = run(LINT_BASIC, ['lint']);
    assert.equal(byDefault.status, 0);
    const explicitError = run(LINT_BASIC, ['lint', '--fail-on', 'error']);
    assert.equal(explicitError.status, 0);
    const failOnWarning = run(LINT_BASIC, ['lint', '--fail-on', 'warning']);
    assert.equal(failOnWarning.status, 1);
    // The JSON is still printed even when the fail-on threshold is reached.
    assert.deepEqual(JSON.parse(failOnWarning.stdout), JSON.parse(byDefault.stdout));
  });

  test('bad args: --fail-on info exits 1 with nothing on stdout', () => {
    const { status, stdout, stderr } = run(LINT_BASIC, ['lint', '--fail-on', 'info']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  });

  test('bad args: an unknown flag exits 1 with nothing on stdout', () => {
    const { status, stdout, stderr } = run(LINT_BASIC, ['lint', '--bogus']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  });

  test('bad args: an extra positional argument exits 1 with nothing on stdout', () => {
    const { status, stdout, stderr } = run(LINT_BASIC, ['lint', 'extra']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  });

  test('bad args: a bad flag with no project root still exits 1, not 2 (flags parse before the root lookup)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-lint-no-root-'));
    try {
      const { status, stdout, stderr } = run(dir, ['lint', '--bogus']);
      assert.equal(status, 1);
      assert.equal(stdout, '');
      assert.equal(JSON.parse(stderr).code, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('P16: an include pattern matching zero files is folded in at _lumina/config/project.yaml:1', () => {
    const { status, stdout } = run(join(FIXTURES, 'config-p16-warning'), ['lint']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    const p16 = result.findings.filter((f) => f.id === 'P16');
    assert.equal(p16.length, 1);
    assert.equal(p16[0].file, '_lumina/config/project.yaml');
    assert.equal(p16[0].line, 1);
    assert.equal(p16[0].severity, 'warning');
  });

  test('running twice produces byte-identical stdout', () => {
    const first = run(LINT_BASIC, ['lint']);
    const second = run(LINT_BASIC, ['lint']);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, second.stdout);
  });

  test('determinism: a fixture with a relation-rule finding (P08 contradicts) still lints byte-identical across two runs', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      const write = runFactsWrite(root, {
        source: docPath,
        sourceHash,
        facts: [{
          kind: 'edge',
          subject: `doc:${docPath}`,
          relation: 'contradicts',
          object: 'ADR-0009',
          evidence: { quote: 'Supersedes ADR-0009 in part.' },
          provenance: 'extracted',
        }],
      });
      assert.equal(write.status, 0);

      const first = run(root, ['lint']);
      const second = run(root, ['lint']);
      assert.equal(first.status, 0);
      assert.ok(JSON.parse(first.stdout).findings.some((f) => f.id === 'P08'), 'expected the P08 relation-rule finding');
      assert.equal(first.stdout, second.stdout);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('lint touches no file under the fixture tree', async () => {
    const before = await hashTree(LINT_BASIC);
    run(LINT_BASIC, ['lint']);
    const after = await hashTree(LINT_BASIC);
    assert.equal(after, before);
  });

  test('parse-pilot: the dec-a/dec-b/dec-c mutual supersession gives no spurious P03', () => {
    const { status, stdout } = run(PARSE_PILOT, ['lint']);
    assert.equal(status, 0);
    const { findings } = JSON.parse(stdout);
    assert.equal(findings.filter((f) => f.id === 'P03').length, 0);
  });

  test('P03: a scoped supersedes citer is flagged at its own line; a scope-less citer of the same target is not', async () => {
    const root = await copyParsePilot();
    try {
      const superseder = 'docs/adr/0052-new.md';
      const scope = 'row: Retry policy';
      assert.equal(runFactsWrite(root, {
        source: superseder,
        sourceHash: await hashOfFile(root, superseder),
        facts: [{
          kind: 'edge',
          subject: `doc:${superseder}`,
          relation: 'supersedes',
          object: 'ADR-0009',
          scope,
          evidence: { quote: 'Supersedes ADR-0009 in part.' },
          provenance: 'extracted',
        }],
      }).status, 0);

      const citer = 'docs/adr/0011-inline-status.md';
      assert.equal(runFactsWrite(root, {
        source: citer,
        sourceHash: await hashOfFile(root, citer),
        facts: [{
          kind: 'edge',
          subject: `doc:${citer}`,
          relation: 'references',
          object: 'ADR-0009',
          scope,
          evidence: { quote: 'Some rationale text.' },
          provenance: 'extracted',
        }],
      }).status, 0);

      const scopeless = 'docs/misc/unmapped.md';
      assert.equal(runFactsWrite(root, {
        source: scopeless,
        sourceHash: await hashOfFile(root, scopeless),
        facts: [{
          kind: 'edge',
          subject: `doc:${scopeless}`,
          relation: 'references',
          object: 'ADR-0009',
          evidence: { quote: 'Some content, no special mentions.' },
          provenance: 'extracted',
        }],
      }).status, 0);

      const { status, stdout } = run(root, ['lint']);
      assert.equal(status, 0);
      const { findings } = JSON.parse(stdout);
      const p03 = findings.filter((f) => f.id === 'P03');
      assert.equal(p03.length, 1);
      assert.equal(p03[0].file, citer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('P14 (error) + P13 (stale, at file:1) fold in; default --fail-on exits 1 on the P14 error', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      assert.equal(runFactsWrite(root, {
        source: docPath,
        sourceHash: await hashOfFile(root, docPath),
        facts: [{
          kind: 'edge',
          subject: `doc:${docPath}`,
          relation: 'references',
          object: 'ADR-0009',
          evidence: { quote: 'Supersedes ADR-0009 in part.' },
          provenance: 'extracted',
        }],
      }).status, 0);

      const filePath = join(root, docPath);
      const edited = (await readFile(filePath, 'utf8')).replace('Supersedes ADR-0009 in part.\n', '');
      await writeFile(filePath, edited);

      const { status, stdout } = run(root, ['lint']);
      assert.equal(status, 1);
      const result = JSON.parse(stdout);
      assert.ok(result.summary.errors >= 1);

      const p14 = result.findings.find((f) => f.id === 'P14' && f.file === docPath);
      assert.ok(p14, 'expected a P14 finding for the broken quote');
      assert.equal(p14.severity, 'error');

      const p13 = result.findings.find((f) => f.id === 'P13' && f.file === docPath);
      assert.ok(p13, 'expected a P13 finding for the now-stale doc');
      assert.equal(p13.line, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a doc excluded from scope but still on disk: P14 at warning, its facts feed no edge, default lint exits 0', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      assert.equal(runFactsWrite(root, {
        source: docPath,
        sourceHash: await hashOfFile(root, docPath),
        facts: [{
          kind: 'edge', subject: `doc:${docPath}`, relation: 'depends-on', object: 'id:ADR-9999',
          evidence: { quote: 'Supersedes ADR-0009 in part.' }, provenance: 'extracted',
        }],
      }).status, 0);
      const configPath = join(root, '_lumina', 'config', 'project.yaml');
      const yaml = await readFile(configPath, 'utf8');
      await writeFile(configPath, yaml.replace('exclude: []', `exclude: ["${docPath}"]`));

      const { status, stdout } = run(root, ['lint']);
      assert.equal(status, 0);
      const p14 = JSON.parse(stdout).findings.filter((f) => f.id === 'P14');
      assert.equal(p14.length, 1);
      assert.equal(p14[0].file, docPath);
      assert.equal(p14[0].severity, 'warning');
      assert.match(p14[0].message, /out of scope/);

      const graph = JSON.parse(run(root, ['build']).stdout);
      assert.ok(!graph.edges.some((e) => e.from === `doc:${docPath}`), 'an out-of-scope envelope must not feed edges');
      assert.ok(!graph.nodes.some((n) => n.id === 'id:ADR-9999'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('query', () => {
  // Every test below runs on its own throwaway mkdtemp copy of `parse-pilot`
  // (never the fixture itself), same convention as `facts-write`/`lint`.
  async function withParsePilotCopy(fn) {
    const root = await copyParsePilot();
    try {
      await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  /** The 1-based `line` of `file` under `root`, read straight off disk -- for checking a citation's quote against the real file, not against the engine's own idea of it. */
  async function fileLineAt(root, file, line) {
    const text = await readFile(join(root, file), 'utf8');
    return text.split(/\r\n|\r|\n/)[line - 1] ?? '';
  }

  function assertWellFormedAt(at) {
    assert.ok(at.file.length > 0, 'at.file must not be empty');
    assert.ok(Number.isInteger(at.line) && at.line >= 1, 'at.line must be a positive integer');
    assert.ok(at.quote.length > 0, 'at.quote must not be empty');
  }

  function assertWellFormedEvidence(evidence) {
    for (const ev of evidence) {
      assert.deepEqual(Object.keys(ev), ['file', 'line', 'quote']);
      assert.ok(ev.file.length > 0);
      assert.ok(Number.isInteger(ev.line) && ev.line >= 1);
      assert.ok(ev.quote.length > 0);
    }
  }

  test('node: resolves by declared ID; response has {schemaVersion, op, node, out, in, freshness}; a pristine copy has every doc never-ingested', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'node', 'ADR-0009']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.deepEqual(Object.keys(result), ['schemaVersion', 'op', 'node', 'out', 'in', 'freshness']);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.op, 'node');
    assert.equal(result.node.id, 'doc:docs/adr/0009-partial.md');
    assert.equal(result.node.metaType, 'Decision');
    assert.equal(result.node.status, 'partially-superseded');
    assert.deepEqual(result.freshness, {
      stale: 0, changed: 0, neverIngested: 11, staleDocs: [],
    });
  }));

  test('node: a bare repo-relative path resolves to its doc: node', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'node', 'docs/adr/0052-new.md']);
    assert.equal(status, 0);
    assert.equal(JSON.parse(stdout).node.id, 'doc:docs/adr/0052-new.md');
  }));

  test('node: a concept name resolves to the concept node; every mentions edge cites a real file:line', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'node', 'credit limit']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.node.id, 'concept:credit-limit');
    assert.ok(result.in.length > 0);
    for (const edge of result.in) {
      assert.equal(edge.relation, 'mentions');
      assertWellFormedEvidence(edge.evidence);
      for (const ev of edge.evidence) {
        const actualLine = await fileLineAt(root, ev.file, ev.line);
        assert.ok(actualLine.includes(ev.quote), `expected ${JSON.stringify(actualLine)} to include ${JSON.stringify(ev.quote)}`);
      }
    }
  }));

  test('node: an alias resolves to the same concept node as its name', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'node', 'hạn mức']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.node.id, 'concept:credit-limit');
    assert.ok(result.in.length > 0);
    for (const edge of result.in) {
      for (const ev of edge.evidence) {
        const actualLine = await fileLineAt(root, ev.file, ev.line);
        assert.ok(actualLine.includes(ev.quote));
      }
    }
  }));

  test('node: an unknown ref exits 2 with nothing on stdout', () => withParsePilotCopy(async (root) => {
    const { status, stdout, stderr } = run(root, ['query', 'node', 'NOPE-1']);
    assert.equal(status, 2);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 2);
  }));

  test('list: --meta-type + --status, sorted by id, non-empty', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'list', '--meta-type', 'Decision', '--status', 'accepted']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.op, 'list');
    assert.ok(result.items.length > 0);
    assert.deepEqual(
      result.items.map((i) => i.id),
      [...result.items.map((i) => i.id)].sort(),
    );
    for (const item of result.items) {
      assert.equal(item.status, 'accepted');
      assertWellFormedAt(item.at);
    }
  }));

  test('list: bad --meta-type exits 1 with nothing on stdout', () => withParsePilotCopy(async (root) => {
    const { status, stdout, stderr } = run(root, ['query', 'list', '--meta-type', 'Foo']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  }));

  test('list: missing --meta-type exits 1', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'list']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
  }));

  test('list: an empty --status exits 1', () => withParsePilotCopy(async (root) => {
    const { status, stdout, stderr } = run(root, ['query', 'list', '--meta-type', 'Decision', '--status', '']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  }));

  test('list: an extra positional argument exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'list', '--meta-type', 'Decision', 'extra']);
    assert.equal(status, 1);
  }));

  test('neighbors: --direction + --relation, each item {relation, node, evidence}, non-empty', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query', 'neighbors', 'ADR-0009', '--direction', 'in', '--relation', 'mentions']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.op, 'neighbors');
    assert.ok(result.items.length > 0);
    for (const item of result.items) {
      assert.deepEqual(Object.keys(item), ['relation', 'node', 'evidence']);
      assert.equal(item.relation, 'mentions');
      assertWellFormedAt(item.node.at);
      assertWellFormedEvidence(item.evidence);
    }
  }));

  test('neighbors: a fact committed via facts-write (supersedes) is a non-empty result', () => withParsePilotCopy(async (root) => {
    const docPath = 'docs/adr/0052-new.md';
    const write = runFactsWrite(root, {
      source: docPath,
      sourceHash: await hashOfFile(root, docPath),
      facts: [{
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'supersedes',
        object: 'ADR-0009',
        evidence: { quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'extracted',
      }],
    });
    assert.equal(write.status, 0);

    const { status, stdout } = run(root, ['query', 'neighbors', 'ADR-0009', '--direction', 'in', '--relation', 'supersedes']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.ok(result.items.length > 0);
    assert.ok(result.items.some((i) => i.node.id === `doc:${docPath}`));
  }));

  test('neighbors: an unknown ref exits 2 with nothing on stdout', () => withParsePilotCopy(async (root) => {
    const { status, stdout, stderr } = run(root, ['query', 'neighbors', 'NOPE-1', '--direction', 'in']);
    assert.equal(status, 2);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 2);
  }));

  test('neighbors: missing --direction exits 1', () => withParsePilotCopy(async (root) => {
    const { status, stdout, stderr } = run(root, ['query', 'neighbors', 'ADR-0009']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  }));

  test('neighbors: invalid --direction exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'neighbors', 'ADR-0009', '--direction', 'sideways']);
    assert.equal(status, 1);
  }));

  test('neighbors: --relation not in META_RELATIONS exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'neighbors', 'ADR-0009', '--direction', 'in', '--relation', 'bogus']);
    assert.equal(status, 1);
  }));

  test('neighbors: missing <ref> exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'neighbors', '--direction', 'in']);
    assert.equal(status, 1);
  }));

  test('neighbors: an extra positional argument exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'neighbors', 'ADR-0009', 'extra', '--direction', 'in']);
    assert.equal(status, 1);
  }));

  test('bad op: missing op exits 1', () => withParsePilotCopy(async (root) => {
    const { status, stdout } = run(root, ['query']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
  }));

  test('bad op: unknown op exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'bogus']);
    assert.equal(status, 1);
  }));

  test('bad op: node with a missing ref exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'node']);
    assert.equal(status, 1);
  }));

  test('bad op: node with an extra positional exits 1', () => withParsePilotCopy(async (root) => {
    const { status } = run(root, ['query', 'node', 'ADR-0009', 'extra']);
    assert.equal(status, 1);
  }));

  test('a bad flag with no project root still exits 1, not 2 (flags parse before the root lookup)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumina-project-cli-query-no-root-'));
    try {
      const { status, stdout, stderr } = run(dir, ['query', 'list', '--meta-type', 'Bogus']);
      assert.equal(status, 1);
      assert.equal(stdout, '');
      assert.equal(JSON.parse(stderr).code, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('running twice produces byte-identical stdout', () => withParsePilotCopy(async (root) => {
    const first = run(root, ['query', 'node', 'ADR-0009']);
    const second = run(root, ['query', 'node', 'ADR-0009']);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, second.stdout);
  }));

  test('query touches no file under the fixture tree (node, list, neighbors)', () => withParsePilotCopy(async (root) => {
    const before = await hashTree(root);
    run(root, ['query', 'node', 'ADR-0009']);
    run(root, ['query', 'list', '--meta-type', 'Decision']);
    run(root, ['query', 'neighbors', 'ADR-0009', '--direction', 'in']);
    const after = await hashTree(root);
    assert.equal(after, before);
  }));

  test('stale: a committed fact whose quoted sentence was deleted from its doc names that doc in freshness.staleDocs; list still reflects the current (live-parsed) doc', () => withParsePilotCopy(async (root) => {
    const docPath = 'docs/adr/0052-new.md';
    assert.equal(runFactsWrite(root, {
      source: docPath,
      sourceHash: await hashOfFile(root, docPath),
      facts: [{
        kind: 'edge',
        subject: `doc:${docPath}`,
        relation: 'references',
        object: 'ADR-0009',
        evidence: { quote: 'Supersedes ADR-0009 in part.' },
        provenance: 'extracted',
      }],
    }).status, 0);

    const filePath = join(root, docPath);
    const edited = (await readFile(filePath, 'utf8')).replace('Supersedes ADR-0009 in part.\n', '');
    await writeFile(filePath, edited);

    const { status, stdout } = run(root, ['query', 'node', 'ADR-0009']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.freshness.staleDocs, [docPath]);
    assert.equal(result.freshness.stale, 1);

    // `list` is computed live off the current file too: the doc is still
    // correctly parsed and returned (metaType/status unaffected by the
    // edit), even though the committed fact for it is stale -- CAP-8's
    // "results still reflect the current text".
    const list = JSON.parse(run(root, ['query', 'list', '--meta-type', 'Decision', '--status', 'accepted']).stdout);
    const item = list.items.find((i) => i.id === `doc:${docPath}`);
    assert.ok(item, 'expected the edited doc to still be listed, parsed live');
    assert.equal(item.status, 'accepted');
  }));

  test('CAP-10 chain: list --meta-type Decision --status superseded, then neighbors <it> --direction out --relation governs', () => withParsePilotCopy(async (root) => {
    // parse-pilot's config already has `relatedRules: [{source: Capability,
    // target: Decision, relation: governs, inverse: true}]` (ontology.md's
    // own example) -- it just has no `Capability` project type yet.
    const configPath = join(root, '_lumina', 'config', 'project.yaml');
    const config = await readFile(configPath, 'utf8');
    await writeFile(configPath, config.replace(
      'types:\n',
      'types:\n  Capability:\n    metaType: Capability\n    frontmatter: { type: capability }\n',
    ));

    await writeFile(join(root, 'docs', 'adr', '9001-test-superseded.md'), [
      '---',
      'id: ADR-9001',
      'type: adr',
      'status: superseded',
      '---',
      '# ADR-9001: Test Decision',
      '',
      'Superseded for testing.',
      '',
    ].join('\n'));
    await mkdir(join(root, 'docs', 'capabilities'), { recursive: true });
    await writeFile(join(root, 'docs', 'capabilities', 'test-capability.md'), [
      '---',
      'type: capability',
      'related: ADR-9001',
      '---',
      '# Test Capability',
      '',
    ].join('\n'));

    const list = JSON.parse(run(root, ['query', 'list', '--meta-type', 'Decision', '--status', 'superseded']).stdout);
    assert.ok(list.items.length > 0);
    const decision = list.items.find((i) => i.id === 'doc:docs/adr/9001-test-superseded.md');
    assert.ok(decision, 'expected the new superseded Decision in the list');
    assertWellFormedAt(decision.at);

    const neighbors = JSON.parse(run(root, ['query', 'neighbors', decision.id, '--direction', 'out', '--relation', 'governs']).stdout);
    assert.ok(neighbors.items.length > 0);
    const capability = neighbors.items.find((i) => i.node.id === 'doc:docs/capabilities/test-capability.md');
    assert.ok(capability, 'expected the Decision to govern the Capability (Capability.related -> Decision, inverse)');
    assertWellFormedAt(capability.node.at);
    assertWellFormedEvidence(capability.evidence);
  }));

  // `query resolve <citing-doc> <object>`: what facts-write would do with `object`.
  const CITING = 'docs/adr/0009-partial.md';
  function resolveOut(root, object) {
    const { status, stdout, stderr } = run(root, ['query', 'resolve', CITING, object]);
    assert.equal(status, 0, stderr);
    return JSON.parse(stdout);
  }

  test('resolve: a doc-relative path from the citing doc resolves to its in-scope doc', () => withParsePilotCopy(async (root) => {
    assert.deepEqual(resolveOut(root, '0052-new.md'), {
      ok: true, from: CITING, object: '0052-new.md', resolution: 'resolved', target: 'doc:docs/adr/0052-new.md', inScope: true,
    });
  }));

  test('resolve: an unlinked, out-of-scope file on disk resolves with inScope false', () => withParsePilotCopy(async (root) => {
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(join(root, 'notes', 'outside.md'), '# Outside\n');
    assert.deepEqual(resolveOut(root, 'notes/outside.md'), {
      ok: true, from: CITING, object: 'notes/outside.md', resolution: 'resolved', target: 'doc:notes/outside.md', inScope: false,
    });
  }));

  test('resolve: a configured concept nothing mentions still resolves', () => withParsePilotCopy(async (root) => {
    const configPath = join(root, '_lumina', 'config', 'project.yaml');
    const yaml = await readFile(configPath, 'utf8');
    await writeFile(configPath, yaml.replace('  - { name: credit limit, aliases: [hạn mức] }', '  - { name: credit limit, aliases: [hạn mức] }\n  - { name: ledger freeze }'));
    assert.deepEqual(resolveOut(root, 'ledger freeze'), {
      ok: true, from: CITING, object: 'ledger freeze', resolution: 'resolved', target: 'concept:ledger-freeze',
    });
  }));

  test('resolve: an undeclared ID (only an id: placeholder) is dangling', () => withParsePilotCopy(async (root) => {
    assert.deepEqual(resolveOut(root, 'ADR-9999'), {
      ok: true, from: CITING, object: 'ADR-9999', resolution: 'dangling',
    });
  }));

  test('resolve: an anchor the in-scope target lacks, or a prefixed id that does not resolve, is rejected with facts-write\'s reason', () => withParsePilotCopy(async (root) => {
    const anchor = resolveOut(root, '0052-new.md#gone');
    assert.equal(anchor.resolution, 'rejected');
    assert.match(anchor.error, /names an anchor the target doc does not have/);
    assert.ok(!Object.hasOwn(anchor, 'target'));
    const prefixed = resolveOut(root, 'doc:docs/nope.md');
    assert.equal(prefixed.resolution, 'rejected');
    assert.match(prefixed.error, /does not resolve/);
  }));

  test('resolve: bad args exit 1; a citing doc not in scope or an unsafe path exits 2; nothing on stdout', () => withParsePilotCopy(async (root) => {
    for (const [args, code] of [
      [['query', 'resolve', CITING], 1],
      [['query', 'resolve', CITING, ''], 1],
      [['query', 'resolve', CITING, 'a', 'b'], 1],
      [['query', 'resolve', 'docs/nope.md', 'ADR-0009'], 2],
      [['query', 'resolve', '../outside.md', 'ADR-0009'], 2],
    ]) {
      const { status, stdout, stderr } = run(root, args);
      assert.equal(status, code, `expected exit ${code} for ${JSON.stringify(args)}`);
      assert.equal(stdout, '');
      assert.equal(JSON.parse(stderr).code, code);
    }
  }));
});

// ---------------------------------------------------------------------------
// view (CAP-12, AD-16): writes `_lumina/graph/view.html`. Matrix rows: Happy,
// Deterministic, No network, Empty graph, Bad args, Cold start.
// ---------------------------------------------------------------------------

describe('view', () => {
  async function viewHtmlPath(root) {
    return join(root, '_lumina', 'graph', 'view.html');
  }

  /** Parses the JSON assigned to `window.__LUMINA_VIEW_DATA__` back out of a rendered page. */
  function extractViewData(html) {
    const marker = 'window.__LUMINA_VIEW_DATA__ = ';
    const start = html.indexOf(marker);
    assert.ok(start !== -1, 'expected the inlined window.__LUMINA_VIEW_DATA__ assignment');
    const jsonStart = start + marker.length;
    const end = html.indexOf(';\n', jsonStart);
    assert.ok(end !== -1, 'expected the assignment to end with ";\\n"');
    return JSON.parse(html.slice(jsonStart, end));
  }

  test('happy: writes _lumina/graph/view.html and prints {ok, file} (exit 0)', async () => {
    const root = await copyParsePilot();
    try {
      const { status, stdout } = run(root, ['view']);
      assert.equal(status, 0);
      const out = JSON.parse(stdout);
      assert.deepEqual({ ok: out.ok, file: out.file }, { ok: true, file: '_lumina/graph/view.html' });
      assert.deepEqual(Object.keys(out).sort(), ['file', 'ok', 'url']);
      // Compare by realpath: Windows may report the temp root as an 8.3 short name.
      assert.equal(await realpath(fileURLToPath(out.url)), await realpath(await viewHtmlPath(root)));
      const html = await readFile(await viewHtmlPath(root), 'utf8');
      assert.match(html, /<!doctype html>/i);
      const vendorSrc = await readFile(join(HERE, 'vendor', 'force-graph.min.js'), 'utf8');
      assert.ok(html.includes(vendorSrc), 'the vendored force-graph bundle is inlined verbatim');
      // Data stays repo-relative (spec): the absolute local path used to run
      // this test must never leak into the page.
      assert.ok(!html.includes(root), 'the absolute local root must not appear in the page');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('the inlined data: a known frag/concept node carries its resolved metaType and at {file, line, quote}', async () => {
    const root = await copyParsePilot();
    try {
      const { status } = run(root, ['view']);
      assert.equal(status, 0);
      const html = await readFile(await viewHtmlPath(root), 'utf8');
      const data = extractViewData(html);
      const byId = new Map(data.nodes.map((n) => [n.id, n]));

      // frag: a heading (parse-pilot's 0009-partial.md links to
      // "0052-new.md#status") that `buildGraph` resolved to a fragment node.
      const frag = byId.get('frag:docs/adr/0052-new.md#status');
      assert.ok(frag, 'expected the frag node in the inlined data');
      assert.equal(frag.metaType, 'Decision');
      assert.deepEqual(frag.at, { file: 'docs/adr/0052-new.md', line: 8, quote: 'Status' });

      // concept: parse-pilot's vocabulary carries "credit limit" (aliased "hạn mức").
      const concept = byId.get('concept:credit-limit');
      assert.ok(concept, 'expected the concept node in the inlined data');
      assert.equal(concept.metaType, 'Concept');
      assert.deepEqual(concept.at, { file: 'docs/adr/0009-partial.md', line: 14, quote: 'credit limit' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('the inlined findings deep-equal lint\'s findings, and freshness docs match status\'s docs, on the same root', async () => {
    const root = await copyParsePilot();
    try {
      const { status } = run(root, ['view']);
      assert.equal(status, 0);
      const html = await readFile(await viewHtmlPath(root), 'utf8');
      const data = extractViewData(html);

      const lintOut = JSON.parse(run(root, ['lint']).stdout);
      assert.deepEqual(data.findings, lintOut.findings);

      const statusOut = JSON.parse(run(root, ['status']).stdout);
      assert.deepEqual(data.freshness.docs, statusOut.docs);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('injection: a heading holding </script><script>alert(1)</script> and U+2028 yields exactly one inlined data block and no raw payload', async () => {
    const root = await copyParsePilot();
    try {
      const nasty = '# Nasty </script><script>alert(1)</script> heading\n\nBody text.\n';
      await writeFile(join(root, 'docs', 'misc', 'nasty-heading.md'), nasty);

      const { status } = run(root, ['view']);
      assert.equal(status, 0);
      const html = await readFile(await viewHtmlPath(root), 'utf8');

      assert.ok(!html.includes('</script><script>alert'), 'the raw injection payload must not survive unescaped');
      assert.ok(!html.includes(' '), 'U+2028 must not appear raw');
      const dataBlocks = html.match(/window\.__LUMINA_VIEW_DATA__ = /g) ?? [];
      assert.equal(dataBlocks.length, 1, 'exactly one inlined data block');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('view touches no file besides _lumina/graph/view.html', async () => {
    const root = await copyParsePilot();
    try {
      const before = await hashTree(root);
      const { status } = run(root, ['view']);
      assert.equal(status, 0);
      // hashTree fingerprints the whole tree; delete the one new file before
      // re-hashing so the comparison isolates "nothing else changed".
      await rm(await viewHtmlPath(root));
      const after = await hashTree(root);
      assert.equal(after, before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('deterministic: running view twice produces byte-identical file content', async () => {
    const root = await copyParsePilot();
    try {
      run(root, ['view']);
      const first = await readFile(await viewHtmlPath(root), 'utf8');
      run(root, ['view']);
      const second = await readFile(await viewHtmlPath(root), 'utf8');
      assert.equal(first, second);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('no network: no src=/href= to http(s), and the CSP meta is present', async () => {
    const root = await copyParsePilot();
    try {
      run(root, ['view']);
      const html = await readFile(await viewHtmlPath(root), 'utf8');
      assert.ok(!/\b(?:src|href)\s*=\s*["']https?:/i.test(html));
      assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('parse-pilot: the generated file is under 400 KB', async () => {
    const root = await copyParsePilot();
    try {
      run(root, ['view']);
      const html = await readFile(await viewHtmlPath(root));
      assert.ok(html.length < 400 * 1024, `expected under 400KB, got ${html.length} bytes`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad args: "view extra" and "view --x" exit 1 and write nothing', async () => {
    const root = await copyParsePilot();
    try {
      for (const args of [['view', 'extra'], ['view', '--x']]) {
        const { status } = run(root, args);
        assert.equal(status, 1);
      }
      await assert.rejects(readFile(await viewHtmlPath(root)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('empty graph: zero in-scope docs still exits 0 with a valid, empty-graph page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumina-project-cli-view-empty-'));
    try {
      await mkdir(join(root, '_lumina', 'config'), { recursive: true });
      await writeFile(
        join(root, '_lumina', 'config', 'project.yaml'),
        'schemaVersion: 1\nsources:\n  include: ["docs-that-do-not-exist"]\n',
      );
      const { status, stdout } = run(root, ['view']);
      assert.equal(status, 0);
      const out = JSON.parse(stdout);
      assert.deepEqual({ ok: out.ok, file: out.file }, { ok: true, file: '_lumina/graph/view.html' });
      assert.deepEqual(Object.keys(out).sort(), ['file', 'ok', 'url']);
      // Compare by realpath: Windows may report the temp root as an 8.3 short name.
      assert.equal(await realpath(fileURLToPath(out.url)), await realpath(await viewHtmlPath(root)));
      const html = await readFile(await viewHtmlPath(root), 'utf8');
      assert.match(html, /<!doctype html>/i);
      assert.ok(html.includes('No in-scope documents'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('cold start: ./lib/view.mjs is only ever dynamic-imported, never a static import', async () => {
    const src = await readFile(PROJECT_MJS, 'utf8');
    const staticImportRe = /^import\s+.*from\s+['"]\.\/lib\/view\.mjs['"];?\s*$/m;
    assert.ok(!staticImportRe.test(src), 'expected no static "import ... from \'./lib/view.mjs\'" line');
    assert.match(src, /await import\(\s*['"]\.\/lib\/view\.mjs['"]\s*\)/, 'expected the lazy import inside runView');
  });
});

describe('facts-prune', () => {
  /** The steady-state shape for a run that removes/keeps nothing extra: `skipped`/`failed`/`warnings` are all empty on parse-pilot (no scope warnings). */
  function pruneResult(overrides) {
    return {
      ok: true, dryRun: false, removed: [], kept: [], skipped: [], failed: [], warnings: [], ...overrides,
    };
  }

  test('doc deleted: removed lists the fact file, the file (and its now-empty directories) are gone, and lint/verify-evidence show no P14 for it, but _lumina/facts/ itself survives', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);
      assert.ok(await factFileExists(root, docPath));

      await rm(join(root, docPath));

      const { status, stdout } = run(root, ['facts-prune']);
      assert.equal(status, 0);
      assert.deepEqual(JSON.parse(stdout), pruneResult({ removed: [`_lumina/facts/${docPath}.json`] }));
      assert.ok(!(await factFileExists(root, docPath)));
      // The rule also removes any directory under _lumina/facts/ left empty
      // by the delete -- here, both docs/adr/ and docs/ under it -- but
      // never _lumina/facts/ itself, even though it's now empty too.
      await assert.rejects(readdir(join(root, '_lumina', 'facts', 'docs', 'adr')));
      await assert.rejects(readdir(join(root, '_lumina', 'facts', 'docs')));
      await assert.doesNotReject(readdir(join(root, '_lumina', 'facts')));

      const lint = run(root, ['lint']);
      assert.equal(lint.status, 0);
      assert.ok(!JSON.parse(lint.stdout).findings.some((f) => f.id === 'P14' && f.file === docPath));

      const verify = run(root, ['verify-evidence']);
      assert.equal(verify.status, 0);
      assert.deepEqual(JSON.parse(verify.stdout).findings, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rename: the old fact file is kept as a rename candidate, nothing removed', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);

      const renamedPath = 'docs/adr/0052-renamed.md';
      await cp(join(root, docPath), join(root, renamedPath));
      await rm(join(root, docPath));

      const { status, stdout } = run(root, ['facts-prune']);
      assert.equal(status, 0);
      assert.deepEqual(JSON.parse(stdout), pruneResult({
        kept: [{ file: `_lumina/facts/${docPath}.json`, reason: 'rename-candidate', candidate: renamedPath }],
      }));
      assert.ok(await factFileExists(root, docPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rename after re-ingest: the old fact file is removed once the new path has its own committed envelope', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);

      const renamedPath = 'docs/adr/0052-renamed.md';
      await cp(join(root, docPath), join(root, renamedPath));
      await rm(join(root, docPath));
      assert.equal(runFactsWrite(root, { source: renamedPath, sourceHash, facts: [] }).status, 0);

      const { status, stdout } = run(root, ['facts-prune']);
      assert.equal(status, 0);
      assert.deepEqual(JSON.parse(stdout), pruneResult({ removed: [`_lumina/facts/${docPath}.json`] }));
      assert.ok(!(await factFileExists(root, docPath)));
      assert.ok(await factFileExists(root, renamedPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('dry run: same lists, nothing changed on disk', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);
      await rm(join(root, docPath));

      const dry = run(root, ['facts-prune', '--dry-run']);
      assert.equal(dry.status, 0);
      const dryResult = JSON.parse(dry.stdout);
      assert.deepEqual(dryResult, pruneResult({ dryRun: true, removed: [`_lumina/facts/${docPath}.json`] }));
      assert.ok(await factFileExists(root, docPath));

      const real = run(root, ['facts-prune']);
      const realResult = JSON.parse(real.stdout);
      assert.deepEqual(realResult.removed, dryResult.removed);
      assert.deepEqual(realResult.kept, dryResult.kept);
      assert.ok(!(await factFileExists(root, docPath)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('bad flag: --force exits 1 with nothing on stdout, nothing removed', () => {
    const { status, stdout, stderr } = run(join(FIXTURES, 'scope-basic'), ['facts-prune', '--force']);
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).code, 1);
  });

  test('out of scope but still on disk: kept, not removed (a scope edit or typo must not lose paid-for facts)', async () => {
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/misc/unmapped.md';
      const sourceHash = await hashOfFile(root, docPath);
      assert.equal(runFactsWrite(root, { source: docPath, sourceHash, facts: [] }).status, 0);

      const configPath = join(root, '_lumina', 'config', 'project.yaml');
      const yaml = await readFile(configPath, 'utf8');
      assert.match(yaml, /exclude: \[\]/);
      await writeFile(configPath, yaml.replace('exclude: []', `exclude: ["${docPath}"]`));

      const { status, stdout } = run(root, ['facts-prune']);
      assert.equal(status, 0);
      assert.deepEqual(JSON.parse(stdout), pruneResult({
        kept: [{ file: `_lumina/facts/${docPath}.json`, reason: 'out-of-scope' }],
      }));
      assert.ok(await factFileExists(root, docPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a sibling fact file in the same directory keeps its directory', async () => {
    const root = await copyParsePilot();
    try {
      const gone = 'docs/adr/0052-new.md';
      const sibling = 'docs/adr/0009-partial.md';
      assert.equal(runFactsWrite(root, {
        source: gone, sourceHash: await hashOfFile(root, gone), facts: [],
      }).status, 0);
      assert.equal(runFactsWrite(root, {
        source: sibling, sourceHash: await hashOfFile(root, sibling), facts: [],
      }).status, 0);

      await rm(join(root, gone));

      const { status } = run(root, ['facts-prune']);
      assert.equal(status, 0);
      assert.ok(!(await factFileExists(root, gone)));
      assert.ok(await factFileExists(root, sibling));
      const adrDir = await readdir(join(root, '_lumina', 'facts', 'docs', 'adr'));
      assert.deepEqual(adrDir, ['0009-partial.md.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('positionals: only the approved, still-removable files are deleted; a stale approval is skipped', async () => {
    const root = await copyParsePilot();
    try {
      const docA = 'docs/adr/0009-partial.md';
      const docB = 'docs/adr/0011-inline-status.md';
      assert.equal(runFactsWrite(root, {
        source: docA, sourceHash: await hashOfFile(root, docA), facts: [],
      }).status, 0);
      assert.equal(runFactsWrite(root, {
        source: docB, sourceHash: await hashOfFile(root, docB), facts: [],
      }).status, 0);

      const bytesA = await readFile(join(root, docA));
      await rm(join(root, docA));
      await rm(join(root, docB));

      const dry = run(root, ['facts-prune', '--dry-run']);
      const dryResult = JSON.parse(dry.stdout);
      assert.deepEqual([...dryResult.removed].sort(), [
        `_lumina/facts/${docA}.json`, `_lumina/facts/${docB}.json`,
      ].sort());

      // Doc A comes back before the real (approved) run -- its approval is stale.
      await writeFile(join(root, docA), bytesA);

      const real = run(root, ['facts-prune', ...dryResult.removed]);
      assert.equal(real.status, 0);
      const result = JSON.parse(real.stdout);
      assert.deepEqual(result.removed, [`_lumina/facts/${docB}.json`]);
      assert.deepEqual(result.skipped, [{ file: `_lumina/facts/${docA}.json`, reason: 'not-removable' }]);
      assert.ok(await factFileExists(root, docA)); // untouched, not deleted
      assert.ok(!(await factFileExists(root, docB)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('an invalid positional: outside _lumina/facts/ exits 1; a path-traversal segment exits 2 (AD-14 path safety)', async () => {
    const root = await copyParsePilot();
    try {
      for (const [bad, code] of [
        ['docs/adr/0052-new.md', 1], ['_lumina/facts/../../etc/passwd', 2], ['_lumina/config/project.yaml', 1],
      ]) {
        const { status, stdout, stderr } = run(root, ['facts-prune', bad]);
        assert.equal(status, code, `expected exit ${code} for ${bad}`);
        assert.equal(stdout, '');
        assert.equal(JSON.parse(stderr).code, code);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a failed unlink is recorded in failed and the run exits 3', async (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.skip('running as root bypasses directory permission bits');
      return;
    }
    if (process.platform === 'win32') {
      t.skip('chmod cannot reliably block unlink via POSIX mode bits on Windows');
      return;
    }
    const root = await copyParsePilot();
    try {
      const docPath = 'docs/adr/0052-new.md';
      assert.equal(runFactsWrite(root, {
        source: docPath, sourceHash: await hashOfFile(root, docPath), facts: [],
      }).status, 0);
      await rm(join(root, docPath));

      // 0o500 (r-x, no write): readdir/classification still sees the file
      // (needs only read+execute), but unlink on it fails with EACCES
      // (needs write on the containing directory too). 0o000 would also
      // block readdir, which loadFacts treats as an empty directory --
      // hiding the file from classification entirely, never reaching unlink.
      const parentDir = join(root, '_lumina', 'facts', 'docs', 'adr');
      await chmod(parentDir, 0o500);
      try {
        const { status, stdout } = run(root, ['facts-prune']);
        assert.equal(status, 3);
        const result = JSON.parse(stdout);
        assert.deepEqual(result.removed, []);
        assert.equal(result.failed.length, 1);
        assert.equal(result.failed[0].file, `_lumina/facts/${docPath}.json`);
        assert.match(result.failed[0].error, /EACCES|EPERM/);
      } finally {
        await chmod(parentDir, 0o755);
      }
      assert.ok(await factFileExists(root, docPath)); // still there -- the unlink never succeeded
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
