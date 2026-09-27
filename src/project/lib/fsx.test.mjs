import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertSafeRelPath, atomicWrite, withLock, LockTimeoutError } from './fsx.mjs';

describe('assertSafeRelPath', () => {
  test('accepts a plain repo-relative path', () => {
    assert.equal(assertSafeRelPath('docs/adr'), 'docs/adr');
  });

  test('accepts a glob pattern', () => {
    assert.equal(assertSafeRelPath('packages/*/docs'), 'packages/*/docs');
  });

  for (const bad of ['../x', '/abs', 'C:/x', 'c:\\x', 'a\\b', '', 'docs/../x']) {
    test(`rejects unsafe pattern ${JSON.stringify(bad)}`, () => {
      assert.throws(() => assertSafeRelPath(bad), RangeError);
    });
  }

  test('error message names the offending pattern', () => {
    assert.throws(() => assertSafeRelPath('../x'), (err) => {
      assert.match(err.message, /\.\.\/x/);
      return true;
    });
  });
});

describe('atomicWrite', () => {
  let dir;
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lumina-fsx-atomic-'));
  });
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('writes the file and creates parent directories', async () => {
    const dest = join(dir, 'a', 'b', 'out.json');
    await atomicWrite(dest, '{"x":1}\n');
    assert.equal(await readFile(dest, 'utf8'), '{"x":1}\n');
  });

  test('replaces existing content and leaves no temp file behind', async () => {
    const dest = join(dir, 'out.json');
    await atomicWrite(dest, 'first');
    await atomicWrite(dest, 'second');
    assert.equal(await readFile(dest, 'utf8'), 'second');
    const entries = await readdir(dir);
    assert.deepEqual(entries, ['out.json']);
  });

  test('two concurrent writes to the same path use distinct temp names and both land', async () => {
    const dest = join(dir, 'out.json');
    await Promise.all([atomicWrite(dest, 'one'), atomicWrite(dest, 'two')]);
    const content = await readFile(dest, 'utf8');
    assert.ok(content === 'one' || content === 'two');
    const entries = await readdir(dir);
    assert.deepEqual(entries, ['out.json']);
  });
});

describe('withLock', () => {
  let dir;
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lumina-fsx-lock-'));
  });
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('runs fn and releases the lock file afterward', async () => {
    const lockPath = join(dir, '_state', 'lock');
    let ran = false;
    const result = await withLock(lockPath, async () => {
      ran = true;
      return 42;
    });
    assert.equal(result, 42);
    assert.ok(ran);
    await assert.rejects(readFile(lockPath), { code: 'ENOENT' });
  });

  test('releases the lock even when fn throws', async () => {
    const lockPath = join(dir, 'lock');
    await assert.rejects(
      withLock(lockPath, async () => { throw new Error('boom'); }),
      /boom/,
    );
    await assert.rejects(readFile(lockPath), { code: 'ENOENT' });
  });

  test('a fresh, live lock makes a second caller time out with LockTimeoutError', async () => {
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, 'held');
    await assert.rejects(
      withLock(lockPath, async () => {}, { timeoutMs: 30, pollMs: 5 }),
      (err) => err instanceof LockTimeoutError,
    );
    // The live lock is left untouched by a timed-out caller.
    assert.equal(await readFile(lockPath, 'utf8'), 'held');
  });

  test('a stale lock (older than staleMs) is taken over and fn runs', async () => {
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, 'held');
    const old = new Date(Date.now() - 60000);
    await utimes(lockPath, old, old);
    let ran = false;
    await withLock(lockPath, async () => { ran = true; }, { staleMs: 1000, timeoutMs: 200, pollMs: 5 });
    assert.ok(ran);
  });

  test('a stale lock that is a directory (unlink fails) still times out instead of spinning', async () => {
    const lockPath = join(dir, 'lock');
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60000);
    await utimes(lockPath, old, old);
    await assert.rejects(
      withLock(lockPath, async () => {}, { staleMs: 1000, timeoutMs: 100, pollMs: 5 }),
      (err) => err instanceof LockTimeoutError,
    );
  });

  test('injectable clock/sleep let a timeout test run without waiting on real time', async () => {
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, 'held');
    let fakeNow = 0;
    const sleeps = [];
    await assert.rejects(
      withLock(lockPath, async () => {}, {
        timeoutMs: 100,
        pollMs: 10,
        now: () => fakeNow,
        sleep: async (ms) => { sleeps.push(ms); fakeNow += ms; },
      }),
      (err) => err instanceof LockTimeoutError,
    );
    assert.ok(sleeps.length > 0);
  });

  test('release does not delete a lock whose token changed (was reclaimed)', async () => {
    const lockPath = join(dir, 'lock');
    const result = await withLock(lockPath, async () => {
      // Simulate another process reclaiming this lock while we hold it
      // (e.g. our heartbeat lost the race, or staleMs was too low for the
      // work). Our own release must not delete the new owner's lock.
      await writeFile(lockPath, `${process.pid}:someone-elses-token`);
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(await readFile(lockPath, 'utf8'), `${process.pid}:someone-elses-token`);
  });

  test('heartbeat keeps a long-running holder from being reclaimed by a waiter', async () => {
    const lockPath = join(dir, 'lock');
    let active = 0;
    let overlapped = false;

    const holder = withLock(lockPath, async () => {
      active += 1;
      await new Promise((r) => setTimeout(r, 400));
      if (active > 1) overlapped = true;
      active -= 1;
    }, { staleMs: 150, pollMs: 10, timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 20)); // let the holder acquire first

    const waiter = withLock(lockPath, async () => {
      active += 1;
      if (active > 1) overlapped = true;
      active -= 1;
    }, { staleMs: 150, pollMs: 10, timeoutMs: 2000 });

    await Promise.all([holder, waiter]);
    assert.equal(overlapped, false);
  });

  test('two concurrent callers serialize: only one runs fn at a time', async () => {
    const lockPath = join(dir, 'lock');
    let active = 0;
    let maxActive = 0;
    async function task() {
      return withLock(lockPath, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      }, { pollMs: 5, timeoutMs: 2000 });
    }
    await Promise.all([task(), task(), task()]);
    assert.equal(maxActive, 1);
  });
});
