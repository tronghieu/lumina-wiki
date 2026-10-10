/**
 * @module installer/viewer-files
 * @description The one list of what the wiki viewer installs into
 * `_lumina/viewer/`. The package guard and a completeness test read it. A
 * listed file missing from the package is an internal error (exit 3), never
 * skipped.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicCopyFile, pathExists } from './fs.js';

/** Paths relative to `src/viewer/`, forward slashes. */
export const VIEWER_FILES = Object.freeze([
  'view.mjs',
  'lib/server.mjs',
  'lib/data.mjs',
  'lib/communities.mjs',
  'app/index.html',
  'app/viewer.js',
  'app/viewer.css',
  'app/THIRD-PARTY-NOTICES.md',
]);

/**
 * Engine files the viewer reaches by import, relative to `src/scripts/`. They
 * ship and install with the engine, not with the viewer; a test keeps this in
 * step with the real import graph.
 */
export const VIEWER_ENGINE_FILES = Object.freeze([
  'lint.mjs',
  'schemas.mjs',
  'external-ids.mjs',
  'lib/edges.mjs',
  'lib/globs.mjs',
  'lib/fsx.mjs',
  'lib/slug.mjs',
]);

const HERE = dirname(fileURLToPath(import.meta.url));
export const VIEWER_SRC_DIR = join(HERE, '..', 'viewer');
const SCRIPTS_SRC_DIR = join(HERE, '..', 'scripts');

/** Throws (code 3) on the first listed viewer or engine file that is absent. */
export async function assertViewerFilesPresent(srcDir = VIEWER_SRC_DIR, scriptsDir = SCRIPTS_SRC_DIR) {
  for (const rel of VIEWER_FILES) {
    if (!(await pathExists(join(srcDir, ...rel.split('/'))))) {
      const err = new Error(`VIEWER_FILE_MISSING: src/viewer/${rel} is missing from this package`);
      err.code = 3;
      throw err;
    }
  }
  for (const rel of VIEWER_ENGINE_FILES) {
    if (!(await pathExists(join(scriptsDir, ...rel.split('/'))))) {
      const err = new Error(`VIEWER_FILE_MISSING: src/scripts/${rel} is missing from this package`);
      err.code = 3;
      throw err;
    }
  }
}

export async function copyViewerFiles(projectRoot, srcDir = VIEWER_SRC_DIR) {
  await assertViewerFilesPresent(srcDir);
  for (const rel of VIEWER_FILES) {
    const parts = rel.split('/');
    await atomicCopyFile(join(srcDir, ...parts), join(projectRoot, '_lumina', 'viewer', ...parts));
  }
}
