/**
 * @module installer/project-mode
 * @description Project-mode install/uninstall payload (spec-project-docs-overlay,
 * story 7; architecture AD-2 through AD-5, AD-17, AD-24, AD-26).
 *
 * Everything here is specific to `--mode project`: resolving its own install/
 * uninstall CLI flow (`runProjectInstallCommand`/`runProjectUninstallCommand`,
 * called from `commands.js`'s mode gate), copying the self-contained
 * `src/project/` engine tree into `_lumina/project/`, copying `lumi-project-*`
 * skills, and editing the `<!-- lumina:project -->` / `# >>> lumina` marker
 * blocks in the user's own `AGENTS.md` / `CLAUDE.md` / `.gitignore`.
 *
 * Deliberately imports from `./commands.js` (skill-ownership fingerprinting,
 * symlink creation, owned-skill cleanup, the package-version/color/manifest
 * helpers classic install already built) rather than duplicating that logic.
 * `commands.js` never imports this module at the top level — only via a
 * lazy `await import('./project-mode.js')` inside the project branch of
 * `installCommand`/`uninstallCommand` — so there is no import cycle at
 * module-init time even though the two files depend on each other.
 */

import { readFile, readdir, rm, lstat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicWrite, atomicCopyFile, ensureDir, copyDir, pathExists } from './fs.js';
import { upsertMarkerBlock, stripMarkerBlock, render, MarkerBlockError } from './template-engine.js';
import { isNewerVersion } from './update-check.js';
import { readManifest, writeManifest, migrateManifest, MANIFEST_SCHEMA_VERSION } from './manifest.js';
import { loadLocale } from './locales.js';
import {
  runLocaleOnlyPrompt,
  runProjectTargetsPrompt,
  runProjectUninstallConfirm,
  runProjectUninstallFactsPrompt,
} from './prompts.js';
import {
  isLuminaOwnedSkillEntry,
  createSkillSymlinks,
  removeOwnedAgentsSkills,
  removeOwnedClaudeSkillLinks,
  warnForeignSkillEntry,
  removeSkillEntry,
  warnSkillDeletionFailed,
  removeDirIfEmpty,
  PKG,
  getColorFns,
  readManifestForInstall,
  parseListOption,
  unique,
  normalizeLangFlag,
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
    'If `_lumina/config/project.yaml` is missing, run the `lumi-project-setup` skill.',
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

/** Realpath of an entry file, or the path itself when absent (ENOENT). */
async function resolveEntryFile(p) {
  try {
    return await realpath(p);
  } catch (err) {
    if (err.code === 'ENOENT') return p;
    throw err;
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
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
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
 * Wrap a `MarkerBlockError` (unbalanced/duplicated marker pair) with the
 * file path and `code = 3` — never repaired silently, refused at the caller.
 */
function asMarkerFileError(filePath, err) {
  if (!(err instanceof MarkerBlockError)) return err;
  const e = new Error(`PROJECT_MARKER_BLOCK_INVALID: ${filePath}: ${err.message}`);
  e.code = 3;
  return e;
}

// Both helpers read/write through a symlinked entry file (e.g. CLAUDE.md ->
// AGENTS.md) so atomicWrite's rename never replaces the link with a file.
// Only ENOENT means "absent"; any other read error (EACCES, EISDIR, ...)
// propagates, so an unreadable file is never overwritten with just the block.
async function upsertMarkerFile(filePath, open, close, body) {
  const realPath = await resolveEntryFile(filePath);
  let content = '';
  try {
    content = await readFile(realPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let next;
  try {
    next = upsertMarkerBlock(content, open, close, body);
  } catch (err) {
    throw asMarkerFileError(filePath, err);
  }
  if (next !== content) await atomicWrite(realPath, next);
}

async function stripMarkerFile(filePath, open, close) {
  const realPath = await resolveEntryFile(filePath);
  let content;
  try {
    content = await readFile(realPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return; // nothing to strip
    throw err;
  }
  let next;
  try {
    next = stripMarkerBlock(content, open, close);
  } catch (err) {
    throw asMarkerFileError(filePath, err);
  }
  if (next === content) return;
  // Never delete through a symlink: that would leave the link dangling.
  if (next.trim() === '' && !(await lstat(filePath)).isSymbolicLink()) {
    await rm(filePath, { force: true });
  } else {
    await atomicWrite(realPath, next);
  }
}

// ---------------------------------------------------------------------------
// installProject
// ---------------------------------------------------------------------------

/**
 * Read the committed `_lumina/project/install.json` once. Returns `null`
 * when absent (fresh install — no committed record yet). An unparsable file
 * is refused (code 3) rather than treated as absent: that would skip the
 * version-skew check and overwrite a teammate's committed record.
 * Both the version-skew check and the ideTargets upgrade fallback read this
 * same file; callers should read it once and pass the result around rather
 * than each re-reading it.
 *
 * @param {string} projectRoot
 * @returns {Promise<object|null>}
 */
export async function readProjectInstallJson(projectRoot) {
  const p = join(projectRoot, '_lumina', 'project', 'install.json');
  let raw;
  try {
    raw = await readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(`PROJECT_INSTALL_JSON_INVALID: ${p} is not valid JSON (${err.message}). Fix or delete it, then re-run.`);
    e.code = 3;
    throw e;
  }
}

/**
 * AD-24 version skew: refuse (nothing written) if the committed
 * `install.json` names a version newer than this installer. Exposed
 * separately so callers can check it before running any prompt.
 *
 * @param {string} projectRoot
 * @param {string} pkgVersion
 * @param {object|null} [installJson] - already-read install.json (see
 *   `readProjectInstallJson`); read fresh when omitted.
 */
export async function checkProjectVersionSkew(projectRoot, pkgVersion, installJson) {
  const previousInstallJson = installJson !== undefined ? installJson : await readProjectInstallJson(projectRoot);
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
 * @returns {Promise<{ skillCount: number, symlinkStrategies: object }>}
 */
export async function installProject({
  projectRoot, ideTargets, pkgVersion, existingManifest = null, colors,
  reLink = false, skillsSrcDir = PROJECT_SKILLS_SRC_DIR,
}) {
  validateProjectIdeTargets(ideTargets);

  const engineDestDir = join(projectRoot, '_lumina', 'project');
  const installJsonPath = join(engineDestDir, 'install.json');

  // Version-skew refusal is the caller's job (runProjectInstallCommand runs
  // it before any prompt, so nothing is written for a refused install) —
  // checking it again here would re-read the same install.json a second
  // time for every install.

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

  // Skills: `.agents/skills/lumi-project-*` for every target (AD-4). Reuses
  // classic's foreign-collision/deletion-failure warnings (commands.js)
  // instead of a second copy of that safety-critical delete path — a
  // deletion failure here now degrades the same way classic's `copySkills`
  // does: warn and skip that one skill, rather than aborting the install.
  const skillDefs = await listProjectSkillDefs(skillsSrcDir);
  const skillRows = [];
  for (const { canonicalId, srcDir } of skillDefs) {
    const destDir = join(projectRoot, '.agents', 'skills', canonicalId);
    const relPath = join('.agents', 'skills', canonicalId);
    const owned = await isLuminaOwnedSkillEntry({ entryPath: destDir, canonicalId });
    if (!owned) {
      if (colors) warnForeignSkillEntry(colors, relPath, canonicalId);
      continue;
    }
    const removed = await removeSkillEntry(destDir);
    if (!removed.ok) {
      if (colors) warnSkillDeletionFailed(colors, relPath, canonicalId, removed.error);
      continue;
    }
    await ensureDir(destDir);
    await copyDir(srcDir, destDir);
    skillRows.push({ canonical_id: canonicalId, relative_path: relPath });
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
    await removeOwnedClaudeSkillLinks(projectRoot, colors, rm, { prefix: SKILL_PREFIX });
  }

  // Prune `.claude/skills` BEFORE `.agents/skills` (same order as classic
  // uninstall): judging a `.claude` symlink's ownership can fall back to
  // resolving it against its `.agents/skills/<id>` target, so that target
  // must still exist when this runs. Reuses classic's owned-skill pruning
  // scoped to the `lumi-project-` prefix (never a classic lumi-* skill) and
  // to the current skill selection (`keep`), instead of a third
  // ownership-checked deletion loop.
  if (claudeCode) {
    await removeOwnedClaudeSkillLinks(projectRoot, colors, rm, {
      prefix: SKILL_PREFIX,
      keep: new Set(skillRows.map((r) => r.canonical_id)),
    });
    await removeDirIfEmpty(join(projectRoot, '.claude', 'skills'));
  }
  await removeOwnedAgentsSkills(projectRoot, colors, rm, {
    prefix: SKILL_PREFIX,
    keep: new Set(skillDefs.map((s) => s.canonicalId)),
  });

  // Marker blocks — only in the files each selected target actually reads.
  // CLAUDE.md and AGENTS.md resolving to one file (a symlink) get one edit:
  // block present when either target needs it.
  const agentsNeeded = ideTargets.includes('codex') || ideTargets.includes('antigravity');
  const entries = [[join(projectRoot, 'CLAUDE.md'), claudeCode], [join(projectRoot, 'AGENTS.md'), agentsNeeded]];
  if (await resolveEntryFile(entries[0][0]) === await resolveEntryFile(entries[1][0])) {
    entries.splice(1, 1);
    entries[0][1] = claudeCode || agentsNeeded;
  }
  for (const [entryPath, needed] of entries) {
    if (needed) {
      await upsertMarkerFile(entryPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE, projectMarkerBody(pkgVersion));
    } else {
      await stripMarkerFile(entryPath, CLAUDE_MARKER_OPEN, CLAUDE_MARKER_CLOSE);
    }
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

  await removeOwnedClaudeSkillLinks(projectRoot, colors, rm, { prefix: SKILL_PREFIX });
  await removeDirIfEmpty(join(projectRoot, '.claude', 'skills'));
  await removeDirIfEmpty(join(projectRoot, '.claude'));
  await removeOwnedAgentsSkills(projectRoot, colors, rm, { prefix: SKILL_PREFIX });

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
  await removeDirIfEmpty(luminaDir);
}

// ---------------------------------------------------------------------------
// CLI entry points (CAP-1 / AD-2) — called from commands.js's mode gate
// ---------------------------------------------------------------------------

/**
 * Resolve the installer's own UI language for project mode — same source
 * order as classic's Prompt 0 (--lang, else the previously installed
 * locale, else a TTY prompt, else 'en') but never persists a
 * communication/document-output language: project mode records no
 * communication language (agents follow the user's language).
 *
 * @param {object} opts
 * @param {object|null} existingManifest
 * @param {boolean} yes
 * @returns {Promise<'en'|'vi'|'zh'>}
 */
export async function resolveProjectUiLocale(opts, existingManifest, yes) {
  const langFlag = normalizeLangFlag(opts.lang);
  if (langFlag !== null) return langFlag;
  if (existingManifest?.locale) return existingManifest.locale;
  if (!yes && process.stdin.isTTY && process.stdout.isTTY) {
    return runLocaleOnlyPrompt({ acceptDefaults: false });
  }
  return 'en';
}

/**
 * `--mode project` install/upgrade branch. Diverges early, like `--agents`:
 * never scaffolds `raw/`/`wiki/`, never calls `renderIdeStubs`.
 *
 * @param {object} opts          - the original installCommand opts
 * @param {string} projectRoot
 * @param {object} [ctx]
 * @param {string|null} [ctx.presetLocale] - already resolved by the mode gate
 *   (it needed one to localize the classic-vs-project prompt); reused here
 *   to avoid asking twice in the same interactive session.
 * @param {boolean} [ctx.wasDetected] - the repo already carried a mode
 *   signal (manifest.mode / project.yaml / install.json) before this call —
 *   never prompt for ideTargets in that case (teammate-clone rows: "no
 *   prompts"), and always report progress as an upgrade.
 */
export async function runProjectInstallCommand(opts, projectRoot, { presetLocale = null, wasDetected = false } = {}) {
  const colors = await getColorFns();

  // install.json is read once here and threaded through both the
  // version-skew check and the ideTargets upgrade fallback below, rather
  // than each re-reading the same committed file.
  const previousInstallJson = await readProjectInstallJson(projectRoot);

  // Version-skew refusal happens before ANY prompt — nothing written, and
  // the user isn't asked questions for an install that's about to be refused.
  await checkProjectVersionSkew(projectRoot, PKG.version, previousInstallJson);

  const existingManifest = await readManifestForInstall(projectRoot);
  const isUpgrade = existingManifest !== null || wasDetected;
  const yes = Boolean(opts.yes);

  // A detected repo (teammate clone) never prompts -- matrix row "no prompts".
  const uiLocale = presetLocale ?? await resolveProjectUiLocale(opts, existingManifest, yes || wasDetected);
  const { t } = await loadLocale(uiLocale);

  const override = parseListOption(opts.ideTargets ?? opts.ide, '--ide-targets');
  let ideTargets;
  if (override) {
    validateProjectIdeTargets(unique(override));
    ideTargets = unique(override);
  } else if (previousInstallJson?.ideTargets?.length) {
    // Committed install.json wins over the local (gitignored) manifest, so a
    // teammate's committed target change is never reverted by a stale clone.
    ideTargets = previousInstallJson.ideTargets;
  } else if (existingManifest?.ideTargets?.length) {
    ideTargets = existingManifest.ideTargets;
  } else if (!yes && !wasDetected && process.stdin.isTTY && process.stdout.isTTY) {
    ideTargets = await runProjectTargetsPrompt({ acceptDefaults: false, t });
  } else {
    // "--yes with no --ide-targets defaults to claude_code" (Boundaries);
    // same default when the repo was detected and carries no prior targets.
    ideTargets = ['claude_code'];
  }

  console.log('');
  console.log(colors.bold(t(isUpgrade ? 'project.progress.upgrading' : 'project.progress.installing', { dir: projectRoot })));

  const result = await installProject({
    projectRoot,
    ideTargets,
    pkgVersion: PKG.version,
    existingManifest,
    colors,
    reLink: Boolean(opts.reLink),
  });

  const now = new Date().toISOString();
  const migrated = existingManifest ? migrateManifest(existingManifest, MANIFEST_SCHEMA_VERSION) : {};
  const manifest = {
    ...migrated,
    schemaVersion:  MANIFEST_SCHEMA_VERSION,
    packageVersion: PKG.version,
    mode:           'project',
    locale:         uiLocale,
    installedAt:    existingManifest?.installedAt ?? now,
    updatedAt:      now,
    ideTargets,
    symlinkStrategies: result.symlinkStrategies,
    resolvedPaths: {
      projectRoot,
      lumina: join(projectRoot, '_lumina'),
    },
  };
  await writeManifest(projectRoot, manifest);

  console.log('');
  console.log(colors.green(t('project.success.installed')));
  console.log(t('project.success.targets', { targets: ideTargets.join(', ') }));
  console.log(t('project.success.skills', { count: result.skillCount }));
}

/**
 * `--mode project` uninstall branch (AD-17). Called from `uninstallCommand`
 * once it has already detected `mode === 'project'`.
 *
 * @param {object} opts
 * @param {boolean} [opts.yes]
 * @param {string} projectRoot
 */
export async function runProjectUninstallCommand(opts, projectRoot) {
  const { yes = false } = opts;
  const colors = await getColorFns();

  let locale = 'en';
  try {
    const mf = await readManifest(projectRoot);
    if (mf?.locale) locale = mf.locale;
  } catch (_) {}
  const { t } = await loadLocale(locale);

  const confirmed = yes ? true : await runProjectUninstallConfirm({ acceptDefaults: false, t });
  if (!confirmed) {
    console.log(colors.yellow(t('uninstall.cancelled')));
    // CLI contract: a declined confirmation is a user cancellation (exit 4),
    // matching every other confirm prompt in commands.js.
    process.exit(4);
  }
  // "--yes keeps them" (facts/ and config/ survive unless explicitly confirmed).
  const deleteFactsAndConfig = yes ? false : await runProjectUninstallFactsPrompt({ acceptDefaults: false, t });
  await uninstallProject({ projectRoot, colors, deleteFactsAndConfig });
  console.log(colors.green(
    deleteFactsAndConfig
      ? t('project_uninstall.done.deleted')
      : t('project_uninstall.done.kept'),
  ));
}
