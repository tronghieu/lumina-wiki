#!/usr/bin/env node
/**
 * @module reset
 * @description Scoped destructive reset for Lumina wiki workspaces.
 *
 * Usage: node reset.mjs --scope <wiki|raw|state|checkpoints|all> [--yes] [--dry-run]
 * Exit codes: 0 success/dry-run, 2 user error, 3 internal error
 */

import { readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, sep, parse as parsePath } from 'node:path';
import { existsSync } from 'node:fs';

// --- Output helpers ---------------------------------------------------------

const NO_COLOR = process.env.NO_COLOR !== undefined || !process.stdout.isTTY; // eslint-disable-line no-unused-vars

/** @param {string} msg */
function out(msg) { process.stdout.write(msg + '\n'); }
/** @param {string} msg */
function err(msg) { process.stderr.write(msg + '\n'); }
/** @param {string} msg @param {number} code @returns {never} */
function die(msg, code) { err(msg); process.exit(code); }

// --- Argument parsing -------------------------------------------------------

const VALID_SCOPES = new Set(['wiki', 'raw', 'state', 'checkpoints', 'all']);

function parseArgs(argv) {
  const args = argv.slice(2);
  let scope = null, yes = false, dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--scope')    { scope  = args[++i] ?? null; }
    else if (a === '--yes') { yes    = true; }
    else if (a === '--dry-run') { dryRun = true; }
    else { die(`Unknown argument: ${a}`, 2); }
  }

  if (!scope) die('--scope is required. Values: wiki|raw|state|checkpoints|all', 2);
  if (!VALID_SCOPES.has(scope)) die(`Invalid scope "${scope}". Values: wiki|raw|state|checkpoints|all`, 2);
  return { scope, yes, dryRun };
}

// --- Project root discovery -------------------------------------------------

