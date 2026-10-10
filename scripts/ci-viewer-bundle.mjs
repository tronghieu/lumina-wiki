#!/usr/bin/env node
/**
 * CI check that the committed viewer files match their source.
 *
 * Rebuilds src/viewer/app/viewer.js and THIRD-PARTY-NOTICES.md and fails if
 * either differs from the committed file.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { buildViewer } from './build-viewer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['src/viewer/app/viewer.js', 'src/viewer/app/THIRD-PARTY-NOTICES.md'];

function git(...args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

// git diff reports nothing for an untracked file, so check tracking first.
if (git('ls-files', '--error-unmatch', '--', ...files).status !== 0) {
  throw new Error(`A generated viewer file is not committed. Run "npm run build:viewer" and commit ${files.join(' and ')}.`);
}

await buildViewer();

const diff = git('diff', '--exit-code', '--', ...files);
if (diff.status !== 0 && diff.status !== 1) {
  throw new Error(`git diff failed: ${diff.stderr?.trim()}`);
}
if (diff.status === 1) {
  throw new Error(`The committed viewer files are stale. Run "npm run build:viewer" and commit ${files.join(' and ')}.`);
}

console.log(`ok: ${files.join(' and ')} match a fresh build`);
