/**
 * @module installer/project-mode
 * @description Project-mode install/uninstall payload (spec-project-docs-overlay,
 * story 7; architecture AD-2 through AD-5, AD-17, AD-24, AD-26).
 *
 * Everything here is specific to `--mode project`: copying the self-contained
 * `src/project/` engine tree into `_lumina/project/`, copying `lumi-project-*`
 * skills, and editing the `<!-- lumina:project -->` / `# >>> lumina` marker
 * blocks in the user's own `AGENTS.md` / `CLAUDE.md` / `.gitignore`.
 *
 * Deliberately imports from `./commands.js` (skill-ownership fingerprinting,
 * symlink creation, owned-skill cleanup) rather than duplicating that logic.
 * `commands.js` never imports this module at the top level — only via a
 * lazy `await import('./project-mode.js')` inside the project branch of
 * `installCommand`/`uninstallCommand` — so there is no import cycle at
 * module-init time even though the two files depend on each other.
 */

import { readFile, readdir, rm, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { atomicWrite, atomicCopyFile, ensureDir, copyDir } from './fs.js';
import { upsertMarkerBlock, stripMarkerBlock, render, MarkerBlockError } from './template-engine.js';
import { isNewerVersion } from './update-check.js';
import {
  isLuminaOwnedSkillEntry,
  createSkillSymlinks,
  removeOwnedAgentsSkills,
  removeOwnedClaudeSkillLinks,
} from './commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const PROJECT_ENGINE_SRC_DIR = join(PACKAGE_ROOT, 'src', 'project');
const PROJECT_SKILLS_SRC_DIR = join(PACKAGE_ROOT, 'src', 'skills', 'project');
const PROJECT_TEMPLATE_PATH = join(PACKAGE_ROOT, 'src', 'templates', 'project', 'PROJECT.md');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Explicit copy list for the self-contained project engine (AD-5, AD-6).
 * Paths are relative to `src/project/`. A source file missing from disk is
 * an internal error (exit 3), never silently skipped — unlike classic
 * `copyScripts`. Keep this in step with `package.json` `files` (ci-package
 * requires each entry) and with `src/project/` itself (project-mode.test.js
 * asserts every non-test, non-fixture file in that tree is listed here).
 */
export const PROJECT_ENGINE_FILES = Object.freeze([
  'project.mjs',
  'ontology.mjs',
  'lib/config.mjs',
  'lib/evidence.mjs',
  'lib/fact.mjs',
  'lib/factfile.mjs',
  'lib/frontmatter.mjs',
  'lib/fsx.mjs',
  'lib/graph.mjs',
  'lib/hash.mjs',
  'lib/lint.mjs',
  'lib/markdown.mjs',
  'lib/parse.mjs',
  'lib/query.mjs',
  'lib/scope.mjs',
  'lib/view.mjs',
  'view/viewer.js',
  'view/viewer.css',
  'vendor/js-yaml.mjs',
  'vendor/force-graph.min.js',
  'vendor/THIRD-PARTY-NOTICES.md',
]);

/** Project-mode host targets (AD-4). Distinct from classic VALID_IDE_TARGETS. */
export const PROJECT_IDE_TARGETS = Object.freeze(['claude_code', 'codex', 'antigravity']);

const CLAUDE_MARKER_OPEN = '<!-- lumina:project -->';
const CLAUDE_MARKER_CLOSE = '<!-- /lumina:project -->';
const GITIGNORE_MARKER_OPEN = '# >>> lumina';
const GITIGNORE_MARKER_CLOSE = '# <<< lumina';
const GITIGNORE_BODY = ['_lumina/graph/', '_lumina/_state/', '_lumina/manifest.json'].join('\n');
const SKILL_PREFIX = 'lumi-project-';

function projectMarkerBody(pkgVersion) {
  return [
    `This repo uses Lumina project mode (lumina-wiki >= ${pkgVersion}). Read \`_lumina/project/PROJECT.md\`.`,
    'If `_lumina/config/project.yaml` is missing, run `/lumi-project-setup`.',
  ].join('\n');
}

/**
 * Validate a caller-supplied ide-target list against PROJECT_IDE_TARGETS.
 * Unlike classic `validateValues`, an unknown project target is a bad-flags
 * user error (exit 1, matching `--mode project` + `--packs`/`--agents`),
 * not a filesystem/path-safety error.
 *
 * @param {string[]} values
 */
export function validateProjectIdeTargets(values) {
  const invalid = values.filter((v) => !PROJECT_IDE_TARGETS.includes(v));
  if (invalid.length > 0) {
    const err = new Error(
      `Unknown project IDE target: ${invalid.join(', ')}. Valid values: ${PROJECT_IDE_TARGETS.join(', ')}`,
    );
    err.code = 1;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

async function readJsonQuiet(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function removeDirIfEmpty(dirPath) {
  let entries = [];
  try {
    entries = await readdir(dirPath);
  } catch (_) {
    return;
  }
  if (entries.length === 0) {
    await rm(dirPath, { recursive: true, force: true });
  }
}

/**
 * Discover the currently-shipped `lumi-project-*` skills. The directory
 * name under `skillsSrcDir` IS the canonical id (AD-4 Design Notes: "the
 * directory name is the canonical id"). Absent/empty source dir -> `[]`,
 * matching the "no skills yet" acceptance row.
 *
 * @param {string} skillsSrcDir
 * @returns {Promise<{canonicalId: string, srcDir: string}[]>}
 */
async function listProjectSkillDefs(skillsSrcDir) {
  let entries;
  try {
    entries = await readdir(skillsSrcDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const defs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcDir = join(skillsSrcDir, entry.name);
    if (await pathExists(join(srcDir, 'SKILL.md'))) {
      defs.push({ canonicalId: entry.name, srcDir });
    }
  }
  return defs;
}

/**
 * Remove any `lumi-project-*` entry under `dirPath` that Lumina owns (per
 * `isLuminaOwnedSkillEntry`) but that is no longer in `keepIds` — a skill
 * dropped from the skills source dir since the last install. Stateless: run
 * on every install/upgrade, no bookkeeping file needed (Design Notes: "a new
 * skill directory needs no installer edit").
 *
 * @param {string} dirPath
 * @param {Set<string>} keepIds
 * @param {string|null} [expectedTargetDir] - for `.claude/skills`, the
 *   `.agents/skills` directory each surviving symlink should resolve to;
 *   omitted for `.agents/skills` itself, which holds real directories.
 */
async function pruneStaleProjectSkillEntries(dirPath, keepIds, expectedTargetDir = null) {
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch (_) {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(SKILL_PREFIX) || keepIds.has(name)) continue;
    const entryPath = join(dirPath, name);
    const owned = await isLuminaOwnedSkillEntry({
      entryPath,
      canonicalId: name,
      ...(expectedTargetDir ? { expectedTarget: join(expectedTargetDir, name) } : {}),
    });
    if (!owned) continue;
    await rm(entryPath, { recursive: true, force: true });
  }
  await removeDirIfEmpty(dirPath);
}

/**
 * Wrap a `MarkerBlockError` (unbalanced/duplicated marker pair) with the
 * file path and `code = 3` — never repaired silently, refused at the caller.
 */
function asMarkerFileError(filePath, err) {
  if (!(err instanceof MarkerBlockError)) return err;
  const e = new Error(`PROJECT_MARKER_BLOCK_INVALID: ${filePath}: ${err.message}`);
  e.code = 3;
  return e;
}

async function upsertMarkerFile(filePath, open, close, body) {
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch (_) {
    // Absent file — created holding only the block.
  }
  let next;
  try {
    next = upsertMarkerBlock(content, open, close, body);
  } catch (err) {
    throw asMarkerFileError(filePath, err);
  }
  if (next !== content) await atomicWrite(filePath, next);
}

async function stripMarkerFile(filePath, open, close) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (_) {
    return; // nothing to strip
  }
  let next;
  try {
    next = stripMarkerBlock(content, open, close);
  } catch (err) {
    throw asMarkerFileError(filePath, err);
  }
  if (next === content) return;
  if (next.trim() === '') {
    await rm(filePath, { force: true });
  } else {
    await atomicWrite(filePath, next);
  }
}

// ---------------------------------------------------------------------------
// installProject
// ---------------------------------------------------------------------------

/**
 * AD-24 version skew: refuse (nothing written) if the committed
 * `install.json` names a version newer than this installer. Exposed
 * separately so callers can check it before running any prompt.
 *
 * @param {string} projectRoot
 * @param {string} pkgVersion
 */
export async function checkProjectVersionSkew(projectRoot, pkgVersion) {
  const installJsonPath = join(projectRoot, '_lumina', 'project', 'install.json');
  const previousInstallJson = await readJsonQuiet(installJsonPath);
  if (previousInstallJson?.packageVersion && isNewerVersion(previousInstallJson.packageVersion, pkgVersion)) {
    const err = new Error(
      `PROJECT_VERSION_SKEW: this repo's committed _lumina/project/install.json names lumina-wiki ` +
      `${previousInstallJson.packageVersion}, newer than the installed ${pkgVersion}. Upgrade lumina-wiki first.`,
    );
    err.code = 3;
    throw err;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string[]} opts.ideTargets   - subset of PROJECT_IDE_TARGETS
 * @param {string} opts.pkgVersion     - installer's own package.json version
 * @param {object|null} [opts.existingManifest] - for symlink-strategy reuse
 * @param {object} opts.colors
 * @param {boolean} [opts.reLink=false] - force re-detection of the symlink
 *   strategy, same as classic install's `--re-link`.
 * @param {string} [opts.skillsSrcDir] - override for `src/skills/project/`
 *   (test seam only; production callers never pass this).
 * @param {Function|null} [opts.t] - locale translator; falls back to EN
 *   literals when not supplied.
 * @returns {Promise<{ skillCount: number, symlinkStrategies: object }>}
 */
export async function installProject({
  projectRoot, ideTargets, pkgVersion, existingManifest = null, colors,
  reLink = false, skillsSrcDir = PROJECT_SKILLS_SRC_DIR, t = null,
}) {
  validateProjectIdeTargets(ideTargets);

  const engineDestDir = join(projectRoot, '_lumina', 'project');
  const installJsonPath = join(engineDestDir, 'install.json');

  await checkProjectVersionSkew(projectRoot, pkgVersion);

  // Copy the engine tree from one explicit list (AD-5). A missing source
  // file is an internal error, not a skip — never reuse classic copyScripts.
  for (const relPath of PROJECT_ENGINE_FILES) {
    const src = join(PROJECT_ENGINE_SRC_DIR, ...relPath.split('/'));
    const dest = join(engineDestDir, ...relPath.split('/'));
    if (!(await pathExists(src))) {
      const err = new Error(`PROJECT_ENGINE_FILE_MISSING: src/project/${relPath} is missing from this package`);
      err.code = 3;
      throw err;
    }
    await atomicCopyFile(src, dest);
  }

  // PROJECT.md — shared skill context (AD-4).
  const template = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
  await atomicWrite(join(engineDestDir, 'PROJECT.md'), render(template, { package_version: pkgVersion }));

  // install.json last among the engine writes (AD-2 teammate-clone record).
  await atomicWrite(
    installJsonPath,
    JSON.stringify({ schemaVersion: 1, packageVersion: pkgVersion, ideTargets }, null, 2) + '\n',
  );

  // Skills: `.agents/skills/lumi-project-*` for every target (AD-4).
  const skillDefs = await listProjectSkillDefs(skillsSrcDir);
  const skillRows = [];
  for (const { canonicalId, srcDir } of skillDefs) {
    const destDir = join(projectRoot, '.agents', 'skills', canonicalId);
    const owned = await isLuminaOwnedSkillEntry({ entryPath: destDir, canonicalId });
    if (!owned) {
      if (colors) {
        const relPath = join('.agents', 'skills', canonicalId);
        console.log(colors.yellow(
          t ? t('project.warn.foreign_skill', { path: relPath })
            : `  [warn] Found an existing directory at "${relPath}" that Lumina does not recognize as its ` +
              `own. Lumina will not touch it.`,
        ));
      }
      continue;
    }
    await rm(destDir, { recursive: true, force: true });
    await ensureDir(destDir);
    await copyDir(srcDir, destDir);
    skillRows.push({ canonical_id: canonicalId, relative_path: join('.agents', 'skills', canonicalId) });
  }

  // Claude Code symlinks, only for the claude_code target; dropped target
  // means every owned `.claude/skills/lumi-project-*` link is removed.
  let symlinkStrategies = {};
  const claudeCode = ideTargets.includes('claude_code');
  if (claudeCode) {
    const { strategies, errors } = await createSkillSymlinks(
      projectRoot, skillRows, existingManifest, reLink, colors ?? { yellow: (s) => s, red: (s) => s },
    );
    symlinkStrategies = strategies;
    if (errors.length > 0) {
      const err = new Error(
        `SKILL_LINKS_INCOMPLETE: ${errors.length} of ${skillRows.length} project skill links failed: ` +
        errors.map((item) => `${item.skill}: ${item.error.message}`).join('; '),
      );
      err.code = 2;
      throw err;
    }
  } else {
    await removeOwnedClaudeSkillLinks(projectRoot, colors);
  }

  // Prune `.claude/skills` BEFORE `.agents/skills` (same order as classic
  // uninstall): judging a `.claude` symlink's ownership can fall back to
  // resolving it against its `.agents/skills/<id>` target, so that target
  // must still exist when this runs.
  if (claudeCode) {
    await pruneStaleProjectSkillEntries(
      join(projectRoot, '.claude', 'skills'),
      new Set(skillRows.map((r) => r.canonical_id)),
      join(projectRoot, '.agents', 'skills'),
    );
  }
  await pruneStaleProjectSkillEntries(
    join(projectRoot, '.agents', 'skills'),
    new Set(skillDefs.map((s) => s.canonicalId)),
  );

  // Marker blocks — only in the files each selected target actually reads.
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');
  if (claudeCode) {
    await upsertMarkerFile(claudeMdPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE, projectMarkerBody(pkgVersion));
  } else {
    await stripMarkerFile(claudeMdPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE);
  }

  const agentsMdPath = join(projectRoot, 'AGENTS.md');
  const agentsNeeded = ideTargets.includes('codex') || ideTargets.includes('antigravity');
  if (agentsNeeded) {
    await upsertMarkerFile(agentsMdPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE, projectMarkerBody(pkgVersion));
  } else {
    await stripMarkerFile(agentsMdPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE);
  }

  await upsertMarkerFile(
    join(projectRoot, '.gitignore'),
    GITIGNORE_MARKER_OPEN, GITIGNORE_MARKER_CLOSE, GITIGNORE_BODY,
  );

  return { skillCount: skillRows.length, symlinkStrategies };
}

// ---------------------------------------------------------------------------
// uninstallProject
// ---------------------------------------------------------------------------

/**
 * Remove `_lumina/` except `facts/` and `config/` (kept unless
 * `deleteFactsAndConfig`), strip the marker blocks from every entry file,
 * and remove owned `lumi-project-*` skills/links (AD-17). Never touches
 * in-scope docs or anything outside the paths this function owns.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {object} [opts.colors]
 * @param {boolean} [opts.deleteFactsAndConfig=false]
 */
export async function uninstallProject({ projectRoot, colors = null, deleteFactsAndConfig = false }) {
  await stripMarkerFile(join(projectRoot, 'CLAUDE.md'), CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE);
  await stripMarkerFile(join(projectRoot, 'AGENTS.md'), CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE);
  await stripMarkerFile(join(projectRoot, '.gitignore'), GITIGNORE_MARKER_OPEN, GITIGNORE_MARKER_CLOSE);

  await removeOwnedClaudeSkillLinks(projectRoot, colors);
  await removeOwnedAgentsSkills(projectRoot, colors);

  const luminaDir = join(projectRoot, '_lumina');
  if (deleteFactsAndConfig) {
    await rm(luminaDir, { recursive: true, force: true });
    return;
  }
  let entries = [];
  try {
    entries = await readdir(luminaDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'facts' || entry.name === 'config') continue;
    await rm(join(luminaDir, entry.name), { recursive: true, force: true });
  }
}
