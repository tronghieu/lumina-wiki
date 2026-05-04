/**
 * Tests for src/installer/commands.js high-risk install behavior.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { installCommand, printPostUpgradeBanner } from './commands.js';
import { writeManifest, MANIFEST_SCHEMA_VERSION } from './manifest.js';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json');
const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));

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

      await access(join(workspace, '.agents', 'skills', 'lumi-research-discover', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-research-discover', 'references', 'source-modes.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-research-discover', 'references', 'ranking-signals.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-ingest', 'references', 'pdf-preprocessing.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-check', 'references', 'lint-checks.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-verify', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-reading-chapter-ingest', 'SKILL.md'));
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

  test('post-upgrade banner: prints to stderr when lint finds errors/warnings', async () => {
    const tmp = await makeTmpDir();
    try {
      // Create a minimal project with lint.mjs stub that reports findings
      await mkdir(join(tmp, '_lumina', 'scripts'), { recursive: true });
      const lintStub = `process.stdout.write(JSON.stringify({"errors":3,"warnings":7,"by_check":{},"fixable":0}) + '\\n');\nprocess.exit(1);\n`;
      await writeFile(join(tmp, '_lumina', 'scripts', 'lint.mjs'), lintStub, 'utf8');

      // Capture stderr by intercepting process.stderr.write
      const captured = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk, ...args) => { captured.push(String(chunk)); return true; };

      try {
        await printPostUpgradeBanner({
          projectRoot: tmp,
          fromVersion: '0.5.0',
          toVersion: PKG.version,
          colors: { yellow: (s) => s },
        });
      } finally {
        process.stderr.write = origWrite;
      }

      const output = captured.join('');
      assert.match(output, /\[warn\]/);
      assert.match(output, /0\.5\.0/);
      assert.match(output, /3 error/);
      assert.match(output, /7 warning/);
      assert.match(output, /\/lumi-migrate-legacy/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('post-upgrade banner: silent when lint reports no findings', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'scripts'), { recursive: true });
      const lintStub = `process.stdout.write(JSON.stringify({"errors":0,"warnings":0,"by_check":{},"fixable":0}) + '\\n');\nprocess.exit(0);\n`;
      await writeFile(join(tmp, '_lumina', 'scripts', 'lint.mjs'), lintStub, 'utf8');

      const captured = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk, ...args) => { captured.push(String(chunk)); return true; };

      try {
        await printPostUpgradeBanner({
          projectRoot: tmp,
          fromVersion: '0.5.0',
          toVersion: PKG.version,
          colors: { yellow: (s) => s },
        });
      } finally {
        process.stderr.write = origWrite;
      }

      const output = captured.join('');
      assert.ok(!output.includes('[warn] Lumina upgraded'), 'stderr should not contain upgrade banner on clean lint');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('same-version re-install does not print banner', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'same-ver-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      await mkdir(join(workspace, '_lumina', 'config'), { recursive: true });
      await mkdir(join(workspace, '_lumina', '_state'), { recursive: true });
      await writeFile(join(workspace, '_lumina', 'config', 'lumina.config.yaml'), [
        'project_name: same-ver-wiki',
        'communication_language: English',
        'document_output_language: English',
        'ide_targets:',
        '  claude_code: true',
        '  codex: false',
        '  cursor: false',
        '  gemini_cli: false',
        '  generic: false',
        'packs:',
        '  core: true',
        '  research: false',
        '  reading: false',
        '',
      ].join('\n'), 'utf8');
      // Manifest with CURRENT version (same as PKG.version) — banner should NOT fire
      await writeManifest(workspace, {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        packageVersion: PKG.version,
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        packs: { core: { version: PKG.version, source: 'built-in' } },
        ideTargets: ['claude_code'],
        symlinkStrategies: {},
        resolvedPaths: { projectRoot: workspace },
      });

      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--directory', workspace],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stderr.includes('[warn] Lumina upgraded'), 'same-version re-install must not print banner');
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

      await access(join(tmp, '.agents', 'skills', 'lumi-research-discover', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-research-discover', 'references', 'source-modes.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-research-discover', 'references', 'ranking-signals.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-ingest', 'references', 'dedup-policy.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-check', 'references', 'lint-checks.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-verify', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(tmp, '_lumina', 'tools', 'prepare_source.py'));
    } finally {
      await cleanTmp(tmp);
    }
  });
});
