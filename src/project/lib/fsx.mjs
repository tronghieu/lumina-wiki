/**
 * @file fsx.mjs
 * @description Path-safety check for project-engine relative paths and glob
 * patterns, plus the two write primitives `facts-write` needs (AD-23):
 * `atomicWrite` (temp name + fsync + rename, mirroring `src/installer/fs.js`
 * `atomicWrite` but with a unique temp name so two writers never collide on
 * the same `.tmp` path) and `withLock` (exclusive-create lock file, stale
 * after `staleMs`, retried for up to `timeoutMs`). Mirrors `safePath`'s
 * rejection rules from `src/installer/fs.js` (reject absolute, drive letter,
 * `..` segment) as a pure check with no filesystem access and no root
 * argument, since the engine must validate glob patterns before any of them
 * are ever joined to a root. Not imported from `src/installer/fs.js` (AD-6:
 * engine imports only `node:` builtins and files inside `src/project/`).
 */

import { open, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const DRIVE_LETTER_RE = /^[A-Za-z]:/;

/**
 * Assert that `p` is a safe repo-relative path or glob pattern: no
 * backslash, no absolute path, no Windows drive letter, no `..` segment.
 * @param {string} p
 * @returns {string} `p`, unchanged, when safe.
 * @throws {RangeError} when unsafe.
 */
export function assertSafeRelPath(p) {
  if (typeof p !== 'string' || p.length === 0) {
    throw new RangeError(`unsafe path: ${JSON.stringify(p)}`);
  }
  if (p.includes('\\')) {
    throw new RangeError(`unsafe path: backslash not allowed: "${p}"`);
  }
  if (p.startsWith('/')) {
    throw new RangeError(`unsafe path: absolute path not allowed: "${p}"`);
  }
  if (DRIVE_LETTER_RE.test(p)) {
    throw new RangeError(`unsafe path: drive letter not allowed: "${p}"`);
  }
  for (const seg of p.split('/')) {
    if (seg === '..') {
      throw new RangeError(`unsafe path: ".." segment not allowed: "${p}"`);
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// atomicWrite (AD-23): unique temp name (pid + random bytes) so two writers
// racing on the same destination never collide on the same temp path, then
// fsync, then rename. Parent directories are created as needed.
// ---------------------------------------------------------------------------

/**
 * Write `text` to `absPath` atomically: temp file (unique name) + fsync +
 * rename over the destination.
 * @param {string} absPath absolute destination path.
 * @param {string} text UTF-8 content.
 * @returns {Promise<void>}
 */
export async function atomicWrite(absPath, text) {
  const dir = dirname(absPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.${basename(absPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try {
    fd = await open(tmpPath, 'w');
    await fd.writeFile(text, 'utf8');
    await fd.sync();
    await fd.close();
    fd = null;
    await rename(tmpPath, absPath);
  } catch (err) {
    if (fd) {
      try { await fd.close(); } catch { /* already closing on error path */ }
    }
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// withLock (AD-23): exclusive-create lock file at `lockPath`. A lock whose
// mtime is older than `staleMs` is taken over; otherwise the caller retries
// (polling) for up to `timeoutMs` before giving up. Timings are parameters,
// not constants, so tests can shorten them instead of waiting for real time
// to pass.
// ---------------------------------------------------------------------------

/** Thrown by `withLock` when the lock stays held (and fresh) past `timeoutMs`. */
export class LockTimeoutError extends Error {
  constructor(lockPath) {
    super(`could not acquire lock (held): ${lockPath}`);
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding an exclusive lock file at `lockPath`, released
 * afterward whether `fn` succeeds or throws.
 * @param {string} lockPath absolute path to the lock file.
 * @param {() => Promise<any>} fn
 * @param {object} [options]
 * @param {number} [options.staleMs] a lock older than this (by mtime) is taken over.
 * @param {number} [options.timeoutMs] give up (throw `LockTimeoutError`) after retrying this long.
 * @param {number} [options.pollMs] delay between acquire attempts.
 * @param {() => number} [options.now] injectable clock, for tests.
 * @param {(ms: number) => Promise<void>} [options.sleep] injectable delay, for tests.
 * @returns {Promise<any>} `fn`'s return value.
 * @throws {LockTimeoutError}
 */
export async function withLock(lockPath, fn, options = {}) {
  const {
    staleMs = 30000,
    timeoutMs = 10000,
    pollMs = 50,
    now = Date.now,
    sleep = defaultSleep,
  } = options;

  await mkdir(dirname(lockPath), { recursive: true });
  const start = now();

  for (;;) {
    try {
      const fd = await open(lockPath, 'wx');
      await fd.writeFile(String(process.pid));
      await fd.close();
      break; // acquired
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;

      let mtimeMs = null;
      try {
        mtimeMs = (await stat(lockPath)).mtimeMs;
      } catch {
        continue; // lock file vanished between the failed create and this stat; retry immediately
      }
      if (now() - mtimeMs > staleMs) {
        // Stale: take it over. A concurrent taker may race here and lose to
        // `unlink` + retry -- acceptable, the retry loop resolves it. When
        // `unlink` itself fails (e.g. `lockPath` is a directory, EPERM),
        // don't `continue` straight back into another failing `open` --
        // that would spin hot forever, never reaching the timeout check or
        // sleep below. Fall through to them instead, same as a live lock.
        try {
          await unlink(lockPath);
          continue;
        } catch {
          // fall through
        }
      }
      if (now() - start > timeoutMs) {
        throw new LockTimeoutError(lockPath);
      }
      await sleep(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}
