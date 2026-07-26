/**
 * @module installer/layout
 * @description Canonical, pack-aware description of a conforming Lumina
 * workspace — pure data derived from what `commands.js`'s install flow
 * actually writes (see CORE_WIKI_DIRS / RESEARCH_WIKI_DIRS / etc. there).
 *
 * This is the single definition consumed by install, `wikis doctor`, and
 * doctor's repair step (AD-5). No I/O at import time; `checkLayout` is the
 * only function and it only reads.
 *
 * Keep this in sync with `commands.js` by construction: `layout.test.js`
 * runs a real sandbox install and fails if this data and installer output
 * disagree.
 */

import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

// ---------------------------------------------------------------------------
// Directories always present after a core install (mirrors commands.js:
// CORE_WIKI_DIRS, CORE_RAW_DIRS, LUMINA_DIRS). '.agents/skills' is NOT here
// — it's a full-profile-only directory (see fullProfileDirs below); a
// minimal-profile install has no per-project skill copies at all.
// ---------------------------------------------------------------------------

export const baseDirs = [
  'wiki/sources', 'wiki/concepts', 'wiki/people', 'wiki/summary',
  'wiki/outputs', 'wiki/graph', 'wiki/readings',
  'raw/sources', 'raw/notes', 'raw/assets', 'raw/tmp', 'raw/download',
  '_lumina/config', '_lumina/schema', '_lumina/scripts', '_lumina/tools', '_lumina/_state',
];

// ---------------------------------------------------------------------------
// Directories only present under the 'full' install profile (mirrors
// commands.js's `if (profile === 'full') dirsToCreate.push('.agents/skills')`).
// A 'minimal' profile install never creates these — the workspace is managed
// entirely by globally-installed agent skills, with no per-project copies.
// ---------------------------------------------------------------------------

export const fullProfileDirs = ['.agents/skills'];

// ---------------------------------------------------------------------------
// Extra directories created only when a given pack is selected (mirrors
// RESEARCH_WIKI_DIRS/RESEARCH_RAW_DIRS, READING_WIKI_DIRS, LEARNING_WIKI_DIRS).
// `core` has no entry here — its dirs are always in baseDirs.
// ---------------------------------------------------------------------------

export const packDirs = {
  research: ['wiki/foundations', 'wiki/topics', 'raw/discovered'],
  reading: ['wiki/chapters', 'wiki/characters', 'wiki/themes', 'wiki/plot'],
  learning: ['wiki/reflections'],
};

// ---------------------------------------------------------------------------
// Files seeded only on first install (mirrors seedWikiFiles in commands.js).
// ---------------------------------------------------------------------------

export const seedFiles = [
  { relPath: 'wiki/index.md', kind: 'first-install-only' },
  { relPath: 'wiki/log.md', kind: 'first-install-only' },
];

// ---------------------------------------------------------------------------
// Paths whose content only the installer can correctly (re)produce —
// README.md needs schema-region-aware rendering, _lumina/config needs the
// full answers→YAML render, _lumina/scripts is a multi-file copy from the
// package's script sources. Doctor/repair may only report these as missing;
// remediation is "re-run the installer", never a hand-written stand-in.
// ---------------------------------------------------------------------------

export const engineCriticalPaths = ['_lumina/scripts', '_lumina/config', 'README.md'];

/**
 * Check an installed workspace against the canonical layout for the given
 * packs. Read-only — never creates or modifies anything.
 *
 * @param {string} rootAbs - Absolute path to the workspace root.
 * @param {string[]} [packs] - Installed packs; 'core' is implicit/ignored.
 * @param {object} [options]
 * @param {'full'|'minimal'} [options.profile='full'] - Install profile. A
 *   'minimal' profile never expects '.agents/skills' (no per-project skill
 *   copies) — see fullProfileDirs. Default 'full' preserves pre-profile
 *   behavior for existing 2-arg call sites.
 * @returns {Promise<{ok: boolean, missingDirs: string[], missingSeedFiles: string[], missingEngine: string[]}>}
 */
export async function checkLayout(rootAbs, packs = ['core'], { profile = 'full' } = {}) {
  const dirsToCheck = [...baseDirs];
  if (profile === 'full') {
    dirsToCheck.push(...fullProfileDirs);
  }
  for (const pack of packs) {
    if (pack === 'core') continue;
    if (packDirs[pack]) dirsToCheck.push(...packDirs[pack]);
  }

  const missingDirs = await filterMissing(rootAbs, dirsToCheck);
  const missingSeedFiles = await filterMissing(rootAbs, seedFiles.map(f => f.relPath));
  const missingEngine = await filterMissing(rootAbs, engineCriticalPaths);

  return {
    ok: missingDirs.length === 0 && missingSeedFiles.length === 0 && missingEngine.length === 0,
    missingDirs,
    missingSeedFiles,
    missingEngine,
  };
}

async function filterMissing(rootAbs, relPaths) {
  const missing = [];
  for (const relPath of relPaths) {
    try {
      await access(join(rootAbs, ...relPath.split('/')), fsConstants.F_OK);
    } catch (_) {
      missing.push(relPath);
    }
  }
  return missing;
}