/** Walk up from cwd until wiki/ or _lumina/ found. @returns {string} */
function findProjectRoot() {
  let dir = resolve(process.cwd());
  const fsRoot = parsePath(dir).root || '/';
  while (true) {
    if (existsSync(join(dir, 'wiki')) || existsSync(join(dir, '_lumina'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir || dir === fsRoot) break;
    dir = parent;
  }
  die('Could not locate project root (no wiki/ or _lumina/ found in cwd or ancestors).', 2);
}

// --- Path safety ------------------------------------------------------------

/**
 * Resolve path and assert it stays within projectRoot.
 * @param {string} projectRoot @param {string} target @returns {string}
 */
function safePath(projectRoot, target) {
  const resolved = resolve(target);
  const rel = relative(projectRoot, resolved);
  if (rel.split(/[\\/]/)[0] === '..' || rel === '..') {
    die(`Path traversal detected: "${target}" is outside project root.`, 2);
  }
  return resolved;
}

// --- Filesystem helpers -----------------------------------------------------

/**
 * Recursively collect entries under dir.
 * @param {string} dir @param {string} [base]
 * @returns {Promise<{path:string, size:number, isDir:boolean}[]>}
 */
async function collectEntries(dir, base) {
  base = base ?? dir;
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel  = relative(base, full);
    if (e.isDirectory()) {
      results.push({ path: rel, size: 0, isDir: true });
      results.push(...await collectEntries(full, base));
    } else {
      let size = 0;
      try { size = (await stat(full)).size; } catch { /* ignore */ }
      results.push({ path: rel, size, isDir: false });
    }
  }
  return results;
}

/** @param {number} bytes @returns {string} */
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Scope resolution -------------------------------------------------------

/** Match checkpoint files: <skill>-<phase>.json */
const CHECKPOINT_RE = /^[^/]+-[^/]+\.json$/;

/**
 * @typedef {{ deleteTargets: string[], recreate: {path:string, content:string}[],
 *             label: string, checkpointsOnly: boolean }} ResetPlan
 */

/** @param {string} scope @param {string} root @returns {ResetPlan} */
function buildPlan(scope, root) {
  const wikiDir  = safePath(root, join(root, 'wiki'));
  const rawDir   = safePath(root, join(root, 'raw'));
  const stateDir = safePath(root, join(root, '_lumina', '_state'));
  const wikiStubs = [
    { path: join(wikiDir, 'index.md'), content: '' },
    { path: join(wikiDir, 'log.md'),   content: '' },
  ];

  switch (scope) {
    case 'wiki':         return { deleteTargets: [wikiDir],             recreate: wikiStubs, label: 'wiki',              checkpointsOnly: false };
    case 'raw':          return { deleteTargets: [rawDir],              recreate: [],        label: 'raw',               checkpointsOnly: false };
    case 'state':        return { deleteTargets: [stateDir],            recreate: [],        label: 'state',             checkpointsOnly: false };
    case 'checkpoints':  return { deleteTargets: [stateDir],            recreate: [],        label: 'checkpoints',       checkpointsOnly: true  };
    case 'all':          return { deleteTargets: [wikiDir, stateDir],   recreate: wikiStubs, label: 'all (wiki + state)', checkpointsOnly: false };
    default: die(`Unhandled scope: ${scope}`, 2);
  }
}

// --- Dry-run ----------------------------------------------------------------

/** @param {ResetPlan} plan @param {string} scope @param {string} root */
async function printDryRun(plan, scope, root) {
  out(`Plan: --scope ${scope} --yes`);
  out('Would delete:');
  let totalFiles = 0, totalBytes = 0;

  for (const target of plan.deleteTargets) {
    const rel     = relative(root, target);
    const entries = await collectEntries(target).catch(() => []);
    const filtered = plan.checkpointsOnly
      ? entries.filter(e => !e.isDir && CHECKPOINT_RE.test(e.path))
      : entries;
    const files = filtered.filter(e => !e.isDir);
    const bytes = files.reduce((s, e) => s + e.size, 0);
    totalFiles += files.length;
    totalBytes += bytes;
    const label = plan.checkpointsOnly ? `${rel}/ (checkpoints only)` : `${rel}/`;
    out(`  ${label}  (${files.length} files, ${fmtBytes(bytes)})`);
  }

  if (plan.recreate.length > 0) {
    out('Would recreate:');
    for (const r of plan.recreate) out(`  ${relative(root, r.path)}  (empty)`);
  }
  out(`Total: ${totalFiles} files, ${fmtBytes(totalBytes)}`);
}

// --- Actual deletion --------------------------------------------------------

/** @param {ResetPlan} plan @param {string} root @returns {Promise<number>} */
async function executeDelete(plan, root) {
  let count = 0;

  for (const target of plan.deleteTargets) {
    safePath(root, target);

    if (plan.checkpointsOnly) {
      const entries = await collectEntries(target).catch(() => []);
      for (const e of entries.filter(f => !f.isDir && CHECKPOINT_RE.test(f.path))) {
        const full = join(target, e.path);
        safePath(root, full);
        await rm(full, { force: false });
        count++;
      }
    } else {
      const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = join(target, e.name);
        safePath(root, full);
        const pre = await collectEntries(full).catch(() => []);
        const fileCount = pre.filter(x => !x.isDir).length || (e.isDirectory() ? 0 : 1);
        await rm(full, { force: false, recursive: true });
        count += fileCount;
      }
    }
  }

  for (const r of plan.recreate) {
    await mkdir(resolve(r.path, '..'), { recursive: true });
    await writeFile(r.path, r.content, 'utf8');
  }

  return count;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const { scope, yes, dryRun } = parseArgs(process.argv);
  const root = findProjectRoot();
  const plan = buildPlan(scope, root);

  if (dryRun) { await printDryRun(plan, scope, root); process.exit(0); }

  if (!yes) {
    err('[error] --yes is required to perform destructive operations.');
    err('Run with --dry-run to preview what would be deleted.');
    err('Re-run with --yes to proceed.');
    process.exit(2);
  }

  try {
    const count = await executeDelete(plan, root);
    out(`[OK] reset --scope ${scope} complete: deleted ${count} files`);
  } catch (e) {
    die(`[error] Delete failed: ${e.message}`, 3);
  }
}

main();
