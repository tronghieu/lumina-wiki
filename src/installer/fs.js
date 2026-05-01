/**
 * @module installer/fs
 * @description Filesystem helpers for the Lumina installer.
 *
 * ⭐ HIGH RISK MODULE — symlink ladder, atomic writes, idempotency.
 *
 * Exports:
 *   atomicWrite(filePath, content)               — temp + datasync + rename
 *   linkDirectory(target, linkPath, manifest)    — symlink → junction → copy
 *   safePath(root, candidate)                    — reject traversal attacks
 *   ensureDir(dirPath)                           — recursive mkdir, idempotent
 *   copyDir(src, dest)                           — recursive directory copy
 *   fileHash(filePath)                           — sha256 hex of a file
 *
 * Symlink ladder behavior:
 *   1. fs.symlink(target, linkPath)                  — macOS / Linux / Windows+DevMode
 *   2. fs.symlink(target, linkPath, 'junction')      — Windows directory junctions
 *   3. copyDir(target, linkPath)                     — final fallback; records strategy='copy'
 */

import {
  open,
  readFile,
  writeFile,
  rename,
  unlink,
  mkdir,
  access,
  stat,
  readdir,
  symlink,
  lstat,
  rm,
  copyFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve, normalize, relative, sep, isAbsolute, dirname } from 'node:path';
import { constants as fsConstants } from 'node:fs';

// ---------------------------------------------------------------------------
// atomicWrite
// ---------------------------------------------------------------------------

/**
 * Write content to filePath atomically.
 * Writes to <filePath>.tmp, calls fd.datasync(), closes, then renames.
 * On any error the .tmp is cleaned up and the error is re-thrown.
 * Ensures parent directory exists before writing.
 *
 * @param {string} filePath - Destination path (absolute or CWD-relative).
 * @param {string} content  - UTF-8 string content.
 * @returns {Promise<void>}
 */
export async function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp';
  await ensureDir(dirname(filePath));
  let fd;
  try {
    fd = await open(tmpPath, 'w');
    await fd.writeFile(content, 'utf8');
    await fd.datasync();
    await fd.close();
    fd = null;
    await rename(tmpPath, filePath);
  } catch (err) {
    if (fd) {
      try { await fd.close(); } catch (_) { /* ignore */ }
    }
    // Best-effort cleanup of orphaned .tmp
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------

/**
 * Resolve `candidate` relative to `root` and verify it stays inside root.
 * Handles both forward-slash and back-slash separators (Windows safety).
 * Throws a RangeError if the resolved path escapes root.
 *
 * @param {string} root      - Absolute project root path.
 * @param {string} candidate - User-supplied relative path fragment.
 * @returns {string}           Resolved absolute path guaranteed inside root.
 */
export function safePath(root, candidate) {
  if (typeof candidate !== 'string') throw new TypeError('candidate must be a string');
  if (typeof root !== 'string') throw new TypeError('root must be a string');

  // Normalize separators to forward slashes before checking for traversal
  const normalizedCandidate = candidate.replace(/\\/g, '/');

  // Reject absolute paths outright (Unix '/', Windows 'C:\' / 'C:/').
  // node:path.isAbsolute only recognizes drive-letter prefixes on Windows,
  // so test the pattern explicitly to stay correct under POSIX CI runs.
  const windowsDriveAbsolute = /^[A-Za-z]:[\\/]/.test(candidate);
  if (windowsDriveAbsolute || isAbsolute(normalizedCandidate) || isAbsolute(candidate)) {
    throw new RangeError(`Path traversal rejected: absolute path not allowed: "${candidate}"`);
  }

  // Reject explicit traversal segments
  const segments = normalizedCandidate.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new RangeError(`Path traversal rejected: ".." segment in path: "${candidate}"`);
    }
  }

  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(join(absoluteRoot, candidate));

  // Final safety check: resolved path must start with root + sep
  if (absoluteTarget !== absoluteRoot && !absoluteTarget.startsWith(absoluteRoot + sep) && !absoluteTarget.startsWith(absoluteRoot + '/')) {
    throw new RangeError(`Path traversal rejected: "${candidate}" escapes root "${root}"`);
  }

  return absoluteTarget;
}

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

