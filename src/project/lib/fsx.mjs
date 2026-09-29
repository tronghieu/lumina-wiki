/**
 * @file fsx.mjs
 * @description Path-safety check for project-engine relative paths and glob
 * patterns, plus the two write primitives `facts-write` needs (AD-23):
 * `atomicWrite` (temp name + fsync + rename, with a unique temp name so two
 * writers never collide on the same `.tmp` path) and `withLock`
 * (exclusive-create lock file, holder-owned token, mtime heartbeat while
 * held, stale after `staleMs`, retried for up to `timeoutMs`). The
 * path-safety check rejects an absolute path, a Windows drive letter, and a
 * `..` segment, as a pure check with no filesystem access and no root
 * argument, since the engine must validate glob patterns before any of them
 * are ever joined to a root. Only `node:` builtins and files inside
 * `src/project/` are imported here (AD-6).
 */

import { open, mkdir, rename, unlink, stat, readFile, utimes } from 'node:fs/promises';
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
// withLock (AD-23): exclusive-create lock file at `lockPath`, content
// `"<pid>:<token>"` with a random per-acquisition token. A lock whose mtime
// is older than `staleMs` is taken over; otherwise the caller retries
// (polling) for up to `timeoutMs` before giving up. While held, an unref'd
// interval refreshes the lock's mtime every `staleMs / 3` so a holder whose
// `fn` runs longer than `staleMs` never looks stale to a waiter. Release
// unlinks the lock file only if its content still holds our token, so a
// holder that *was* reclaimed (its heartbeat somehow lost the race, or
// `staleMs` was set too low for the work) never deletes the new owner's
// lock. Timings are parameters, not constants, so tests can shorten them
// instead of waiting for real time to pass.
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
 * afterward whether `fn` succeeds or throws. Guards against the two races a
 * plain "unlink on exit" lock has under concurrent, potentially slow,
 * holders: a live holder being reclaimed as stale (heartbeat), and a
 * reclaimed holder deleting the new owner's lock (token check on release).
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
  const token = randomBytes(8).toString('hex');
  const ownContent = `${process.pid}:${token}`;

  for (;;) {
    try {
      const fd = await open(lockPath, 'wx');
      await fd.writeFile(ownContent);
      await fd.close();
      break; // acquired
    } catch (e) {
      // Windows: a lock just unlinked stays "delete pending" while any handle
      // (a waiter's readFile) is open, and creating it fails with EPERM
      // instead of EEXIST until that handle closes. Treat it as contention.
      if (e.code === 'EPERM' && process.platform === 'win32') {
        if (now() - start > timeoutMs) throw e;
        await sleep(pollMs);
        continue;
      }
      if (e.code !== 'EEXIST') throw e;

      // Content first, then mtime: a lock replaced after this read either
      // shows a fresh mtime below or different content at the re-read, so
      // it is never mistaken for the stale one we saw.
      let seenContent = null;
      let mtimeMs = null;
      try {
        seenContent = await readFile(lockPath, 'utf8').catch((err) => {
          if (err.code === 'ENOENT') throw err;
          return null; // unreadable (e.g. a directory): never reclaimable, fall through to timeout
        });
        mtimeMs = (await stat(lockPath)).mtimeMs;
      } catch {
        continue; // lock file vanished between the failed create and here; retry immediately
      }
      if (seenContent !== null && now() - mtimeMs > staleMs) {
        // Stale: take it over only if its content is still what we saw.
        // ponytail: still racy between the re-read and the unlink; an atomic
        // reclaim needs a rename/link scheme or an OS lock (flock). Fine for
        // a single-machine, few-contender lock. Any failure falls through to
        // timeout/sleep below instead of spinning hot into another `open`.
        try {
          if (await readFile(lockPath, 'utf8') === seenContent) {
            await unlink(lockPath);
            continue;
          }
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

  const heartbeatMs = Math.max(1, Math.floor(staleMs / 3));
  // Refresh only while the lock is still ours: once reclaimed, touching it
  // would keep the new owner's lock fresh even after that owner dies.
  // ponytail: read-then-utimes is not atomic, same ceiling as the reclaim above.
  const heartbeat = setInterval(() => {
    readFile(lockPath, 'utf8')
      .then((current) => current === ownContent && utimes(lockPath, new Date(), new Date()))
      .catch(() => {});
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      const current = await readFile(lockPath, 'utf8');
      if (current === ownContent) {
        await unlink(lockPath);
      }
    } catch {
      // already gone; nothing to release
    }
  }
}
