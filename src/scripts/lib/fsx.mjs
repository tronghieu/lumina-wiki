/**
 * @file fsx.mjs
 * @description Filesystem primitives shared by every script in this layer.
 *
 * `atomicWrite` used to exist as four separate copies (wiki.mjs, lint.mjs,
 * discover-runner.mjs, lib/discovery-state.mjs) plus a bare `writeFile` in
 * reset.mjs. They had already drifted: the lint copy wrote with `writeFile`
 * and renamed without ever calling `fd.datasync()`, so `lint --fix` — the
 * widest-blast-radius mutation path in the project — ran without the
 * durability guarantee the other copies provide. One implementation, taking
 * the strictest behaviour of the set.
 */

import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write `content` to `filePath` atomically: create the parent directory,
 * write to `<filePath>.tmp`, fsync the descriptor, then rename into place.
 * The temp file is removed on failure so a crash never leaves a partial
 * sibling behind.
 *
 * @param {string} filePath Destination path.
 * @param {string} content  UTF-8 content to write.
 * @returns {Promise<void>}
 */
export async function atomicWrite(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
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
    // Best-effort cleanup of the temp file.
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
