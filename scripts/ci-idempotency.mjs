#!/usr/bin/env node
/**
 * CI installability check for Lumina Wiki.
 *
 * Creates disposable workspaces, installs via the public CLI path, commits a
 * baseline, reinstalls, and fails if installer-managed user-facing/runtime
 * files drift. Runtime state timestamps are intentionally excluded. Classic
 * workspaces must ship the viewer, project ones must not, and the installed
 * viewer of the default scenario must start, serve, and write nothing.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

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
    // Pre-existing CRLF AGENTS.md and .gitignore — AD-3 requires every byte
    // outside the marker block, including line endings, survives. Asserted
    // after install #1 (the git diff below only compares install #2 to #1).
    seed: {
      'AGENTS.md': 'Existing project instructions.\r\n',
      '.gitignore': '.env\n',
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
  '_lumina/viewer',
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

// --ignored lists the folders the installed .gitignore hides (state, tmp, .env, node_modules).
// --untracked-files=all lists every file in them one by one, so a new or removed file changes the output.
// It cannot see a change inside a file that already exists in an ignored folder.
function gitStatus(workspace) {
  return run('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: workspace }).stdout;
}

function withDeadline(promise, ms, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${what}`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function httpGet(port, path) {
  const request = new Promise((resolveGet, rejectGet) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveGet({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', rejectGet);
    });
    req.on('error', rejectGet);
  });
  return withDeadline(request, 10000, `GET ${path}`);
}

async function getJson(port, path) {
  const res = await httpGet(port, path);
  if (res.status !== 200) throw new Error(`GET ${path} returned ${res.status}, expected 200.`);
  return JSON.parse(res.body.toString('utf8'));
}

// The installed viewer imports ../scripts/; only a real start proves that layout resolves.
async function assertInstalledViewerStarts(workspace) {
  const before = gitStatus(workspace);
  const child = spawn(process.execPath, [join(workspace, '_lumina', 'viewer', 'view.mjs')], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exited = false;
  const exitPromise = new Promise((resolveExit) => child.once('exit', () => { exited = true; resolveExit(); }));
  child.stderr.on('data', (c) => { stderr += c; });
  // A spawn failure emits "error" and never "exit"; without a listener it would crash the script.
  const spawnFailed = new Promise((_, rejectSpawn) => child.once('error', (err) => {
    exited = true;
    rejectSpawn(new Error(`Installed viewer failed to spawn: ${err.message}`));
  }));
  spawnFailed.catch(() => {});
  try {
    const firstLine = new Promise((resolveLine, rejectLine) => {
      child.stdout.on('data', (c) => {
        stdout += c;
        const nl = stdout.indexOf('\n');
        if (nl !== -1) resolveLine(stdout.slice(0, nl));
      });
      spawnFailed.catch(rejectLine);
      exitPromise.then(() => rejectLine(new Error('viewer exited before printing its ready line.')));
    });
    let line;
    try {
      line = await withDeadline(firstLine, 15000, 'the viewer ready line');
    } catch (err) {
      throw new Error(`Installed viewer did not start: ${err.message}\nstderr:\n${stderr.trim()}`);
    }
    const ready = JSON.parse(line);
    if (ready.ok !== true || typeof ready.port !== 'number' || ready.reused !== false) {
      throw new Error(`Unexpected viewer ready line: ${line}`);
    }
    const { port } = ready;

    const health = await getJson(port, '/api/health');
    const { packageVersion } = JSON.parse(await readFile(join(workspace, '_lumina', 'manifest.json'), 'utf8'));
    if (health.app !== 'lumina-view' || health.version !== packageVersion) {
      throw new Error(`/api/health mismatch: ${JSON.stringify(health)}, expected lumina-view ${packageVersion}.`);
    }

    const index = await httpGet(port, '/');
    const html = index.body.toString('utf8');
    const stylesheet = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1];
    const script = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
    if (index.status !== 200 || !stylesheet || script !== '/assets/viewer.js') {
      throw new Error('GET / must return 200 and reference a stylesheet and /assets/viewer.js.');
    }
    const css = await httpGet(port, stylesheet);
    if (css.status !== 200 || css.body.length === 0) throw new Error(`GET ${stylesheet} must return 200 with a body.`);

    const bundle = await httpGet(port, '/assets/viewer.js');
    const expected = await readFile(join(repoRoot, 'src', 'viewer', 'app', 'viewer.js'));
    if (bundle.status !== 200 || !bundle.body.equals(expected)) {
      throw new Error('GET /assets/viewer.js must return 200 and match src/viewer/app/viewer.js byte for byte.');
    }

    const wiki = await getJson(port, '/api/wiki');
    if (!Array.isArray(wiki.nodes) || !Array.isArray(wiki.edges)) {
      throw new Error('/api/wiki must return arrays "nodes" and "edges".');
    }

    const lint = await getJson(port, '/api/lint');
    if (!Array.isArray(lint.findings)) throw new Error('/api/lint must return an array "findings".');

    // A fresh install seeds wiki/index.md, so "index" is a page that must exist.
    const page = await getJson(port, '/api/page?id=index');
    if (page.id !== 'index' || typeof page.title !== 'string' || typeof page.body !== 'string'
      || typeof page.frontmatter !== 'object' || page.frontmatter === null
      || typeof page.links !== 'object' || page.links === null) {
      throw new Error('/api/page?id=index must return id, title, body, frontmatter and links.');
    }
  } finally {
    // The child must be gone before the workspace is removed: Windows cannot delete a live cwd.
    if (!exited) child.kill();
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      await withDeadline(exitPromise, 10000, 'the viewer to exit');
    }
  }
  if (gitStatus(workspace) !== before) {
    throw new Error('The installed viewer changed the workspace; it must write nothing.');
  }
}

let viewerChecks = 0;

async function runScenario(scenario) {
  // Stable basename so the auto-derived project_name is identical across runs.
  const parent = await mkdtemp(join(tmpdir(), `lumina-ci-${scenario.name}-`));
  const workspace = join(parent, scenario.workspaceBasename);
  await mkdir(workspace, { recursive: true });
  try {
    run('git', ['init'], { cwd: workspace });
    run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: workspace });
    run('git', ['config', 'user.name', 'Lumina CI'], { cwd: workspace });

    for (const [rel, content] of Object.entries(scenario.seed ?? {})) {
      await writeFile(join(workspace, rel), content, 'utf8');
    }

    run(process.execPath, [cliPath, ...scenario.args, '--directory', workspace], { cwd: repoRoot });
    for (const [rel, content] of Object.entries(scenario.seed ?? {})) {
      if (!(await readFile(join(workspace, rel), 'utf8')).startsWith(content)) {
        throw new Error(`Scenario "${scenario.name}": seeded bytes of ${rel} did not survive install #1.`);
      }
    }
    // AD-26 classic isolation gate: a classic (non-project) install must
    // never create _lumina/project/ — project code leaking into a classic
    // install is exactly what the mode gate exists to prevent.
    if (!scenario.isProject && await pathExists(join(workspace, '_lumina', 'project'))) {
      throw new Error(`Classic scenario "${scenario.name}" must never create _lumina/project/, but it did.`);
    }
    // Mirror gate: the viewer belongs to classic workspaces only.
    if (scenario.isProject && await pathExists(join(workspace, '_lumina', 'viewer'))) {
      throw new Error(`Project scenario "${scenario.name}" must never create _lumina/viewer/, but it did.`);
    }
    if (!scenario.isProject && !(await pathExists(join(workspace, '_lumina', 'viewer', 'view.mjs')))) {
      throw new Error(`Classic scenario "${scenario.name}" must contain _lumina/viewer/view.mjs, but it does not.`);
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

    if (scenario.name === 'core-default') {
      await assertInstalledViewerStarts(workspace);
      viewerChecks++;
    }

    console.log(`[ok] ${scenario.name}`);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  await runScenario(scenario);
}

if (viewerChecks === 0) {
  throw new Error('The installed-viewer check never ran; the core-default scenario is missing.');
}
