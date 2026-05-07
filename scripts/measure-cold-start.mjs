#!/usr/bin/env node
/**
 * Cold-start measurement for `lumina install --yes`.
 *
 * Runs N installs into temp dirs, measures wall-clock per run, reports
 * min/median/max. Hard-fails if median exceeds the threshold.
 *
 * Threshold: 350 ms (300 ms target + 50 ms CI runner allowance).
 * This is a NON-NEGOTIABLE invariant per CLAUDE.md.
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const repoRoot   = resolve(__dirname, '..');
const cliPath    = join(repoRoot, 'bin', 'lumina.js');

const N = 5;
const THRESHOLD_MS = 350;

const times = [];
for (let i = 0; i < N; i++) {
  const parent    = await mkdtemp(join(tmpdir(), 'lumina-cold-start-'));
  const workspace = join(parent, 'cold-start-wiki');
  await mkdir(workspace, { recursive: true });
  try {
    const start = performance.now();
    const result = spawnSync(process.execPath,
      [cliPath, 'install', '--yes', '--no-update', '--directory', workspace],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, LUMINA_NO_UPDATE_CHECK: '1' },
      });
    const elapsed = performance.now() - start;
    if (result.status !== 0) {
      console.error(`[error] cold-start run ${i + 1} failed`);
      console.error(result.stderr?.trim());
      process.exit(2);
    }
    times.push(elapsed);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

times.sort((a, b) => a - b);
const min    = times[0];
const max    = times[times.length - 1];
const median = times[Math.floor(times.length / 2)];

console.log(`Cold-start over ${N} runs (full install):`);
console.log(`  min:    ${min.toFixed(1)} ms`);
console.log(`  median: ${median.toFixed(1)} ms`);
console.log(`  max:    ${max.toFixed(1)} ms`);
console.log(`  threshold: ${THRESHOLD_MS} ms`);

if (median > THRESHOLD_MS) {
  console.error(`[fail] median ${median.toFixed(1)}ms exceeds ${THRESHOLD_MS}ms — cold-start regression`);
  process.exit(1);
}
console.log('[ok] cold-start within budget');
