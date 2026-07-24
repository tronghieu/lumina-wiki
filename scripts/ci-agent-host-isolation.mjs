#!/usr/bin/env node
/**
 * CI gate for AD-7 (agent-host isolation) and CAP-9 (non-destructive skills
 * install), separate from ci-idempotency.mjs.
 *
 * Proves:
 *   1. A classic (no --agents) install's project-level output is byte-for-
 *      byte unaffected by whether an AI-agent global install ran earlier in
 *      the same environment.
 *   2. The AI-agent global skill install is correct: every shipped lumi-*
 *      SKILL.md (every skill in the source tree now carries the literal
 *      AD-7 anchor line) gets the routing preamble injected and loses the
 *      anchor line — lumi-hub is the sole documented exception and is
 *      copied byte-identical; shipped `{{...}}` placeholders in other skill
 *      files survive untouched (proving no file is ever run through the
 *      template engine).
 *   3. A foreign skill directory already present in the global skills
 *      directory survives an agent install byte-identical.
 *   4. A second, identical agent install is idempotent.
 */

import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const cliPath = join(repoRoot, 'bin', 'lumina.js');

// Same watched-path list as scripts/ci-idempotency.mjs.
const managedDiffPaths = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'QWEN.md',
  'IFLOW.md',
  '.cursor',
  '.claude',
  '.agents',
  '_lumina/config',
  '_lumina/schema',
  '_lumina/scripts',
  '_lumina/tools',
  '.env.example',
  'wiki',
  'raw',
];

