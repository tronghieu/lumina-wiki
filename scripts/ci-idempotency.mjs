#!/usr/bin/env node
/**
 * CI installability check for Lumina Wiki.
 *
 * Creates disposable workspaces, installs via the public CLI path, commits a
 * baseline, reinstalls, and fails if installer-managed user-facing/runtime
 * files drift. Runtime state timestamps are intentionally excluded.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const cliPath = join(repoRoot, 'bin', 'lumina.js');

const scenarios = [
  {
    name: 'core-default',
    args: ['install', '--yes', '--no-update'],
  },
  {
    name: 'full-pack',
    args: [
      'install',
      '--yes',
      '--no-update',
      '--packs', 'core,research,reading',
      '--ide-targets', 'claude_code,codex,cursor,gemini_cli,qwen,iflow',
      '--project-name', 'CI Full Pack Wiki',
      '--communication-language', 'English',
      '--document-output-language', 'English',
    ],
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
  const workspace = await mkdtemp(join(tmpdir(), `lumina-ci-${scenario.name}-`));
  try {
    run('git', ['init'], { cwd: workspace });
    run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: workspace });
    run('git', ['config', 'user.name', 'Lumina CI'], { cwd: workspace });

    run(process.execPath, [cliPath, ...scenario.args, '--cwd', workspace], { cwd: repoRoot });
    run('git', ['add', '-A'], { cwd: workspace });
    run('git', ['commit', '-m', 'baseline'], { cwd: workspace });

    run(process.execPath, [cliPath, ...scenario.args, '--cwd', workspace], { cwd: repoRoot });

    const diff = spawnSync('git', ['diff', '--exit-code', '--', ...managedDiffPaths], {
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
    await rm(workspace, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  await runScenario(scenario);
}
