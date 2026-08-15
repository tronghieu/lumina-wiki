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

import { readFile, writeFile, rename, unlink, rm, access, lstat, realpath, readlink, readdir } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import {
  atomicWrite,
  atomicCopyFile,
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
  runAgentInstallAcknowledgment,
  LOCALE_LANGUAGE_NAME,
} from './prompts.js';
import { VALID_LOCALES, loadLocale } from './locales.js';
import { checkForUpdate } from './update-check.js';
import { readAgentsManifest, writeAgentsManifest } from './agents-manifest.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'src', 'templates');
const SCRIPTS_DIR = join(PACKAGE_ROOT, 'src', 'scripts');
const SKILLS_DIR = join(PACKAGE_ROOT, 'src', 'skills');
const TOOLS_DIR = join(PACKAGE_ROOT, 'src', 'tools');

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

/** Directories always created (core pack) */
const CORE_WIKI_DIRS = [
  'wiki/sources', 'wiki/concepts', 'wiki/people', 'wiki/summary',
  'wiki/outputs', 'wiki/graph', 'wiki/readings',
];

const RESEARCH_WIKI_DIRS = ['wiki/foundations', 'wiki/topics'];
const READING_WIKI_DIRS  = ['wiki/chapters', 'wiki/characters', 'wiki/themes', 'wiki/plot'];
const LEARNING_WIKI_DIRS = ['wiki/reflections'];

const CORE_RAW_DIRS = ['raw/sources', 'raw/notes', 'raw/assets', 'raw/tmp', 'raw/download'];
const RESEARCH_RAW_DIRS = ['raw/discovered'];

const LUMINA_DIRS = [
  '_lumina/config',
  '_lumina/schema',
  '_lumina/scripts',
  '_lumina/tools',
  '_lumina/_state',
];

const VALID_PACKS = new Set(['core', 'research', 'reading', 'learning']);
const VALID_IDE_TARGETS = new Set(['claude_code', 'codex', 'cursor', 'gemini_cli', 'qwen', 'iflow', 'generic']);
// AI-agent global-skills targets (CAP-8). Deliberately a separate set from
// VALID_IDE_TARGETS — these never write a project workspace payload, only a
// platform's documented global skills directory (see platform-integration.md).
const VALID_AGENT_TARGETS = new Set(['openclaw', 'hermes']);
const RESEARCH_TOOL_FILES = [
  '_env.py', '_cache.py', 'discover.py', 'init_discovery.py', 'prepare_source.py',
  'fetch_arxiv.py', 'fetch_wikipedia.py', 'fetch_s2.py', 'fetch_deepxiv.py',
  'fetch_openalex.py', 'fetch_unpaywall.py', 'fetch_core.py', 'resolve_pdf.py',
  'fetch_rss.py', 'fetch_scite.py', 'fetch_altmetric.py',
];

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
 * @param {string|string[]} [opts.ide]      - Alias for `opts.ideTargets`; the
 *   latter wins when both are given
 * @param {string} [opts.agents]       - Comma-separated AI-agent platform targets
 *   (CAP-8): 'openclaw', 'hermes'. When present, the install is AGENTS-ONLY:
 *   the entire per-project payload (steps 1-18 below) is skipped and only a
 *   skills-only install into each platform's documented global skills
 *   directory runs — `opts.directory`/`opts.cwd` are accepted but unused in
 *   this mode. Never persisted into lumina.config.yaml. (The interactive
 *   install prompt has its own, unrelated agent-target multiselect that
 *   remains additive to a full project install — this flag is the only
 *   thing that triggers the agents-only fast path.)
 * @param {string} [opts.projectName]  - Hidden escape hatch; default = basename(directory)
 * @param {string} [opts.communicationLang]
 * @param {string} [opts.documentOutputLang]
 * @param {boolean} [opts.searchParents] - Find an enclosing Lumina workspace when no directory flag was used
 * @param {'full'|'minimal'} [opts.profile] - Install profile. 'full' (default)
 *   is today's behavior, byte-identical. 'minimal' scaffolds a wiki managed
 *   entirely by globally-installed agent skills (CAP-8): no .agents/skills,
 *   no per-project skill copies, no IDE stub files. Implies non-interactive
 *   (never reaches the @clack/prompts UI), same as --yes.
 * @param {string} [opts.purpose] - Non-interactive README '## Project
 *   Purpose' text; equivalent to the interactive research-purpose prompt.
 */