/**
 * Create a directory (and all parents) if it does not exist.
 * Idempotent — safe to call when the directory already exists.
 *
 * @param {string} dirPath - Directory path to create.
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// copyDir
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory tree from src to dest.
 * Creates dest and all intermediate directories.
 * Overwrites existing files at dest.
 *
 * @param {string} src  - Source directory path.
 * @param {string} dest - Destination directory path.
 * @returns {Promise<void>}
 */
export async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// fileHash
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file's content.
 *
 * @param {string} filePath - Path to the file.
 * @returns {Promise<string>} Hex string.
 */
export function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// linkDirectory — symlink ladder
// ---------------------------------------------------------------------------

/**
 * @typedef {'symlink'|'junction'|'copy'} LinkStrategy
 */

/**
 * @typedef {Object} LinkResult
 * @property {LinkStrategy} strategy - Strategy used.
 * @property {string}       message  - Human-readable description.
 * @property {boolean}      warning  - True when fallback to copy occurred.
 */

/**
 * Create a directory link from `linkPath` pointing to `target` using the best
 * available strategy on the current platform.
 *
 * Symlink ladder:
 *   1. fs.symlink(target, linkPath)                — macOS/Linux, Windows+DevMode
 *   2. fs.symlink(target, linkPath, 'junction')    — Windows directory junctions
 *   3. copyDir(target, linkPath) + warn            — final fallback
 *
 * When `linkPath` already exists and matches the same strategy recorded in
 * `existingStrategy` (from manifest), the function returns early (idempotent).
 * When `linkPath` already exists with a different strategy, it is removed first.
 *
 * @param {string}          target           - Real directory the link should point to.
 * @param {string}          linkPath         - Where the link/copy will be created.
 * @param {LinkStrategy|null} existingStrategy - Strategy from previous install (null = fresh).
 * @returns {Promise<LinkResult>}
 */
export async function linkDirectory(target, linkPath, existingStrategy = null) {
  // Check if linkPath already exists
  let existingStat = null;
  try {
    existingStat = await lstat(linkPath);
  } catch (_) {
    // Does not exist — proceed with creation
  }

  if (existingStat) {
    // If it is a symlink or junction pointing to the right target, keep it
    if (existingStat.isSymbolicLink() && existingStrategy === 'symlink') {
      return { strategy: 'symlink', message: `symlink already exists: ${linkPath}`, warning: false };
    }
    if (existingStat.isSymbolicLink() && existingStrategy === 'junction') {
      return { strategy: 'junction', message: `junction already exists: ${linkPath}`, warning: false };
    }
    if (existingStat.isDirectory() && existingStrategy === 'copy') {
      return { strategy: 'copy', message: `copy already exists: ${linkPath}`, warning: false };
    }
    // Stale or mismatched — remove and recreate
    if (existingStat.isSymbolicLink()) {
      await unlink(linkPath);
    } else if (existingStat.isDirectory()) {
      await rm(linkPath, { recursive: true, force: true });
    } else {
      await unlink(linkPath);
    }
  }

  await ensureDir(dirname(linkPath));

  // Attempt 1: native symlink (macOS / Linux / Windows with Developer Mode)
  try {
    await symlink(target, linkPath);
    return { strategy: 'symlink', message: `symlink created: ${linkPath} -> ${target}`, warning: false };
  } catch (err1) {
    // EPERM on Windows without Developer Mode, or other platform restriction
    const isPermError = err1.code === 'EPERM' || err1.code === 'EACCES';
    if (!isPermError) throw err1; // Unexpected error — propagate
  }

  // Attempt 2: Windows directory junction
  try {
    await symlink(target, linkPath, 'junction');
    return { strategy: 'junction', message: `junction created: ${linkPath} -> ${target}`, warning: false };
  } catch (err2) {
    // Junction also failed — fall through to copy
    const isPermError = err2.code === 'EPERM' || err2.code === 'EACCES' || err2.code === 'EINVAL';
    if (!isPermError) throw err2;
  }

  // Attempt 3: directory copy (final fallback — records strategy: 'copy')
  await copyDir(target, linkPath);
  return {
    strategy: 'copy',
    message: `WARNING: symlink and junction both failed; copied directory: ${linkPath}. Run "lumina install --re-link" after enabling Windows Developer Mode to upgrade to symlinks.`,
    warning: true,
  };
}
