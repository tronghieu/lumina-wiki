/**
 * @module installer/commands
 * @description Subcommand dispatch for the Lumina installer.
 *
 * Commands: install, uninstall, --re-link (as install flag), --version
 *
 * Install flow:
 *   1. Read manifest (detect fresh vs upgrade)
 *   2. Collect answers (prompts or --yes defaults / config file)
 *   3. Scaffold directories
 *   4. Copy/render files
 *   5. Create per-skill symlinks
 *   6. Write three state files atomically
 *   7. Print summary tree
 */

import { readFile, writeFile, rename, unlink, rm, access, copyFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  atomicWrite,
  safePath,
  ensureDir,
  copyDir,
  fileHash,
  linkDirectory,
} from './fs.js';
import {
  readManifest,
  writeManifest,
  migrateManifest,
  readSkillsManifest,
  writeSkillsManifest,
  readFilesManifest,
  writeFilesManifest,
  cleanupObsoleteCatalog,
  MANIFEST_SCHEMA_VERSION,
} from './manifest.js';
import {
  render,
  renderReadme,
  extractSchemaRegion,
  replaceSchemaRegion,
} from './template-engine.js';
import {
  runInstallPrompts,
  runUninstallConfirm,
  runReadmeMergePrompt,
  runUpgradeModePrompt,
  LOCALE_LANGUAGE_NAME,
} from './prompts.js';
import { VALID_LOCALES, loadLocale } from './locales.js';
import { checkForUpdate } from './update-check.js';
import {
  RESEARCH_TOOL_FILES,
  projectWorkspace,
  workspacePayloadSources,
  workspaceSkillDefinitions,
} from './workspace-definition.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'src', 'templates');
const SKILLS_DIR = join(PACKAGE_ROOT, 'src', 'skills');

// Load package.json for version info
const require = createRequire(import.meta.url);
const PKG = (() => {
  try {
    return require(join(PACKAGE_ROOT, 'package.json'));
  } catch {
    return { version: '0.0.0' };
  }
})();

// ---------------------------------------------------------------------------
// Lazy color import
// ---------------------------------------------------------------------------

let pc;
async function getColor() {
  if (!pc) {
    pc = (await import('picocolors')).default;
  }
  return pc;
}

function noColor(str) { return str; }

async function getColorFns() {
  const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
  if (!isTTY) {
    return { green: noColor, yellow: noColor, red: noColor, bold: noColor, dim: noColor };
  }
  const p = await getColor();
  return { green: p.green, yellow: p.yellow, red: p.red, bold: p.bold, dim: p.dim };
}

// ---------------------------------------------------------------------------
// Directory scaffold spec
// ---------------------------------------------------------------------------

const VALID_PACKS = new Set(['core', 'research', 'reading', 'learning']);
const VALID_IDE_TARGETS = new Set(['claude_code', 'codex', 'cursor', 'gemini_cli', 'qwen', 'iflow', 'generic']);

