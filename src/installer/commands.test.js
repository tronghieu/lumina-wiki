/**
 * Tests for src/installer/commands.js high-risk install behavior.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { installCommand } from './commands.js';
import { writeManifest, MANIFEST_SCHEMA_VERSION } from './manifest.js';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json');
const CLI = resolve(new URL('../..', import.meta.url).pathname, 'bin', 'lumina.js');

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'lumina-command-test-'));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

describe('CLI version', () => {
  test('--version --no-update prints package version and exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, '--version', '--no-update'],
      { encoding: 'utf8', timeout: 10000 },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), PKG.version);
  });
});

describe('installCommand', () => {
  test('CLI install supports non-interactive full-pack overrides', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'override-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'install',
          '--yes',
          '--no-update',
          '--directory', workspace,
          '--packs', 'core,research,reading',
          '--ide-targets', 'claude_code,codex,cursor,gemini_cli',
          '--communication-language', 'Vietnamese',
          '--document-output-language', 'English',
        ],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      const config = await readFile(join(workspace, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /project_name: override-wiki/);
      assert.match(config, /communication_language: Vietnamese/);
      assert.match(config, /research: true/);
      assert.match(config, /reading: true/);

      await access(join(workspace, '.agents', 'skills', 'lumi-discover', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-chapter-ingest', 'SKILL.md'));
      await access(join(workspace, '_lumina', 'tools', 'prepare_source.py'));
      await access(join(workspace, 'AGENTS.md'));
      await access(join(workspace, 'GEMINI.md'));
      await access(join(workspace, '.cursor', 'rules', 'lumina.mdc'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('CLI install rejects unknown pack overrides', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--cwd', tmp, '--packs', 'research,unknown'],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /Unknown pack: unknown/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('first install merges schema into an existing README without markers', async () => {
    const tmp = await makeTmpDir();
    try {
      await writeFile(join(tmp, 'README.md'), '# Existing Project\n\nKeep this content.\n', 'utf8');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });

      const readme = await readFile(join(tmp, 'README.md'), 'utf8');
      assert.ok(readme.includes('# Existing Project'));
      assert.ok(readme.includes('Keep this content.'));
      assert.ok(readme.includes('<!-- lumina:schema -->'));
      assert.ok(readme.includes('<!-- /lumina:schema -->'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade with --yes preserves existing config choices', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeManifest(tmp, {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        packageVersion: '0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        packs: {
          core: { version: '0.1.0', source: 'built-in' },
          research: { version: '0.1.0', source: 'built-in' },
          reading: { version: '0.1.0', source: 'built-in' },
        },
        ideTargets: ['codex'],
        symlinkStrategies: {},
        resolvedPaths: { projectRoot: tmp },
      });
      await writeFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), [
        'project_name: Existing Wiki',
        'communication_language: Vietnamese',
        'document_output_language: English',
        'ide_targets:',
        '  claude_code: false',
        '  codex: true',
        '  cursor: false',
        '  gemini_cli: false',
        '  generic: false',
        'packs:',
        '  core: true',
        '  research: true',
        '  reading: true',
        '',
      ].join('\n'), 'utf8');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });

      const config = await readFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /project_name: Existing Wiki/);
      assert.match(config, /communication_language: Vietnamese/);
      assert.match(config, /research: true/);
      assert.match(config, /reading: true/);
      assert.match(config, /codex: true/);

      await access(join(tmp, '.agents', 'skills', 'lumi-discover', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-chapter-ingest', 'SKILL.md'));
      await access(join(tmp, '_lumina', 'tools', 'prepare_source.py'));
    } finally {
      await cleanTmp(tmp);
    }
  });
});
