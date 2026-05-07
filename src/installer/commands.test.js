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

import { installCommand, printPostUpgradeBanner, applyInstallOverrides, validateLanguageInput } from './commands.js';
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
      await access(join(workspace, '.agents', 'skills', 'lumi-research-watchlist', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-ingest', 'references', 'pdf-preprocessing.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-check', 'references', 'lint-checks.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-verify', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(workspace, '.agents', 'skills', 'lumi-help', 'SKILL.md'));
      await access(join(workspace, '_lumina', 'tools', 'prepare_source.py'));
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

  test('skills-catalog.md is rendered into _lumina/schema/ and gates pack sections', async () => {
    const tmp = await makeTmpDir();
    try {
      await installCommand({ cwd: tmp, yes: true, noUpdate: true });
      const catalog = await readFile(join(tmp, '_lumina', 'schema', 'skills-catalog.md'), 'utf8');
      assert.match(catalog, /## Core/);
      assert.match(catalog, /\/lumi-init/);
      assert.match(catalog, /\/lumi-ingest/);
      assert.match(catalog, /\/lumi-help/);
      assert.doesNotMatch(catalog, /## Research pack/);
      assert.doesNotMatch(catalog, /## Reading pack/);
    } finally {
      await cleanTmp(tmp);
    }
  });
});
