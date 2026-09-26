import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_MJS = join(HERE, 'project.mjs');
const FIXTURES = join(HERE, 'test-fixtures');

function run(cwd, args) {
  const result = spawnSync(process.execPath, [PROJECT_MJS, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
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
