/**
 * @file fsx.mjs
 * @description Path-safety check for project-engine relative paths and glob
 * patterns. Mirrors `safePath`'s rejection rules from `src/installer/fs.js`
 * (reject absolute, drive letter, `..` segment) as a pure check with no
 * filesystem access and no root argument, since the engine must validate
 * glob patterns before any of them are ever joined to a root. Not imported
 * from `src/installer/fs.js` (AD-6: engine imports only `node:` builtins and
 * files inside `src/project/`).
 */

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