export async function installCommand(opts = {}) {
  // --agents-only fast path (CAP-8/CAP-10 fix): `--agents` documents a
  // GLOBAL, skills-only install (README.md / user-guides "AI-agent
  // installs"). Previously it ran the ENTIRE classic per-project install
  // (steps 1-18 below) into the resolved directory — defaulting to
  // process.cwd() — before ever reaching the global agent-skill install.
  // That scaffolded README.md/wiki//raw//_lumina/ into whatever directory
  // the user happened to be in when they ran the documented command.
  // Fixed semantics: when `--agents` is passed, skip the whole per-project
  // payload and run ONLY the global agent-skill install (the former step
  // 19 logic below). `opts.directory`/`opts.cwd` are accepted but unused
  // here. The programmatic `profile: 'minimal'` path (used by
  // `wikis add --provision`) never sets `opts.agents`, so it is unaffected.
  const agentTargetsOverride = parseListOption(opts.agents, '--agents');
  if (agentTargetsOverride) {
    validateValues(agentTargetsOverride, VALID_AGENT_TARGETS, 'agent target');
    const agentTargets = unique(agentTargetsOverride);
    const colors = await getColorFns();
    const yes = Boolean(opts.yes);
    const preambleContent = await readFile(
      join(TEMPLATES_DIR, 'partials', 'librarian-preamble.md'), 'utf8',
    );
    for (const platform of agentTargets) {
      await copySkillsToAgentPlatform(platform, preambleContent, colors);
      printAgentInstallNotice(platform);
      await runAgentInstallAcknowledgment({ acceptDefaults: yes });
    }
    return;
  }

  const profile = opts.profile === 'minimal' ? 'minimal' : 'full';
  // Minimal is always non-interactive — it's driven by the global hub, never
  // a human at a terminal, so it must never reach getClack() even if the
  // caller forgot --yes.
  const yes = Boolean(opts.yes) || profile === 'minimal';
  const { reLink = false } = opts;
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
  // Raw skills-manifest.csv rows (not the synthesized previousManagedSkillRows
  // below, which back-fills a row for every currently-defined skill whether
  // or not it was actually recorded — unsuitable for the ownership guard,
  // which needs to know precisely what Lumina previously recorded owning).
  // readSkillsManifest already returns [] when the file is missing, so this
  // is safe to call unconditionally, not just on upgrade.
  const rawSkillsManifestRows = await readSkillsManifest(projectRoot);
  const previousSkillRows = isUpgrade
    ? previousManagedSkillRows(rawSkillsManifestRows, existingManifest)
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

  const { projectName, researchPurpose, ideTargets, packs, communicationLang, documentOutputLang, locale, agentTargets = [] } = answers;
  const hasResearch = packs.includes('research');
  const hasReading  = packs.includes('reading');
  const hasLearning = packs.includes('learning');
  const previousProjectRoot = existingManifest?.resolvedPaths?.projectRoot;
  const relocated = Boolean(previousProjectRoot && resolve(previousProjectRoot) !== projectRoot);
  const effectiveReLink = reLink || relocated;

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
  const dirsToCreate = [
    ...CORE_WIKI_DIRS,
    ...CORE_RAW_DIRS,
    ...LUMINA_DIRS,
  ];
  if (profile === 'full') {
    dirsToCreate.push('.agents/skills');
  }
  if (hasResearch) {
    dirsToCreate.push(...RESEARCH_WIKI_DIRS, ...RESEARCH_RAW_DIRS);
  }
  if (hasReading) {
    dirsToCreate.push(...READING_WIKI_DIRS);
  }
  if (hasLearning) {
    dirsToCreate.push(...LEARNING_WIKI_DIRS);
  }

  for (const dir of dirsToCreate) {
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
  const templateVars = {
    project_name:             projectName,
    locale:                   locale,
    communication_language:   communicationLang,
    document_output_language: documentOutputLang,
    pack_core:     true,
    pack_research: hasResearch,
    pack_reading:  hasReading,
    pack_learning: hasLearning,
    created_at:    new Date().toISOString().slice(0, 10),
    schema_version: String(MANIFEST_SCHEMA_VERSION),
  };

  // 5. Render + write config
  await renderAndWriteConfig(projectRoot, templateVars, answers);

  // 6. Render + write README (with region awareness)
  await renderAndWriteReadme(projectRoot, templateVars, researchPurpose, isUpgrade, yes, t);

  // 7. Render IDE stubs
  await renderIdeStubs(projectRoot, ideTargets, templateVars);

  // 8. Copy scripts
  await copyScripts(projectRoot);

  // 8.5. Copy CHANGELOG.md so /lumi-migrate-legacy can read it offline
  await copyChangelog(projectRoot);

  // 9. Copy skills — minimal profile has no per-project skill copies at all
  // (the workspace is managed entirely by globally-installed agent skills).
  const skillRows = profile === 'full'
    ? await copySkills(projectRoot, packs, {
        claudeCode: ideTargets.includes('claude_code'),
        colors,
      })
    : [];
  // minimal profile installs no per-project skills at all, so nothing from
  // the current pack selection is "wanted" at this call site — everything
  // previously managed is obsolete, same as before this guard existed.
  const wantedSkillIds = profile === 'full'
    ? new Set(getSkillDefs(packs).map(skill => skill.canonicalId))
    : new Set();
  await reconcileRemovedSkills(projectRoot, previousSkillRows, skillRows, wantedSkillIds, colors);

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
  const fileRows = await buildFilesManifest(projectRoot, packs, PKG.version);

  // 17. Write three state files atomically
  const now = new Date().toISOString();
  // Run schema migrations on the existing manifest first so flags like
  // legacyMigrationNeeded are preserved into the final write.
  const migrated = existingManifest
    ? migrateManifest(existingManifest, MANIFEST_SCHEMA_VERSION)
    : {};
  const manifest = {
    ...migrated,
    schemaVersion:    MANIFEST_SCHEMA_VERSION,
    packageVersion:   PKG.version,
    locale:           locale,
    installedAt:      existingManifest?.installedAt ?? now,
    updatedAt:        now,
    packs:            Object.fromEntries(packs.map(p => [p, { version: PKG.version, source: 'built-in' }])),
    ideTargets,
    profile,
    symlinkStrategies,
    resolvedPaths: {
      projectRoot,
      wiki:    join(projectRoot, 'wiki'),
      raw:     join(projectRoot, 'raw'),
      agents:  join(projectRoot, '.agents'),
      lumina:  join(projectRoot, '_lumina'),
    },
  };

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

  // 19. AI-agent global skill installs (CAP-8) — fully independent of the
  // project payload above: writes only into each platform's documented
  // global skills directory (never anything under projectRoot). Guarded
  // behind agentTargets so a classic install (no --agents / no selection)
  // is byte-identical to today (AD-7/AD-9).
  //
  // `opts.agents` (the CLI/programmatic flag) never reaches here — it takes
  // the agents-only fast-path return at the top of this function instead.
  // `agentTargets` can only be non-empty here via the interactive install's
  // own agent-target multiselect prompt, which stays intentionally additive
  // to a full project install.
  if (agentTargets.length > 0) {
    const preambleContent = await readFile(
      join(TEMPLATES_DIR, 'partials', 'librarian-preamble.md'), 'utf8',
    );
    for (const platform of agentTargets) {
      await copySkillsToAgentPlatform(platform, preambleContent, colors);
      printAgentInstallNotice(platform);
      await runAgentInstallAcknowledgment({ acceptDefaults: yes });
    }
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
  // files-manifest.csv (SHA256 per managed file) lives under _lumina/_state/
  // and is about to be deleted along with the rest of _lumina/ — read it
  // now, before that happens, so the stub-file removal below can still tell
  // an unmodified CLAUDE.md/AGENTS.md/etc. from one the user has edited.
  const previousFileRows = await readFilesManifest(projectRoot).catch(() => []);

  // Remove _lumina/ (except we preserve wiki/ and raw/)
  await rm(join(projectRoot, '_lumina'), { recursive: true, force: true });
  console.log(colors.green(t('uninstall.removed_lumina')));

  // Remove .claude/skills/lumi-* links BEFORE .agents/skills/<id> — the
  // .claude side judges ownership partly by resolving each symlink against
  // its .agents/skills/<id> target (see isLuminaOwnedSkillEntry). Deleting
  // .agents/skills first would make that target vanish out from under a
  // perfectly legitimate link, misjudging Lumina's own symlink as foreign
  // and leaving it behind, dangling, on every single uninstall.
  await removeOwnedClaudeSkillLinks(projectRoot, colors);

  // Remove only the lumi-* skills this install owns (CAP-9 / AD-8) — never a
  // whole-directory wipe, which would destroy any foreign skill a user or
  // another tool placed in .agents/skills/.
  await removeOwnedAgentsSkills(projectRoot, colors);
  console.log(colors.green(t('uninstall.removed_agents')));

  // Remove IDE stub files — but CLAUDE.md/AGENTS.md/etc. are not purely
  // Lumina artifacts the way _lumina/ or a lumi-* skill directory is.
  // Lumina only owns a small rendered stub inside them; a user routinely
  // adds their own project instructions to the same file. Confirming the
  // uninstall confirms removing Lumina — it says nothing about the user's
  // own notes, which they never thought of as ours to delete. Use the same
  // SHA256 content-integrity check the upgrade path already applies when an
  // IDE target is dropped (removeManagedFileIfUnchanged): unmodified since
  // install -> remove; modified -> preserve, with a warning. This makes
  // uninstall at least as careful as a routine upgrade, not less — losing
  // unsaved work should never be easier during the permanent, one-way
  // operation than during a routine reinstall.
  const ideTargets = manifest?.ideTargets ?? ['claude_code'];
  const stubFiles = ideTargetStubFiles(ideTargets);
  for (const f of stubFiles) {
    await removeManagedFileIfUnchanged(projectRoot, f, previousFileRows, colors, t);
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
 * Derive an {errors, warnings, fixableCount, nonFixableCount} breakdown from
 * whatever shape `lint.mjs` produced.
 *
 * Preferred shape (`--json`, no `--summary`): a `findings[]` array where each
 * finding carries its own `severity` and `fixable` — this is the authoritative
 * per-finding truth (a check can be nominally "fixable" yet still leave a
 * specific finding untouched, e.g. an L01 on an enum/number field with no
 * safe default). We sum from the array directly rather than trusting a
 * check-ID-level count.
 *
 * Fallback shape (`--summary`, or any stub/mock that only returns the compact
 * top-level `{errors, warnings, fixable}` object): used when `findings` is
 * absent. This keeps the function resilient to older/simpler lint outputs.
 *
 * @param {object} parsed
 * @returns {{errors: number, warnings: number, fixableCount: number, nonFixableCount: number}}
 */
function summarizeLintOutput(parsed) {
  if (parsed && Array.isArray(parsed.findings)) {
    const findings = parsed.findings;
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const fixableCount = findings.filter(f => f.severity !== 'info' && f.fixable).length;
    const nonFixableCount = Math.max(0, errors + warnings - fixableCount);
    return { errors, warnings, fixableCount, nonFixableCount };
  }

  const errors = Number(parsed?.errors) || 0;
  const warnings = Number(parsed?.warnings) || 0;
  const fixableCount = Number(parsed?.fixable) || 0;
  const nonFixableCount = Math.max(0, errors + warnings - fixableCount);
  return { errors, warnings, fixableCount, nonFixableCount };
}

/**
 * Run lint in the project root and, if findings exist, print a post-upgrade
 * banner to stderr that tells the user exactly what will and will not be
 * fixed for them.
 *
 * @param {object} opts
 * @param {string}  opts.projectRoot
 * @param {string}  opts.fromVersion
 * @param {string}  opts.toVersion
 * @param {object}  opts.colors
 */
export async function printPostUpgradeBanner({ projectRoot, fromVersion, toVersion, colors, t = null }) {
  let parsed;
  try {
    const lintScript = join(projectRoot, '_lumina', 'scripts', 'lint.mjs');

    // maxBuffer: measured ~281 bytes/finding for plain pretty-printed --json.
    // --suggest (below) adds a `suggestion` string, and for L05 a
    // `candidates` array, to every unresolved finding — call it ~2x the
    // plain-mode cost as a conservative estimate, so ~560 bytes/finding.
    // 16 MB comfortably covers ~28,000 findings, an order of magnitude past
    // anything a real wiki should produce, while staying small enough that
    // buffering it in memory for a one-shot upgrade banner is a non-issue.
    const runLintJson = (args) => spawnSync(
      process.execPath,
      [lintScript, ...args],
      { cwd: projectRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );

    // Exit codes: 0 = clean, 1 = findings. Anything else (crash / ENOENT) →
    // treat as unusable. Returns the parsed body, or null if the spawn
    // failed, the exit code was unexpected, or stdout wasn't valid JSON
    // (e.g. truncated output — see the ENOBUFS/truncation comment below).
    const tryParseLintOutput = (result) => {
      if (result.error || (result.status !== 0 && result.status !== 1)) {
        return null;
      }
      try {
        return JSON.parse(result.stdout.trim());
      } catch {
        return null;
      }
    };

    // `--suggest` (without `--fix`/`--dry-run`) makes runLint execute
    // applyFixes in its no-write dry-run mode purely to learn which findings
    // a fixer would actually resolve — the truth pass documented in
    // lint.mjs's runLint (search "Apply fixes if requested"). Without it,
    // `fixable` is only the check-time prediction, which can tell the user
    // to run --fix for something it will silently decline, or hide guidance
    // for something that is in fact repairable. --suggest never writes to
    // disk: every write inside applyFixes is gated on `!opts.dryRun`, and
    // --suggest alone forces `dryRun: true` internally (see runLint).
    parsed = tryParseLintOutput(runLintJson(['--suggest', '--json']));

    // Fallback: the full findings list can still fail to come back even
    // with a 16 MB maxBuffer — either genuine ENOBUFS on an enormous wiki,
    // or (the flavor actually seen while building this: see lint.mjs's
    // main(), which now sets `process.exitCode` instead of calling
    // `process.exit()` right after writing stdout) silent truncation of a
    // large pipe write that races an explicit exit, which produces no
    // `result.error` at all, just invalid JSON. Rather than silently
    // dropping the entire banner (the bug this replaces) on either failure
    // mode, degrade to the compact `--summary` shape, whose size is fixed
    // regardless of finding count, so it cannot repeat either failure.
    // Still `--suggest`, so `fixable` in the summary reflects the same
    // truth pass, not just the prediction.
    if (parsed === null) {
      try {
        parsed = tryParseLintOutput(runLintJson(['--suggest', '--summary']));
      } catch {
        return;
      }
    }

    if (parsed === null) {
      return;
    }
  } catch {
    return;
  }

  const { errors, warnings, fixableCount, nonFixableCount } = summarizeLintOutput(parsed);
  if (errors === 0 && warnings === 0) {
    return;
  }

  // Use t() if available; fall back to EN literals for callers that don't pass t.
  const lines = [
    '',
    colors.yellow(t ? t('warn.upgrade_header', { from: fromVersion, to: toVersion }) : `[warn] Lumina upgraded v${fromVersion} -> v${toVersion}. Some older wiki entries need attention:`),
    colors.yellow(t ? t('warn.upgrade_errors', { errors, warnings }) : `       ${errors} error(s), ${warnings} warning(s).`),
    '',
  ];

  // Deterministic pass — only mention it when it actually has something to do.
  if (fixableCount > 0) {
    lines.push(t ? t('warn.upgrade_fix_auto') : '     Fix what can be corrected automatically:');
    lines.push(t ? t('warn.upgrade_fix_auto_cmd') : '       node _lumina/scripts/lint.mjs --fix');
    lines.push('');
  }

  // Judgment pass — only mention the LLM-assisted path when something actually
  // needs a human decision. If everything was auto-fixable, say nothing here.
  if (nonFixableCount > 0) {
    lines.push(t ? t('warn.upgrade_fix_manual', { count: nonFixableCount }) : `     ${nonFixableCount} finding(s) still need your judgment. See exactly what to do:`);
    lines.push(t ? t('warn.upgrade_fix_manual_suggest_cmd') : '       node _lumina/scripts/lint.mjs --suggest');
    lines.push(t ? t('warn.upgrade_fix_manual_cmd') : '       /lumi-migrate-legacy');
    lines.push('');
  }

  lines.push(t ? t('warn.upgrade_footer') : '     Safe to run again. See _lumina/CHANGELOG.md for details.');
  lines.push('');

  process.stderr.write(lines.join('\n') + '\n');

  // Spawn-and-forget: append upgrade log entry (ignore failures, e.g., wiki/ missing)
  try {
    const wikiScript = join(projectRoot, '_lumina', 'scripts', 'wiki.mjs');
    const logMsg = nonFixableCount > 0
      ? `upgrade v${fromVersion}->v${toVersion}: ${errors} errors, ${warnings} warnings — ${fixableCount} auto-fixable via lint --fix, ${nonFixableCount} need /lumi-migrate-legacy`
      : `upgrade v${fromVersion}->v${toVersion}: ${errors} errors, ${warnings} warnings — all auto-fixable via lint --fix`;
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

  // `opts.ide` is accepted as an alias for `opts.ideTargets` — some callers
  // (e.g. the multi-wiki hub's provisioning path) spell it that way. The
  // canonical `opts.ideTargets` wins when both are present.
  const ideOverride = parseListOption(opts.ideTargets ?? opts.ide, '--ide-targets');
  if (ideOverride) {
    validateValues(ideOverride, VALID_IDE_TARGETS, 'IDE target');
    next.ideTargets = unique(ideOverride);
  }

  // AI-agent global-skills targets (CAP-8). --agents is a raw comma-separated
  // string (see bin/lumina.js); never persisted into lumina.config.yaml (AD-9)
  // — every invocation decides fresh, so an upgrade path with no override
  // simply defaults to none selected.
  const agentOverride = parseListOption(opts.agents, '--agents');
  if (agentOverride) {
    validateValues(agentOverride, VALID_AGENT_TARGETS, 'agent target');
    next.agentTargets = unique(agentOverride);
  } else {
    next.agentTargets = unique(next.agentTargets || []);
  }

  if (opts.projectName) next.projectName = String(opts.projectName);
  if (opts.communicationLang !== undefined && opts.communicationLang !== null && opts.communicationLang !== '') {
    next.communicationLang = validateLanguageInput(opts.communicationLang, '--communication-language');
  }
  if (opts.documentOutputLang !== undefined && opts.documentOutputLang !== null && opts.documentOutputLang !== '') {
    next.documentOutputLang = validateLanguageInput(opts.documentOutputLang, '--document-output-language');
  }

  // Non-interactive equivalent of the research-purpose prompt (used by the
  // global hub's minimal-profile installs, but not restricted to them).
  // Absent/empty → unchanged, preserving today's '' fallback.
  if (opts.purpose !== undefined && opts.purpose !== null && opts.purpose !== '') {
    next.researchPurpose = String(opts.purpose);
  }

  return next;
}

export { applyInstallOverrides, validateLanguageInput, removeManagedSkillLink, removeOwnedAgentsSkills, removeOwnedClaudeSkillLinks };

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

async function renderAndWriteConfig(projectRoot, templateVars, answers) {
  const yaml = await import('js-yaml');

  // Build config object
  const config = {
    project_name: templateVars.project_name,
    locale: templateVars.locale,
    communication_language: templateVars.communication_language,
    document_output_language: templateVars.document_output_language,
    created_at: templateVars.created_at,
    ide_targets: {
      claude_code: answers.ideTargets.includes('claude_code'),
      codex:       answers.ideTargets.includes('codex'),
      cursor:      answers.ideTargets.includes('cursor'),
      gemini_cli:  answers.ideTargets.includes('gemini_cli'),
      qwen:        answers.ideTargets.includes('qwen'),
      iflow:       answers.ideTargets.includes('iflow'),
      generic:     answers.ideTargets.includes('generic'),
    },
    packs: {
      core:     true,
      research: answers.packs.includes('research'),
      reading:  answers.packs.includes('reading'),
      learning: answers.packs.includes('learning'),
    },
    paths: {
      raw:     'raw',
      wiki:    'wiki',
      agents:  '.agents',
      _lumina: '_lumina',
      index:   'wiki/index.md',
      log:     'wiki/log.md',
    },
    wiki: {
      link_syntax:  'obsidian',
      slug_style:   'kebab-case',
      log_prefix:   '## [{{date}}] {{skill}} | {{details}}',
      bidirectional_links: {
        mode: 'exempt-only',
        exemptions: ['foundations/**', 'outputs/**', '*://*', ...(answers.packs.includes('learning') ? ['reflections/**'] : [])],
      },
      graph: {
        enabled: true,
        edge_types_core: ['related_to', 'builds_on', 'contradicts', 'cites', 'mentions', 'part_of'],
      },
    },
    lint: {
      default_mode: 'report',
      checks: {
        broken_links: true,
        orphan_pages: true,
        missing_reverse_links: true,
        log_format: true,
        index_freshness: true,
        stale_claims: false,
      },
    },
    integrations: {
      qmd_search: false,
      obsidian_vault: false,
      marp_slides: false,
    },
    telemetry: false,
  };

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
      await atomicCopyFile(readmePath, readmePath + '.bak');
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
  for (const skill of getSkillDefs(previousPacks)) {
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

/**
 * Remove the `.claude/skills/<canonical_id>` link for a skill that is no
 * longer managed (its IDE target was dropped, or the skill itself was
 * removed by a pack change). Guarded the same way as every other
 * skill-deletion site: an entry whose on-disk fingerprint doesn't match
 * survives, with a warning, rather than being deleted just because its
 * name happens to match a `canonical_id` we once managed.
 *
 * @param {string} projectRoot
 * @param {SkillRow} skill
 * @param {object} [colors] - Color functions for the foreign-collision warning.
 */
async function removeManagedSkillLink(projectRoot, skill, colors = null, rmImpl = rm) {
  if (skill.managed_link === false) return;
  const relPath = skill.target_link_path || join('.claude', 'skills', skill.canonical_id);
  const entryPath = safePath(projectRoot, relPath);
  const expectedTarget = skill.relative_path
    ? safePath(projectRoot, skill.relative_path)
    : join(projectRoot, '.agents', 'skills', skill.canonical_id);

  const owned = await isLuminaOwnedSkillEntry({
    entryPath,
    canonicalId: skill.canonical_id,
    expectedTarget,
  });
  if (!owned) {
    if (colors) warnForeignSkillEntry(colors, relPath, skill.canonical_id);
    return;
  }

  const removed = await removeSkillEntry(entryPath, rmImpl);
  if (!removed.ok && colors) {
    warnSkillDeletionFailed(colors, relPath, skill.canonical_id, removed.error);
  }
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
      await Promise.all(previousSkillRows.map(skill => removeManagedSkillLink(projectRoot, skill, colors)));
    }

    const relPath = ideTargetStubFiles([target])[0];
    if (relPath) {
      await removeManagedFileIfUnchanged(projectRoot, relPath, previousFileRows, colors, t);
    }
  }
}

/**
 * Delete any previously-managed skill that is no longer part of the current
 * pack selection.
 *
 * `wantedIds` — the full set of canonicalIds the current `packs` selection
 * asks for (from `getSkillDefs(packs)`) — is the "still wanted" signal, NOT
 * `currentSkillRows` alone. A skill can be part of the current selection yet
 * absent from `currentSkillRows` because `copySkills` skipped it this run
 * (a foreign directory occupies its `.agents/skills/<id>` path — see the
 * skill-ownership guard); that is a "leave it alone" outcome, not a "pack
 * was deselected, clean it up" outcome, and must not be reconciled away.
 *
 * The `.agents/skills/<id>` deletion below is guarded the same way as
 * `removeManagedSkillLink`'s `.claude/skills/<id>` deletion: an obsolete
 * row whose path no longer fingerprints as Lumina's own (e.g. a user
 * deleted the skill and dropped unrelated content in its place) survives,
 * with a warning, instead of being deleted just because it used to be
 * managed.
 *
 * @param {string} projectRoot
 * @param {SkillRow[]} previousSkillRows
 * @param {SkillRow[]} currentSkillRows
 * @param {Set<string>} wantedIds
 * @param {object} [colors] - Color functions for the foreign-collision warning.
 */
async function reconcileRemovedSkills(projectRoot, previousSkillRows, currentSkillRows, wantedIds, colors = null, rmImpl = rm) {
  const stillWanted = new Set([...wantedIds, ...currentSkillRows.map(row => row.canonical_id)]);
  const obsolete = previousSkillRows.filter(row => !stillWanted.has(row.canonical_id));

  for (const skill of obsolete) {
    if (skill.relative_path) {
      const entryPath = safePath(projectRoot, skill.relative_path);
      const owned = await isLuminaOwnedSkillEntry({
        entryPath,
        canonicalId: skill.canonical_id,
      });
      if (owned) {
        const removed = await removeSkillEntry(entryPath, rmImpl);
        if (!removed.ok && colors) {
          warnSkillDeletionFailed(colors, skill.relative_path, skill.canonical_id, removed.error);
        }
      } else if (colors) {
        warnForeignSkillEntry(colors, skill.relative_path, skill.canonical_id);
      }
    }
    await removeManagedSkillLink(projectRoot, skill, colors, rmImpl);
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
  const destDir = join(projectRoot, '_lumina', 'scripts');
  const scriptFiles = ['wiki.mjs', 'lint.mjs', 'reset.mjs', 'schemas.mjs', 'discover-runner.mjs', 'external-ids.mjs', 'parse-ids.mjs', 'merge-ids.mjs', 'build-source.mjs'];
  // Parallel: each copy is independent; destDir is created earlier.
  await Promise.all(scriptFiles.map(async file => {
    try {
      await atomicCopyFile(join(SCRIPTS_DIR, file), join(destDir, file));
    } catch (_) {
      // Scripts may not exist yet (P4+ work); skip gracefully
    }
  }));
  // Ensure the lib subdir once, then parallelize the file copies. The list is
  // read from the package instead of hardcoded: wiki.mjs and lint.mjs import
  // shared helpers from lib/, so a lib file missing from the workspace breaks
  // every skill at runtime — and the catch below would hide that at install
  // time. Reading the directory keeps the two in step by construction.
  const libDir = join(destDir, 'lib');
  await ensureDir(libDir);
  let libFiles = [];
  try {
    libFiles = (await readdir(join(SCRIPTS_DIR, 'lib'))).filter(f => f.endsWith('.mjs'));
  } catch (_) {
    // No lib/ in this package snapshot; nothing to copy.
  }
  await Promise.all(libFiles.map(async file => {
    try {
      await atomicCopyFile(join(SCRIPTS_DIR, 'lib', file), join(libDir, file));
    } catch (_) {
      // Script libs may not exist yet; skip gracefully
    }
  }));
}

async function copyChangelog(projectRoot) {
  const src = join(PACKAGE_ROOT, 'CHANGELOG.md');
  const dest = join(projectRoot, '_lumina', 'CHANGELOG.md');
  try {
    await atomicCopyFile(src, dest);
  } catch (_) {
    // CHANGELOG may not exist in older snapshots; skip gracefully
  }
}

// ---------------------------------------------------------------------------
// Skill ownership guard — foreign-collision protection
// ---------------------------------------------------------------------------

/**
 * Extract the frontmatter `name:` value from a SKILL.md's raw content, or
 * null when there is no frontmatter block or no `name:` key.
 *
 * @param {string} content
 * @returns {string|null}
 */
function extractSkillFrontmatterName(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;
  const frontmatter = normalized.slice(4, end);
  const match = frontmatter.match(/^name:\s*(.+)$/m);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * True when `dirPath/SKILL.md` exists and its frontmatter `name:` equals
 * `canonicalId` — the fingerprint half of `isLuminaOwnedSkillEntry`.
 *
 * @param {string} dirPath
 * @param {string} canonicalId
 * @returns {Promise<boolean>}
 */
async function skillMdNameMatches(dirPath, canonicalId) {
  let content;
  try {
    content = await readFile(join(dirPath, 'SKILL.md'), 'utf8');
  } catch (_) {
    return false;
  }
  return extractSkillFrontmatterName(content) === canonicalId;
}

/**
 * Decide whether an on-disk entry sitting at one of Lumina's own lumi-*
 * skill paths is something Lumina itself put there, vs. genuinely foreign
 * content that happens to occupy the same name.
 *
 * The on-disk fingerprint is authoritative: a symlink/junction whose
 * realpath resolves to `expectedTarget` (Lumina's own source-of-truth
 * copy), or a directory containing a SKILL.md whose frontmatter `name:`
 * equals `canonicalId`.
 *
 * There is deliberately NO manifest-membership shortcut here. A canonicalId
 * having been written into some ownership manifest in the past
 * (skills-manifest.csv, manifest.symlinkStrategies, a platform's agents
 * manifest) proves only that Lumina once installed something at this path —
 * never that what occupies the path *right now* is still that thing. A user
 * can delete a Lumina-installed skill and drop unrelated content in its
 * place without ever touching the manifest; trusting the manifest alone
 * would silently blow that content away on the next install. (An earlier
 * version of this function did exactly that — `if (recordedInManifest)
 * return true` before any fingerprint check — which meant the fingerprint
 * protection only ever fired on a skill's *first* collision; every
 * `lumi-*` id gets recorded on the very first install, so from the second
 * install onward it was an unconditional bypass. Do not reintroduce it.)
 *
 * Deliberate non-goal — do not "fix" this: a user who edits the *body* of a
 * genuine `lumi-ask` while leaving its SKILL.md frontmatter `name: lumi-ask`
 * intact still fingerprint-matches and will be overwritten on the next
 * upgrade. That is correct — it is still Lumina's skill, and refreshing it
 * is the point of an upgrade. Only content whose fingerprint doesn't match
 * (wrong/missing frontmatter name, or a symlink resolving somewhere else)
 * is protected.
 *
 * Only ever call this about a path that already exists on disk; the caller
 * is responsible for the "nothing there yet" fast path.
 *
 * @param {object} opts
 * @param {string}  opts.entryPath        - Absolute path to the existing entry.
 * @param {string}  opts.canonicalId      - The Lumina skill id expected at this path.
 * @param {string}  [opts.expectedTarget] - For symlink fingerprinting: the
 *   real directory this entry should resolve to if Lumina created it.
 * @param {(path: string) => Promise<import('node:fs').Stats>} [opts.lstatImpl] -
 *   Test seam only; production callers never pass this and always get the
 *   real `lstat`. Node's ESM named imports from built-in modules can't be
 *   intercepted by `node:test`'s `mock.method` (the module namespace object
 *   is non-configurable), so this is the only way to deterministically
 *   exercise an `lstat` failure in a test.
 * @param {(path: string) => Promise<string>} [opts.readlinkImpl] -
 *   Test seam only, same reason as `lstatImpl`.
 * @returns {Promise<boolean>}
 */
export async function isLuminaOwnedSkillEntry({ entryPath, canonicalId, expectedTarget, lstatImpl = lstat, readlinkImpl = readlink }) {
  let st;
  try {
    st = await lstatImpl(entryPath);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return true; // genuinely nothing there — no collision to protect against
    }
    // Something IS there and we could not look at it (EACCES, EPERM, EIO,
    // ...) — refusing to delete is the only safe answer. Matches the
    // discrimination fs.js's own linkDirectory already makes on the same
    // kind of lstat (`if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')
    // throw err`); this function can't re-throw (its contract is "always
    // resolve a verdict"), so the equivalent safe choice here is "foreign."
    return false;
  }

  if (st.isSymbolicLink()) {
    if (!expectedTarget) return false;
    try {
      const [current, expected] = await Promise.all([
        realpath(entryPath),
        realpath(expectedTarget),
      ]);
      return current === expected;
    } catch (_) {
      // realpath needs the WHOLE chain to exist end-to-end, including
      // `expectedTarget` itself. A link whose target has already been
      // removed — out-of-order cleanup, a corrupted install, a user who
      // deleted .agents/skills/<id> by hand — still IS Lumina's link if it
      // still points at where Lumina put it; requiring the target to
      // additionally exist right now would misjudge a perfectly legitimate,
      // if orphaned, Lumina symlink as foreign. Fall back to comparing the
      // link's own stored target path against `expectedTarget` directly —
      // pure path resolution, no existence check on either side.
      try {
        const rawTarget = await readlinkImpl(entryPath);
        const resolvedRawTarget = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(entryPath), rawTarget);
        return resolve(resolvedRawTarget) === resolve(expectedTarget);
      } catch (_) {
        return false;
      }
    }
  }

  if (st.isDirectory()) {
    return skillMdNameMatches(entryPath, canonicalId);
  }

  // A plain file (or anything else) sitting at a Lumina skill path is never
  // something Lumina itself creates — treat as foreign.
  return false;
}

/**
 * Print the standard "found content Lumina doesn't recognize" warning for a
 * foreign collision at one of Lumina's own lumi-* skill paths. Plain
 * English via colors.yellow, matching the existing non-localized
 * symlink-ladder warnings (see createSkillSymlinks) rather than the locale
 * system — this is a rare defensive-only path, not everyday installer copy.
 *
 * @param {object} colors
 * @param {string} pathLabel   - Path to show the user (relative preferred).
 * @param {string} canonicalId
 */
function warnForeignSkillEntry(colors, pathLabel, canonicalId) {
  console.log(colors.yellow(
    `  [warn] Found an existing directory at "${pathLabel}" that Lumina does not recognize as its own ` +
    `(its content doesn't match a Lumina skill). Lumina will not touch content it does not recognize ` +
    `— move or delete it yourself if you want Lumina's "${canonicalId}" skill installed there.`,
  ));
}

/**
 * Attempt to remove an already-ownership-confirmed skill entry, converting
 * a real deletion failure (permissions, a read-only mount, quota, an
 * immutable flag — or simply permissions changing between the ownership
 * check and this call) into a reported-but-non-fatal outcome instead of an
 * unhandled rejection that would abort the whole install. One unwritable
 * entry must never cost a user their whole install — the same principle a
 * foreign-collision skip already gets.
 *
 * @param {string} entryPath
 * @param {(path: string, options: object) => Promise<void>} [rmImpl] -
 *   Test seam only; production callers never pass this and always get the
 *   real `rm` (see isLuminaOwnedSkillEntry's `lstatImpl` for why a real
 *   permission fixture can't isolate a single sibling entry here either).
 * @returns {Promise<{ ok: true } | { ok: false, error: Error }>}
 */
async function removeSkillEntry(entryPath, rmImpl = rm) {
  try {
    await rmImpl(entryPath, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Print the "could not remove this" warning when a deletion that already
 * passed the ownership check still fails at the filesystem level. Distinct
 * from warnForeignSkillEntry, which covers content deliberately left alone
 * because it isn't Lumina's — this one is Lumina's own content that simply
 * couldn't be removed.
 *
 * @param {object} colors
 * @param {string} pathLabel
 * @param {string} canonicalId
 * @param {Error}  error
 */
function warnSkillDeletionFailed(colors, pathLabel, canonicalId, error) {
  console.log(colors.yellow(
    `  [warn] Could not remove "${pathLabel}" (${error?.code || error?.message || 'unknown error'}). ` +
    `Lumina left it in place — if you want Lumina's "${canonicalId}" skill installed there, fix its ` +
    `permissions (or remove it yourself) and reinstall.`,
  ));
}

export async function copySkills(projectRoot, packs, { claudeCode = false, colors = null, rmImpl = rm } = {}) {
  const skillRows = [];
  const skillDefs = getSkillDefs(packs);

  for (const skill of skillDefs) {
    // srcPackPath uses forward slashes — join handles OS differences
    const srcDir = join(SKILLS_DIR, ...skill.srcPackPath.split('/'), skill.name);
    const destDir = join(projectRoot, '.agents', 'skills', skill.canonicalId);

    await access(join(srcDir, 'SKILL.md'), fsConstants.F_OK);

    const owned = await isLuminaOwnedSkillEntry({
      entryPath: destDir,
      canonicalId: skill.canonicalId,
    });
    if (!owned) {
      if (colors) warnForeignSkillEntry(colors, join('.agents', 'skills', skill.canonicalId), skill.canonicalId);
      continue; // leave the foreign directory untouched; this skill is not installed this run
    }

    const removed = await removeSkillEntry(destDir, rmImpl);
    if (!removed.ok) {
      if (colors) warnSkillDeletionFailed(colors, join('.agents', 'skills', skill.canonicalId), skill.canonicalId, removed.error);
      continue; // could not remove existing content; skip this skill, don't abort the whole install
    }
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

// ---------------------------------------------------------------------------
// AI-agent global skill installs (CAP-8, AD-7, AD-8)
// ---------------------------------------------------------------------------

// The exact opening sentence used as the anchor for AD-7's literal injection.
// Line-anchored, prefix-compared (trim-compare in the style of
// template-engine's `line.trim() === marker`): a shipped SKILL.md may
// continue the same line with more of that paragraph (e.g.
// "...before this SKILL.md. The Repository Layout section..."), so matching
// is done against the start of the trimmed line, not full-line equality.
// Any SKILL.md whose opening does not use this exact sentence (e.g.
// lumi-hub, or skills phrased differently) is left byte-identical — this
// injection only ever substitutes this one literal anchor, never a
// template-engine render.
const LIBRARIAN_PREAMBLE_ANCHOR = 'Read `README.md` at the project root before this SKILL.md.';

/**
 * Documented global skills directory for an AI-agent platform target.
 * Based on the real OS home directory (`os.homedir()`, which honors HOME /
 * USERPROFILE overrides) — never LUMINA_HOME, which is a separate Lumina hub
 * concern (see agents-manifest.js).
 *
 * @param {string} platform - 'openclaw' | 'hermes'
 * @returns {string|null}
 */
function agentGlobalSkillsDir(platform) {
  switch (platform) {
    case 'openclaw': return join(homedir(), '.openclaw', 'skills');
    case 'hermes':   return join(homedir(), '.hermes', 'skills');
    default:         return null;
  }
}

/**
 * Substitute the literal LIBRARIAN_PREAMBLE_ANCHOR line in a copied SKILL.md
 * with the full content of the routing-preamble partial. No-op (file left
 * exactly as copied) when the anchor line is absent — this never runs the
 * file through the template engine, so any `{{...}}` placeholders the skill
 * body already contains survive untouched.
 *
 * @param {string} skillMdPath  - Path to the already-copied SKILL.md.
 * @param {string} preambleRaw  - Raw content of librarian-preamble.md.
 * @returns {Promise<void>}
 */
async function injectLibrarianPreamble(skillMdPath, preambleRaw) {
  let content;
  try {
    content = await readFile(skillMdPath, 'utf8');
  } catch (_) {
    return;
  }
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const idx = lines.findIndex(line => line.trimStart().startsWith(LIBRARIAN_PREAMBLE_ANCHOR));
  if (idx === -1) return; // e.g. lumi-hub — no anchor line, copy stands verbatim

  const line = lines[idx];
  const trimmedStart = line.trimStart();
  const leading = line.slice(0, line.length - trimmedStart.length);
  const trailing = trimmedStart.slice(LIBRARIAN_PREAMBLE_ANCHOR.length).trim();

  const preambleLines = preambleRaw
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n$/, '')
    .split('\n');

  // Any prose that continued on the same line after the anchor sentence is
  // real content (not filler) — preserve it as its own line right after the
  // preamble instead of discarding it.
  const replacement = trailing ? [...preambleLines, '', leading + trailing] : preambleLines;
  const newLines = [...lines.slice(0, idx), ...replacement, ...lines.slice(idx + 1)];
  await atomicWrite(skillMdPath, newLines.join('\n'));
}

/**
 * Install the full fixed skill set (all packs + the lumi-hub front door) into
 * one AI-agent platform's documented global skills directory. Skills-only:
 * never writes anything under a project root. Plain copy — no symlink
 * ladder (AD-7). Non-destructive: only ever creates/removes directories
 * named after our own `lumi-*` canonicalIds, tracked via the platform's
 * agents manifest (AD-2/AD-8) — any other entry in the directory is
 * untouched. A `lumi-*`-named directory is only ever a fixed canonicalId of
 * ours, but that name is still just a string — a real, unrelated directory
 * (e.g. from a different tool, or a user's own experiment) can legitimately
 * occupy it too, so each target is still checked via
 * `isLuminaOwnedSkillEntry` before anything is deleted.
 *
 * @param {string} platform      - 'openclaw' | 'hermes'
 * @param {string} preambleRaw   - Raw content of librarian-preamble.md.
 * @param {object} [colors]      - Color functions for the foreign-collision warning.
 * @returns {Promise<void>}
 */
async function copySkillsToAgentPlatform(platform, preambleRaw, colors = null, rmImpl = rm) {
  const destRoot = agentGlobalSkillsDir(platform);
  if (!destRoot) return;

  const allPackSkills = getSkillDefs(['core', 'research', 'reading', 'learning']);
  const targets = [
    ...allPackSkills.map(skill => ({
      canonicalId: skill.canonicalId,
      srcDir: join(SKILLS_DIR, ...skill.srcPackPath.split('/'), skill.name),
    })),
    { canonicalId: 'lumi-hub', srcDir: join(SKILLS_DIR, 'agents', 'hub') },
  ];

  const previousManifest = await readAgentsManifest(platform);
  const ownedBefore = new Set(previousManifest?.skills ?? []);
  const selected = new Set(targets.map(target => target.canonicalId));

  await ensureDir(destRoot);

  // Tracks only the canonicalIds actually (re)installed this run — a
  // foreign-blocked skill must never be recorded as owned, or the AD-8
  // deselection cleanup below could delete it on a later run once it's no
  // longer "selected".
  const installedIds = new Set();

  for (const { canonicalId, srcDir } of targets) {
    await access(join(srcDir, 'SKILL.md'), fsConstants.F_OK);
    const destDir = join(destRoot, canonicalId);

    const owned = await isLuminaOwnedSkillEntry({
      entryPath: destDir,
      canonicalId,
    });
    if (!owned) {
      if (colors) warnForeignSkillEntry(colors, destDir, canonicalId);
      continue; // leave the foreign directory untouched; this skill is not installed this run
    }

    const removed = await removeSkillEntry(destDir, rmImpl);
    if (!removed.ok) {
      if (colors) warnSkillDeletionFailed(colors, destDir, canonicalId, removed.error);
      continue; // could not remove existing content; skip this skill, don't abort the whole install
    }
    await ensureDir(destDir);
    await copyDir(srcDir, destDir);
    await injectLibrarianPreamble(join(destDir, 'SKILL.md'), preambleRaw);
    installedIds.add(canonicalId);
  }

  // AD-8: remove only entries we owned previously that are no longer part
  // of the (currently always-full) selection — never touch anything else.
  // `selected` is every shipped skill today, so nothing is ever in
  // `ownedBefore` but absent from it and this loop is currently unreachable
  // in practice — but that's an incidental property of how `selected` is
  // computed, not a guarantee, so it still goes through the same
  // fingerprint guard as every other deletion site rather than trusting
  // `ownedBefore` alone.
  for (const canonicalId of ownedBefore) {
    if (selected.has(canonicalId)) continue;
    const entryPath = join(destRoot, canonicalId);
    const owned = await isLuminaOwnedSkillEntry({ entryPath, canonicalId });
    if (!owned) {
      if (colors) warnForeignSkillEntry(colors, entryPath, canonicalId);
      continue;
    }
    const removed = await removeSkillEntry(entryPath, rmImpl);
    if (!removed.ok && colors) {
      warnSkillDeletionFailed(colors, entryPath, canonicalId, removed.error);
    }
  }

  await writeAgentsManifest(platform, [...installedIds]);
}

const AGENT_PLATFORM_LABELS = { openclaw: 'OpenClaw', hermes: 'Hermes Agent' };

/**
 * Plain-language next-steps notice after an AI-agent global skill install
 * (CAP-8 / platform-integration.md "Installer UX"). English source only —
 * this notice is not routed through the locale system.
 *
 * The registration step is chat-driven, not a command the user types
 * themselves: they tell the agent about a folder in conversation, and the
 * agent's own lumi-hub skill runs `lumina wikis inspect`/`add` on their
 * behalf. Don't hand the user a `lumina wikis add ...` command to type —
 * that instruction is wrong now, since nothing about it is theirs to run.
 *
 * @param {string} platform
 */
function printAgentInstallNotice(platform) {
  const label = AGENT_PLATFORM_LABELS[platform] ?? platform;
  console.log('');
  console.log(`[done] Installed Lumina skills globally for ${label}.`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open a chat with ${label} and tell it about a folder you want it to remember as a wiki — existing or brand new. It will ask a couple of quick questions and set it up for you.`);
  console.log('  2. From then on, just say which wiki you mean when you chat — it will ask if it is not sure.');
  console.log('  3. Optional: check on all your wikis any time with: lumina wikis doctor');
  console.log('');
}

// ---------------------------------------------------------------------------
// Uninstall helpers (CAP-9 / AD-8)
// ---------------------------------------------------------------------------

/**
 * Remove only the `.agents/skills/<canonicalId>` entries this install owns,
 * then remove `.agents/skills` and `.agents` themselves only if left empty.
 * Never a recursive wipe of `.agents/` — that would take any foreign skill
 * with it (the CAP-9 defect this replaces).
 *
 * Every entry is judged on its Lumina fingerprint (a directory containing a
 * SKILL.md whose frontmatter `name:` matches the lumi-* directory name it
 * sits in) via `isLuminaOwnedSkillEntry`, rather than a bare `lumi-*` name
 * prefix — a name a foreign directory could just as easily use. (By the
 * time this runs, uninstallCommand has already deleted `_lumina/` anyway,
 * so a manifest-based check would have nothing to read here regardless.)
 *
 * A deletion that fails at the filesystem level (permissions, a read-only
 * mount, ...) after passing the ownership check degrades the same way
 * every install-side delete site does: warn, leave that one entry in
 * place, and keep going — an uninstall that aborts partway leaves the user
 * in a half-removed state with no obvious way forward, which is worse than
 * one skill surviving with a warning.
 *
 * @param {string} projectRoot
 * @param {object} [colors] - Color functions for the foreign-collision/deletion-failure warning.
 * @param {(path: string, options: object) => Promise<void>} [rmImpl] - Test seam; see removeSkillEntry.
 * @returns {Promise<void>}
 */
async function removeOwnedAgentsSkills(projectRoot, colors = null, rmImpl = rm) {
  const agentsSkillsDir = join(projectRoot, '.agents', 'skills');
  const entries = (await readdir_safe(agentsSkillsDir)).filter(name => name.startsWith('lumi-'));

  for (const canonicalId of entries) {
    const entryPath = join(agentsSkillsDir, canonicalId);
    const owned = await isLuminaOwnedSkillEntry({
      entryPath,
      canonicalId,
    });
    if (!owned) {
      if (colors) warnForeignSkillEntry(colors, join('.agents', 'skills', canonicalId), canonicalId);
      continue;
    }
    const removed = await removeSkillEntry(entryPath, rmImpl);
    if (!removed.ok && colors) {
      warnSkillDeletionFailed(colors, join('.agents', 'skills', canonicalId), canonicalId, removed.error);
    }
  }

  await removeDirIfEmpty(agentsSkillsDir);
  await removeDirIfEmpty(join(projectRoot, '.agents'));
}

/**
 * Remove only the `.claude/skills/<canonicalId>` symlinks this install
 * owns. A "lumi-*" name is still just a string, not proof of ownership —
 * check each entry's on-disk fingerprint before deleting anything, so a
 * foreign directory that happens to share one of our skill names survives.
 * Same degrade-and-continue treatment as `removeOwnedAgentsSkills` for a
 * deletion that fails after passing the ownership check.
 *
 * @param {string} projectRoot
 * @param {object} [colors] - Color functions for the foreign-collision/deletion-failure warning.
 * @param {(path: string, options: object) => Promise<void>} [rmImpl] - Test seam; see removeSkillEntry.
 * @returns {Promise<void>}
 */
async function removeOwnedClaudeSkillLinks(projectRoot, colors = null, rmImpl = rm) {
  try {
    const claudeSkillsDir = join(projectRoot, '.claude', 'skills');
    const entries = await readdir_safe(claudeSkillsDir);
    for (const entry of entries) {
      if (!entry.startsWith('lumi-')) continue;
      const entryPath = join(claudeSkillsDir, entry);
      const owned = await isLuminaOwnedSkillEntry({
        entryPath,
        canonicalId: entry,
        expectedTarget: join(projectRoot, '.agents', 'skills', entry),
      });
      if (!owned) {
        if (colors) warnForeignSkillEntry(colors, join('.claude', 'skills', entry), entry);
        continue;
      }
      const removed = await removeSkillEntry(entryPath, rmImpl);
      if (!removed.ok && colors) {
        warnSkillDeletionFailed(colors, join('.claude', 'skills', entry), entry, removed.error);
      }
    }
  } catch (_) {}
}

async function removeDirIfEmpty(dirPath) {
  const entries = await readdir_safe(dirPath);
  if (entries.length === 0) {
    await rm(dirPath, { recursive: true, force: true });
  }
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

function getSkillDefs(packs) {
  const defs = [];

  if (packs.includes('core')) {
    const coreSkills = [
      { name: 'init',            canonicalId: 'lumi-init',            displayName: '/lumi-init' },
      { name: 'ingest',          canonicalId: 'lumi-ingest',          displayName: '/lumi-ingest' },
      { name: 'ask',             canonicalId: 'lumi-ask',             displayName: '/lumi-ask' },
      { name: 'edit',            canonicalId: 'lumi-edit',            displayName: '/lumi-edit' },
      { name: 'check',           canonicalId: 'lumi-check',           displayName: '/lumi-check' },
      { name: 'reset',           canonicalId: 'lumi-reset',           displayName: '/lumi-reset' },
      { name: 'verify',          canonicalId: 'lumi-verify',          displayName: '/lumi-verify' },
      { name: 'migrate-legacy',  canonicalId: 'lumi-migrate-legacy',  displayName: '/lumi-migrate-legacy' },
      { name: 'help',            canonicalId: 'lumi-help',            displayName: '/lumi-help' },
    ];
    for (const s of coreSkills) {
      defs.push({ ...s, pack: 'core', srcPackPath: 'core' });
    }
  }

  if (packs.includes('research')) {
    const researchSkills = [
      { name: 'discover', canonicalId: 'lumi-research-discover', displayName: '/lumi-research-discover' },
      { name: 'survey',   canonicalId: 'lumi-research-survey',   displayName: '/lumi-research-survey' },
      { name: 'prefill',  canonicalId: 'lumi-research-prefill',  displayName: '/lumi-research-prefill' },
      { name: 'setup',    canonicalId: 'lumi-research-setup',    displayName: '/lumi-research-setup' },
      { name: 'topic',     canonicalId: 'lumi-research-topic',     displayName: '/lumi-research-topic' },
      { name: 'rank',      canonicalId: 'lumi-research-rank',      displayName: '/lumi-research-rank' },
      { name: 'watchlist', canonicalId: 'lumi-research-watchlist', displayName: '/lumi-research-watchlist' },
      { name: 'watch-run', canonicalId: 'lumi-research-watch-run', displayName: '/lumi-research-watch-run' },
    ];
    for (const s of researchSkills) {
      defs.push({ ...s, pack: 'research', srcPackPath: 'packs/research' });
    }
  }

  if (packs.includes('reading')) {
    const readingSkills = [
      { name: 'chapter-ingest',   canonicalId: 'lumi-reading-chapter-ingest',   displayName: '/lumi-reading-chapter-ingest' },
      { name: 'character-track',  canonicalId: 'lumi-reading-character-track',  displayName: '/lumi-reading-character-track' },
      { name: 'theme-map',        canonicalId: 'lumi-reading-theme-map',        displayName: '/lumi-reading-theme-map' },
      { name: 'plot-recap',       canonicalId: 'lumi-reading-plot-recap',       displayName: '/lumi-reading-plot-recap' },
    ];
    for (const s of readingSkills) {
      defs.push({ ...s, pack: 'reading', srcPackPath: 'packs/reading' });
    }
  }

  if (packs.includes('learning')) {
    const learningSkills = [
      { name: 'reflect', canonicalId: 'lumi-learning-reflect', displayName: '/lumi-learning-reflect' },
    ];
    for (const s of learningSkills) {
      defs.push({ ...s, pack: 'learning', srcPackPath: 'packs/learning' });
    }
  }

  return defs;
}

async function copyTools(projectRoot, { research }) {
  const destDir = join(projectRoot, '_lumina', 'tools');
  const coreTools = ['extract_pdf.py', 'fetch_pdf.py', 'id_utils.py', 'verify_quotes.py'];
  const toolFiles = research ? [...coreTools, ...RESEARCH_TOOL_FILES] : coreTools;
  // Parallelize: each copy is independent and destDir already exists.
  // Sequential awaits were the main Windows cold-start regression in v1.4
  // (~30 ms per file × 14 files dominates on NTFS + Defender).
  await Promise.all(toolFiles.map(async file => {
    try {
      await atomicCopyFile(join(TOOLS_DIR, file), join(destDir, file));
    } catch (_) {
      // Tool not yet authored; skip
    }
  }));
  try {
    await atomicCopyFile(join(TOOLS_DIR, 'requirements.txt'), join(destDir, 'requirements.txt'));
  } catch (_) {
    // requirements.txt missing in dev; skip
  }
}

async function renderSchemaDocs(projectRoot, templateVars) {
  const schemaDir = join(projectRoot, '_lumina', 'schema');
  const schemaDocs = ['page-templates.md', 'cross-reference-packs.md', 'graph-packs.md', 'lumi-help.csv', 'lumi-help-runbook.md'];

  // Parallel render + atomicWrite. Each doc is independent; schemaDir is
  // already created by the dirsToCreate loop in installCommand.
  await Promise.all(schemaDocs.map(async doc => {
    const templatePath = join(TEMPLATES_DIR, '_lumina', 'schema', doc);
    const destPath = join(schemaDir, doc);
    let content;
    try {
      const raw = await readFile(templatePath, 'utf8');
      content = render(raw, templateVars);
    } catch (_) {
      content = `# ${doc}\n\n_This file is managed by the Lumina installer._\n`;
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
    const templatePath = join(TEMPLATES_DIR, '.gitignore');
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

// Exported for src/installer/wikis-command.js's `doctor --fix` (AD-6): the
// only correct way to recreate missing seed files is the installer's own
// seeding source, never a hand-written stand-in. This function already
// no-ops on any path that exists (exists→skip), so it is safe to call as a
// pure repair step.
export async function seedWikiFiles(projectRoot) {
  const indexPath = join(projectRoot, 'wiki', 'index.md');
  const logPath   = join(projectRoot, 'wiki', 'log.md');

  // Only seed if files don't exist
  try { await access(indexPath, fsConstants.F_OK); } catch (_) {
    await atomicWrite(indexPath, '# Wiki Index\n\n_This catalog is updated by /lumi-ingest and /lumi-init._\n');
  }
  try { await access(logPath, fsConstants.F_OK); } catch (_) {
    await atomicWrite(logPath, '# Wiki Log\n\n_Append-only activity log. Updated by each skill invocation._\n');
  }
}

async function createSkillSymlinks(projectRoot, skillRows, existingManifest, reLink, colors, t = null) {
  const strategies = {};
  const errors = [];
  const recordedStrategies = existingManifest?.symlinkStrategies ?? {};

  for (const skill of skillRows) {
    const target   = resolve(projectRoot, skill.relative_path);
    const linkPath = resolve(projectRoot, '.claude', 'skills', skill.canonical_id);

    const existingStrategy = reLink ? null : (recordedStrategies[skill.canonical_id] ?? null);

    try {
      const result = await linkDirectory(target, linkPath, existingStrategy, {
        isOwned: () => isLuminaOwnedSkillEntry({
          entryPath: linkPath,
          canonicalId: skill.canonical_id,
          expectedTarget: target,
        }),
      });
      if (result.warning) {
        console.log(colors.yellow(`  [warn] ${result.message}`));
      }
      if (result.foreign) {
        continue; // leave the foreign directory untouched; no strategy to record
      }
      strategies[skill.canonical_id] = result.strategy;
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

async function buildFilesManifest(projectRoot, packs, pkgVersion) {
  const managedFiles = [
    'README.md',
    '_lumina/config/lumina.config.yaml',
    '_lumina/schema/page-templates.md',
    '_lumina/schema/cross-reference-packs.md',
    '_lumina/schema/graph-packs.md',
    '_lumina/schema/lumi-help.csv',
    '_lumina/schema/lumi-help-runbook.md',
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    'QWEN.md',
    'IFLOW.md',
    '.cursor/rules/lumina.mdc',
  ];

  if (packs.includes('research')) {
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
