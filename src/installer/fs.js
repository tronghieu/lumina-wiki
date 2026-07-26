/**
 * @module installer/fs
 * @description Filesystem helpers for the Lumina installer.
 *
 * ⭐ HIGH RISK MODULE — symlink ladder, atomic writes, idempotency.
 *
 * Exports:
 *   atomicWrite(filePath, content)               — temp + datasync + rename
 *   atomicCopyFile(srcPath, destPath)            — same discipline, for copying an existing file
 *   linkDirectory(target, linkPath, manifest)    — symlink → junction → copy
 *   safePath(root, candidate)                    — reject traversal attacks
 *   ensureDir(dirPath)                           — recursive mkdir, idempotent
 *   copyDir(src, dest)                           — recursive directory copy, atomic per file
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
  realpath,
  lstat,
  rm,
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
// atomicCopyFile
// ---------------------------------------------------------------------------

/**
 * Copy a file atomically: read the full source content, write it to
 * `<destPath>.tmp`, fsync, then rename over `destPath`. Same discipline as
 * `atomicWrite`, but for copying an existing file's bytes rather than
 * writing a string — used everywhere the installer copies its own payload
 * (skills, scripts, tools) into a user's workspace.
 *
 * A bare `fs.copyFile` writes directly into the destination path; an
 * interruption partway through (process kill, power loss, OOM, a CI
 * timeout) can leave a truncated file sitting at that path permanently —
 * on a skill's SKILL.md, a truncated file fails the ownership fingerprint
 * on every subsequent reinstall and is never repaired (see
 * isLuminaOwnedSkillEntry: a skill whose content doesn't match is treated
 * as foreign, deliberately, with no special case for "looks corrupted").
 * With the temp+rename discipline, `destPath` is always either the
 * complete old file or the complete new file — an interruption at any
 * point leaves the OLD content in place (nothing has touched `destPath`
 * itself yet) or the fully-written NEW content (if interrupted after the
 * rename, which is atomic at the filesystem level) — never a partial write
 * at the real path. Reads/writes raw bytes (a Buffer), not a UTF-8 string,
 * so binary payloads (if any are ever added) survive intact too.
 *
 * @param {string} srcPath  - Source file to copy from.
 * @param {string} destPath - Destination path (absolute or CWD-relative).
 * @returns {Promise<void>}
 */
