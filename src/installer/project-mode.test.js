/**
 * Tests for src/installer/project-mode.js — `lumina install --mode project`
 * and its uninstall counterpart.
 *
 * Pattern follows commands.test.js: spawn the REAL CLI against sandbox
 * dirs created OUTSIDE the repo (never run the installer against the repo
 * root — project-context.md rule 0).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, chmod, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { PROJECT_ENGINE_FILES, PROJECT_IDE_TARGETS, installProject, uninstallProject } from './project-mode.js';
import { pathExists } from './fs.js';
import { META_TYPES, META_RELATIONS } from '../project/ontology.mjs';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json');
const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'lumina-project-mode-test-'));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', timeout: 30000, ...opts,
  });
}

async function gitInit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
}

// ---------------------------------------------------------------------------
// Static completeness checks
// ---------------------------------------------------------------------------

describe('PROJECT_ENGINE_FILES completeness', () => {
  test('every non-test, non-fixture file under src/project/ is listed', async () => {
    const srcDir = join(REPO_ROOT, 'src', 'project');
    const found = [];
    async function walk(dir, relBase) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.name === 'test-fixtures') continue;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), rel);
        } else if (!entry.name.endsWith('.test.mjs')) {
          found.push(rel);
        }
      }
    }
    await walk(srcDir, '');
    const listed = new Set(PROJECT_ENGINE_FILES);
    const missing = found.filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], `files present on disk but missing from PROJECT_ENGINE_FILES: ${missing.join(', ')}`);
    const extra = PROJECT_ENGINE_FILES.filter((f) => !found.includes(f));
    assert.deepEqual(extra, [], `PROJECT_ENGINE_FILES names files absent on disk: ${extra.join(', ')}`);
  });

  test('every listed file is in package.json files', async () => {
    const pkgRaw = await readFile(join(REPO_ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const files = new Set(pkg.files);
    const missing = PROJECT_ENGINE_FILES
      .map((f) => `src/project/${f}`)
      .filter((f) => !files.has(f));
    assert.deepEqual(missing, [], `package.json "files" is missing: ${missing.join(', ')}`);
    assert.ok(files.has('src/installer/project-mode.js'), 'package.json "files" is missing src/installer/project-mode.js');
  });
});

describe('PROJECT.md content', () => {
  test('names every meta-type and meta-relation', async () => {
    const template = await readFile(join(REPO_ROOT, 'src', 'templates', 'project', 'PROJECT.md'), 'utf8');
    for (const metaType of Object.keys(META_TYPES)) {
      assert.ok(template.includes(metaType), `PROJECT.md does not mention meta-type "${metaType}"`);
    }
    for (const relation of META_RELATIONS) {
      assert.ok(template.includes(relation), `PROJECT.md does not mention meta-relation "${relation}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// I/O & edge-case matrix (spec story 7)
// ---------------------------------------------------------------------------

describe('install --mode project', () => {
  test('fresh install: engine, PROJECT.md, install.json; CLAUDE.md created holding only the block; ' +
       'CRLF AGENTS.md block appended in CRLF; .gitignore block; manifest v5 mode=project', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      await writeFile(join(tmp, 'AGENTS.md'), 'existing agents content\r\n');
      await writeFile(join(tmp, '.gitignore'), '.env\n');

      const result = runCli([
        'install', '--mode', 'project', '--yes', '--no-update',
        '--ide-targets', 'claude_code,codex', '--directory', tmp,
      ]);
      assert.equal(result.status, 0, result.stderr);

      for (const rel of PROJECT_ENGINE_FILES) {
        assert.ok(await pathExists(join(tmp, '_lumina', 'project', rel)), `missing engine file ${rel}`);
      }
      const projectMd = await readFile(join(tmp, '_lumina', 'project', 'PROJECT.md'), 'utf8');
      assert.ok(projectMd.includes(`Installed by lumina-wiki ${PKG.version}.`), 'PROJECT.md names the installing version');
      assert.ok(!projectMd.includes('{{'), 'PROJECT.md has no unrendered placeholders');
      const installJson = JSON.parse(await readFile(join(tmp, '_lumina', 'project', 'install.json'), 'utf8'));
      assert.equal(installJson.schemaVersion, 1);
      assert.equal(installJson.packageVersion, PKG.version);
      assert.deepEqual(installJson.ideTargets, ['claude_code', 'codex']);

      const claudeMd = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
      assert.equal(
        claudeMd,
        '<!-- lumina:project -->\n' +
        `This repo uses Lumina project mode (lumina-wiki >= ${PKG.version}). Read \`_lumina/project/PROJECT.md\`.\n` +
        'If `_lumina/config/project.yaml` is missing, run the `lumi-project-setup` skill.\n' +
        '<!-- /lumina:project -->\n',
      );

      const agentsMd = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
      assert.ok(agentsMd.startsWith('existing agents content\r\n'));
      assert.ok(agentsMd.includes('<!-- lumina:project -->\r\n'));
      assert.ok(!agentsMd.split('\r\n').some((line) => line.includes('\n')), 'AGENTS.md must stay CRLF throughout');

      const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
      assert.ok(gitignore.startsWith('.env\n'));
      assert.ok(gitignore.includes('# >>> lumina\n_lumina/graph/\n_lumina/_state/\n_lumina/manifest.json\n# <<< lumina\n'));

      const manifest = JSON.parse(await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8'));
      assert.equal(manifest.schemaVersion, 5);
      assert.equal(manifest.mode, 'project');
      assert.deepEqual(manifest.ideTargets, ['claude_code', 'codex']);

      // Never created in project mode.
      for (const forbidden of ['raw', 'wiki', 'README.md', 'lumina.config.yaml']) {
        assert.ok(!(await pathExists(join(tmp, forbidden))), `must not create ${forbidden}`);
      }
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'schema'))));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'scripts'))));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'tools'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('re-run: no byte change outside manifest.json and _state/', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      const args = ['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp];
      assert.equal(runCli(args).status, 0);

      async function snapshot() {
        const out = [];
        async function walk(dir, relBase) {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
            if (rel === '.git' || rel === '_lumina/manifest.json' || rel.startsWith('_lumina/_state')) continue;
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) await walk(abs, rel);
            else out.push([rel, await readFile(abs, 'utf8').catch(() => 'BINARY')]);
          }
        }
        await walk(tmp, '');
        out.sort((a, b) => a[0].localeCompare(b[0]));
        return out;
      }

      const before = await snapshot();
      assert.equal(runCli(args).status, 0);
      const after = await snapshot();
      assert.deepEqual(after, before);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('teammate clone: no manifest, committed install.json -> upgrades using its targets, no prompts', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      await mkdir(join(tmp, '_lumina', 'project'), { recursive: true });
      await writeFile(
        join(tmp, '_lumina', 'project', 'install.json'),
        JSON.stringify({ schemaVersion: 1, packageVersion: PKG.version, ideTargets: ['codex'] }, null, 2) + '\n',
      );

      const result = runCli(['install', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(await pathExists(join(tmp, 'AGENTS.md')), 'codex target from install.json should write AGENTS.md');
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))), 'claude_code was not in install.json ideTargets');
      const manifest = JSON.parse(await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8'));
      assert.equal(manifest.mode, 'project');
      assert.deepEqual(manifest.ideTargets, ['codex']);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('teammate clone: no manifest, only a committed project.yaml (no install.json) -> upgrades, no prompts', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['install', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      // No install.json and no existing manifest ideTargets -> default claude_code.
      assert.ok(await pathExists(join(tmp, 'CLAUDE.md')));
      const manifest = JSON.parse(await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8'));
      assert.equal(manifest.mode, 'project');
      assert.deepEqual(manifest.ideTargets, ['claude_code']);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('mode conflict: --mode classic over a repo with only a committed project.yaml exits 3, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['install', '--mode', 'classic', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /MODE_CONFLICT/);
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'manifest.json'))));
      assert.ok(!(await pathExists(join(tmp, 'wiki'))));
      assert.ok(!(await pathExists(join(tmp, 'raw'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('classic manifest together with a committed project.yaml (conflicting state) exits 3 on any install', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      assert.equal(runCli(['install', '--yes', '--no-update', '--directory', tmp]).status, 0);
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['install', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /MODE_CONFLICT/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('antigravity target writes the AGENTS.md block, not CLAUDE.md', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'antigravity', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(await pathExists(join(tmp, 'AGENTS.md')));
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))));
      const agentsMd = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
      assert.ok(agentsMd.includes('<!-- lumina:project -->'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('nested cwd: a teammate clone with only install.json is found and upgraded from a subdirectory, with no --directory', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      await mkdir(join(tmp, '_lumina', 'project'), { recursive: true });
      await writeFile(
        join(tmp, '_lumina', 'project', 'install.json'),
        JSON.stringify({ schemaVersion: 1, packageVersion: PKG.version, ideTargets: ['claude_code'] }, null, 2) + '\n',
      );
      const subDir = join(tmp, 'packages', 'alpha');
      await mkdir(subDir, { recursive: true });

      const result = runCli(['install', '--yes', '--no-update'], { cwd: subDir });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(await pathExists(join(tmp, 'CLAUDE.md')), 'root gets the project upgrade');
      assert.ok(await pathExists(join(tmp, '_lumina', 'manifest.json')));
      // Nothing created under the subdirectory itself.
      assert.deepEqual(await readdir(subDir), []);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('mode conflict: --mode classic over a project manifest exits 3, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      assert.equal(runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]).status, 0);
      const before = await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8');

      const result = runCli(['install', '--mode', 'classic', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /MODE_CONFLICT/);
      assert.match(result.stderr, /project\.yaml.*install\.json.*manifest\.json/, 'names every file to delete to switch back');
      const after = await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8');
      assert.equal(after, before);
      assert.ok(!(await pathExists(join(tmp, 'raw'))));
      assert.ok(!(await pathExists(join(tmp, 'wiki'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('mode conflict: --mode project over a classic manifest exits 3, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      assert.equal(runCli(['install', '--yes', '--no-update', '--directory', tmp]).status, 0);
      const before = await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8');

      const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /MODE_CONFLICT/);
      assert.match(result.stderr, /classic Lumina install.*uninstall/, 'says it is classic and to uninstall first');
      assert.doesNotMatch(result.stderr, /project\.yaml/);
      const after = await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8');
      assert.equal(after, before);
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'project'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('bad flags: --mode project with --packs exits 1, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'project', '--packs', 'research', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 1);
      assert.ok(!(await pathExists(join(tmp, '_lumina'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('bad flags: --mode project with --agents exits 1, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'project', '--agents', 'openclaw', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 1);
      assert.ok(!(await pathExists(join(tmp, '_lumina'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('bad flags: an unknown project IDE target exits 1, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'project', '--ide-targets', 'gemini_cli', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 1);
      assert.ok(!(await pathExists(join(tmp, '_lumina'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('bad flags: --mode foo exits 1, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'foo', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 1);
      assert.ok(!(await pathExists(join(tmp, '_lumina'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('default mode: fresh install, no --mode, --yes -> classic (no _lumina/project/)', async () => {
    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(await readFile(join(tmp, '_lumina', 'manifest.json'), 'utf8'));
      assert.equal(manifest.mode, 'classic');
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'project'))));
      assert.ok(await pathExists(join(tmp, 'wiki')));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('ships every src/skills/project skill: byte-identical .agents/skills/<id>/SKILL.md, ' +
       'Skills: N installed matches the shipped set', async () => {
    const skillsSrcDir = join(REPO_ROOT, 'src', 'skills', 'project');
    const entries = await readdir(skillsSrcDir, { withFileTypes: true });
    // Same filter as listProjectSkillDefs: a directory counts only when it holds a SKILL.md.
    const expectedIds = (await Promise.all(entries
      .filter((e) => e.isDirectory())
      .map(async (e) => ((await pathExists(join(skillsSrcDir, e.name, 'SKILL.md'))) ? e.name : null))))
      .filter((id) => id !== null)
      .sort();
    assert.ok(expectedIds.length > 0, 'src/skills/project/ has no skill directories holding a SKILL.md');

    const tmp = await makeTmpDir();
    try {
      const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`Skills:\\s+${expectedIds.length} installed`));

      for (const id of expectedIds) {
        const srcPath = join(skillsSrcDir, id, 'SKILL.md');
        const destPath = join(tmp, '.agents', 'skills', id, 'SKILL.md');
        assert.ok(await pathExists(destPath), `missing ${destPath}`);
        const [src, dest] = await Promise.all([readFile(srcPath), readFile(destPath)]);
        assert.ok(src.equals(dest), `${id}/SKILL.md is not byte-identical to its source`);
      }
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('target dropped: upgrading without claude_code strips the CLAUDE.md block ' +
       '(and deletes the file, since it held only the block)', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      assert.equal(
        runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'claude_code,codex', '--directory', tmp]).status,
        0,
      );
      assert.ok(await pathExists(join(tmp, 'CLAUDE.md')));

      const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'codex', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))), 'CLAUDE.md held only the block and should be deleted');
      assert.ok(await pathExists(join(tmp, 'AGENTS.md')), 'codex is still selected');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('version skew: a committed install.json naming a newer packageVersion refuses install, exit 3, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      const seededInstallJson = JSON.stringify({ schemaVersion: 1, packageVersion: '999.0.0', ideTargets: ['claude_code'] }, null, 2) + '\n';
      await mkdir(join(tmp, '_lumina', 'project'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'project', 'install.json'), seededInstallJson);

      const result = runCli(['install', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /PROJECT_VERSION_SKEW/);

      // _lumina/project/ holds only the seeded install.json — no engine
      // files, no PROJECT.md, and nothing else was written anywhere.
      assert.deepEqual(await readdir(join(tmp, '_lumina', 'project')), ['install.json']);
      assert.equal(await readFile(join(tmp, '_lumina', 'project', 'install.json'), 'utf8'), seededInstallJson);
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))));
      assert.ok(!(await pathExists(join(tmp, 'AGENTS.md'))));
      assert.ok(!(await pathExists(join(tmp, '.gitignore'))));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'manifest.json'))));
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('install --mode project — review fixes', () => {
  test('bad flags: an auto-detected project repo (no --mode) with --packs exits 1, nothing written', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['install', '--packs', 'research', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /cannot be combined with --packs/);
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'project'))));
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('corrupt committed install.json exits 3 naming the file, left untouched', async () => {
    const tmp = await makeTmpDir();
    try {
      await mkdir(join(tmp, '_lumina', 'project'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'project', 'install.json'), '{broken');

      const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]);
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, /install\.json/);
      assert.equal(await readFile(join(tmp, '_lumina', 'project', 'install.json'), 'utf8'), '{broken');
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('a committed install.json target change wins over the stale local manifest', async () => {
    const tmp = await makeTmpDir();
    try {
      const args = ['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp];
      assert.equal(runCli(args).status, 0);
      assert.ok(await pathExists(join(tmp, 'CLAUDE.md')));
      // Teammate commits a switch to codex; this clone's manifest still says claude_code.
      const installJsonPath = join(tmp, '_lumina', 'project', 'install.json');
      const installJson = JSON.parse(await readFile(installJsonPath, 'utf8'));
      installJson.ideTargets = ['codex'];
      await writeFile(installJsonPath, JSON.stringify(installJson, null, 2) + '\n');

      const result = runCli(args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await readFile(installJsonPath, 'utf8')).ideTargets, ['codex']);
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))), 'claude_code block stripped');
      assert.ok((await readFile(join(tmp, 'AGENTS.md'), 'utf8')).includes('<!-- lumina:project -->'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('an unreadable AGENTS.md is refused (exit 2), never replaced by the block',
    { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
      const tmp = await makeTmpDir();
      const agentsMd = join(tmp, 'AGENTS.md');
      try {
        await writeFile(agentsMd, 'user notes\n');
        await chmod(agentsMd, 0o000);
        const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'codex', '--directory', tmp]);
        assert.equal(result.status, 2, result.stderr);
        await chmod(agentsMd, 0o644);
        assert.equal(await readFile(agentsMd, 'utf8'), 'user notes\n');
      } finally {
        await chmod(agentsMd, 0o644).catch(() => {});
        await cleanTmp(tmp);
      }
    });

  test('CLAUDE.md symlinked to AGENTS.md stays a symlink; one block, stripped on uninstall',
    { skip: process.platform === 'win32' }, async () => {
      const tmp = await makeTmpDir();
      try {
        await writeFile(join(tmp, 'AGENTS.md'), 'user notes\n');
        await symlink('AGENTS.md', join(tmp, 'CLAUDE.md'));

        for (const targets of ['claude_code,codex', 'claude_code']) {
          const result = runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', targets, '--directory', tmp]);
          assert.equal(result.status, 0, result.stderr);
          assert.ok((await lstat(join(tmp, 'CLAUDE.md'))).isSymbolicLink(), `CLAUDE.md is still a symlink (${targets})`);
          const content = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
          assert.equal(content.split('<!-- lumina:project -->').length - 1, 1, `exactly one block (${targets})`);
          assert.ok(content.startsWith('user notes\n'));
        }

        assert.equal(runCli(['uninstall', '--yes', '--directory', tmp]).status, 0);
        assert.ok((await lstat(join(tmp, 'CLAUDE.md'))).isSymbolicLink());
        assert.equal(await readFile(join(tmp, 'AGENTS.md'), 'utf8'), 'user notes\n');
      } finally {
        await cleanTmp(tmp);
      }
    });
});

describe('uninstall project mode', () => {
  test('strips blocks, deletes blank entry files, empties _lumina/ except facts/ and config/, ' +
       '--yes keeps facts/config', async () => {
    const tmp = await makeTmpDir();
    try {
      await gitInit(tmp);
      await writeFile(join(tmp, '.gitignore'), '.env\n');
      assert.equal(
        runCli(['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'claude_code,codex', '--directory', tmp]).status,
        0,
      );
      await mkdir(join(tmp, '_lumina', 'facts'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'facts', 'doc.json'), '{}\n');
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['uninstall', '--yes', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);

      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))));
      assert.ok(!(await pathExists(join(tmp, 'AGENTS.md'))));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'project'))));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'manifest.json'))));
      assert.ok(await pathExists(join(tmp, '_lumina', 'facts', 'doc.json')), '--yes keeps facts/');
      assert.ok(await pathExists(join(tmp, '_lumina', 'config', 'project.yaml')), '--yes keeps config/');
      assert.ok(!(await pathExists(join(tmp, '.agents', 'skills', 'lumi-project-setup'))), 'uninstall removes .agents/skills/lumi-project-setup');
      assert.ok(!(await pathExists(join(tmp, '.claude', 'skills', 'lumi-project-setup'))), 'uninstall removes .claude/skills/lumi-project-setup');

      const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
      assert.ok(!gitignore.includes('lumina:project') && !gitignore.includes('>>> lumina'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('leaves no empty _lumina/, .claude/, or .agents/ behind', async () => {
    const tmp = await makeTmpDir();
    try {
      assert.equal(runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]).status, 0);
      const result = runCli(['uninstall', '--yes', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      for (const dir of ['_lumina', '.claude', '.agents']) {
        assert.ok(!(await pathExists(join(tmp, dir))), `${dir}/ should be removed once empty`);
      }
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('corrupt manifest in a project repo still runs the project uninstall: facts/ and config/ survive', async () => {
    const tmp = await makeTmpDir();
    try {
      assert.equal(runCli(['install', '--mode', 'project', '--yes', '--no-update', '--directory', tmp]).status, 0);
      await mkdir(join(tmp, '_lumina', 'facts'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'facts', 'doc.json'), '{}\n');
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');
      await writeFile(join(tmp, '_lumina', 'manifest.json'), '{broken');

      const result = runCli(['uninstall', '--yes', '--directory', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(await pathExists(join(tmp, '_lumina', 'facts', 'doc.json')));
      assert.ok(await pathExists(join(tmp, '_lumina', 'config', 'project.yaml')));
      assert.ok(!(await pathExists(join(tmp, '_lumina', 'project'))));
      assert.ok(!(await pathExists(join(tmp, 'CLAUDE.md'))), 'lumina:project block stripped');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('classic manifest plus a committed project.yaml (MODE_CONFLICT): uninstall exits 3, removes nothing', async () => {
    const tmp = await makeTmpDir();
    try {
      assert.equal(runCli(['install', '--yes', '--no-update', '--directory', tmp]).status, 0);
      await mkdir(join(tmp, '_lumina', 'config'), { recursive: true });
      await writeFile(join(tmp, '_lumina', 'config', 'project.yaml'), 'schemaVersion: 1\n');

      const result = runCli(['uninstall', '--yes', '--directory', tmp]);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /MODE_CONFLICT/);
      assert.ok(await pathExists(join(tmp, '_lumina', 'manifest.json')));
      assert.ok(await pathExists(join(tmp, '_lumina', 'config', 'project.yaml')));
      assert.ok(await pathExists(join(tmp, '.agents', 'skills', 'lumi-init')));
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('installProject — skill copy/link/prune (direct call, fixture skills dir)', () => {
  // The CLI-spawn tests above already cover the real src/skills/project/
  // set. Exercise the copy/link/prune path in isolation with a fixture
  // skill instead, so this describe block stays independent of which real
  // skills currently ship.
  const colors = { yellow: (s) => s, red: (s) => s, green: (s) => s, bold: (s) => s, dim: (s) => s };

  async function makeFixtureSkillsDir() {
    const skillsSrcDir = await mkdtemp(join(tmpdir(), 'lumina-project-skills-fixture-'));
    const skillDir = join(skillsSrcDir, 'lumi-project-demo');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: lumi-project-demo\n---\n\nDemo skill.\n');
    return skillsSrcDir;
  }

  test('install with claude_code copies .agents/skills/<id> and links .claude/skills/<id>', async () => {
    const tmp = await makeTmpDir();
    const skillsSrcDir = await makeFixtureSkillsDir();
    try {
      const result = await installProject({
        projectRoot: tmp, ideTargets: ['claude_code'], pkgVersion: '1.0.0',
        existingManifest: null, colors, skillsSrcDir,
      });
      assert.equal(result.skillCount, 1);
      assert.ok(await pathExists(join(tmp, '.agents', 'skills', 'lumi-project-demo', 'SKILL.md')));
      assert.ok(await pathExists(join(tmp, '.claude', 'skills', 'lumi-project-demo')));
    } finally {
      await cleanTmp(tmp);
      await cleanTmp(skillsSrcDir);
    }
  });

  test('dropping claude_code removes the .claude/skills link but keeps the .agents/skills entry', async () => {
    const tmp = await makeTmpDir();
    const skillsSrcDir = await makeFixtureSkillsDir();
    try {
      const first = await installProject({
        projectRoot: tmp, ideTargets: ['claude_code'], pkgVersion: '1.0.0',
        existingManifest: null, colors, skillsSrcDir,
      });
      const second = await installProject({
        projectRoot: tmp, ideTargets: ['codex'], pkgVersion: '1.0.0',
        existingManifest: { ideTargets: ['claude_code'], symlinkStrategies: first.symlinkStrategies },
        colors, skillsSrcDir,
      });
      assert.equal(second.skillCount, 1);
      assert.ok(!(await pathExists(join(tmp, '.claude', 'skills', 'lumi-project-demo'))), 'claude_code dropped -> link removed');
      assert.ok(await pathExists(join(tmp, '.agents', 'skills', 'lumi-project-demo', 'SKILL.md')), '.agents/skills entry survives a target drop');
    } finally {
      await cleanTmp(tmp);
      await cleanTmp(skillsSrcDir);
    }
  });

  test('removing the skill from the source dir prunes both .agents/skills and .claude/skills entries', async () => {
    const tmp = await makeTmpDir();
    const skillsSrcDir = await makeFixtureSkillsDir();
    try {
      await installProject({
        projectRoot: tmp, ideTargets: ['claude_code'], pkgVersion: '1.0.0',
        existingManifest: null, colors, skillsSrcDir,
      });
      assert.ok(await pathExists(join(tmp, '.claude', 'skills', 'lumi-project-demo')));

      await rm(join(skillsSrcDir, 'lumi-project-demo'), { recursive: true, force: true });
      const result = await installProject({
        projectRoot: tmp, ideTargets: ['claude_code'], pkgVersion: '1.0.0',
        existingManifest: null, colors, skillsSrcDir,
      });
      assert.equal(result.skillCount, 0);
      assert.ok(!(await pathExists(join(tmp, '.agents', 'skills', 'lumi-project-demo'))), 'dropped skill pruned from .agents/skills');
      assert.ok(!(await pathExists(join(tmp, '.claude', 'skills', 'lumi-project-demo'))), 'dropped skill pruned from .claude/skills');
    } finally {
      await cleanTmp(tmp);
      await cleanTmp(skillsSrcDir);
    }
  });
});

describe('project skill cleanup never touches classic lumi-* skills', () => {
  const colors = { yellow: (s) => s, red: (s) => s, green: (s) => s, bold: (s) => s, dim: (s) => s };

  test('an owned classic lumi-ingest (dir + .claude link) survives a claude_code drop and uninstall', async () => {
    const tmp = await makeTmpDir();
    try {
      const classicDir = join(tmp, '.agents', 'skills', 'lumi-ingest');
      const classicLink = join(tmp, '.claude', 'skills', 'lumi-ingest');
      await mkdir(classicDir, { recursive: true });
      await writeFile(join(classicDir, 'SKILL.md'), '---\nname: lumi-ingest\n---\n');
      await mkdir(join(tmp, '.claude', 'skills'), { recursive: true });
      await symlink(classicDir, classicLink, 'junction');

      await installProject({ projectRoot: tmp, ideTargets: ['claude_code'], pkgVersion: PKG.version, colors });
      await installProject({ projectRoot: tmp, ideTargets: ['codex'], pkgVersion: PKG.version, colors });
      assert.ok(await pathExists(join(classicLink, 'SKILL.md')), 'classic .claude link survives the target drop');

      await uninstallProject({ projectRoot: tmp, colors });
      assert.ok(await pathExists(join(classicDir, 'SKILL.md')), 'classic .agents skill survives uninstall');
      assert.ok(await pathExists(join(classicLink, 'SKILL.md')), 'classic .claude link survives uninstall');
      assert.ok(!(await pathExists(join(tmp, '.agents', 'skills', 'lumi-project-setup'))));
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('PROJECT_IDE_TARGETS', () => {
  test('is exactly claude_code, codex, antigravity', () => {
    assert.deepEqual([...PROJECT_IDE_TARGETS], ['claude_code', 'codex', 'antigravity']);
  });
});
