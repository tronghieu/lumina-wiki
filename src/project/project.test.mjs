import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { contentHash } from './lib/hash.mjs';
import { loadConfig, ontologyVersion } from './lib/config.mjs';
import { makeFact } from './lib/fact.mjs';
import { readStdinText } from './project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_MJS = join(HERE, 'project.mjs');
const FIXTURES = join(HERE, 'test-fixtures');
const PARSE_PILOT = join(FIXTURES, 'parse-pilot');

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
