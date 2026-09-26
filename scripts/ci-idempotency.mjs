#!/usr/bin/env node
/**
 * CI installability check for Lumina Wiki.
 *
 * Creates disposable workspaces, installs via the public CLI path, commits a
 * baseline, reinstalls, and fails if installer-managed user-facing/runtime
 * files drift. Runtime state timestamps are intentionally excluded.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { pathExists } from '../src/installer/fs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const cliPath = join(repoRoot, 'bin', 'lumina.js');

const scenarios = [
  {
    name: 'core-default',
    workspaceBasename: 'ci-core-default',
    args: ['install', '--yes', '--no-update'],
  },
  {
    name: 'full-pack',
    workspaceBasename: 'ci-full-pack-wiki',
    args: [
      'install',
      '--yes',
      '--no-update',
      '--packs', 'core,research,reading,learning',
      '--ide-targets', 'claude_code,codex,cursor,gemini_cli,qwen,iflow',
      '--communication-language', 'English',
      '--document-output-language', 'English',
    ],
  },
  {
    name: 'multilingual-en',
    workspaceBasename: 'ci-multilingual-en',
    args: ['install', '--yes', '--no-update', '--lang', 'en', '--packs', 'core,research'],
  },
  {
    name: 'multilingual-vi',
    workspaceBasename: 'ci-multilingual-vi',
    args: ['install', '--yes', '--no-update', '--lang', 'vi', '--packs', 'core,research'],
  },
  {
    name: 'multilingual-zh',
    workspaceBasename: 'ci-multilingual-zh',
    args: ['install', '--yes', '--no-update', '--lang', 'zh', '--packs', 'core,research'],
  },
  {
    name: 'project',
    workspaceBasename: 'ci-project-mode',
    args: ['install', '--mode', 'project', '--yes', '--no-update', '--ide-targets', 'claude_code,codex'],
    isProject: true,
    // Seeds a pre-existing CRLF AGENTS.md and .gitignore — AD-3 requires
    // every byte outside the marker block, including line endings, survives.
    async seed(workspace) {
      await writeFile(join(workspace, 'AGENTS.md'), 'Existing project instructions.\r\n', 'utf8');
      await writeFile(join(workspace, '.gitignore'), '.env\n', 'utf8');
    },
    diffPaths: ['AGENTS.md', '.gitignore', 'CLAUDE.md', '.agents', '.claude', '_lumina/project'],
  },
];

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

async function runScenario(scenario) {
  // Stable basename so the auto-derived project_name is identical across runs.
  const parent = await mkdtemp(join(tmpdir(), `lumina-ci-${scenario.name}-`));
  const workspace = join(parent, scenario.workspaceBasename);
  await mkdir(workspace, { recursive: true });
  try {
    run('git', ['init'], { cwd: workspace });
    run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: workspace });
    run('git', ['config', 'user.name', 'Lumina CI'], { cwd: workspace });

    if (scenario.seed) await scenario.seed(workspace);

    run(process.execPath, [cliPath, ...scenario.args, '--directory', workspace], { cwd: repoRoot });
    // AD-26 classic isolation gate: a classic (non-project) install must
    // never create _lumina/project/ — project code leaking into a classic
    // install is exactly what the mode gate exists to prevent.
    if (!scenario.isProject && await pathExists(join(workspace, '_lumina', 'project'))) {
      throw new Error(`Classic scenario "${scenario.name}" must never create _lumina/project/, but it did.`);
    }
    run('git', ['add', '-A'], { cwd: workspace });
    run('git', ['commit', '-m', 'baseline'], { cwd: workspace });

    run(process.execPath, [cliPath, ...scenario.args, '--directory', workspace], { cwd: repoRoot });

    const diff = spawnSync('git', ['diff', '--exit-code', '--', ...(scenario.diffPaths ?? managedDiffPaths)], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 60000,
    });

    if (diff.status !== 0) {
      throw new Error([
        `Install idempotency drift in scenario "${scenario.name}"`,
        diff.stdout?.trim(),
        diff.stderr?.trim(),
      ].filter(Boolean).join('\n'));
    }

    console.log(`[ok] ${scenario.name}`);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  await runScenario(scenario);
}
