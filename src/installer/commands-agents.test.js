/**
 * Tests for the AI-agent global install path (CAP-8) and the CAP-9
 * non-destructive uninstall fix in src/installer/commands.js.
 *
 * Every test spawns the real CLI with HOME/USERPROFILE overridden to a
 * disposable temp directory, so os.homedir()-based global skill paths and
 * the LUMINA_HOME-derived agents manifest (which falls back to
 * ~/.lumina when LUMINA_HOME is unset) both land inside the sandbox and
 * never touch the real machine.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/lumina.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const LIBRARIAN_PREAMBLE_ANCHOR = 'Read `README.md` at the project root before this SKILL.md.';
const PREAMBLE_HEADING = '## Workspace resolution (multi-wiki mode)';

async function makeTmpDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function cleanTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}

function runCli(args, { cwd = REPO_ROOT, env = {}, timeout = 30000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', ...env },
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('AI-agent global install (CAP-8)', () => {
  test('places every lumi-* skill plus lumi-hub in the platform global dir, injects the preamble, and writes the agents manifest', async () => {
    const tmp = await makeTmpDir('lumina-agents-install-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);

      const globalDir = join(fakeHome, '.openclaw', 'skills');

      // A core skill whose source carries the AD-7 anchor line got injected.
      const initSkillMd = await readFile(join(globalDir, 'lumi-init', 'SKILL.md'), 'utf8');
      assert.ok(initSkillMd.includes(PREAMBLE_HEADING), 'expected routing preamble heading in lumi-init/SKILL.md');
      assert.ok(!initSkillMd.includes(LIBRARIAN_PREAMBLE_ANCHOR), 'expected the anchor line to be replaced in lumi-init/SKILL.md');

      // lumi-hub has no anchor line — copied verbatim from source.
      const hubSrc = await readFile(join(REPO_ROOT, 'src', 'skills', 'agents', 'hub', 'SKILL.md'), 'utf8');
      const hubDest = await readFile(join(globalDir, 'lumi-hub', 'SKILL.md'), 'utf8');
      assert.equal(hubDest, hubSrc);

      // Research/reading/learning pack skills are all present too (every pack,
      // not just core — agent installs are not pack-selectable).
      await access(join(globalDir, 'lumi-research-discover', 'SKILL.md'));
      await access(join(globalDir, 'lumi-reading-chapter-ingest', 'SKILL.md'));
      await access(join(globalDir, 'lumi-learning-reflect', 'SKILL.md'));

      // Shipped {{...}} placeholders in reference files survive untouched
      // (never run through the template engine).
      const verifyRefs = await readFile(
        join(globalDir, 'lumi-verify', 'references', 'reviewers.md'), 'utf8',
      ).catch(() => null);
      if (verifyRefs !== null) {
        const srcRefs = await readFile(
          join(REPO_ROOT, 'src', 'skills', 'core', 'verify', 'references', 'reviewers.md'), 'utf8',
        );
        assert.equal(verifyRefs, srcRefs);
      }

      // Agents manifest tracks ownership (AD-2/AD-8).
      const manifestPath = join(fakeHome, '.lumina', 'agents', 'openclaw-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(manifest.version, 1);
      assert.equal(manifest.platform, 'openclaw');
      assert.ok(manifest.skills.includes('lumi-init'));
      assert.ok(manifest.skills.includes('lumi-hub'));
      assert.ok(manifest.skills.includes('lumi-research-discover'));

      // No workspace payload leaked into the global skills directory or its
      // ancestor — agent installs are skills-only (CAP-8).
      assert.equal(await exists(join(fakeHome, '.openclaw', 'wiki')), false);
      assert.equal(await exists(join(fakeHome, '.openclaw', '_lumina')), false);

      // The classic project payload still happened normally alongside it.
      await access(join(workspace, '_lumina', 'manifest.json'));
      await access(join(workspace, 'wiki', 'index.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('foreign skill directory in the global skills dir survives an agent install byte-identical', async () => {
    const tmp = await makeTmpDir('lumina-agents-foreign-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    const foreignDir = join(fakeHome, '.openclaw', 'skills', 'my-own-skill');
    await mkdir(foreignDir, { recursive: true });
    const foreignSkillMdPath = join(foreignDir, 'SKILL.md');
    const foreignContent = '---\nname: my-own-skill\ndescription: not a Lumina skill\n---\nHello.\n';
    await writeFile(foreignSkillMdPath, foreignContent, 'utf8');
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);

      const after = await readFile(foreignSkillMdPath, 'utf8');
      assert.equal(after, foreignContent, 'foreign skill must survive an agent install untouched');
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('unknown --agents value exits 2', async () => {
    const tmp = await makeTmpDir('lumina-agents-invalid-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'not-a-real-platform'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Unknown agent target/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('acknowledgment notice is printed under --yes without blocking on input', async () => {
    const tmp = await makeTmpDir('lumina-agents-ack-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome }, timeout: 30000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Installed Lumina skills globally for OpenClaw/);
      assert.match(result.stdout, /lumina wikis add/);
      assert.match(result.stdout, /lumina wikis doctor/);
      // --yes must never pause for acknowledgment (would hang the process).
      assert.doesNotMatch(result.stdout, /Press Enter to continue/);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('classic install (no --agents) never touches HOME', async () => {
    const tmp = await makeTmpDir('lumina-agents-classic-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const result = runCli(
        ['install', '--yes', '--no-update', '--directory', workspace],
        { env: { HOME: fakeHome, USERPROFILE: fakeHome } },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await exists(join(fakeHome, '.openclaw')), false);
      assert.equal(await exists(join(fakeHome, '.hermes')), false);
      assert.equal(await exists(join(fakeHome, '.lumina')), false);
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('re-running the same agent install is idempotent', async () => {
    const tmp = await makeTmpDir('lumina-agents-idempotent-');
    const workspace = join(tmp, 'wiki-project');
    const fakeHome = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    try {
      const args = ['install', '--yes', '--no-update', '--directory', workspace, '--agents', 'openclaw'];
      const env = { HOME: fakeHome, USERPROFILE: fakeHome };
      const first = runCli(args, { env });
      assert.equal(first.status, 0, first.stderr);
      const before = await readFile(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'), 'utf8');

      const second = runCli(args, { env });
      assert.equal(second.status, 0, second.stderr);
      const after = await readFile(join(fakeHome, '.openclaw', 'skills', 'lumi-init', 'SKILL.md'), 'utf8');

      assert.equal(after, before);
    } finally {
      await cleanTmp(tmp);
    }
  });
});

describe('uninstall non-destructive skills removal (CAP-9)', () => {
  test('foreign skill in .agents/skills survives uninstall while lumi-* entries are removed', async () => {
    const tmp = await makeTmpDir('lumina-uninstall-foreign-');
    const workspace = join(tmp, 'wiki-project');
    await mkdir(workspace, { recursive: true });
    try {
      const install = runCli(['install', '--yes', '--no-update', '--directory', workspace]);
      assert.equal(install.status, 0, install.stderr);

      const foreignDir = join(workspace, '.agents', 'skills', 'custom-skill');
      await mkdir(foreignDir, { recursive: true });
      const foreignSkillMdPath = join(foreignDir, 'SKILL.md');
      const foreignContent = '---\nname: custom-skill\ndescription: user-authored, not Lumina\n---\nHi.\n';
      await writeFile(foreignSkillMdPath, foreignContent, 'utf8');

      const uninstall = runCli(['uninstall', '--yes', '--directory', workspace]);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      // Foreign entry survives, byte-identical.
      const after = await readFile(foreignSkillMdPath, 'utf8');
      assert.equal(after, foreignContent);

      // lumi-* entries are gone.
      assert.equal(await exists(join(workspace, '.agents', 'skills', 'lumi-init')), false);
      assert.equal(await exists(join(workspace, '.agents', 'skills', 'lumi-ask')), false);

      // .agents/ itself survives because it still holds the foreign entry.
      await access(join(workspace, '.agents', 'skills', 'custom-skill', 'SKILL.md'));
    } finally {
      await cleanTmp(tmp);
    }
  });

  test('uninstall with no foreign skills removes .agents/ entirely', async () => {
    const tmp = await makeTmpDir('lumina-uninstall-clean-');
    const workspace = join(tmp, 'wiki-project');
    await mkdir(workspace, { recursive: true });
    try {
      const install = runCli(['install', '--yes', '--no-update', '--directory', workspace]);
      assert.equal(install.status, 0, install.stderr);

      const uninstall = runCli(['uninstall', '--yes', '--directory', workspace]);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      assert.equal(await exists(join(workspace, '.agents')), false);
    } finally {
      await cleanTmp(tmp);
    }
  });
});