const CLASSIC_ARGS = ['install', '--yes', '--no-update'];
const LIBRARIAN_PREAMBLE_ANCHOR = 'Read `README.md` at the project root before this SKILL.md.';
const PREAMBLE_HEADING = '## Workspace resolution (multi-wiki mode)';

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: opts.timeout ?? 60000,
    env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1', ...(opts.env || {}) },
  });

  if (result.status !== 0) {
    const rendered = [command, ...args].join(' ');
    throw new Error([
      `Command failed (${result.status}): ${rendered}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  return result;
}

async function hashFile(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function walkFiles(base, root = base, out = []) {
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const abs = join(base, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(abs, root, out);
    } else if (entry.isFile()) {
      out.push(relative(root, abs));
    }
  }
  return out;
}

async function snapshotPath(absPath, root) {
  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
  const map = new Map();
  if (st.isFile()) {
    map.set(relative(root, absPath), await hashFile(absPath));
    return map;
  }
  const files = (await walkFiles(absPath, root)).sort();
  for (const rel of files) {
    map.set(rel, await hashFile(join(root, rel)));
  }
  return map;
}

function assertSnapshotsEqual(before, after, label) {
  const beforeKeys = [...before.keys()].sort();
  const afterKeys = [...after.keys()].sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
    throw new Error(
      `${label}: file set changed.\nbefore: ${beforeKeys.join(', ') || '(none)'}\nafter:  ${afterKeys.join(', ') || '(none)'}`,
    );
  }
  for (const key of beforeKeys) {
    if (before.get(key) !== after.get(key)) {
      throw new Error(`${label}: file changed: ${key}`);
    }
  }
}

async function diffManagedPaths(dirA, dirB) {
  for (const relPath of managedDiffPaths) {
    const snapA = await snapshotPath(join(dirA, relPath), dirA);
    const snapB = await snapshotPath(join(dirB, relPath), dirB);
    assertSnapshotsEqual(snapA, snapB, `classic install drift at "${relPath}"`);
  }
}

/**
 * Discover which lumi-* skill directories the repo ships (excluding
 * lumi-hub, which is agent-host-only and has no project-side source under
 * src/skills/{core,packs}). Mirrors getSkillDefs()'s coverage in
 * src/installer/commands.js without importing it (this script must stay a
 * standalone CI gate, mirroring ci-idempotency.mjs's style).
 */
async function shippedSkillCanonicalIds() {
  const roots = [
    { dir: join(repoRoot, 'src', 'skills', 'core'), prefix: 'lumi-' },
    { dir: join(repoRoot, 'src', 'skills', 'packs', 'research'), prefix: 'lumi-research-' },
    { dir: join(repoRoot, 'src', 'skills', 'packs', 'reading'), prefix: 'lumi-reading-' },
    { dir: join(repoRoot, 'src', 'skills', 'packs', 'learning'), prefix: 'lumi-learning-' },
  ];
  const ids = [];
  for (const { dir, prefix } of roots) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      ids.push({ canonicalId: `${prefix}${entry.name}`, srcDir: join(dir, entry.name) });
    }
  }
  return ids;
}

async function verifyGlobalSkills(globalDir) {
  const shipped = await shippedSkillCanonicalIds();

  // lumi-hub: no anchor line in source, must be copied byte-identical.
  const hubSrc = join(repoRoot, 'src', 'skills', 'agents', 'hub', 'SKILL.md');
  const hubDest = join(globalDir, 'lumi-hub', 'SKILL.md');
  const hubSrcContent = await readFile(hubSrc, 'utf8');
  const hubDestContent = await readFile(hubDest, 'utf8');
  if (hubSrcContent !== hubDestContent) {
    throw new Error('lumi-hub/SKILL.md was modified by the agent install; it has no AD-7 anchor line and must copy verbatim.');
  }

  let injectedCount = 0;

  for (const { canonicalId, srcDir } of shipped) {
    const srcSkillMd = join(srcDir, 'SKILL.md');
    const destSkillMd = join(globalDir, canonicalId, 'SKILL.md');
    const srcContent = await readFile(srcSkillMd, 'utf8');
    const destContent = await readFile(destSkillMd, 'utf8');

    const srcHasAnchor = srcContent
      .replace(/\r\n/g, '\n')
      .split('\n')
      .some(line => line.trimStart().startsWith(LIBRARIAN_PREAMBLE_ANCHOR));

    // Every shipped skill except lumi-hub now carries the canonical anchor
    // line (the "11 of them" normalization landed) — there is no longer a
    // verbatim-if-no-anchor allowance. A skill missing the anchor is a
    // regression, not a legitimate exemption, and fails the gate.
    if (!srcHasAnchor) {
      throw new Error(`${canonicalId}/SKILL.md: missing the AD-7 anchor line — every non-hub SKILL.md must open with "${LIBRARIAN_PREAMBLE_ANCHOR}"`);
    }

    injectedCount++;
    if (destContent.includes(LIBRARIAN_PREAMBLE_ANCHOR)) {
      throw new Error(`${canonicalId}/SKILL.md: AD-7 anchor line was not removed`);
    }
    if (!destContent.includes(PREAMBLE_HEADING)) {
      throw new Error(`${canonicalId}/SKILL.md: routing preamble was not injected`);
    }

    // Every other file in the skill directory must survive byte-identical —
    // proves no file is ever run through the template engine (AD-7).
    const otherFiles = (await walkFiles(srcDir)).filter(rel => rel !== 'SKILL.md');
    for (const rel of otherFiles) {
      const a = await readFile(join(srcDir, rel), 'utf8').catch(() => null);
      const b = await readFile(join(globalDir, canonicalId, rel), 'utf8').catch(() => null);
      if (a === null || b === null || a !== b) {
        throw new Error(`${canonicalId}/${rel}: reference file drifted from source (must copy verbatim)`);
      }
      if (a.includes('{{') && !b.includes('{{')) {
        throw new Error(`${canonicalId}/${rel}: shipped {{...}} placeholder(s) did not survive the copy`);
      }
    }
  }

  if (injectedCount === 0) {
    throw new Error('No shipped SKILL.md carried the AD-7 anchor line — injection coverage assertion is vacuous, treat as a failure');
  }

  console.log(`[ok] ${injectedCount} SKILL.md file(s) got the routing preamble injected (100% of non-hub shipped skills); lumi-hub verbatim`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'lumina-agent-isolation-'));
  try {
    const fakeHome = join(root, 'fake-home');
    await mkdir(fakeHome, { recursive: true });
    const homeEnv = { HOME: fakeHome, USERPROFILE: fakeHome };

    // sandboxA and sandboxB share the same basename (only their parent
    // differs) so the auto-derived project_name — and therefore
    // README.md/config content — is identical between them; only the
    // presence of a prior agent install in the shared environment differs.
    const sandboxA = join(root, 'a', 'wiki-project');
    const sandboxB = join(root, 'b', 'wiki-project');
    const agentDir = join(root, 'agent-install-workspace');
    await mkdir(sandboxA, { recursive: true });
    await mkdir(sandboxB, { recursive: true });
    await mkdir(agentDir, { recursive: true });

    // (a) Classic baseline — no --agents at all.
    run(process.execPath, [cliPath, ...CLASSIC_ARGS, '--directory', sandboxA], { cwd: repoRoot, env: homeEnv });

    // Agent install into an unrelated workspace, same fake HOME.
    run(process.execPath, [cliPath, ...CLASSIC_ARGS, '--agents', 'openclaw', '--directory', agentDir], { cwd: repoRoot, env: homeEnv });

    // (b) Classic install again, identical args, run AFTER the agent install
    // above populated the fake global skills directory.
    run(process.execPath, [cliPath, ...CLASSIC_ARGS, '--directory', sandboxB], { cwd: repoRoot, env: homeEnv });

    await diffManagedPaths(sandboxA, sandboxB);
    console.log('[ok] classic install output is unaffected by a prior agent install');

    // (c) Inspect the OpenClaw global skills directory.
    const openclawDir = join(fakeHome, '.openclaw', 'skills');
    await verifyGlobalSkills(openclawDir);

    // (d) Plant a foreign skill, re-run the agent install, verify survival.
    const foreignDir = join(openclawDir, 'my-own-skill');
    await mkdir(foreignDir, { recursive: true });
    const foreignSkillMd = join(foreignDir, 'SKILL.md');
    await writeFile(foreignSkillMd, '---\nname: my-own-skill\ndescription: a foreign skill unrelated to Lumina\n---\nHello from a foreign skill.\n', 'utf8');
    const foreignBefore = await hashFile(foreignSkillMd);

    run(process.execPath, [cliPath, ...CLASSIC_ARGS, '--agents', 'openclaw', '--directory', agentDir], { cwd: repoRoot, env: homeEnv });

    const foreignAfter = await hashFile(foreignSkillMd);
    if (foreignBefore !== foreignAfter) {
      throw new Error('Foreign skill directory was modified by a re-install of the agent target');
    }
    console.log('[ok] foreign skill directory survives agent install byte-identical');

    // (e) Snapshot, re-run once more with the same selection, confirm
    // byte-identical output (idempotency).
    const before = await snapshotPath(openclawDir, openclawDir);
    run(process.execPath, [cliPath, ...CLASSIC_ARGS, '--agents', 'openclaw', '--directory', agentDir], { cwd: repoRoot, env: homeEnv });
    const after = await snapshotPath(openclawDir, openclawDir);
    assertSnapshotsEqual(before, after, 'agent install idempotency');
    console.log('[ok] agent install is idempotent');

    console.log('[ok] ci-agent-host-isolation passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
