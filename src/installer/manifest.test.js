/**
 * Tests for src/installer/manifest.js
 *
 * Uses node:test + node:assert.
 * Each test creates its own isolated tmp directory.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readManifest,
  writeManifest,
  readSkillsManifest,
  writeSkillsManifest,
  readFilesManifest,
  writeFilesManifest,
  MANIFEST_SCHEMA_VERSION,
  SKILLS_CSV_HEADER,
  FILES_CSV_HEADER,
  statePaths,
  migrateManifest,
} from './manifest.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'lumina-manifest-test-'));
}

async function setupProjectRoot(base) {
  const root = join(base, 'project');
  await mkdir(join(root, '_lumina', '_state'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// manifest.json round-trip
// ---------------------------------------------------------------------------

describe('writeManifest / readManifest', () => {
  test('writes and reads back a manifest (round-trip)', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const manifest = {
      schemaVersion:    MANIFEST_SCHEMA_VERSION,
      packageVersion:   '0.1.0',
      installedAt:      '2026-05-01T00:00:00.000Z',
      updatedAt:        '2026-05-01T00:00:00.000Z',
      packs:            { core: { version: '0.1.0', source: 'built-in' } },
      ideTargets:       ['claude_code'],
      symlinkStrategies: { 'lumi-init': 'symlink' },
      resolvedPaths:    { projectRoot: root },
    };

    await writeManifest(root, manifest);
    const result = await readManifest(root);

    assert.deepEqual(result, manifest);
  });

  test('returns null for missing manifest (fresh install)', async () => {
    const base = await makeTmpDir();
    const root = join(base, 'fresh-project');
    await mkdir(join(root, '_lumina'), { recursive: true });

    const result = await readManifest(root);
    assert.equal(result, null);
  });

  test('throws on corrupted JSON', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);
    const manifestPath = join(root, '_lumina', 'manifest.json');
    await writeFile(manifestPath, '{ "broken": json }', 'utf8');

    await assert.rejects(
      () => readManifest(root),
      SyntaxError,
    );
  });

  test('preserves all fields across write/read', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const manifest = {
      schemaVersion:    1,
      packageVersion:   '0.1.5',
      installedAt:      '2026-01-01T00:00:00.000Z',
      updatedAt:        '2026-05-01T12:00:00.000Z',
      packs: {
        core:     { version: '0.1.5', source: 'built-in' },
        research: { version: '0.1.5', source: 'built-in' },
      },
      ideTargets:       ['claude_code', 'codex', 'cursor'],
      symlinkStrategies: {
        'lumi-init':   'symlink',
        'lumi-ingest': 'junction',
        'lumi-ask':    'copy',
      },
      resolvedPaths: {
        projectRoot: root,
        wiki:        join(root, 'wiki'),
      },
    };

    await writeManifest(root, manifest);
    const result = await readManifest(root);

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.packageVersion, '0.1.5');
    assert.deepEqual(result.ideTargets, ['claude_code', 'codex', 'cursor']);
    assert.equal(result.symlinkStrategies['lumi-ask'], 'copy');
    assert.equal(result.packs.research.source, 'built-in');
  });
});

// ---------------------------------------------------------------------------
// skills-manifest.csv round-trip
// ---------------------------------------------------------------------------

describe('writeSkillsManifest / readSkillsManifest', () => {
  test('writes and reads back skill rows (round-trip)', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const rows = [
      {
        canonical_id:    'lumi-init',
        display_name:    '/lumi-init',
        pack:            'core',
        source:          'built-in',
        relative_path:   '.agents/skills/lumi-init',
        target_link_path: '.claude/skills/lumi-init',
        version:         '0.1.0',
      },
      {
        canonical_id:    'lumi-ingest',
        display_name:    '/lumi-ingest',
        pack:            'core',
        source:          'built-in',
        relative_path:   '.agents/skills/lumi-ingest',
        target_link_path: '.claude/skills/lumi-ingest',
        version:         '0.1.0',
      },
    ];

    await writeSkillsManifest(root, rows);
    const result = await readSkillsManifest(root);

    assert.equal(result.length, 2);
    assert.deepEqual(result[0], rows[0]);
    assert.deepEqual(result[1], rows[1]);
  });

  test('returns empty array for missing file', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const result = await readSkillsManifest(root);
    assert.deepEqual(result, []);
  });

  test('truncated CSV returns empty array with warning', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);
    const csvPath = join(root, '_lumina', '_state', 'skills-manifest.csv');
    // Write truncated / malformed CSV
    await writeFile(csvPath, 'wrong,headers,here\nsome,data', 'utf8');

    const warnings = [];
    const result = await readSkillsManifest(root, msg => warnings.push(msg));

    assert.deepEqual(result, []);
    assert.ok(warnings.length > 0, 'Should emit a warning on header mismatch');
  });

  test('handles fields with commas via CSV quoting', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const rows = [
      {
        canonical_id:    'lumi-test',
        display_name:    '/lumi-test, a skill',
        pack:            'core',
        source:          'built-in',
        relative_path:   '.agents/skills/lumi-test',
        target_link_path: '',
        version:         '0.1.0',
      },
    ];

    await writeSkillsManifest(root, rows);
    const result = await readSkillsManifest(root);
    assert.equal(result[0].display_name, '/lumi-test, a skill');
  });
});

// ---------------------------------------------------------------------------
// files-manifest.csv round-trip
// ---------------------------------------------------------------------------

describe('writeFilesManifest / readFilesManifest', () => {
  test('writes and reads back file rows (round-trip)', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const rows = [
      {
        relative_path:     'README.md',
        sha256:            'a'.repeat(64),
        source_pack:       'core',
        installed_version: '0.1.0',
      },
      {
        relative_path:     '_lumina/config/lumina.config.yaml',
        sha256:            'b'.repeat(64),
        source_pack:       'core',
        installed_version: '0.1.0',
      },
    ];

    await writeFilesManifest(root, rows);
    const result = await readFilesManifest(root);

    assert.equal(result.length, 2);
    assert.equal(result[0].sha256, 'a'.repeat(64));
    assert.equal(result[1].relative_path, '_lumina/config/lumina.config.yaml');
  });

  test('returns empty array for missing file', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const result = await readFilesManifest(root);
    assert.deepEqual(result, []);
  });

  test('truncated files CSV emits warning and returns []', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);
    const csvPath = join(root, '_lumina', '_state', 'files-manifest.csv');
    await writeFile(csvPath, 'bad,csv\nrow1,row2', 'utf8');

    const warnings = [];
    const result = await readFilesManifest(root, msg => warnings.push(msg));
    assert.deepEqual(result, []);
    assert.ok(warnings.length > 0);
  });

  test('round-trip preserves empty fields', async () => {
    const base = await makeTmpDir();
    const root = await setupProjectRoot(base);

    const rows = [
      {
        relative_path:     'CLAUDE.md',
        sha256:            '',
        source_pack:       'core',
        installed_version: '0.1.0',
      },
    ];

    await writeFilesManifest(root, rows);
    const result = await readFilesManifest(root);
    assert.equal(result[0].sha256, '');
  });
});

// ---------------------------------------------------------------------------
// statePaths
// ---------------------------------------------------------------------------

describe('statePaths', () => {
  test('returns correct paths relative to project root', () => {
    const root = '/project/root';
    const paths = statePaths(root);
    assert.equal(paths.manifestJson, join(root, '_lumina', 'manifest.json'));
    assert.equal(paths.skillsCsv, join(root, '_lumina', '_state', 'skills-manifest.csv'));
    assert.equal(paths.filesCsv, join(root, '_lumina', '_state', 'files-manifest.csv'));
  });
});

// ---------------------------------------------------------------------------
// migrateManifest
// ---------------------------------------------------------------------------

describe('migrateManifest', () => {
  test('no-op when schemaVersion already matches targetVersion', () => {
    const manifest = {
      schemaVersion: 1,
      packageVersion: '0.5.0',
      packs: { core: { version: '0.5.0', source: 'built-in' } },
    };
    const result = migrateManifest(manifest, 1);
    // Must be the same reference — no copy, no mutation.
    assert.strictEqual(result, manifest);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.packageVersion, '0.5.0');
  });

  test('adds schemaVersion: 1 to a legacy manifest that has no schemaVersion', () => {
    const manifest = {
      packageVersion: '0.4.0',
      packs: { core: { version: '0.4.0', source: 'built-in' } },
      ideTargets: ['claude_code'],
    };
    const result = migrateManifest(manifest, 1);
    assert.equal(result.schemaVersion, 1);
    // Other fields must be preserved.
    assert.equal(result.packageVersion, '0.4.0');
    assert.deepEqual(result.packs, { core: { version: '0.4.0', source: 'built-in' } });
    assert.deepEqual(result.ideTargets, ['claude_code']);
  });

  test('treats explicit null schemaVersion as legacy (upgrades to 1)', () => {
    const manifest = { schemaVersion: null, packs: {} };
    const result = migrateManifest(manifest, 1);
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.packs, {});
  });

  test('throws with code 3 when schemaVersion > targetVersion (downgrade refused)', () => {
    const manifest = { schemaVersion: 99 };
    let caught;
    try {
      migrateManifest(manifest, 1);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof Error, 'Should throw an Error');
    assert.equal(caught.code, 3, 'Error code must be 3');
    assert.match(caught.message, /[Dd]owngrade/);
  });
});