export async function atomicCopyFile(srcPath, destPath) {
  const content = await readFile(srcPath);
  const tmpPath = destPath + '.tmp';
  await ensureDir(dirname(destPath));
  let fd;
  try {
    fd = await open(tmpPath, 'w');
    await fd.writeFile(content);
    await fd.datasync();
    await fd.close();
    fd = null;
    await rename(tmpPath, destPath);
  } catch (err) {
    if (fd) {
      try { await fd.close(); } catch (_) { /* ignore */ }
    }
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
 * Overwrites existing files at dest — atomically per file (via
 * `atomicCopyFile`), so an interruption mid-copy can never leave a
 * truncated file at any path under `dest`.
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
      await atomicCopyFile(srcPath, destPath);
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

async function linkPointsToTarget(linkPath, target) {
  try {
    const [currentTarget, expectedTarget] = await Promise.all([
      realpath(linkPath),
      realpath(target),
    ]);
    return currentTarget === expectedTarget;
  } catch (_) {
    return false;
  }
}

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
 * When `linkPath` already exists and points to `target` with the same link
 * strategy recorded in `existingStrategy`, the function returns early.
 * Stale links are removed and recreated. Copy fallbacks are refreshed because
 * their source target cannot be verified from filesystem metadata.
 *
 * This is a generic helper with no manifest access, so it does not decide
 * ownership itself. When the caller passes `options.isOwned`, it is
 * consulted exactly once (as `isOwned(linkPath, existingStat) =>
 * Promise<boolean>`) whenever `linkPath` already exists and the fast
 * "already matches the recorded strategy" early return does not apply —
 * i.e. before any of the destructive/overwriting steps that follow:
 * refreshing a recorded copy-strategy fallback, or removing a
 * stale/mismatched entry. The check runs once for whatever is actually
 * there, BEFORE branching on its shape (symlink, junction, directory, or
 * plain file) — never shape-then-ask, which previously left two of those
 * three shapes unguarded (only the "existing entry is a directory" branch
 * consulted `isOwned`; a plain file or a symlink pointing outside Lumina's
 * own tree was unlinked/deleted unconditionally). If `isOwned` resolves
 * false, `linkPath` is left completely untouched and a `{ strategy:
 * 'foreign', foreign: true }` result is returned instead of linking.
 * Callers that omit `isOwned` keep today's unconditional behavior.
 *
 * @param {string}          target           - Real directory the link should point to.
 * @param {string}          linkPath         - Where the link/copy will be created.
 * @param {LinkStrategy|null} existingStrategy - Strategy from previous install (null = fresh).
 * @param {object}          [options]
 * @param {(linkPath: string, existingStat: import('node:fs').Stats) => Promise<boolean>} [options.isOwned] -
 *   Ownership guard consulted before overwriting or deleting anything at `linkPath`.
 * @returns {Promise<LinkResult>}
 */
export async function linkDirectory(target, linkPath, existingStrategy = null, options = {}) {
  const { isOwned = null } = options;

  // Check if linkPath already exists
  let existingStat = null;
  let lstatError = null;
  try {
    existingStat = await lstat(linkPath);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      // Something IS there and we could not look at it (EACCES, EPERM,
      // EIO, ...) — e.g. the shared parent directory lost traverse
      // permission. When the caller supplied an ownership guard, defer the
      // verdict to it instead of aborting the whole install here: isOwned
      // performs its own lstat and independently fails closed to "not
      // owned" on this exact condition (see isLuminaOwnedSkillEntry), so
      // the safe outcome is the same "foreign, leave it alone" result a
      // rejected isOwned already produces below — not a hard throw.
      // Callers that omit isOwned have no such fallback and keep today's
      // unconditional behavior.
      if (!isOwned) throw err;
      lstatError = err;
    }
  }

  if (existingStat || lstatError) {
    // Fast path: already a symlink/junction pointing at the right target,
    // under the strategy we last recorded — this check IS the ownership
    // proof for a symlink (same realpath comparison isOwned would make),
    // so it returns early without ever consulting isOwned. This keeps
    // ordinary reinstalls fast and silent rather than paying for an extra
    // stat/readFile on every run. Skipped entirely when the initial lstat
    // itself failed — there is no stat to fast-path on.
    if (
      existingStat?.isSymbolicLink()
      && (existingStrategy === 'symlink' || existingStrategy === 'junction')
    ) {
      if (await linkPointsToTarget(linkPath, target)) {
        return {
          strategy: existingStrategy,
          message: `${existingStrategy} already exists: ${linkPath}`,
          warning: false,
        };
      }
    }

    // Everything from here on is about to overwrite or delete whatever
    // currently sits at `linkPath` — refreshing a recorded copy fallback,
    // or removing a stale/mismatched entry of ANY shape. `existingStrategy`
    // is only ever a manifest's memory of what USED to be here, never proof
    // of what's there now, so ask once — for whichever shape actually
    // exists — before doing anything to it.
    if (isOwned && !(await isOwned(linkPath, existingStat))) {
      return {
        strategy: 'foreign',
        message: `Found an existing entry at ${linkPath} that does not look like it was installed by Lumina (its content doesn't match a Lumina skill). Lumina will not touch content it does not recognize — move or delete it yourself if you want Lumina's skill linked there.`,
        warning: true,
        foreign: true,
      };
    }

    if (lstatError) {
      // isOwned resolved true despite our own lstat failing — shouldn't
      // happen in practice (isOwned's independent lstat hits the identical
      // failure and fails closed above), but without a stat we don't know
      // what shape is sitting at linkPath and cannot safely act on it.
      throw lstatError;
    }

    if (existingStat.isDirectory() && existingStrategy === 'copy') {
      await rm(linkPath, { recursive: true, force: true });
      await copyDir(target, linkPath);
      return { strategy: 'copy', message: `copy refreshed: ${linkPath}`, warning: false };
    }
    // Stale or mismatched — remove and recreate.
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
    const symlinkTarget = process.platform === 'win32'
      ? resolve(target)
      : (relative(dirname(linkPath), target) || '.');
    await symlink(symlinkTarget, linkPath);
    return { strategy: 'symlink', message: `symlink created: ${linkPath} -> ${symlinkTarget}`, warning: false };
  } catch (err1) {
    // EPERM on Windows without Developer Mode, or other platform restriction
    const isPermError = err1.code === 'EPERM' || err1.code === 'EACCES';
    if (!isPermError) throw err1; // Unexpected error — propagate
  }

  // Attempt 2: Windows directory junction
  try {
    await symlink(resolve(target), linkPath, 'junction');
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
