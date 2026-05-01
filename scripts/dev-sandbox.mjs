#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'bin', 'lumina.js');

const args = process.argv.slice(2);
const reuseFlag = args.includes('--reuse');
const keepFlag = args.includes('--keep');
const installArgs = args.filter((a) => a !== '--reuse' && a !== '--keep');

const FIXED_DIR = join(tmpdir(), 'lumi-sandbox');
let sandbox;

if (reuseFlag) {
  sandbox = FIXED_DIR;
  if (!existsSync(sandbox)) mkdirSync(sandbox, { recursive: true });
} else {
  sandbox = mkdtempSync(join(tmpdir(), 'lumi-sandbox-'));
}

console.log(`[dev:sandbox] sandbox: ${sandbox}`);

try {
  if (reuseFlag) {
    for (const entry of readdirSync(sandbox)) {
      rmSync(join(sandbox, entry), { recursive: true, force: true });
    }
  }

  execSync('git init -q', { cwd: sandbox, stdio: 'inherit' });

  const defaultArgs = installArgs.length ? installArgs : ['--yes'];
  console.log(`[dev:sandbox] running: node ${CLI} install ${defaultArgs.join(' ')}\n`);

  const result = spawnSync(process.execPath, [CLI, 'install', ...defaultArgs], {
    cwd: sandbox,
    stdio: 'inherit',
  });

  console.log('\n[dev:sandbox] tree:');
  printTree(sandbox, '', 0, 3);

  if (result.status !== 0) {
    console.error(`\n[dev:sandbox] install exited ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`\n[dev:sandbox] OK. Sandbox at: ${sandbox}`);
  if (!keepFlag && !reuseFlag) {
    console.log('[dev:sandbox] (pass --keep to retain after exit, or --reuse for fixed path)');
  }
} finally {
  if (!keepFlag && !reuseFlag) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function printTree(dir, prefix, depth, maxDepth) {
  if (depth > maxDepth) return;
  const entries = readdirSync(dir).sort();
  for (const name of entries) {
    if (name === '.git') continue;
    const full = join(dir, name);
    const isDir = statSync(full).isDirectory();
    console.log(`${prefix}${isDir ? '📁' : '📄'} ${name}`);
    if (isDir) printTree(full, prefix + '  ', depth + 1, maxDepth);
  }
}
