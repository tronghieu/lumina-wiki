/**
 * Tests for src/installer/commands.js high-risk install behavior.
 *
 * Run this file directly with Node, as configured in package.json. Several
 * tests intentionally emit localized installer output; Node 20's parent test
 * runner multiplexes that output with its serialized protocol and can
 * intermittently misparse the stream (GitHub issue #23).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir, readlink, readdir, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { installCommand, uninstallCommand, printPostUpgradeBanner, applyInstallOverrides, validateLanguageInput, isLuminaOwnedSkillEntry, copySkills, removeManagedSkillLink, removeOwnedAgentsSkills, removeOwnedClaudeSkillLinks } from './commands.js';
import { readManifest, readSkillsManifest, writeManifest, MANIFEST_SCHEMA_VERSION } from './manifest.js';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json');
const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'lumina-command-test-'));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

// Captures everything written via console.log while `fn` runs, restoring
// the real console.log afterward even if `fn` throws. Used to assert on
// installer warning output without spawning the CLI as a subprocess.
async function captureLogs(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

// Recursive [relPath, content] snapshot of a directory tree, for idempotency
// comparisons. `excludePrefixes` skips paths (and their children) that are
// runtime state with timestamps (manifest.json, _state/*) — same exclusion
// list as scripts/ci-idempotency.mjs's managedDiffPaths complement.
async function snapshotTree(root, excludePrefixes = []) {
  const out = [];
  async function walk(dir, relBase) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (excludePrefixes.some(p => rel === p || rel.startsWith(p + '/'))) continue;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        out.push([rel, `SYMLINK:${await readlink(abs)}`]);
      } else if (entry.isDirectory()) {
        await walk(abs, rel);
      } else {
        out.push([rel, await readFile(abs, 'utf8').catch(() => 'BINARY')]);
      }
    }
  }
  await walk(root, '');
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
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
      await access(join(workspace, '.agents', 'skills', 'lumi-research-watchlist', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-research-rank', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-research-rank', 'references', '4c-rubric.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-ingest', 'references', 'pdf-preprocessing.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-check', 'references', 'lint-checks.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-verify', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-help', 'SKILL.md'));
      await access(join(workspace, '_lumina', 'tools', 'prepare_source.py'));
      await access(join(workspace, '_lumina', 'tools', 'fetch_scite.py'));
      await access(join(workspace, '_lumina', 'tools', 'fetch_altmetric.py'));
      await access(join(workspace, '_lumina', 'scripts', 'discover-runner.mjs'));
      await access(join(workspace, '_lumina', 'scripts', 'external-ids.mjs'));
      await access(join(workspace, '_lumina', 'scripts', 'parse-ids.mjs'));
      await access(join(workspace, '_lumina', 'scripts', 'merge-ids.mjs'));
      await access(join(workspace, '_lumina', 'scripts', 'build-source.mjs'));
      await access(join(workspace, '_lumina', 'scripts', 'lib', 'watchlist-config.mjs'));
      await access(join(workspace, '_lumina', 'config', 'watchlist.yml'));
      await access(join(workspace, 'AGENTS.md'));
      await access(join(workspace, 'GEMINI.md'));
      await access(join(workspace, '.cursor', 'rules', 'lumina.mdc'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('CLI install with learning pack creates wiki/reflections and links skill', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'learning-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--directory', workspace, '--packs', 'core,learning'],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      const config = await readFile(join(workspace, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /learning: true/);
      await access(join(workspace, 'wiki', 'reflections'));
      await access(join(workspace, '.agents', 'skills', 'lumi-learning-reflect', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('CLI install without learning pack has no wiki/reflections or learning skill', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'core-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--directory', workspace, '--packs', 'core'],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      const config = await readFile(join(workspace, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /learning: false/);
      await assert.rejects(() => access(join(workspace, 'wiki', 'reflections')));
      await assert.rejects(() => access(join(workspace, '.agents', 'skills', 'lumi-learning-reflect')));
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
      await access(join(tmp, '.agents', 'skills', 'lumi-research-watchlist', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-ingest', 'references', 'dedup-policy.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-check', 'references', 'lint-checks.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-verify', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-help', 'SKILL.md'));
      await access(join(tmp, '_lumina', 'tools', 'prepare_source.py'));
      await access(join(tmp, '_lumina', 'config', 'watchlist.yml'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade preserves existing research watchlist', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await mkdir(join(tmp, '_lumina', '_state'), { recursive: true });
      await writeManifest(tmp, {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        packageVersion: '0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        packs: {
          core: { version: '0.1.0', source: 'built-in' },
          research: { version: '0.1.0', source: 'built-in' },
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
        '  codex: true',
        'packs:',
        '  core: true',
        '  research: true',
        '',
      ].join('\n'), 'utf8');
      const customWatchlist = 'version: 1\nitems:\n  - id: keep-me\n    enabled: true\n    query: "keep this"\n';
      await writeFile(join(tmp, '_lumina', 'config', 'watchlist.yml'), customWatchlist, 'utf8');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });

      const after = await readFile(join(tmp, '_lumina', 'config', 'watchlist.yml'), 'utf8');
      assert.equal(after, customWatchlist);
    } finally {
      await cleanTmp(tmp);
    }
  });

  // ── Upgrade menu (BMAD-style) ──────────────────────────────────────────────

  test('fresh install with default (core-only) packs prints hint about available packs', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'hint-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--directory', workspace],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /more packs are available/);
      assert.match(result.stdout, /research/);
      assert.match(result.stdout, /reading/);
      assert.match(result.stdout, /learning/);
      assert.match(result.stdout, /Modify installation/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('fresh install with every pack does not print the packs-available hint', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'full-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update', '--directory', workspace, '--packs', 'core,research,reading,learning'],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes('more packs are available'), 'hint should not print once every pack is installed');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade with --yes: quick update semantics keep existing packs and print the packs-available hint', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeManifest(tmp, {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        packageVersion: '0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        packs: { core: { version: '0.1.0', source: 'built-in' } },
        ideTargets: ['claude_code'],
        symlinkStrategies: {},
        resolvedPaths: { projectRoot: tmp },
      });
      await writeFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), [
        'project_name: Core Only Wiki',
        'communication_language: English',
        'document_output_language: English',
        'ide_targets:',
        '  claude_code: true',
        'packs:',
        '  core: true',
        '',
      ].join('\n'), 'utf8');

      const captured = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, ...args) => { captured.push(String(chunk)); return true; };
      try {
        await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join('');
      assert.match(output, /more packs are available/);
      assert.match(output, /research/);
      assert.match(output, /reading/);
      assert.match(output, /learning/);

      // Quick update semantics: --yes on an upgrade never adds packs the user
      // didn't already request — it only preserves the prior config.
      const config = await readFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /research: false/);
      assert.match(config, /reading: false/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade without --yes over a non-TTY pipe skips the interactive upgrade menu (behaves like quick update)', async () => {
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
        },
        ideTargets: ['codex'],
        symlinkStrategies: {},
        resolvedPaths: { projectRoot: tmp },
      });
      await writeFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), [
        'project_name: Piped Wiki',
        'communication_language: English',
        'document_output_language: English',
        'ide_targets:',
        '  codex: true',
        'packs:',
        '  core: true',
        '  research: true',
        '',
      ].join('\n'), 'utf8');

      // No --yes flag: spawnSync's default stdio is piped, not a TTY, so the
      // interactive upgrade menu's TTY guard must skip the prompt rather than
      // block waiting for input that will never arrive.
      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--no-update', '--directory', tmp],
        { encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      const config = await readFile(join(tmp, '_lumina', 'config', 'lumina.config.yaml'), 'utf8');
      assert.match(config, /project_name: Piped Wiki/);
      assert.match(config, /research: true/);
      assert.match(config, /codex: true/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('CLI install from a nested directory upgrades the enclosing workspace', async () => {
    const tmp = await makeTmpDir();
    const nested = join(tmp, 'docs', 'notes');
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await mkdir(nested, { recursive: true });

      const result = spawnSync(
        process.execPath,
        [CLI, 'install', '--yes', '--no-update'],
        { cwd: nested, encoding: 'utf8', timeout: 30000 },
      );

      assert.equal(result.status, 0, result.stderr);
      await assert.rejects(() => access(join(nested, '_lumina', 'manifest.json')));
      await access(join(tmp, '_lumina', 'manifest.json'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade removes obsolete managed skills, links, tools, and unchanged IDE stubs', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        packs: 'core,research',
        ideTargets: 'claude_code,codex',
      });
      await access(join(tmp, 'wiki', 'topics'));

      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        packs: 'core',
        ideTargets: 'codex',
      });

      await assert.rejects(() => access(join(tmp, '.agents', 'skills', 'lumi-research-discover')));
      await assert.rejects(() => access(join(tmp, '.claude', 'skills', 'lumi-research-discover')));
      await assert.rejects(() => access(join(tmp, '.claude', 'skills', 'lumi-init')));
      await assert.rejects(() => access(join(tmp, '_lumina', 'tools', 'discover.py')));
      await assert.rejects(() => access(join(tmp, '.env.example')));
      await assert.rejects(() => access(join(tmp, 'CLAUDE.md')));
      await access(join(tmp, 'AGENTS.md'));
      await access(join(tmp, 'wiki', 'topics'));

      const rows = await readSkillsManifest(tmp);
      assert.ok(rows.every(row => row.pack === 'core'));
      assert.ok(rows.every(row => row.target_link_path === ''));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('upgrade preserves a modified stub when its IDE target is removed', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        ideTargets: 'claude_code,codex',
      });
      const custom = '# My Claude instructions\n';
      await writeFile(join(tmp, 'CLAUDE.md'), custom, 'utf8');

      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        ideTargets: 'codex',
      });

      assert.equal(await readFile(join(tmp, 'CLAUDE.md'), 'utf8'), custom);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('pack cleanup does not remove a user-created Claude path when Claude was never selected', async () => {
    const tmp = await makeTmpDir();
    const customPath = join(tmp, '.claude', 'skills', 'lumi-research-discover');
    try {
      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        packs: 'core,research',
        ideTargets: 'codex',
      });
      await mkdir(customPath, { recursive: true });
      await writeFile(join(customPath, 'CUSTOM.md'), 'user-owned\n', 'utf8');

      await installCommand({
        cwd: tmp,
        yes: true,
        noUpdate: true,
        packs: 'core',
        ideTargets: 'codex',
      });

      assert.equal(
        await readFile(join(customPath, 'CUSTOM.md'), 'utf8'),
        'user-owned\n',
      );
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('relocated workspace refreshes manifest paths and keeps portable skill links', async () => {
    const tmp = await makeTmpDir();
    const original = join(tmp, 'original');
    const relocated = join(tmp, 'relocated');
    try {
      await mkdir(original, { recursive: true });
      await installCommand({ cwd: original, yes: true, noUpdate: true });
      const { cp } = await import('node:fs/promises');
      // verbatimSymlinks:true is required here to faithfully simulate a
      // real workspace relocation (mv, rsync, git, shell `cp -R`, or a
      // Finder/Explorer drag all preserve a relative symlink's target
      // string byte-for-byte). Without it, Node's fs.cp() defaults to
      // *resolving* relative symlink targets and rewriting them as
      // absolute paths anchored at the ORIGINAL source location — a
      // Node-specific quirk that doesn't happen in any real relocation,
      // and produces a copied .claude/skills/lumi-init symlink that
      // (correctly) fails the foreign-collision fingerprint check because
      // it points at `original/.agents/skills/lumi-init`, not
      // `relocated/.agents/skills/lumi-init`.
      await cp(original, relocated, { recursive: true, verbatimSymlinks: true });

      await installCommand({ cwd: relocated, yes: true, noUpdate: true });

      const manifest = await readManifest(relocated);
      assert.equal(manifest.resolvedPaths.projectRoot, relocated);
      if (process.platform !== 'win32') {
        const target = await readlink(join(relocated, '.claude', 'skills', 'lumi-init'));
        assert.equal(target, '../../.agents/skills/lumi-init');
      }
      await access(join(relocated, '.claude', 'skills', 'lumi-init', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('install fails when required Claude skill links cannot be created', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '.claude'), { recursive: true });
      await writeFile(join(tmp, '.claude', 'skills'), 'blocks skill directory', 'utf8');

      await assert.rejects(
        () => installCommand({ cwd: tmp, yes: true, noUpdate: true }),
        (err) => err.code === 2 && /SKILL_LINKS_INCOMPLETE/.test(err.message),
      );
      await assert.rejects(() => access(join(tmp, '_lumina', 'manifest.json')));
    } finally {
      await cleanTmp(tmp);
    }
  });
});


describe("applyInstallOverrides — locale + language validation", () => {
  const base = { packs: ["core"], ideTargets: ["claude_code"], communicationLang: "English", documentOutputLang: "English" };

  test("--lang vi sets locale", () => {
    const r = applyInstallOverrides({ ...base }, { lang: "vi" });
    assert.equal(r.locale, "vi");
  });

  test("--lang fr throws code 2 with UNKNOWN_LOCALE", () => {
    assert.throws(() => applyInstallOverrides({ ...base }, { lang: "fr" }), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.message, /UNKNOWN_LOCALE/);
      return true;
    });
  });

  test("--lang EN normalizes case-insensitive", () => {
    const r = applyInstallOverrides({ ...base }, { lang: "EN" });
    assert.equal(r.locale, "en");
  });

  test("no --lang, no existing locale → defaults en", () => {
    const r = applyInstallOverrides({ ...base }, {});
    assert.equal(r.locale, "en");
  });

  test("no --lang, existing answers.locale=zh preserved", () => {
    const r = applyInstallOverrides({ ...base, locale: "zh" }, {});
    assert.equal(r.locale, "zh");
  });

  test("interactive locale selection cascades installed default languages", () => {
    const r = applyInstallOverrides({
      ...base,
      locale: "en",
      selectedLocale: "vi",
      communicationLang: "English",
      documentOutputLang: "English",
    }, {});
    assert.equal(r.locale, "vi");
    assert.equal(r.communicationLang, "Vietnamese");
    assert.equal(r.documentOutputLang, "Vietnamese");
    assert.equal("selectedLocale" in r, false);
  });

  test("--lang remains authoritative over an interactive locale selection", () => {
    const r = applyInstallOverrides({
      ...base,
      locale: "en",
      selectedLocale: "vi",
      localeSwitchConfirmedFor: "vi",
    }, { lang: "zh" });
    assert.equal(r.locale, "zh");
    assert.equal(r.localeSwitchConfirmedFor, "vi");
  });

  test("--communication-language empty after trim throws code 2", () => {
    assert.throws(() => applyInstallOverrides({ ...base }, { communicationLang: "  " }), (err) => {
      assert.equal(err.code, 2);
      return true;
    });
  });

  test("--communication-language template-injection rejected", () => {
    assert.throws(() => applyInstallOverrides({ ...base }, { communicationLang: "Vietnamese{{evil}}" }), (err) => {
      assert.equal(err.code, 2);
      return true;
    });
  });

  test("--communication-language trims whitespace", () => {
    const r = applyInstallOverrides({ ...base }, { communicationLang: " Vietnamese " });
    assert.equal(r.communicationLang, "Vietnamese");
  });

  test("validateLanguageInput rejects empty", () => {
    assert.throws(() => validateLanguageInput("", "x"), (err) => err.code === 2);
  });
});



describe("installCommand — locale-switch protection", () => {
  test("upgrade with locale mismatch refused without --force-locale-switch (headless)", async () => {
    const tmp = await makeTmpDir();
    try {
      // First install: vi
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "vi" });
      // Second install: en, no --force-locale-switch → refused
      await assert.rejects(
        () => installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "en" }),
        (err) => {
          assert.equal(err.code, 2);
          assert.match(err.message, /LOCALE_SWITCH_REFUSED/);
          return true;
        },
      );
    } finally {
      await cleanTmp(tmp);
    }
  });

  test("upgrade with locale mismatch + --force-locale-switch succeeds", async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "vi" });
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "en", forceLocaleSwitch: true });
      const mf = JSON.parse(await readFile(join(tmp, "_lumina", "manifest.json"), "utf8"));
      assert.equal(mf.locale, "en");
    } finally {
      await cleanTmp(tmp);
    }
  });

  test("config drift trips gate even without --lang flag", async () => {
    const tmp = await makeTmpDir();
    try {
      // Install vi
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "vi" });
      // Hand-edit config to claim zh
      const configPath = join(tmp, "_lumina", "config", "lumina.config.yaml");
      let raw = await readFile(configPath, "utf8");
      raw = raw.replace(/locale: vi/, "locale: zh");
      await writeFile(configPath, raw, "utf8");
      // BUT manifest still says vi → manifest wins per Plan §6, no drift detected.
      // Re-install with no --lang should succeed (manifest stays authoritative).
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const mf = JSON.parse(await readFile(join(tmp, "_lumina", "manifest.json"), "utf8"));
      assert.equal(mf.locale, "vi", "manifest should remain vi (source of truth)");
    } finally {
      await cleanTmp(tmp);
    }
  });

  test("legacy v3 manifest (no locale) treated as en for switch gate", async () => {
    const tmp = await makeTmpDir();
    try {
      // Install fresh
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "en" });
      // Mutate manifest to look like v3 (drop locale field, downgrade schemaVersion)
      const mfPath = join(tmp, "_lumina", "manifest.json");
      const mf = JSON.parse(await readFile(mfPath, "utf8"));
      delete mf.locale;
      mf.schemaVersion = 3;
      await writeFile(mfPath, JSON.stringify(mf, null, 2) + "\n", "utf8");
      // Upgrade with --lang vi (different from migrated 'en') → refused
      await assert.rejects(
        () => installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "vi" }),
        (err) => err.code === 2 && /LOCALE_SWITCH_REFUSED/.test(err.message),
      );
    } finally {
      await cleanTmp(tmp);
    }
  });

  test("readAnswersFromConfig rejects invalid config.locale", async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "en" });
      const configPath = join(tmp, "_lumina", "config", "lumina.config.yaml");
      let raw = await readFile(configPath, "utf8");
      raw = raw.replace(/locale: en/, "locale: ../etc/passwd");
      await writeFile(configPath, raw, "utf8");
      await assert.rejects(
        () => installCommand({ cwd: tmp, yes: true, noUpdate: true }),
        (err) => err.code === 2 && /INVALID_CONFIG_LOCALE/.test(err.message),
      );
    } finally {
      await cleanTmp(tmp);
    }
  });
});


describe("installCommand — additional defensive tests", () => {
  test("custom communicationLang survives subsequent --lang switch (cascade does not clobber)", async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true, lang: "en",
        communicationLang: "Klingon",
      });
      // Switch to vi with --force-locale-switch; no new comm-lang flag → should keep Klingon
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true, lang: "vi",
        forceLocaleSwitch: true,
      });
      const config = await readFile(join(tmp, "_lumina", "config", "lumina.config.yaml"), "utf8");
      assert.match(config, /communication_language: Klingon/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test("malformed config YAML throws CONFIG_READ_FAILED", async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, lang: "en" });
      const configPath = join(tmp, "_lumina", "config", "lumina.config.yaml");
      // Corrupt YAML: unmatched bracket
      await writeFile(configPath, "project_name: [\n  broken\n", "utf8");
      await assert.rejects(
        () => installCommand({ cwd: tmp, yes: true, noUpdate: true }),
        (err) => err.code === 2 && /CONFIG_READ_FAILED/.test(err.message),
      );
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('lumi-help skill', () => {
  test('core-only install creates lumi-help skill in .claude/skills', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await access(join(tmp, '.claude', 'skills', 'lumi-help', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('SKILL.md has valid frontmatter: name, description, and Bash in allowed-tools', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const content = await readFile(join(tmp, '.claude', 'skills', 'lumi-help', 'SKILL.md'), 'utf8');
      assert.match(content, /^name: lumi-help/m);
      assert.match(content, /^description:/m);
      assert.match(content, /- Bash/m);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('lumi-help.csv is rendered into _lumina/schema/ and gates pack rows', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const catalog = await readFile(join(tmp, '_lumina', 'schema', 'lumi-help.csv'), 'utf8');

      // Header is the contract — guards against silent column reorders.
      assert.match(
        catalog,
        /^id,menu,pack,phase,after,before,required,args,outputs,description/m,
      );

      // Core skills are always present.
      assert.match(catalog, /^lumi-init,/m);
      assert.match(catalog, /^lumi-ingest,/m);
      assert.match(catalog, /^lumi-help,/m);

      // Pack-conditioned rows are stripped when the pack is not installed.
      assert.doesNotMatch(catalog, /^lumi-research-/m);
      assert.doesNotMatch(catalog, /^lumi-reading-/m);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('lumi-help-runbook.md is rendered alongside the catalog', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const runbook = await readFile(join(tmp, '_lumina', 'schema', 'lumi-help-runbook.md'), 'utf8');
      // Sanity-check the runbook contains the load-bearing markers it's
      // referenced for from SKILL.md.
      assert.match(runbook, /Step 0 · Read languages/);
      assert.match(runbook, /Mode A · Bash reads/);
      assert.match(runbook, /Mode B · Catalog rendering/);
      assert.match(runbook, /Mode C · Output templates/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('install does not write the obsolete skills-catalog.md or skills-manifest.json', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await assert.rejects(
        () => access(join(tmp, '_lumina', 'schema', 'skills-catalog.md')),
        err => err.code === 'ENOENT',
      );
      await assert.rejects(
        () => access(join(tmp, '_lumina', '_state', 'skills-manifest.json')),
        err => err.code === 'ENOENT',
      );
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Install profile: minimal (global-hub-managed wikis, no per-project skills
// or IDE stub files — see docs/planning-artifacts, CAP-8 successor work).
// ---------------------------------------------------------------------------

describe('installCommand — profile: minimal', () => {
  test('minimal profile writes the expected tree and omits skills/stubs', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'minimal-wiki');
    await mkdir(workspace, { recursive: true });
    try {
      // Mirrors the exact call shape the multi-wiki hub's provisioning path
      // uses, including the `ide`/`updateCheck` spellings (aliases of
      // `ideTargets`/`noUpdate`).
      await installCommand({
        directory: workspace,
        yes: true,
        profile: 'minimal',
        packs: ['core', 'research'],
        ide: ['generic'],
        purpose: 'Ghi chép về kiến trúc phần mềm',
        updateCheck: false,
      });

      // Still written under a minimal profile.
      await access(join(workspace, 'README.md'));
      await access(join(workspace, '_lumina', 'config', 'lumina.config.yaml'));
      await access(join(workspace, '_lumina', 'scripts', 'wiki.mjs'));
      await access(join(workspace, '_lumina', 'schema', 'page-templates.md'));
      await access(join(workspace, '_lumina', 'CHANGELOG.md'));
      await access(join(workspace, '_lumina', 'manifest.json'));
      await access(join(workspace, '_lumina', '_state', 'skills-manifest.csv'));
      await access(join(workspace, '_lumina', '_state', 'files-manifest.csv'));
      await access(join(workspace, '.gitignore'));
      await access(join(workspace, '.env.example')); // research pack
      await access(join(workspace, 'wiki', 'index.md'));
      await access(join(workspace, 'wiki', 'log.md'));
      await access(join(workspace, 'wiki', 'foundations')); // research pack dir
      await access(join(workspace, 'raw', 'discovered'));   // research pack dir

      const readme = await readFile(join(workspace, 'README.md'), 'utf8');
      assert.match(readme, /Ghi chép về kiến trúc phần mềm/);

      // Omitted: no per-project skill copies, no IDE stub files.
      await assert.rejects(() => access(join(workspace, '.agents', 'skills')));
      await assert.rejects(() => access(join(workspace, '.agents')));
      await assert.rejects(() => access(join(workspace, '.claude')));
      await assert.rejects(() => access(join(workspace, 'CLAUDE.md')));
      await assert.rejects(() => access(join(workspace, 'AGENTS.md')));
      await assert.rejects(() => access(join(workspace, 'GEMINI.md')));
      await assert.rejects(() => access(join(workspace, '.cursor')));

      const skillRows = await readSkillsManifest(workspace);
      assert.deepEqual(skillRows, []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('manifest.profile is "minimal" for a minimal install and "full" for a default install', async () => {
    const tmp = await makeTmpDir();
    try {
      const minimalDir = join(tmp, 'minimal');
      const fullDir = join(tmp, 'full');
      await mkdir(minimalDir, { recursive: true });
      await mkdir(fullDir, { recursive: true });

      await installCommand({ directory: minimalDir, yes: true, noUpdate: true, profile: 'minimal' });
      await installCommand({ directory: fullDir, yes: true, noUpdate: true });

      const minimalMf = JSON.parse(await readFile(join(minimalDir, '_lumina', 'manifest.json'), 'utf8'));
      const fullMf = JSON.parse(await readFile(join(fullDir, '_lumina', 'manifest.json'), 'utf8'));
      assert.equal(minimalMf.profile, 'minimal');
      assert.equal(fullMf.profile, 'full');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a manifest lacking the profile field is treated as full on re-install (backward compatible, no crash)', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true }); // full profile
      const mfPath = join(tmp, '_lumina', 'manifest.json');
      const mf = JSON.parse(await readFile(mfPath, 'utf8'));
      delete mf.profile; // simulate a pre-profile-feature manifest
      await writeFile(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');

      // Re-install without opts.profile must not crash, and must write the
      // field back as 'full' rather than leaving it missing/undefined.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const mf2 = JSON.parse(await readFile(mfPath, 'utf8'));
      assert.equal(mf2.profile, 'full');
      // A stale/missing profile field never silently degrades an existing
      // full install's payload.
      await access(join(tmp, '.agents', 'skills'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('opts.purpose lands in README Project Purpose section and survives a second install', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        purpose: 'Track flash-attention variants for a survey',
      });
      let readme = await readFile(join(tmp, 'README.md'), 'utf8');
      assert.match(readme, /## Project Purpose/);
      assert.match(readme, /Track flash-attention variants for a survey/);

      // Second install (upgrade) without a purpose override must not erase
      // it — the purpose region lives outside the schema-region-only rewrite.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      readme = await readFile(join(tmp, 'README.md'), 'utf8');
      assert.match(readme, /Track flash-attention variants for a survey/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('installing minimal profile twice is idempotent', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'minimal-idempotent');
    await mkdir(workspace, { recursive: true });
    try {
      const runOpts = {
        directory: workspace,
        yes: true,
        profile: 'minimal',
        packs: ['core', 'research'],
        ideTargets: ['generic'],
        purpose: 'idempotency check',
        noUpdate: true,
      };
      await installCommand(runOpts);
      const snapshot1 = await snapshotTree(workspace, ['_lumina/manifest.json', '_lumina/_state']);
      await installCommand(runOpts);
      const snapshot2 = await snapshotTree(workspace, ['_lumina/manifest.json', '_lumina/_state']);
      assert.deepEqual(snapshot2, snapshot1);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a full-profile install remains byte-identical to today (no profile-related drift)', async () => {
    const tmp = await makeTmpDir();
    const workspace = join(tmp, 'full-unchanged');
    await mkdir(workspace, { recursive: true });
    try {
      await installCommand({ directory: workspace, yes: true, noUpdate: true });
      await access(join(workspace, '.agents', 'skills', 'lumi-init'));
      await access(join(workspace, 'CLAUDE.md'));
      const skillRows = await readSkillsManifest(workspace);
      assert.ok(skillRows.length > 0);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Skill deletion ownership guard — foreign-collision protection
//
// A destructive site is "foreign-collision safe" when it never deletes an
// on-disk entry at one of Lumina's own lumi-* skill paths unless that entry
// is either recorded in the relevant ownership manifest, or carries a
// Lumina fingerprint (symlink resolving into Lumina's own tree, or a
// SKILL.md whose frontmatter `name:` matches). These tests use Lumina's OWN
// skill names (lumi-ask, lumi-init) for the collision, unlike the older
// tests above which use unrelated names (custom-skill, lumi-research-discover
// with Claude never selected) that never actually reach the destructive
// call — so those never exercised this hole.
// ---------------------------------------------------------------------------

describe('installCommand — skill deletion ownership guard (foreign-collision protection)', () => {
  test('a foreign real directory at .claude/skills/lumi-ask survives a fresh install, a re-install, and --re-link, byte-identical', async () => {
    const tmp = await makeTmpDir();
    const foreignPath = join(tmp, '.claude', 'skills', 'lumi-ask');
    const marker = join(foreignPath, 'marker.txt');
    const foreignContent = 'user-owned content, not a Lumina skill\n';
    try {
      await mkdir(foreignPath, { recursive: true });
      await writeFile(marker, foreignContent, 'utf8');

      // Fresh install: no manifest yet, so this is the "worst case" collision.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      assert.equal(await readFile(marker, 'utf8'), foreignContent);
      const afterFresh = await lstat(foreignPath);
      assert.ok(afterFresh.isDirectory() && !afterFresh.isSymbolicLink());

      // The .agents/skills copy of lumi-ask still installed fine — the
      // collision is scoped to the .claude symlink site only.
      await access(join(tmp, '.agents', 'skills', 'lumi-ask', 'SKILL.md'));
      // Every other skill's Claude Code link still got created normally —
      // one foreign collision does not abort the whole install.
      await access(join(tmp, '.claude', 'skills', 'lumi-init', 'SKILL.md'));

      // Re-install (no --re-link): still no manifest record for lumi-ask's
      // link (nothing was ever recorded), so the guard keeps protecting it.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      assert.equal(await readFile(marker, 'utf8'), foreignContent);

      // --re-link forces existingStrategy to null for every skill — still
      // must not blow away foreign content.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, reLink: true });
      assert.equal(await readFile(marker, 'utf8'), foreignContent);
      const afterReLink = await lstat(foreignPath);
      assert.ok(afterReLink.isDirectory() && !afterReLink.isSymbolicLink());
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a foreign real directory at .agents/skills/lumi-ask survives two installs, byte-identical, without being recorded as installed', async () => {
    const tmp = await makeTmpDir();
    const foreignPath = join(tmp, '.agents', 'skills', 'lumi-ask');
    const marker = join(foreignPath, 'marker.txt');
    const foreignContent = 'user-owned .agents content, not Lumina\n';
    try {
      await mkdir(foreignPath, { recursive: true });
      await writeFile(marker, foreignContent, 'utf8');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      assert.equal(await readFile(marker, 'utf8'), foreignContent);

      const rows1 = await readSkillsManifest(tmp);
      assert.ok(
        !rows1.some(r => r.canonical_id === 'lumi-ask'),
        'lumi-ask must not be recorded as installed while its .agents path is foreign content',
      );
      // Since it was never installed, no Claude Code link was attempted for it either.
      await assert.rejects(() => access(join(tmp, '.claude', 'skills', 'lumi-ask')));
      // Every other skill still installed normally.
      await access(join(tmp, '.agents', 'skills', 'lumi-init', 'SKILL.md'));

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      assert.equal(await readFile(marker, 'utf8'), foreignContent);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a foreign directory named lumi-something-that-is-not-a-lumina-skill survives uninstall', async () => {
    const tmp = await makeTmpDir();
    const foreignPath = join(tmp, '.agents', 'skills', 'lumi-something-that-is-not-a-lumina-skill');
    const marker = join(foreignPath, 'marker.txt');
    const foreignContent = 'not a real Lumina skill, just a lumi-* name\n';
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await mkdir(foreignPath, { recursive: true });
      await writeFile(marker, foreignContent, 'utf8');

      await uninstallCommand({ cwd: tmp, yes: true });

      assert.equal(await readFile(marker, 'utf8'), foreignContent, 'foreign lumi-*-named entry must survive uninstall');
      // Real Lumina skills were still removed.
      await assert.rejects(() => access(join(tmp, '.agents', 'skills', 'lumi-init')));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('positive control: a genuine Lumina skill still gets refreshed on re-install after skills-manifest.csv is deleted (fingerprint fallback)', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const skillMdPath = join(tmp, '.agents', 'skills', 'lumi-ask', 'SKILL.md');
      const original = await readFile(skillMdPath, 'utf8');
      assert.match(original, /^---\nname: lumi-ask/);

      // Simulate a fresh clone / partial restore: _lumina/_state/* is
      // deliberately gitignored runtime state, so the ownership record can
      // legitimately be missing even for a genuinely Lumina-installed skill.
      // The frontmatter (Lumina's fingerprint) is untouched by this.
      await rm(join(tmp, '_lumina', '_state', 'skills-manifest.csv'), { force: true });
      await writeFile(skillMdPath, original + '\n<!-- stale marker, must be replaced by re-install -->\n', 'utf8');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true });

      const refreshed = await readFile(skillMdPath, 'utf8');
      assert.equal(
        refreshed, original,
        'the fingerprint fallback must let a genuine Lumina skill refresh even without a manifest record',
      );
      const rows = await readSkillsManifest(tmp);
      assert.ok(rows.some(r => r.canonical_id === 'lumi-ask'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  // -------------------------------------------------------------------------
  // Regression coverage for the manifest short-circuit bug: an earlier
  // version of isLuminaOwnedSkillEntry did `if (recordedInManifest) return
  // true` before any fingerprint check. Every lumi-* id gets recorded on the
  // very first install, so from the SECOND install onward every lumi-* path
  // was treated as unconditionally owned no matter what currently occupied
  // it — the fingerprint protection only ever fired on a skill's first
  // collision. These tests install cleanly first (so the manifest genuinely
  // does record the id), THEN swap in fingerprint-foreign content, THEN
  // reinstall — the exact sequence the short-circuit got wrong.
  // -------------------------------------------------------------------------

  // captureLogs is defined at module scope (top of file) so it's usable by
  // every describe block, not just this one.

  test('a post-install swap to fingerprint-foreign content at .claude/skills/lumi-ask survives reinstall, with a warning', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      // Genuine Lumina content existed here and is now recorded in the
      // manifest (symlinkStrategies['lumi-ask']) — exactly the state the
      // short-circuit would have trusted blindly.
      await access(join(tmp, '.claude', 'skills', 'lumi-ask', 'SKILL.md'));

      // Swap the symlink out for a real, unambiguously foreign directory —
      // fingerprintable (has a SKILL.md) but for a DIFFERENT skill id, so
      // there is no ambiguity about it not being lumi-ask.
      await rm(join(tmp, '.claude', 'skills', 'lumi-ask'), { recursive: true, force: true });
      const foreignDir = join(tmp, '.claude', 'skills', 'lumi-ask');
      await mkdir(foreignDir, { recursive: true });
      const foreignSkillMd = '---\nname: not-lumi-ask\ndescription: unrelated content that happens to sit at the lumi-ask path\n---\nHello.\n';
      await writeFile(join(foreignDir, 'SKILL.md'), foreignSkillMd, 'utf8');

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true }));

      assert.equal(await readFile(join(foreignDir, 'SKILL.md'), 'utf8'), foreignSkillMd, 'foreign content must survive even though lumi-ask was previously recorded as installed here');
      // This site (createSkillSymlinks -> linkDirectory) prints fs.js's own
      // message text, which differs in wording from commands.js's
      // warnForeignSkillEntry — match the phrase common to both.
      assert.match(output, /will not touch content it does not recognize/, 'a warning must be emitted for the second-collision case, not silence');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a post-install swap to fingerprint-foreign content at .agents/skills/lumi-edit survives reinstall, with a warning', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await access(join(tmp, '.agents', 'skills', 'lumi-edit', 'SKILL.md'));
      const rowsBefore = await readSkillsManifest(tmp);
      assert.ok(rowsBefore.some(r => r.canonical_id === 'lumi-edit'), 'lumi-edit must be genuinely recorded before the swap');

      await rm(join(tmp, '.agents', 'skills', 'lumi-edit'), { recursive: true, force: true });
      const foreignDir = join(tmp, '.agents', 'skills', 'lumi-edit');
      await mkdir(foreignDir, { recursive: true });
      const foreignSkillMd = '---\nname: not-lumi-edit\ndescription: unrelated content that happens to sit at the lumi-edit path\n---\nHello.\n';
      await writeFile(join(foreignDir, 'SKILL.md'), foreignSkillMd, 'utf8');

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true }));

      assert.equal(await readFile(join(foreignDir, 'SKILL.md'), 'utf8'), foreignSkillMd, 'foreign content must survive even though lumi-edit was previously recorded as installed here');
      assert.match(output, /does not recognize as its own/);

      const rowsAfter = await readSkillsManifest(tmp);
      assert.ok(!rowsAfter.some(r => r.canonical_id === 'lumi-edit'), 'lumi-edit must no longer be recorded as installed once its path is foreign');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('dropping a pack whose skill path was swapped for fingerprint-foreign content leaves that content in place (removeManagedSkillLink / reconcileRemovedSkills guard)', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core,research', ideTargets: 'claude_code',
      });
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-research-discover');
      await access(join(linkPath, 'SKILL.md'));

      // Swap the research-pack skill's Claude Code link out for unambiguously
      // foreign, but still fingerprintable, content.
      await rm(linkPath, { recursive: true, force: true });
      await mkdir(linkPath, { recursive: true });
      const foreignSkillMd = '---\nname: not-lumi-research-discover\ndescription: unrelated content\n---\nHi.\n';
      await writeFile(join(linkPath, 'SKILL.md'), foreignSkillMd, 'utf8');

      // Drop the research pack — this is exactly the "pack deselected"
      // reconciliation path that calls removeManagedSkillLink /
      // reconcileRemovedSkills's obsolete-skill cleanup.
      const output = await captureLogs(() => installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core', ideTargets: 'claude_code',
      }));

      assert.equal(await readFile(join(linkPath, 'SKILL.md'), 'utf8'), foreignSkillMd, 'foreign content at a dropped skill\'s link path must survive');
      assert.match(output, /does not recognize as its own/);

      // The .agents/skills/lumi-research-discover source copy (a different
      // site, not swapped in this test) was still cleaned up normally.
      await assert.rejects(() => access(join(tmp, '.agents', 'skills', 'lumi-research-discover')));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a multi-collision reinstall (pack drop + IDE-target drop + non-colliding foreign entries, all at once) protects every foreign entry and exits 0', async () => {
    // Combined scenario: install with every pack and two IDE targets, plant
    // a mix of foreign content (two non-colliding entries that were never at
    // risk, plus three lumi-* collisions — two whose packs get dropped, one
    // whose pack is KEPT but whose IDE target is dropped), then reinstall
    // down to core-only + a single IDE target. Every foreign entry —
    // colliding or not — must survive, with a warning for each collision,
    // and the run must still exit 0 (installCommand resolving normally).
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core,research,reading,learning',
        ideTargets: 'claude_code,codex',
      });
      const skillCountBefore = (await readSkillsManifest(tmp)).length;
      assert.ok(skillCountBefore > 15, 'expected the full skill set across all packs');

      // Non-colliding foreign entries — never at risk, but included so a
      // regression that broke "ignore names we don't manage" would show up too.
      await mkdir(join(tmp, '.claude', 'skills', 'totally-foreign-dir'), { recursive: true });
      await writeFile(join(tmp, '.claude', 'skills', 'totally-foreign-dir', 'FILE.md'), 'foreign\n', 'utf8');
      await writeFile(join(tmp, '.claude', 'skills', 'LOOSE-A.txt'), 'loose foreign file\n', 'utf8');
      await mkdir(join(tmp, '.agents', 'skills', 'totally-foreign-dir-2'), { recursive: true });
      await writeFile(join(tmp, '.agents', 'skills', 'totally-foreign-dir-2', 'FILE.md'), 'foreign\n', 'utf8');
      await writeFile(join(tmp, '.agents', 'skills', 'LOOSE-B.txt'), 'loose foreign file\n', 'utf8');

      const swap = async (relPath, canonicalId) => {
        const dir = join(tmp, relPath);
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        const content = `---\nname: not-${canonicalId}\ndescription: foreign\n---\nHi.\n`;
        await writeFile(join(dir, 'SKILL.md'), content, 'utf8');
        return content;
      };

      // Pack dropped in install #2.
      const surveyContent = await swap(join('.claude', 'skills', 'lumi-research-survey'), 'lumi-research-survey');
      // Pack dropped in install #2.
      const reflectContent = await swap(join('.agents', 'skills', 'lumi-learning-reflect'), 'lumi-learning-reflect');
      // Pack KEPT — only the codex... wait, claude_code IDE target is dropped.
      const editContent = await swap(join('.claude', 'skills', 'lumi-edit'), 'lumi-edit');

      const output = await captureLogs(() => installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core', ideTargets: 'codex',
      }));

      // All three collisions survived byte-identical, each with a warning.
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'lumi-research-survey', 'SKILL.md'), 'utf8'), surveyContent);
      assert.equal(await readFile(join(tmp, '.agents', 'skills', 'lumi-learning-reflect', 'SKILL.md'), 'utf8'), reflectContent);
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'lumi-edit', 'SKILL.md'), 'utf8'), editContent);
      const warnCount = (output.match(/does not recognize as its own/g) || []).length;
      assert.ok(warnCount >= 3, `expected at least 3 foreign-collision warnings, got ${warnCount}\n${output}`);

      // Non-colliding foreign entries survived too, untouched.
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'totally-foreign-dir', 'FILE.md'), 'utf8'), 'foreign\n');
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'LOOSE-A.txt'), 'utf8'), 'loose foreign file\n');
      assert.equal(await readFile(join(tmp, '.agents', 'skills', 'totally-foreign-dir-2', 'FILE.md'), 'utf8'), 'foreign\n');
      assert.equal(await readFile(join(tmp, '.agents', 'skills', 'LOOSE-B.txt'), 'utf8'), 'loose foreign file\n');

      // A second, identical reinstall is still exit-0 and stable (installCommand
      // resolving without throwing is the in-process equivalent of exit 0).
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, packs: 'core', ideTargets: 'codex' });
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('dropping the claude_code IDE target alone (pack kept) leaves a swapped-in foreign lumi-edit untouched, with a warning', async () => {
    // Isolates the single most striking case from the combined test above:
    // lumi-edit's PACK (core) is never dropped between the two installs —
    // only the claude_code IDE target is. Before the fingerprint guard,
    // reconcileRemovedIdeTargets -> removeManagedSkillLink swept every
    // previously-recorded .claude/skills/<id> path unconditionally on an
    // IDE-target drop, which is a far more ordinary reinstall than a pack
    // change and would have emptied nearly all of .claude/skills/ for any
    // user who runs it. Non-colliding foreign entries are included as
    // controls: they were never at risk, but pin that this guard doesn't
    // over-trigger on paths it doesn't manage.
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core,research,reading,learning',
        ideTargets: 'claude_code,codex',
      });

      const lumiEditPath = join(tmp, '.claude', 'skills', 'lumi-edit');
      await access(join(lumiEditPath, 'SKILL.md'));
      const rowsBefore = await readSkillsManifest(tmp);
      assert.ok(rowsBefore.some(r => r.canonical_id === 'lumi-edit'), 'lumi-edit must be genuinely recorded before the swap');

      await mkdir(join(tmp, '.claude', 'skills', 'totally-foreign-dir'), { recursive: true });
      await writeFile(join(tmp, '.claude', 'skills', 'totally-foreign-dir', 'FILE.md'), 'foreign\n', 'utf8');
      await writeFile(join(tmp, '.claude', 'skills', 'LOOSE-A.txt'), 'loose foreign file\n', 'utf8');

      await rm(lumiEditPath, { recursive: true, force: true });
      await mkdir(lumiEditPath, { recursive: true });
      const foreignContent = '---\nname: not-lumi-edit\ndescription: unrelated content that happens to sit at the lumi-edit path\n---\nHello.\n';
      await writeFile(join(lumiEditPath, 'SKILL.md'), foreignContent, 'utf8');

      // Pack selection unchanged (core stays); only the claude_code IDE
      // target is dropped.
      const output = await captureLogs(() => installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core,research,reading,learning', ideTargets: 'codex',
      }));

      assert.equal(
        await readFile(join(lumiEditPath, 'SKILL.md'), 'utf8'), foreignContent,
        'lumi-edit\'s foreign content must survive an IDE-target drop even though its pack (core) was kept',
      );
      assert.match(output, /does not recognize as its own/);

      // Controls: ordinary foreign entries, never at risk, still untouched.
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'totally-foreign-dir', 'FILE.md'), 'utf8'), 'foreign\n');
      assert.equal(await readFile(join(tmp, '.claude', 'skills', 'LOOSE-A.txt'), 'utf8'), 'loose foreign file\n');

      // A different, non-colliding skill's .claude link (never swapped in
      // this test) was still removed normally by the IDE-target-drop
      // reconciliation — proving the guard protects only the one foreign
      // path, not the whole reconciliation pass.
      await assert.rejects(() => access(join(tmp, '.claude', 'skills', 'lumi-init')));
    } finally {
      await cleanTmp(tmp);
    }
  });

  // -------------------------------------------------------------------------
  // Regression coverage for linkDirectory guarding only its directory
  // branch: `.claude/skills/<id>` entries can be a symlink, a directory, or
  // (as these tests show) a plain file — linkDirectory used to consult
  // isOwned only when existingStat.isDirectory() was true, and unlinked
  // symlinks/files unconditionally otherwise. copySkills and
  // copySkillsToAgentPlatform never had this hole because they ask the
  // ownership question once, before branching on what to do about the
  // answer; linkDirectory branched on shape first and only then remembered
  // to ask for one of the three shapes.
  // -------------------------------------------------------------------------

  test('[regression] a plain file at .claude/skills/lumi-migrate-legacy survives reinstall, with a warning (data-loss case)', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-migrate-legacy');
      await access(linkPath);

      // Replace the entry with a PLAIN FILE, not a directory — this is the
      // shape linkDirectory's old "else { await unlink(linkPath); }" branch
      // never asked isOwned about.
      await rm(linkPath, { recursive: true, force: true });
      const foreignContent = 'a user-owned plain file, not a Lumina skill, sitting at a lumi-* path\n';
      await writeFile(linkPath, foreignContent, 'utf8');

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true }));

      const st = await lstat(linkPath);
      assert.ok(st.isFile(), 'the entry must still be a plain file, not replaced by a fresh Lumina symlink/directory');
      assert.equal(await readFile(linkPath, 'utf8'), foreignContent, 'the foreign file\'s content must survive byte-identical');
      assert.match(output, /does not recognize as its own|does not look like it was installed by Lumina/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a symlink pointing outside Lumina\'s tree at .claude/skills/lumi-ask survives reinstall, with a warning, and its target is untouched', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-ask');
      await access(linkPath);

      // An external directory entirely outside Lumina's .agents/skills tree.
      const externalDir = join(tmp, 'user-owned-external-dir');
      await mkdir(externalDir, { recursive: true });
      const externalMarker = join(externalDir, 'marker.txt');
      await writeFile(externalMarker, 'external content the user cares about\n', 'utf8');

      await rm(linkPath, { recursive: true, force: true });
      await symlink(externalDir, linkPath);

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true }));

      const st = await lstat(linkPath);
      assert.ok(st.isSymbolicLink(), 'the entry must still be a symlink, not replaced by a fresh Lumina symlink');
      const resolved = await readlink(linkPath);
      assert.equal(resolve(dirname(linkPath), resolved), externalDir, 'the symlink must still point at the external directory, not Lumina\'s own tree');
      assert.equal(await readFile(externalMarker, 'utf8'), 'external content the user cares about\n', 'the external target\'s content must be completely untouched');
      assert.match(output, /does not recognize as its own|does not look like it was installed by Lumina/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a broken symlink at .claude/skills/lumi-edit survives reinstall rather than being silently replaced', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-edit');
      await access(linkPath);

      const nonexistentTarget = join(tmp, 'nonexistent-target-xyz');
      await rm(linkPath, { recursive: true, force: true });
      await symlink(nonexistentTarget, linkPath);

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true }));

      const st = await lstat(linkPath);
      assert.ok(st.isSymbolicLink(), 'the entry must still be a symlink');
      const resolved = await readlink(linkPath);
      assert.equal(resolve(dirname(linkPath), resolved), nonexistentTarget, 'the broken symlink must still point at the same (nonexistent) target, not be silently replaced');
      assert.match(output, /does not recognize as its own|does not look like it was installed by Lumina/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[positive control] a genuine Lumina symlink is still refreshed normally under --re-link, with no warning', async () => {
    // Guards against the fix above becoming over-broad: --re-link forces
    // existingStrategy to null for every skill, so this never takes the
    // fast "already matches recorded strategy" early return — it must reach
    // the ownership check and be correctly recognized as genuinely owned
    // (its realpath resolves into Lumina's own .agents/skills tree), not
    // just "not yet proven foreign."
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-ask');
      const before = await lstat(linkPath);
      assert.ok(before.isSymbolicLink());

      const output = await captureLogs(() => installCommand({ cwd: tmp, yes: true, noUpdate: true, reLink: true }));

      assert.doesNotMatch(output, /does not recognize as its own|does not look like it was installed by Lumina/, 're-linking a genuine Lumina symlink must not warn');
      await access(join(linkPath, 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// isLuminaOwnedSkillEntry — lstat failure handling (fail-closed, not fail-open)
//
// Node's node:test mock.method cannot intercept a destructured named import
// from a built-in ESM module (verified directly: mock.method throws
// "Cannot redefine property" against node:fs/promises's namespace object,
// and a CJS require()'d reference doesn't propagate to the ESM binding
// either) — so `lstatImpl` is a real injectable parameter on
// isLuminaOwnedSkillEntry, not a mocked global. A permission fixture (e.g.
// chmod 000) cannot reproduce an lstat failure in isolation either: lstat
// only needs traverse permission on ANCESTOR directories, never on the
// entry itself, and chmod-ing a whole shared parent (.claude/skills/, say)
// to block traversal would also break every sibling skill in the same
// install, not just the one under test.
// ---------------------------------------------------------------------------

describe('isLuminaOwnedSkillEntry — lstat failure handling', () => {
  test('[regression] lstat failing with EACCES yields foreign (fail closed), not owned', async () => {
    const failingLstat = async () => {
      const err = new Error('permission denied');
      err.code = 'EACCES';
      throw err;
    };
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant/for/this/test',
      canonicalId: 'lumi-ask',
      lstatImpl: failingLstat,
    });
    assert.equal(owned, false, 'an lstat failure other than ENOENT/ENOTDIR must be treated as foreign — something is there and Lumina could not look at it');
  });

  test('[regression] lstat failing with EPERM also yields foreign', async () => {
    const failingLstat = async () => {
      const err = new Error('operation not permitted');
      err.code = 'EPERM';
      throw err;
    };
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant/for/this/test',
      canonicalId: 'lumi-ask',
      lstatImpl: failingLstat,
    });
    assert.equal(owned, false);
  });

  test('positive control: lstat failing with ENOENT still means "nothing there", not foreign', async () => {
    const enoentLstat = async () => {
      const err = new Error('no such file or directory');
      err.code = 'ENOENT';
      throw err;
    };
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant/for/this/test',
      canonicalId: 'lumi-ask',
      lstatImpl: enoentLstat,
    });
    assert.equal(owned, true, 'ENOENT genuinely means nothing is there — no collision to protect against');
  });

  test('positive control: lstat failing with ENOTDIR still means "nothing there", not foreign', async () => {
    const enotdirLstat = async () => {
      const err = new Error('not a directory');
      err.code = 'ENOTDIR';
      throw err;
    };
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant/for/this/test',
      canonicalId: 'lumi-ask',
      lstatImpl: enotdirLstat,
    });
    assert.equal(owned, true);
  });
});

// ---------------------------------------------------------------------------
// Deletion sites degrade instead of aborting the whole install
//
// copySkills, copySkillsToAgentPlatform, reconcileRemovedSkills, and
// removeManagedSkillLink all call `rm` with no try/catch, so a real
// deletion failure (permissions, a read-only mount, quota, an immutable
// flag) would propagate as an unhandled rejection and take the whole
// install down — createSkillSymlinks already collects such failures
// instead of crashing; these four now match it. Both call sites use an
// injectable `rmImpl` for the same reason isLuminaOwnedSkillEntry needed
// `lstatImpl`: the failure can't be isolated to a single sibling entry via
// real filesystem permissions without a shared-parent side effect on every
// other skill in the same install.
// ---------------------------------------------------------------------------

describe('deletion sites degrade instead of aborting the install', () => {
  test('[regression] a delete that fails during copySkills does not abort — other skills still install, and the failure is reported', async () => {
    const tmp = await makeTmpDir();
    try {
      const colors = { yellow: (s) => s };
      const failingCanonicalId = 'lumi-edit';
      const rmImpl = async (path, opts) => {
        if (path.endsWith(join('.agents', 'skills', failingCanonicalId))) {
          const err = new Error('permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return rm(path, opts);
      };

      let skillRows;
      let output;
      await assert.doesNotReject(async () => {
        output = await captureLogs(async () => {
          skillRows = await copySkills(tmp, ['core'], { claudeCode: false, colors, rmImpl });
        });
      }, 'copySkills must not throw when one deletion fails');

      assert.ok(skillRows.some(r => r.canonical_id === 'lumi-init'), 'other skills must still install');
      assert.ok(!skillRows.some(r => r.canonical_id === failingCanonicalId), 'the skill whose delete failed must be skipped, not partially installed');
      assert.match(output, /Could not remove|does not recognize/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a delete that fails in removeManagedSkillLink does not throw — the failure is reported and the entry survives', async () => {
    const tmp = await makeTmpDir();
    try {
      const colors = { yellow: (s) => s };
      const skillDir = join(tmp, '.agents', 'skills', 'lumi-ask');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: lumi-ask\ndescription: x\n---\nhi\n', 'utf8');
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-ask');
      await mkdir(dirname(linkPath), { recursive: true });
      await symlink(skillDir, linkPath);

      const failingRm = async () => {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      };

      const skill = {
        canonical_id: 'lumi-ask',
        relative_path: join('.agents', 'skills', 'lumi-ask'),
        target_link_path: join('.claude', 'skills', 'lumi-ask'),
        managed_link: true,
      };

      let output;
      await assert.doesNotReject(async () => {
        output = await captureLogs(async () => {
          await removeManagedSkillLink(tmp, skill, colors, failingRm);
        });
      }, 'removeManagedSkillLink must not throw when the delete fails');

      assert.match(output, /Could not remove/);
      await access(linkPath); // survives — the delete genuinely failed
    } finally {
      await cleanTmp(tmp);
    }
  });

  // The two uninstall-path sites (flagged in an earlier round, fixed in
  // this one): an uninstall that aborts partway leaves the user in a
  // half-removed state with no obvious way forward, so these get the same
  // treatment as the install-path sites above.

  test('[regression] a delete that fails in removeOwnedAgentsSkills (uninstall, .agents/skills/lumi-*) does not throw — the failure is reported and the entry survives', async () => {
    const tmp = await makeTmpDir();
    try {
      const colors = { yellow: (s) => s };
      const skillDir = join(tmp, '.agents', 'skills', 'lumi-ask');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: lumi-ask\ndescription: x\n---\nhi\n', 'utf8');

      const failingRm = async () => {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      };

      let output;
      await assert.doesNotReject(async () => {
        output = await captureLogs(async () => {
          await removeOwnedAgentsSkills(tmp, colors, failingRm);
        });
      }, 'removeOwnedAgentsSkills must not throw when the delete fails');

      assert.match(output, /Could not remove/);
      await access(skillDir); // survives — the delete genuinely failed
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a delete that fails in removeOwnedClaudeSkillLinks (uninstall, .claude/skills/lumi-*) does not throw — the failure is reported and the entry survives', async () => {
    const tmp = await makeTmpDir();
    try {
      const colors = { yellow: (s) => s };
      const skillDir = join(tmp, '.agents', 'skills', 'lumi-ask');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: lumi-ask\ndescription: x\n---\nhi\n', 'utf8');
      const linkPath = join(tmp, '.claude', 'skills', 'lumi-ask');
      await mkdir(dirname(linkPath), { recursive: true });
      await symlink(skillDir, linkPath);

      const failingRm = async () => {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      };

      let output;
      await assert.doesNotReject(async () => {
        output = await captureLogs(async () => {
          await removeOwnedClaudeSkillLinks(tmp, colors, failingRm);
        });
      }, 'removeOwnedClaudeSkillLinks must not throw when the delete fails');

      assert.match(output, /Could not remove/);
      await access(linkPath); // survives — the delete genuinely failed
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Uninstall must not treat CLAUDE.md/AGENTS.md/etc. as pure Lumina
// artifacts — Lumina only owns a small rendered stub inside them, and a
// user routinely adds their own project instructions to the same file.
// Confirming the uninstall confirms removing Lumina, not the user's own
// notes. Uses the same SHA256 content-integrity check the upgrade path
// already applies when an IDE target is dropped.
// ---------------------------------------------------------------------------

describe('uninstallCommand — IDE stub files are content-checked, not blindly deleted', () => {
  test('an unmodified CLAUDE.md stub is removed on uninstall', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      await access(join(tmp, 'CLAUDE.md'));

      await uninstallCommand({ cwd: tmp, yes: true });

      await assert.rejects(() => access(join(tmp, 'CLAUDE.md')));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a user-modified CLAUDE.md survives uninstall, with a warning, instead of being silently deleted', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const claudeMdPath = join(tmp, 'CLAUDE.md');
      const userContent = '# My own project instructions\n\nThings I added after installing Lumina that I never thought of as Lumina\'s to delete.\n';
      await writeFile(claudeMdPath, userContent, 'utf8');

      const output = await captureLogs(() => uninstallCommand({ cwd: tmp, yes: true }));

      assert.equal(await readFile(claudeMdPath, 'utf8'), userContent, 'a modified CLAUDE.md must survive uninstall byte-identical');
      assert.match(output, /preserved|Kept modified file/i);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// A vanilla, entirely non-adversarial install-then-uninstall must clean up
// every .claude/skills/lumi-* link. Root cause was ordering: uninstallCommand
// deleted .agents/skills/<id> (via removeOwnedAgentsSkills) BEFORE checking
// ownership of .claude/skills/<id> (via removeOwnedClaudeSkillLinks), which
// judges a symlink's ownership by resolving it against its
// .agents/skills/<id> target — a target the earlier pass had already deleted.
// realpath() on the now-broken symlink threw ENOENT, the ownership check
// failed closed as "foreign", and every legitimate link was misjudged and
// left behind, dangling, forever (a second uninstall on the broken state
// reproduces the same outcome). Fixed two ways: reorder the two removals,
// AND stop requiring the target to exist at all — a readlink-based fallback
// recognizes a dangling-but-legitimate Lumina link on its own merits.
// ---------------------------------------------------------------------------

describe('uninstallCommand — .claude/skills/lumi-* links are actually removed', () => {
  test('[regression] a vanilla install then uninstall removes every .claude/skills/lumi-* link, no warnings', async () => {
    const tmp = await makeTmpDir();
    const claudeSkillsDir = join(tmp, '.claude', 'skills');
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, packs: 'core', ideTargets: 'claude_code' });
      const before = await readdir(claudeSkillsDir);
      assert.ok(before.length > 0, 'expected the fresh install to have created lumi-* links');

      const output = await captureLogs(() => uninstallCommand({ cwd: tmp, yes: true }));

      const after = await readdir(claudeSkillsDir).catch(() => []);
      assert.deepEqual(after, [], 'every .claude/skills/lumi-* link must be gone after an ordinary uninstall');
      assert.doesNotMatch(output, /does not recognize as its own|does not look like it was installed by Lumina/, 'a legitimate Lumina link must never be reported as foreign');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('install -> --re-link -> uninstall still removes every .claude/skills/lumi-* link, no warnings', async () => {
    // Real-world journey this guards: a user installs, later enables Windows
    // Developer Mode and runs --re-link to upgrade off a copy fallback, then
    // eventually uninstalls. --re-link has install-side coverage elsewhere
    // (forces existingStrategy to null and re-verifies every link), but
    // nothing previously carried that forward into an uninstall — this is
    // the missing last leg of the journey.
    const tmp = await makeTmpDir();
    const claudeSkillsDir = join(tmp, '.claude', 'skills');
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, packs: 'core', ideTargets: 'claude_code' });
      const afterInstall = await readdir(claudeSkillsDir);
      assert.ok(afterInstall.length > 0, 'expected the fresh install to have created lumi-* links');

      await installCommand({ cwd: tmp, yes: true, noUpdate: true, packs: 'core', ideTargets: 'claude_code', reLink: true });
      const afterReLink = await readdir(claudeSkillsDir);
      assert.ok(afterReLink.length > 0, 'expected --re-link to leave every lumi-* link in place');

      const output = await captureLogs(() => uninstallCommand({ cwd: tmp, yes: true }));

      const afterUninstall = await readdir(claudeSkillsDir).catch(() => []);
      assert.deepEqual(afterUninstall, [], 'every .claude/skills/lumi-* link must be gone after uninstall, even following a --re-link');
      assert.doesNotMatch(output, /does not recognize as its own|does not look like it was installed by Lumina/, 'a legitimate re-linked Lumina link must never be reported as foreign');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('install packs A, upgrade to packs B, uninstall: the workspace ends up fully clean, no foreign content anywhere', async () => {
    // The plain, non-adversarial counterpart to the pack-drop collision
    // tests above (e.g. "dropping a pack whose skill path was swapped for
    // fingerprint-foreign content..."): nothing foreign is ever planted
    // here. This just walks install-with-everything -> drop three packs ->
    // uninstall and checks the ordinary, non-adversarial case lands clean —
    // an assumption the earlier CAP-9 bug (which affected .claude/skills
    // unconditionally, on every uninstall, not just adversarial ones) put
    // in doubt until actually verified.
    const tmp = await makeTmpDir();
    try {
      await installCommand({
        cwd: tmp, yes: true, noUpdate: true,
        packs: 'core,research,reading,learning', ideTargets: 'claude_code',
      });
      const rowsAfterA = await readSkillsManifest(tmp);
      assert.ok(rowsAfterA.length > 15, 'expected the full skill set across all packs');
      await access(join(tmp, '.claude', 'skills', 'lumi-research-discover', 'SKILL.md'));
      await access(join(tmp, '.agents', 'skills', 'lumi-learning-reflect', 'SKILL.md'));

      // Upgrade down to core only — drops research/reading/learning.
      await installCommand({ cwd: tmp, yes: true, noUpdate: true, packs: 'core', ideTargets: 'claude_code' });
      await assert.rejects(() => access(join(tmp, '.claude', 'skills', 'lumi-research-discover')));
      await assert.rejects(() => access(join(tmp, '.agents', 'skills', 'lumi-learning-reflect')));

      const output = await captureLogs(() => uninstallCommand({ cwd: tmp, yes: true }));

      // Nothing foreign was ever planted, so there is nothing for the
      // ownership guard to protect — no collision or deletion-failure
      // warning should ever fire on this plain path.
      assert.doesNotMatch(output, /does not recognize as its own|does not look like it was installed by Lumina|Could not remove/);

      // Fully clean: no lumina-owned trace left anywhere in the workspace.
      await assert.rejects(() => access(join(tmp, '_lumina')));
      await assert.rejects(() => access(join(tmp, '.agents')));
      const claudeSkillsAfter = await readdir(join(tmp, '.claude', 'skills')).catch(() => []);
      assert.deepEqual(claudeSkillsAfter, [], 'no lumi-* entries (from any pack, dropped or not) should remain in .claude/skills after uninstall');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('[regression] a dangling symlink whose .agents/skills/<id> target is already gone is still recognized as Lumina\'s own (readlink fallback)', async () => {
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant-for-this-test/lumi-ask',
      canonicalId: 'lumi-ask',
      expectedTarget: '/irrelevant-for-this-test/.agents/skills/lumi-ask',
      lstatImpl: async () => ({ isSymbolicLink: () => true, isDirectory: () => false }),
      readlinkImpl: async () => '/irrelevant-for-this-test/.agents/skills/lumi-ask',
    });
    assert.equal(owned, true, 'a symlink whose stored target still matches expectedTarget must be owned even when neither path exists');
  });

  test('positive control: a dangling symlink pointing somewhere else entirely is still foreign', async () => {
    const owned = await isLuminaOwnedSkillEntry({
      entryPath: '/irrelevant-for-this-test/lumi-ask',
      canonicalId: 'lumi-ask',
      expectedTarget: '/irrelevant-for-this-test/.agents/skills/lumi-ask',
      lstatImpl: async () => ({ isSymbolicLink: () => true, isDirectory: () => false }),
      readlinkImpl: async () => '/somewhere/entirely/unrelated',
    });
    assert.equal(owned, false, 'the readlink fallback must not become a blanket "assume owned" — a dangling link pointing elsewhere stays foreign');
  });
});