async function findEnclosingWorkspace(startDir) {
  let current = resolve(startDir);
  while (true) {
    try {
      await access(join(current, '_lumina', 'manifest.json'), fsConstants.F_OK);
      return current;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readManifestForInstall(projectRoot) {
  try {
    return await readManifest(projectRoot);
  } catch (err) {
    const e = new Error(`MANIFEST_READ_FAILED: ${err.message} (path: ${projectRoot}/_lumina/manifest.json)`);
    e.code = 2;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// install command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  [opts.directory]   - Installation directory (BMAD-style canonical flag)
 * @param {string}  [opts.cwd]         - Backward-compat alias for `directory`
 * @param {boolean} opts.yes           - Accept defaults (--yes)
 * @param {boolean} opts.reLink        - Force re-compute symlink strategy
 * @param {boolean} opts.noUpdate      - Skip update check
 * @param {string|string[]} [opts.packs] - Pack override for non-interactive installs
 * @param {string|string[]} [opts.ideTargets] - IDE target override
 * @param {string} [opts.projectName]  - Hidden escape hatch; default = basename(directory)
 * @param {string} [opts.communicationLang]
 * @param {string} [opts.documentOutputLang]
 * @param {boolean} [opts.searchParents] - Find an enclosing Lumina workspace when no directory flag was used
 * @param {{now?: Date|string}} [installContext] - Internal deterministic clock seam for tests
 */
export async function installCommand(opts = {}, installContext = {}) {
  const { yes = false, reLink = false } = opts;
  const initialDir = opts.directory ?? opts.cwd ?? process.cwd();
  const requestedRoot = resolve(initialDir);
  let projectRoot = opts.searchParents
    ? (await findEnclosingWorkspace(requestedRoot) ?? requestedRoot)
    : requestedRoot;
  const colors = await getColorFns();

  // 1. Read existing manifest at the initial path (upgrade detection)
  // Distinguish ENOENT (fresh install) from real I/O errors. Real errors must
  // bail loud — silently treating them as "fresh install" would let a transient
  // permission failure quietly nuke an existing install.
  let existingManifest = await readManifestForInstall(projectRoot);

  let isUpgrade = existingManifest !== null;

  // 2. Collect answers (locale not yet loaded; prompts use EN fallback literals)
  let answers;
  let sawPackPrompt = false; // suppresses the "more packs available" hint
  if (isUpgrade) {
    // Upgrade/reinstall: preserve existing choices, including --yes runs.
    answers = await readAnswersFromConfig(projectRoot, existingManifest);
    // Interactive upgrade menu: quick update (keep choices, the default) vs
    // modify installation (re-run setup prompts prefilled with the current
    // choices — the only discoverable way to add packs/IDE targets that were
    // released after the original install). Skipped when headless (--yes or
    // no TTY) and when explicit override flags already state the intent.
    const hasOverrideFlags = Boolean(opts.packs || opts.ideTargets || opts.lang);
    if (!yes && !hasOverrideFlags && process.stdin.isTTY && process.stdout.isTTY) {
      // Menu renders in the installed locale; EN literals if loading fails.
      let menuT = null;
      try {
        menuT = (await loadLocale(answers.locale ?? 'en')).t;
      } catch { /* keep EN fallback literals */ }
      const mode = await runUpgradeModePrompt({ t: menuT });
      if (mode === 'modify') {
        answers = await runInstallPrompts({
          cwd: projectRoot,
          existingManifest,
          defaultLocale: answers.locale ?? 'en',
          t: menuT,
          modifyAnswers: answers,
        });
        sawPackPrompt = true;
      }
    }
  } else {
    sawPackPrompt = !yes;
    answers = await runInstallPrompts({
      acceptDefaults: yes,
      cwd: projectRoot,
      existingManifest,
      defaultLocale: opts.lang ?? 'en',
      resolveDestination: async (directory) => {
        const manifest = await readManifestForInstall(directory);
        if (!manifest) return null;
        return {
          existingManifest: manifest,
          answers: await readAnswersFromConfig(directory, manifest),
        };
      },
    });
    // Re-resolve projectRoot from the directory the user typed.
    if (answers.directory) {
      projectRoot = resolve(answers.directory);
    }
    existingManifest = await readManifestForInstall(projectRoot);
    isUpgrade = existingManifest !== null;
  }
  answers = applyInstallOverrides(answers, opts);
  const previousSkillRows = isUpgrade
    ? previousManagedSkillRows(await readSkillsManifest(projectRoot), existingManifest)
    : [];
  const previousFileRows = isUpgrade ? await readFilesManifest(projectRoot) : [];

  // 2b. Load locale module ONCE after applyInstallOverrides resolves locale.
  const localeMod = await loadLocale(answers.locale ?? 'en');
  const t = localeMod.t;
  // Warn if locale translations are AI-drafted (won't fire for 'en').
  maybeWarnAiDraft(localeMod);

  // Locale-switch protection on upgrade: any divergence between the installed
  // locale and the resolved locale (from --lang, prompt, OR config drift)
  // requires --force-locale-switch in headless mode. Interactive confirmation
  // is handled inside runInstallPrompts; on the upgrade path we re-collect
  // answers from config/manifest (no prompt), so the headless gate is the only
  // line of defense. Apply migration so legacy v3 installs (no locale field)
  // are treated as 'en' rather than bypassing the gate.
  if (isUpgrade) {
    const installedLocale = (
      existingManifest.locale
        ?? migrateManifest(existingManifest, MANIFEST_SCHEMA_VERSION).locale
        ?? 'en'
    );
    if (
      installedLocale !== answers.locale
      && !opts.forceLocaleSwitch
      && answers.localeSwitchConfirmedFor !== answers.locale
    ) {
      const e = new Error(
        `LOCALE_SWITCH_REFUSED: installed locale '${installedLocale}' differs from resolved locale '${answers.locale}'. ` +
        `Pass --force-locale-switch to confirm (this will rewrite README.md and IDE stubs in the new locale).`,
      );
      e.code = 2;
      throw e;
    }
  }

  const { projectName, researchPurpose, ideTargets, packs, communicationLang, documentOutputLang, locale } = answers;
  const hasResearch = packs.includes('research');
  const previousProjectRoot = existingManifest?.resolvedPaths?.projectRoot;
  const relocated = Boolean(previousProjectRoot && resolve(previousProjectRoot) !== projectRoot);
  const effectiveReLink = reLink || relocated;
  const installInstant = installContext.now === undefined
    ? new Date()
    : new Date(installContext.now);
  if (Number.isNaN(installInstant.valueOf())) {
    throw new TypeError('installContext.now must be a valid instant');
  }
  const workspace = projectWorkspace({
    ...answers,
    packageVersion: PKG.version,
    projectRoot,
    symlinkStrategies: {},
  }, { now: installInstant });

  console.log('');
  if (isUpgrade) {
    console.log(colors.bold(t('progress.upgrading', { dir: projectRoot })));
  } else {
    console.log(colors.bold(t('progress.installing', { dir: projectRoot })));
  }
  if (relocated) {
    console.log(colors.yellow(t('warn.relocated', { from: previousProjectRoot, to: projectRoot })));
  }

  // 3. Scaffold directories
  for (const dir of workspace.directories) {
    await ensureDir(join(projectRoot, dir));
  }

  await reconcileRemovedIdeTargets({
    projectRoot,
    previousIdeTargets: existingManifest?.ideTargets ?? [],
    currentIdeTargets: ideTargets,
    previousFileRows,
    previousSkillRows,
    colors,
    t,
  });

  if (isUpgrade && existingManifest?.packs?.research && !hasResearch) {
    await cleanupRemovedResearchPack(projectRoot, previousFileRows, colors, t);
  }

  // 4. Template variables
  const templateVars = workspace.templateVariables;

  // 5. Render + write config
  await renderAndWriteConfig(projectRoot, workspace.config);

  // 6. Render + write README (with region awareness)
  await renderAndWriteReadme(projectRoot, templateVars, researchPurpose, isUpgrade, yes, t);

  // 7. Render IDE stubs
  await renderIdeStubs(projectRoot, ideTargets, templateVars);

  // 8. Copy scripts
  await copyScripts(projectRoot);

  // 8.5. Copy CHANGELOG.md so /lumi-migrate-legacy can read it offline
  await copyChangelog(projectRoot);

  // 9. Copy skills
  const skillRows = await copySkills(projectRoot, workspace.skills, {
    claudeCode: ideTargets.includes('claude_code'),
  });
  await reconcileRemovedSkills(projectRoot, previousSkillRows, skillRows);

  // 10. Copy Python tools (core: extract_pdf; research pack: discovery/fetchers)
  await copyTools(projectRoot, { research: hasResearch });

  // 11. Render schema docs
  await renderSchemaDocs(projectRoot, templateVars);

  // 12. Render .env.example (research pack only)
  if (hasResearch) {
    await renderEnvExample(projectRoot);
    await writeWatchlistTemplate(projectRoot);
  }

  // 13. Write .gitignore (only if not exists)
  await writeGitignore(projectRoot);

  // 14. Seed wiki/index.md and wiki/log.md (first install only)
  if (!isUpgrade) {
    await seedWikiFiles(projectRoot);
  }

  // 15. Create per-skill symlinks (.claude/skills/lumi-*) for Claude Code
  const symlinkStrategies = {};
  if (ideTargets.includes('claude_code')) {
    const { strategies, errors } = await createSkillSymlinks(
      projectRoot, skillRows, existingManifest, effectiveReLink, colors, t
    );
    Object.assign(symlinkStrategies, strategies);
    if (errors.length > 0) {
      const e = new Error(
        `SKILL_LINKS_INCOMPLETE: ${errors.length} of ${skillRows.length} Claude skill links failed: ` +
        errors.map(item => `${item.skill}: ${item.error.message}`).join('; '),
      );
      e.code = 2;
      throw e;
    }
  }

  // 16. Build files-manifest rows
  const fileRows = await buildFilesManifest(
    projectRoot,
    workspace.state.managedFilePaths,
    PKG.version,
  );

  // 17. Write three state files atomically
  // Run schema migrations on the existing manifest first so flags like
  // legacyMigrationNeeded are preserved into the final write.
  const migrated = existingManifest
    ? migrateManifest(existingManifest, MANIFEST_SCHEMA_VERSION)
    : {};
  const finalWorkspace = projectWorkspace({
    ...answers,
    baseManifest: migrated,
    packageVersion: PKG.version,
    installedAt: existingManifest?.installedAt,
    symlinkStrategies,
    projectRoot,
  }, { now: installInstant });
  const manifest = finalWorkspace.state.manifest;

  await writeManifest(projectRoot, manifest);
  await writeSkillsManifest(projectRoot, skillRows);
  await writeFilesManifest(projectRoot, fileRows);
  // Remove pre-v1.4 catalog files (skills-catalog.md, _state/skills-manifest.json)
  // if they linger from an earlier install. The canonical catalog is
  // _lumina/schema/lumi-help.csv, rendered by renderSchemaDocs above.
  await cleanupObsoleteCatalog(projectRoot);

  // 17.5. Post-upgrade: spawn lint --summary, print banner if findings exist
  if (isUpgrade && existingManifest.packageVersion !== PKG.version) {
    await printPostUpgradeBanner({
      projectRoot,
      fromVersion: existingManifest.packageVersion,
      toVersion: PKG.version,
      colors,
      t,
    });
  }

  // 18. Print summary
  console.log('');
  console.log(colors.green(t('success.installed')));
  console.log(t('success.summary.project', { name: projectName }));
  console.log(t('success.summary.packs', { packs: packs.join(', ') }));
  console.log(t('success.summary.ide', { ide: ideTargets.join(', ') }));
  console.log(t('success.summary.skills', { count: skillRows.length }));
  if (Object.values(symlinkStrategies).some(s => s === 'copy')) {
    console.log(colors.yellow(t('warn.copied_skills')));
  }
  // Surface packs the user has not installed (e.g. added in a newer release).
  // Suppressed when the user just went through the pack picker this run.
  const uninstalledPacks = [...VALID_PACKS].filter(p => !packs.includes(p));
  if (!sawPackPrompt && uninstalledPacks.length > 0) {
    console.log(t('hint.packs_available', { packs: uninstalledPacks.join(', ') }));
  }
}

// ---------------------------------------------------------------------------
// uninstall command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  opts.cwd
 * @param {boolean} opts.yes
 */
export async function uninstallCommand(opts = {}) {
  const { cwd = process.cwd(), yes = false } = opts;
  const projectRoot = resolve(cwd);
  const colors = await getColorFns();

  // Load locale from manifest; fall back to EN if manifest missing/corrupt.
  // uninstall has no --lang flag — it always reads from the installed manifest.
  let uninstallLocale = 'en';
  try {
    const mf = await readManifest(projectRoot);
    if (mf?.locale) uninstallLocale = mf.locale;
  } catch (_) {}
  const { t } = await loadLocale(uninstallLocale);

  const result = await runUninstallConfirm({ acceptDefaults: yes, t });
  if (!result || !result.confirmed) {
    console.log(colors.yellow(t('uninstall.cancelled')));
    process.exit(0);
  }

  const { stripReadme } = result;

  // Read manifest to know what to clean up
  let manifest = null;
  try {
    manifest = await readManifest(projectRoot);
  } catch (_) {}

  // Remove _lumina/ (except we preserve wiki/ and raw/)
  await rm(join(projectRoot, '_lumina'), { recursive: true, force: true });
  console.log(colors.green(t('uninstall.removed_lumina')));

  // Remove .agents/
  await rm(join(projectRoot, '.agents'), { recursive: true, force: true });
  console.log(colors.green(t('uninstall.removed_agents')));

  // Remove .claude/skills/lumi-* symlinks
  try {
    const claudeSkillsDir = join(projectRoot, '.claude', 'skills');
    const entries = await readdir_safe(claudeSkillsDir);
    for (const entry of entries) {
      if (entry.startsWith('lumi-')) {
        await rm(join(claudeSkillsDir, entry), { recursive: true, force: true });
      }
    }
  } catch (_) {}

  // Remove IDE stub files
  const ideTargets = manifest?.ideTargets ?? ['claude_code'];
  const stubFiles = ideTargetStubFiles(ideTargets);
  for (const f of stubFiles) {
    await unlink(join(projectRoot, f)).catch(() => {});
  }

  // Handle README
  if (stripReadme) {
    try {
      const readmePath = join(projectRoot, 'README.md');
      const content = await readFile(readmePath, 'utf8');
      const openMarker = '<!-- lumina:schema -->';
      const closeMarker = '<!-- /lumina:schema -->';
      const start = content.indexOf(openMarker);
      const end = content.indexOf(closeMarker);
      if (start !== -1 && end !== -1) {
        const stripped = content.slice(0, start) + content.slice(end + closeMarker.length);
        await atomicWrite(readmePath, stripped);
        console.log(colors.green(t('uninstall.stripped_readme')));
      }
    } catch (_) {}
  }

  console.log(colors.green(t('uninstall.complete')));
}

// ---------------------------------------------------------------------------
// version command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.noUpdate
 */
export async function versionCommand(opts = {}) {
  const { noUpdate = false } = opts;
  const colors = await getColorFns();

  // Print version immediately (cold-start < 300ms)
  process.stdout.write(PKG.version + '\n');

  // Then do async update check (bounded by 2s timeout).
  // versionCommand has no project directory, so locale is unknown; use EN literals.
  // Pre-loadLocale path — intentionally EN-only and machine-readable.
  if (!noUpdate && process.env.LUMINA_NO_UPDATE_CHECK !== '1') {
    const latest = await checkForUpdate(PKG.version);
    if (latest) {
      console.log(colors.yellow(`\n  Update available: ${PKG.version} -> ${latest}`));
      console.log(`  Run: npx lumina-wiki@latest install\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run lint --summary in the project root and, if findings exist, print a
 * post-upgrade banner to stderr.
 *
 * @param {object} opts
 * @param {string}  opts.projectRoot
 * @param {string}  opts.fromVersion
 * @param {string}  opts.toVersion
 * @param {object}  opts.colors
 */
export async function printPostUpgradeBanner({ projectRoot, fromVersion, toVersion, colors, t = null }) {
  let summary;
  try {
    const lintScript = join(projectRoot, '_lumina', 'scripts', 'lint.mjs');
    const result = spawnSync(
      process.execPath,
      [lintScript, '--summary'],
      { cwd: projectRoot, encoding: 'utf8', timeout: 30000 },
    );

    // Exit codes: 0 = clean, 1 = findings. Anything else (crash / ENOENT) → skip.
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      return;
    }

    try {
      summary = JSON.parse(result.stdout.trim());
    } catch {
      return;
    }
  } catch {
    return;
  }

  const { errors = 0, warnings = 0 } = summary;
  if (errors === 0 && warnings === 0) {
    return;
  }

  // Use t() if available; fall back to EN literals for callers that don't pass t.
  const banner = [
    '',
    colors.yellow(t ? t('warn.upgrade_header', { from: fromVersion, to: toVersion }) : `[warn] Lumina upgraded v${fromVersion} -> v${toVersion} — schema gap detected:`),
    colors.yellow(t ? t('warn.upgrade_errors', { errors, warnings }) : `       ${errors} error(s), ${warnings} warning(s) across legacy entries.`),
    '',
    t ? t('warn.upgrade_fix_quick') : '     Quick fix (deterministic):',
    t ? t('warn.upgrade_fix_quick_cmd') : '       node _lumina/scripts/wiki.mjs migrate --add-defaults',
    '',
    t ? t('warn.upgrade_fix_smart') : '     Smart fix (LLM-driven, recommended):',
    t ? t('warn.upgrade_fix_smart_cmd') : '       /lumi-migrate-legacy',
    '',
    t ? t('warn.upgrade_idempotent') : '     Both are idempotent. See _lumina/CHANGELOG.md for details.',
    '',
  ].join('\n');

  process.stderr.write(banner + '\n');

  // Spawn-and-forget: append upgrade log entry (ignore failures, e.g., wiki/ missing)
  try {
    const wikiScript = join(projectRoot, '_lumina', 'scripts', 'wiki.mjs');
    const logMsg = `upgrade v${fromVersion}->v${toVersion}: ${errors} errors, ${warnings} warnings — run /lumi-migrate-legacy`;
    spawnSync(
      process.execPath,
      [wikiScript, 'log', 'installer', logMsg],
      { cwd: projectRoot, encoding: 'utf8', timeout: 10000 },
    );
  } catch {
    // Ignore: wiki/ may not exist for incomplete installs
  }
}

async function readAnswersFromConfig(projectRoot, existingManifest) {
  // Manifest is the source of truth for `locale` (Plan §6). Config mirrors
  // manifest; if they disagree, manifest wins. Validate config.locale against
  // VALID_LOCALES so a hand-edited or corrupted YAML never propagates an
  // invalid identifier into template-path construction (defense-in-depth even
  // though loadLocale also rejects).
  const configPath = join(projectRoot, '_lumina', 'config', 'lumina.config.yaml');
  let config = null;
  try {
    const yaml = await import('js-yaml');
    const raw = await readFile(configPath, 'utf8');
    config = yaml.load(raw) || {};
  } catch (err) {
    if (err.code === 'ENOENT') {
      config = null;
    } else {
      // Real I/O or parse error — bail loud (Phase 2: "config drift should be loud").
      const e = new Error(`CONFIG_READ_FAILED: ${err.message} (path: ${configPath})`);
      e.code = 2;
      throw e;
    }
  }

  if (config?.locale !== undefined && !VALID_LOCALES.includes(config.locale)) {
    const e = new Error(`INVALID_CONFIG_LOCALE: ${JSON.stringify(config.locale)}. Valid: ${VALID_LOCALES.join(', ')}`);
    e.code = 2;
    throw e;
  }

  if (config) {
    const ideTargets = Object.entries(config.ide_targets || {})
      .filter(([_, v]) => v)
      .map(([k]) => k);

    const packs = Object.entries(config.packs || {})
      .filter(([_, v]) => v)
      .map(([k]) => k);

    // Manifest wins for locale; config is a mirror.
    const locale = existingManifest?.locale || config.locale || 'en';
    const langName = LOCALE_LANGUAGE_NAME[locale] ?? 'English';
    return {
      directory:          projectRoot,
      projectName:        config.project_name || basename(projectRoot),
      researchPurpose:    '',
      ideTargets:         ideTargets.length ? ideTargets : ['claude_code'],
      packs:              packs.length ? packs : ['core'],
      communicationLang:  config.communication_language || langName,
      documentOutputLang: config.document_output_language || langName,
      locale,
    };
  }

  // No config file — fall back to manifest data
  const ideTargets = existingManifest?.ideTargets ?? ['claude_code'];
  const packs = Object.keys(existingManifest?.packs ?? { core: true });
  const locale = existingManifest?.locale ?? 'en';
  const langName = LOCALE_LANGUAGE_NAME[locale] ?? 'English';
  return {
    directory:          projectRoot,
    projectName:        basename(projectRoot),
    researchPurpose:    '',
    ideTargets,
    packs:              packs.length ? packs : ['core'],
    communicationLang:  langName,
    documentOutputLang: langName,
    locale,
  };
}

function parseListOption(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parts = Array.isArray(value)
    ? value
    : String(value).split(',');
  const result = parts.map(p => String(p).trim()).filter(Boolean);
  if (result.length === 0) {
    const err = new Error(`${label} must contain at least one value`);
    err.code = 2;
    throw err;
  }
  return result;
}

function unique(values) {
  return [...new Set(values)];
}

function validateValues(values, validSet, label) {
  const invalid = values.filter(v => !validSet.has(v));
  if (invalid.length > 0) {
    const err = new Error(`Unknown ${label}: ${invalid.join(', ')}. Valid values: ${[...validSet].join(', ')}`);
    err.code = 2;
    throw err;
  }
}

// Validate user-supplied free-text language values (communication / document_output).
// Reject empty after trim and template-injection sequences. Returns trimmed value.
// NOTE: pre-loadLocale errors are intentionally EN-only and machine-readable.
function validateLanguageInput(value, label) {
  const str = String(value ?? '').trim();
  if (!str) {
    const e = new Error(`${label} must not be empty`);
    e.code = 2;
    throw e;
  }
  if (str.includes('{{') || str.includes('}}')) {
    const e = new Error(`${label} contains forbidden template syntax: ${JSON.stringify(value)}`);
    e.code = 2;
    throw e;
  }
  return str;
}

function applyInstallOverrides(answers, opts) {
  const next = { ...answers };
  const priorLocale = answers.locale ?? null;

  // Locale: --lang overrides the interactive selector. Keep the installed
  // locale in answers.locale until this point so default language values can
  // cascade correctly when an existing destination is selected.
  // Pre-loadLocale error → EN-only string (chicken-and-egg, machine-readable).
  if (opts.lang !== undefined && opts.lang !== null && opts.lang !== '') {
    const normalized = String(opts.lang).toLowerCase().trim();
    if (!VALID_LOCALES.includes(normalized)) {
      const e = new Error(`UNKNOWN_LOCALE: ${opts.lang}. Valid: ${VALID_LOCALES.join(', ')}`);
      e.code = 2;
      throw e;
    }
    next.locale = normalized;
  } else if (next.selectedLocale) {
    next.locale = next.selectedLocale;
  } else if (!next.locale) {
    next.locale = 'en';
  }
  delete next.selectedLocale;

  // Cascade: if --lang changed locale and user didn't explicitly pass language
  // overrides, refresh the language defaults to match the new locale.
  if (next.locale !== priorLocale) {
    const cascaded = LOCALE_LANGUAGE_NAME[next.locale] ?? 'English';
    const priorCascaded = priorLocale ? (LOCALE_LANGUAGE_NAME[priorLocale] ?? 'English') : null;
    if (!opts.communicationLang && (next.communicationLang === priorCascaded || !next.communicationLang)) {
      next.communicationLang = cascaded;
    }
    if (!opts.documentOutputLang && (next.documentOutputLang === priorCascaded || !next.documentOutputLang)) {
      next.documentOutputLang = cascaded;
    }
  }

  const packOverride = parseListOption(opts.packs, '--packs');
  if (packOverride) {
    validateValues(packOverride, VALID_PACKS, 'pack');
    next.packs = unique(['core', ...packOverride.filter(p => p !== 'core')]);
  } else {
    next.packs = unique(['core', ...(next.packs || []).filter(p => p !== 'core')]);
  }

  const ideOverride = parseListOption(opts.ideTargets, '--ide-targets');
  if (ideOverride) {
    validateValues(ideOverride, VALID_IDE_TARGETS, 'IDE target');
    next.ideTargets = unique(ideOverride);
  }

  if (opts.projectName) next.projectName = String(opts.projectName);
  if (opts.communicationLang !== undefined && opts.communicationLang !== null && opts.communicationLang !== '') {
    next.communicationLang = validateLanguageInput(opts.communicationLang, '--communication-language');
  }
  if (opts.documentOutputLang !== undefined && opts.documentOutputLang !== null && opts.documentOutputLang !== '') {
    next.documentOutputLang = validateLanguageInput(opts.documentOutputLang, '--document-output-language');
  }

  return next;
}

export { applyInstallOverrides, validateLanguageInput };

/**
 * If the loaded locale module has `_meta.translation_status === 'ai-draft'`,
 * write one EN notice line to stderr. Does nothing for 'en' (native strings).
 * Non-EN locales set this flag in their named export:
 *   export const _meta = { translation_status: 'ai-draft' }
 *
 * @param {{ locale: string, t: Function, keys: Function, _meta: object|null }} localeMod
 */
function maybeWarnAiDraft(localeMod) {
  if (localeMod._meta?.translation_status === 'ai-draft') {
    process.stderr.write(
      `[notice] ${localeMod.locale} translations are AI-drafted; pull requests welcome.\n`
    );
  }
}

async function renderAndWriteConfig(projectRoot, config) {
  const yaml = await import('js-yaml');

  const configPath = join(projectRoot, '_lumina', 'config', 'lumina.config.yaml');
  const configContent = `# lumina.config.yaml — workspace config managed by lumina-wiki installer.\n` +
    `# Lives at _lumina/config/lumina.config.yaml. Editable by hand.\n\n` +
    yaml.dump(config, { lineWidth: 100, noRefs: true });

  await atomicWrite(configPath, configContent);
}

async function renderAndWriteReadme(projectRoot, templateVars, purpose, isUpgrade, acceptDefaults, t = null) {
  const readmePath = join(projectRoot, 'README.md');
  // Select locale-specific template; fall back to EN if locale variant is missing.
  const locale = templateVars.locale ?? 'en';
  const suffix = locale === 'en' ? '' : '.' + locale;
  const templatePath = join(TEMPLATES_DIR, 'README' + suffix + '.md');
  const fallbackTemplatePath = join(TEMPLATES_DIR, 'README.md');

  let templateContent;
  try {
    templateContent = await readFile(templatePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Locale-specific template not present; fall back to EN template.
    try {
      templateContent = await readFile(fallbackTemplatePath, 'utf8');
    } catch (err2) {
      if (err2.code !== 'ENOENT') throw err2;
      templateContent = defaultReadmeTemplate(templateVars);
    }
  }

  // Check if README exists
  let existingReadme = null;
  try {
    existingReadme = await readFile(readmePath, 'utf8');
  } catch (_) {}

  if (existingReadme !== null) {
    if (isUpgrade) {
      // Upgrade: rewrite only the schema region
      const newSchemaContent = render(extractSchemaTemplate(templateContent), templateVars);
      const updated = replaceOrAppendSchemaRegion(existingReadme, newSchemaContent);
      await atomicWrite(readmePath, updated);
      return;
    }

    // First install with existing README: ask user
    const action = await runReadmeMergePrompt({ acceptDefaults, t });
    if (action === 'abort') {
      console.log(t ? t('readme.aborted') : 'Aborted: README.md left unchanged.');
      process.exit(0);
    }
    if (action === 'backup') {
      await copyFile(readmePath, readmePath + '.bak');
    }
    if (action === 'merge') {
      const newSchemaContent = render(extractSchemaTemplate(templateContent), templateVars);
      const updated = replaceOrAppendSchemaRegion(existingReadme, newSchemaContent);
      await atomicWrite(readmePath, updated);
      return;
    }
  }

  // Fresh render
  const rendered = renderReadme(templateContent, templateVars, purpose);
  await atomicWrite(readmePath, rendered);
}

function extractSchemaTemplate(fullTemplate) {
  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const lines = fullTemplate.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const startLine = lines.findIndex(line => line.trim() === openMarker);
  const endLine = lines.findIndex((line, idx) => idx > startLine && line.trim() === closeMarker);
  if (startLine === -1 || endLine === -1) return fullTemplate;
  return lines.slice(startLine + 1, endLine).join('\n');
}

async function renderIdeStubs(projectRoot, ideTargets, templateVars) {
  for (const target of ideTargets) {
    const stubContent = buildIdeStub(target, templateVars);
    if (!stubContent) continue;
    const stubPath = ideTargetFilePath(projectRoot, target);
    if (!stubPath) continue;
    await ensureDir(dirname(stubPath));
    await atomicWrite(stubPath, stubContent);
  }
}

function ideTargetFilePath(projectRoot, target) {
  switch (target) {
    case 'claude_code': return join(projectRoot, 'CLAUDE.md');
    case 'codex':       return join(projectRoot, 'AGENTS.md');
    case 'gemini_cli':  return join(projectRoot, 'GEMINI.md');
    case 'cursor':      return join(projectRoot, '.cursor', 'rules', 'lumina.mdc');
    case 'qwen':        return join(projectRoot, 'QWEN.md');
    case 'iflow':       return join(projectRoot, 'IFLOW.md');
    case 'generic':     return null; // No stub needed; README.md is the entry point
    default:            return null;
  }
}

function ideTargetStubFiles(ideTargets) {
  return ideTargets
    .map(t => {
      switch (t) {
        case 'claude_code': return 'CLAUDE.md';
        case 'codex':       return 'AGENTS.md';
        case 'gemini_cli':  return 'GEMINI.md';
        case 'cursor':      return '.cursor/rules/lumina.mdc';
        case 'qwen':        return 'QWEN.md';
        case 'iflow':       return 'IFLOW.md';
        default:            return null;
      }
    })
    .filter(Boolean);
}

async function removeManagedFileIfUnchanged(projectRoot, relPath, previousFileRows, colors, t) {
  const absPath = safePath(projectRoot, relPath);
  try {
    await access(absPath, fsConstants.F_OK);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const previous = previousFileRows.find(row => row.relative_path === relPath);
  if (previous?.sha256) {
    try {
      if (await fileHash(absPath) === previous.sha256) {
        await unlink(absPath);
        return;
      }
    } catch (_) {}
  }

  console.log(colors.yellow(t('warn.preserved_modified_file', { path: relPath })));
}

function previousManagedSkillRows(previousSkillRows, existingManifest) {
  const rowsById = new Map(previousSkillRows.map(row => [row.canonical_id, row]));
  const previousStrategies = existingManifest?.symlinkStrategies ?? {};
  const claudeWasSelected = existingManifest?.ideTargets?.includes('claude_code') ?? false;
  const previousPacks = Object.keys(existingManifest?.packs ?? {});
  for (const skill of workspaceSkillDefinitions(previousPacks)) {
    if (!rowsById.has(skill.canonicalId)) {
      rowsById.set(skill.canonicalId, {
        canonical_id: skill.canonicalId,
        relative_path: join('.agents', 'skills', skill.canonicalId),
        target_link_path: existingManifest?.ideTargets?.includes('claude_code')
          ? join('.claude', 'skills', skill.canonicalId)
          : '',
      });
    }
  }
  for (const canonicalId of Object.keys(previousStrategies)) {
    if (!rowsById.has(canonicalId)) {
      rowsById.set(canonicalId, {
        canonical_id: canonicalId,
        relative_path: join('.agents', 'skills', canonicalId),
        target_link_path: join('.claude', 'skills', canonicalId),
      });
    }
  }
  return [...rowsById.values()].map(row => ({
    ...row,
    managed_link: claudeWasSelected
      || Object.prototype.hasOwnProperty.call(previousStrategies, row.canonical_id),
  }));
}

async function removeManagedSkillLink(projectRoot, skill) {
  if (skill.managed_link === false) return;
  const relPath = skill.target_link_path || join('.claude', 'skills', skill.canonical_id);
  await rm(safePath(projectRoot, relPath), { recursive: true, force: true });
}

async function reconcileRemovedIdeTargets({
  projectRoot,
  previousIdeTargets,
  currentIdeTargets,
  previousFileRows,
  previousSkillRows,
  colors,
  t,
}) {
  const removedTargets = previousIdeTargets.filter(target => !currentIdeTargets.includes(target));
  for (const target of removedTargets) {
    if (target === 'claude_code') {
      await Promise.all(previousSkillRows.map(skill => removeManagedSkillLink(projectRoot, skill)));
    }

    const relPath = ideTargetStubFiles([target])[0];
    if (relPath) {
      await removeManagedFileIfUnchanged(projectRoot, relPath, previousFileRows, colors, t);
    }
  }
}

async function reconcileRemovedSkills(projectRoot, previousSkillRows, currentSkillRows) {
  const currentIds = new Set(currentSkillRows.map(row => row.canonical_id));
  const obsolete = previousSkillRows.filter(row => !currentIds.has(row.canonical_id));

  for (const skill of obsolete) {
    if (skill.relative_path) {
      await rm(safePath(projectRoot, skill.relative_path), { recursive: true, force: true });
    }
    await removeManagedSkillLink(projectRoot, skill);
  }
}

async function cleanupRemovedResearchPack(projectRoot, previousFileRows, colors, t) {
  await Promise.all(RESEARCH_TOOL_FILES.map(file => (
    rm(safePath(projectRoot, join('_lumina', 'tools', file)), { force: true })
  )));
  await removeManagedFileIfUnchanged(
    projectRoot,
    '.env.example',
    previousFileRows,
    colors,
    t,
  );
}

function buildIdeStub(target, vars) {
  const name = vars.project_name || 'this wiki';
  switch (target) {
    case 'claude_code':
      return `# Claude Code — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'codex':
      return `# AGENTS.md — Lumina Wiki\n\nThis file is the entry point for any CLI agent that reads \`AGENTS.md\` (OpenAI CodexApp (ChatGPT), Amp, Crush, Goose, Auggie, OpenCode, Kimi Code, Mistral Vibe, and other AGENTS.md-compatible tools).\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'gemini_cli':
      return `# Gemini CLI — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'cursor':
      return `---\ndescription: Lumina Wiki workspace rules for Cursor\nglobs: ["**/*.md"]\nalwaysApply: true\n---\n\n# Cursor — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'qwen':
      return `# Qwen Code — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'iflow':
      return `# iFlow CLI — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, skill list, and user communication rules for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    default:
      return null;
  }
}

async function copyScripts(projectRoot) {
  const sources = workspacePayloadSources(['core']).filter(source => source.group === 'script');
  await Promise.all(sources.map(async source => {
    try {
      const destination = join(projectRoot, source.targetPath);
      await ensureDir(dirname(destination));
      await copyFile(join(PACKAGE_ROOT, source.sourcePath), destination);
    } catch (_) {
      // Scripts may not exist yet (P4+ work); skip gracefully
    }
  }));
}

async function copyChangelog(projectRoot) {
  const source = workspacePayloadSources(['core']).find(item => item.group === 'changelog');
  try {
    await copyFile(
      join(PACKAGE_ROOT, source.sourcePath),
      join(projectRoot, source.targetPath),
    );
  } catch (_) {
    // CHANGELOG may not exist in older snapshots; skip gracefully
  }
}

async function copySkills(projectRoot, skillDefs, { claudeCode = false } = {}) {
  const skillRows = [];

  for (const skill of skillDefs) {
    // srcPackPath uses forward slashes — join handles OS differences
    const srcDir = join(SKILLS_DIR, ...skill.srcPackPath.split('/'), skill.name);
    const destDir = join(projectRoot, '.agents', 'skills', skill.canonicalId);

    await access(join(srcDir, 'SKILL.md'), fsConstants.F_OK);
    await rm(destDir, { recursive: true, force: true });
    await ensureDir(destDir);
    await copyDir(srcDir, destDir);

    skillRows.push({
      canonical_id:    skill.canonicalId,
      display_name:    skill.displayName,
      pack:            skill.pack,
      source:          'built-in',
      relative_path:   `.agents/skills/${skill.canonicalId}`,
      target_link_path: claudeCode ? join('.claude', 'skills', skill.canonicalId) : '',
      version:         PKG.version,
    });
  }

  return skillRows;
}

function replaceOrAppendSchemaRegion(existingContent, newSchemaContent) {
  if (extractSchemaRegion(existingContent) !== null) {
    return replaceSchemaRegion(existingContent, newSchemaContent);
  }

  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const schemaBody = newSchemaContent.startsWith('\n') ? newSchemaContent : '\n' + newSchemaContent;
  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  return `${existingContent}${separator}${openMarker}${schemaBody}${closeMarker}\n`;
}

async function copyTools(projectRoot, { research }) {
  const packs = research ? ['core', 'research'] : ['core'];
  const sources = workspacePayloadSources(packs).filter(source => source.group === 'tool');
  // Parallelize: each copy is independent and destDir already exists.
  // Sequential awaits were the main Windows cold-start regression in v1.4
  // (~30 ms per file × 14 files dominates on NTFS + Defender).
  await Promise.all(sources.map(async source => {
    try {
      await copyFile(
        join(PACKAGE_ROOT, source.sourcePath),
        join(projectRoot, source.targetPath),
      );
    } catch (_) {
      // Tool not yet authored; skip
    }
  }));
}

async function renderSchemaDocs(projectRoot, templateVars) {
  const schemaSources = workspacePayloadSources(['core']).filter(source => source.group === 'schema');

  // Parallel render + atomicWrite. Each doc is independent; schemaDir is
  // already created by the dirsToCreate loop in installCommand.
  await Promise.all(schemaSources.map(async source => {
    const templatePath = join(PACKAGE_ROOT, source.sourcePath);
    const destPath = join(projectRoot, source.targetPath);
    let content;
    try {
      const raw = await readFile(templatePath, 'utf8');
      content = render(raw, templateVars);
    } catch (_) {
      content = `# ${basename(source.targetPath)}\n\n_This file is managed by the Lumina installer._\n`;
    }
    await atomicWrite(destPath, content);
  }));
}

async function renderEnvExample(projectRoot) {
  const templatePath = join(TEMPLATES_DIR, '.env.example');
  const destPath = join(projectRoot, '.env.example');
  let content;
  try {
    content = await readFile(templatePath, 'utf8');
  } catch (_) {
    content = `# .env.example — API keys for Lumina Wiki research pack tools\n` +
      `# Copy to .env and fill in your values. Never commit .env.\n\n` +
      `# Semantic Scholar API key (optional; improves rate limits)\n` +
      `SEMANTIC_SCHOLAR_API_KEY=\n\n` +
      `# OpenAlex API key (optional; enables free daily API budget and usage tracking)\n` +
      `OPENALEX_API_KEY=\n\n` +
      `# DeepXiv token (optional; enables full-text PDF access)\n` +
      `DEEPXIV_TOKEN=\n\n` +
      `# Scite.ai API key (optional; enables Smart Citation tallies in /lumi-research-rank)\n` +
      `SCITE_API_KEY=\n\n` +
      `# Altmetric API key (optional; enables attention scores in /lumi-research-rank)\n` +
      `ALTMETRIC_API_KEY=\n\n` +
      `# arXiv does not require an API key in v0.1\n`;
  }
  await atomicWrite(destPath, content);
}

async function writeWatchlistTemplate(projectRoot) {
  const destPath = join(projectRoot, '_lumina', 'config', 'watchlist.yml');
  let exists = false;
  try {
    await access(destPath, fsConstants.F_OK);
    exists = true;
  } catch (_) {}
  if (exists) return;

  const templatePath = join(TEMPLATES_DIR, '_lumina', 'config', 'watchlist.yml');
  let content;
  try {
    content = await readFile(templatePath, 'utf8');
  } catch (_) {
    content = [
      'version: 1',
      'defaults:',
      '  sources: [arxiv]',
      '  schedule: weekly',
      '  limit: 20',
      '  max_new: 5',
      'items: []',
      '',
    ].join('\n');
  }
  await atomicWrite(destPath, content);
}

async function writeGitignore(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  let exists = false;
  try {
    await access(gitignorePath, fsConstants.F_OK);
    exists = true;
  } catch (_) {}

  if (!exists) {
    const source = workspacePayloadSources(['core']).find(item => item.group === 'gitignore');
    const templatePath = join(PACKAGE_ROOT, source.sourcePath);
    let content;
    try {
      content = await readFile(templatePath, 'utf8');
    } catch (_) {
      content = `# Lumina Wiki — generated by lumina-wiki installer\n` +
        `_lumina/_state/\nraw/tmp/\n.env\nnode_modules/\n`;
    }
    await atomicWrite(gitignorePath, content);
  }
}

async function seedWikiFiles(projectRoot) {
  const seeds = workspacePayloadSources(['core']).filter(source => source.group === 'seed');
  for (const seed of seeds) {
    const destination = join(projectRoot, seed.targetPath);
    try {
      await access(destination, fsConstants.F_OK);
    } catch (_) {
      await atomicWrite(destination, seed.content);
    }
  }
}

async function createSkillSymlinks(projectRoot, skillRows, existingManifest, reLink, colors, t = null) {
  const strategies = {};
  const errors = [];

  for (const skill of skillRows) {
    const target   = resolve(projectRoot, skill.relative_path);
    const linkPath = resolve(projectRoot, '.claude', 'skills', skill.canonical_id);

    const existingStrategy = reLink ? null : (existingManifest?.symlinkStrategies?.[skill.canonical_id] ?? null);

    try {
      const result = await linkDirectory(target, linkPath, existingStrategy);
      strategies[skill.canonical_id] = result.strategy;
      if (result.warning) {
        console.log(colors.yellow(`  [warn] ${result.message}`));
      }
    } catch (err) {
      errors.push({ skill: skill.canonical_id, error: err });
      const msg = t
        ? t('error.symlink', { skill: skill.canonical_id, message: err.message })
        : `  [error] Failed to link ${skill.canonical_id}: ${err.message}`;
      console.log(colors.red(msg));
    }
  }

  return { strategies, errors };
}

async function buildFilesManifest(projectRoot, managedFilePathsInput, pkgVersion) {
  const managedFiles = [...managedFilePathsInput];
  const packs = managedFilePathsInput.some(path => path.startsWith('.env'))
    ? ['research']
    : [];

  if (packs.includes('research') && !managedFiles.some(path => path.startsWith('.env'))) {
    managedFiles.push('.env.example');
  }

  const rows = [];
  for (const relPath of managedFiles) {
    const absPath = join(projectRoot, relPath);
    let sha256 = '';
    try {
      sha256 = await fileHash(absPath);
    } catch (_) {}
    if (!sha256) continue;

    const packForFile = relPath.startsWith('.env.example') ? 'research' : 'core';
    rows.push({
      relative_path:     relPath,
      sha256,
      source_pack:       packForFile,
      installed_version: pkgVersion,
    });
  }

  return rows;
}

function defaultReadmeTemplate(vars) {
  return `# ${vars.project_name}\n\n<!-- lumina:schema -->\n\n_Schema region managed by Lumina Wiki installer._\n\n<!-- /lumina:schema -->\n`;
}

async function readdir_safe(dirPath) {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(dirPath);
  } catch (_) {
    return [];
  }
}
