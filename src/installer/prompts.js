/**
 * @module installer/prompts
 * @description Interactive prompt wrapper using @clack/prompts.
 *
 * Install prompts (in order):
 *   1. Installation directory (default: process.cwd())
 *   2. Research purpose (multi-line free-form, optional)
 *   3. IDE targets (multi-select)
 *   4. Packs (multi-select; core always included)
 *   5. Language pair (communication_language, document_output_language)
 *
 * `project_name` is auto-derived as `basename(directory)` — not prompted.
 *
 * When --yes flag is active, all prompts are skipped and defaults are returned.
 * Respects NO_COLOR and TTY detection via @clack/prompts internals.
 *
 * All user-facing strings are provided via the `t` function (locale module).
 * When `t` is not supplied, falls back to EN literal strings — this only
 * happens in tests or pre-locale bootstrap contexts.
 */

import { basename, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';

// Lazy-load @clack/prompts to keep cold-start under 300ms
let clack;
async function getClack() {
  if (!clack) {
    clack = await import('@clack/prompts');
  }
  return clack;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

/**
 * Derive default project name from the current working directory.
 *
 * @param {string} [cwd] - Project root directory path.
 * @returns {string}
 */
export function defaultProjectName(cwd = process.cwd()) {
  return basename(cwd) || 'my-wiki';
}

/**
 * Expand a user-typed path: trim, expand leading `~`, resolve to absolute.
 * Empty input falls back to `fallback`.
 *
 * @param {string} raw
 * @param {string} fallback
 * @returns {string}
 */
export function expandUserPath(raw, fallback) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return fallback;
  let expanded = trimmed;
  if (expanded === '~') expanded = homedir();
  else if (expanded.startsWith('~/')) expanded = `${homedir()}/${expanded.slice(2)}`;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Hardcoded native-name labels for the locale prompt and cascade defaults
 * for communication / document-output language fields.
 */
export const LOCALE_LANGUAGE_NAME = Object.freeze({
  en: 'English',
  vi: 'Vietnamese',
  zh: 'Chinese',
});

export const LOCALE_LABELS = Object.freeze([
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '中文' },
]);

/**
 * Default install answers (used with --yes).
 *
 * @param {string} [cwd]
 * @param {'en'|'vi'|'zh'} [locale='en']
 * @returns {InstallAnswers}
 */
export function defaultAnswers(cwd = process.cwd(), locale = 'en') {
  const directory = resolve(cwd);
  const langName = LOCALE_LANGUAGE_NAME[locale] ?? 'English';
  return {
    directory,
    projectName:          defaultProjectName(directory),
    researchPurpose:      '',
    ideTargets:           ['claude_code'],
    packs:                ['core'],
    communicationLang:    langName,
    documentOutputLang:   langName,
    locale,
  };
}

/**
 * Pure helper: returns the ordered list of prompt-config descriptors that
 * `runInstallPrompts` will iterate. Does NOT call @clack — usable from tests.
 *
 * @param {object|null} existingManifest
 * @param {'en'|'vi'|'zh'} defaultLocale
 * @returns {{id: string, type: string}[]}
 */
export function buildPromptList(existingManifest, defaultLocale = 'en') {
  const locale = existingManifest?.locale ?? defaultLocale;
  return [
    { id: 'locale',             type: 'select',      defaultValue: locale },
    { id: 'directory',          type: 'text' },
    { id: 'researchPurpose',    type: 'text' },
    { id: 'ideTargets',         type: 'multiselect' },
    { id: 'packs',              type: 'multiselect' },
    { id: 'communicationLang',  type: 'text',        defaultValue: LOCALE_LANGUAGE_NAME[locale] ?? 'English' },
    { id: 'documentOutputLang', type: 'text',        defaultValue: LOCALE_LANGUAGE_NAME[locale] ?? 'English' },
  ];
}

// ---------------------------------------------------------------------------
// Prompt types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} InstallAnswers
 * @property {string}   directory       — absolute install path
 * @property {string}   projectName     — auto-derived from basename(directory)
 * @property {string}   researchPurpose
 * @property {string[]} ideTargets
 * @property {string[]} packs
 * @property {string}   communicationLang
 * @property {string}   documentOutputLang
 */

// ---------------------------------------------------------------------------
// runInstallPrompts
// ---------------------------------------------------------------------------

/**
 * Run the five interactive install prompts.
 * Returns default answers immediately when `acceptDefaults` is true (--yes mode).
 * Calls process.exit(4) if the user cancels (Ctrl-C) or declines a confirm prompt.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.acceptDefaults=false] - Skip prompts; return defaults.
 * @param {string}  [opts.cwd]                  - Project root for defaults.
 * @param {Function} [opts.t]                   - Locale translator function.
 * @returns {Promise<InstallAnswers>}
 */
export async function runInstallPrompts({ acceptDefaults = false, cwd = process.cwd(), existingManifest = null, defaultLocale = 'en', t: initialT = null } = {}) {
  if (acceptDefaults) {
    const loc = existingManifest?.locale ?? defaultLocale;
    return defaultAnswers(cwd, loc);
  }

  const { intro, outro, text, multiselect, select, confirm, isCancel, cancel } = await getClack();

  // t starts as whatever the caller passed (may be null on fresh install where
  // locale is unknown). After Prompt 0 selects the locale, we rebind t to the
  // user-chosen locale so prompts 1-5 are localized.
  let t = initialT;

  // t may not be available yet at intro time (locale not yet selected);
  // use hardcoded EN for intro — this is the chicken-and-egg prompt.
  intro('Lumina Wiki Installer');

  // ── Prompt 0: Locale (UI language) ───────────────────────────────────────
  const initialLocale = existingManifest?.locale ?? defaultLocale;
  const localeRaw = await select({
    // Locale selector uses a trilingual label; not routed through t() by design
    message: 'Installer language / Ngôn ngữ / 语言',
    options: [...LOCALE_LABELS],
    initialValue: initialLocale,
  });
  if (isCancel(localeRaw)) {
    // t may be EN or may not be loaded yet — use cancel string from t if available
    cancel(t ? t('prompt.cancelled') : 'Installation cancelled.');
    process.exit(4);
  }
  const locale = localeRaw;
  const langDefault = LOCALE_LANGUAGE_NAME[locale] ?? 'English';

  // Rebind t to the just-selected locale so the remaining prompts render in
  // the user's chosen language. Without this, prompts 1-5 silently fall back
  // to EN literals even when the user picked vi/zh at Prompt 0.
  try {
    const { loadLocale } = await import('./locales.js');
    const localeMod = await loadLocale(locale);
    t = localeMod.t;
  } catch {
    // Keep whatever t we had (possibly null → EN literals); never block install.
  }

  // Interactive locale-switch confirmation (Phase 5 §60-63):
  // If user picks a locale different from the installed one on an upgrade,
  // require explicit confirmation before destructively rewriting README.md
  // and IDE stubs. Default N — protects user content.
  if (existingManifest?.locale && existingManifest.locale !== locale) {
    const proceed = await confirm({
      // Use trilingual literal — user is mid-switch, so both old and new
      // locales are relevant context. t() is available here but intentionally
      // not used so the warning is legible in either locale.
      message: `Locale change ${existingManifest.locale} -> ${locale} will rewrite README.md and IDE stubs in the new locale. Outside-schema edits are preserved. Continue?`,
      initialValue: false,
    });
    if (isCancel(proceed) || !proceed) {
      cancel(t ? t('prompt.cancelled') : 'Installation cancelled.');
      process.exit(4);
    }
  }

  // ── Prompt 1: Installation directory ─────────────────────────────────────
  const cwdAbs = resolve(cwd);
  const directoryRaw = await text({
    message: t ? t('prompt.directory.message') : 'Installation directory',
    placeholder: cwdAbs,
    defaultValue: cwdAbs,
  });
  if (isCancel(directoryRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const directory = expandUserPath(directoryRaw, cwdAbs);
  const projectName = defaultProjectName(directory);

  // ── Prompt 2: Research purpose (multi-line free-form, optional) ─────────
  const researchPurposeRaw = await text({
    message: t ? t('prompt.purpose.message') : 'Research purpose (optional — describe what this wiki is for)',
    placeholder: t ? t('prompt.purpose.placeholder') : 'e.g. Track flash-attention variants for a survey',
  });
  if (isCancel(researchPurposeRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const researchPurpose = researchPurposeRaw || '';

  // ── Prompt 3: IDE targets ────────────────────────────────────────────────
  const ideTargetsRaw = await multiselect({
    message: t ? t('prompt.ide.message') : 'IDE targets (space to toggle, enter to confirm)',
    options: [
      { value: 'claude_code', label: t ? t('prompt.ide.option.claude_code.label') : 'Claude Code',             hint: t ? t('prompt.ide.option.claude_code.hint') : 'CLAUDE.md + .claude/skills/ symlinks' },
      { value: 'codex',       label: t ? t('prompt.ide.option.codex.label') : 'OpenAI CodexApp (ChatGPT)',     hint: t ? t('prompt.ide.option.codex.hint') : 'CodexApp, Amp, Crush, Goose, Auggie, OpenCode, Kimi, Mistral Vibe — writes AGENTS.md' },
      { value: 'gemini_cli',  label: t ? t('prompt.ide.option.gemini_cli.label') : 'Gemini CLI',               hint: t ? t('prompt.ide.option.gemini_cli.hint') : 'GEMINI.md stub' },
      { value: 'qwen',        label: t ? t('prompt.ide.option.qwen.label') : 'Qwen Code',                      hint: t ? t('prompt.ide.option.qwen.hint') : 'QWEN.md stub' },
      { value: 'iflow',       label: t ? t('prompt.ide.option.iflow.label') : 'iFlow CLI',                     hint: t ? t('prompt.ide.option.iflow.hint') : 'IFLOW.md stub' },
      { value: 'cursor',      label: t ? t('prompt.ide.option.cursor.label') : 'Cursor',                       hint: t ? t('prompt.ide.option.cursor.hint') : '.cursor/rules/lumina.mdc stub' },
      { value: 'generic',     label: t ? t('prompt.ide.option.generic.label') : 'Generic',                     hint: t ? t('prompt.ide.option.generic.hint') : 'README.md only' },
    ],
    initialValues: ['claude_code'],
    required: false,
  });
  if (isCancel(ideTargetsRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const ideTargets = Array.isArray(ideTargetsRaw) && ideTargetsRaw.length > 0
    ? ideTargetsRaw
    : ['claude_code'];

  // ── Prompt 4: Packs ──────────────────────────────────────────────────────
  const packsRaw = await multiselect({
    message: t ? t('prompt.packs.message') : 'Packs to install (core is always included)',
    options: [
      { value: 'research', label: t ? t('prompt.packs.option.research.label') : 'Research', hint: t ? t('prompt.packs.option.research.hint') : 'discover/survey/prefill/setup skills + source-fetcher tools' },
      { value: 'reading',  label: t ? t('prompt.packs.option.reading.label') : 'Reading',   hint: t ? t('prompt.packs.option.reading.hint') : 'chapter-ingest/character-track/theme-map/plot-recap skills' },
    ],
    required: false,
  });
  if (isCancel(packsRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const selectedPacks = Array.isArray(packsRaw) ? packsRaw : [];
  const packs = ['core', ...selectedPacks.filter(p => p !== 'core')];

  // ── Prompt 5: Language pair ──────────────────────────────────────────────
  const communicationLangRaw = await text({
    message: t ? t('prompt.communication_language.message') : 'Communication language (how the LLM talks to you)',
    placeholder: langDefault,
    defaultValue: langDefault,
  });
  if (isCancel(communicationLangRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const communicationLang = communicationLangRaw || langDefault;

  const documentOutputLangRaw = await text({
    message: t ? t('prompt.document_output_language.message') : 'Document output language (language wiki pages are written in)',
    placeholder: langDefault,
    defaultValue: langDefault,
  });
  if (isCancel(documentOutputLangRaw)) { cancel(t ? t('prompt.cancelled') : 'Installation cancelled.'); process.exit(4); }
  const documentOutputLang = documentOutputLangRaw || langDefault;

  return {
    directory,
    projectName,
    researchPurpose,
    ideTargets,
    packs,
    communicationLang,
    documentOutputLang,
    locale,
  };
}

// ---------------------------------------------------------------------------
// runUninstallConfirm
// ---------------------------------------------------------------------------

/**
 * Prompt user to confirm uninstall and choose README handling.
 * Returns null if cancelled.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.acceptDefaults=false]
 * @param {Function} [opts.t]  - Locale translator function.
 * @returns {Promise<{confirmed: boolean, stripReadme: boolean}|null>}
 */
export async function runUninstallConfirm({ acceptDefaults = false, t = null } = {}) {
  if (acceptDefaults) {
    return { confirmed: true, stripReadme: false };
  }

  const { confirm, select, isCancel, cancel } = await getClack();

  const confirmed = await confirm({
    message: t
      ? t('prompt.uninstall.confirm')
      : 'Uninstall Lumina Wiki? This will remove _lumina/, .agents/, and IDE stub files. wiki/ and raw/ are preserved.',
    initialValue: false,
  });
  if (isCancel(confirmed) || !confirmed) return null;

  const readmeAction = await select({
    message: t ? t('prompt.uninstall.readme.message') : 'What to do with README.md?',
    options: [
      {
        value: false,
        label: t ? t('prompt.uninstall.readme.option.keep.label') : 'Keep README.md intact (default)',
        hint:  t ? t('prompt.uninstall.readme.option.keep.hint') : 'Lumina schema region remains as plain markdown',
      },
      {
        value: true,
        label: t ? t('prompt.uninstall.readme.option.strip.label') : 'Strip schema region',
        hint:  t ? t('prompt.uninstall.readme.option.strip.hint') : 'Remove <!-- lumina:schema --> block; keep your content',
      },
    ],
    initialValue: false,
  });
  if (isCancel(readmeAction)) return null;

  return { confirmed: true, stripReadme: Boolean(readmeAction) };
}

// ---------------------------------------------------------------------------
// runReadmeMergePrompt
// ---------------------------------------------------------------------------

/**
 * Prompt user how to handle an existing README.md during upgrade.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.acceptDefaults=false]
 * @param {Function} [opts.t]  - Locale translator function.
 * @returns {Promise<'merge'|'backup'|'abort'>}
 */
export async function runReadmeMergePrompt({ acceptDefaults = false, t = null } = {}) {
  if (acceptDefaults) return 'merge';

  const { select, isCancel } = await getClack();

  const action = await select({
    message: t
      ? t('prompt.readme_merge.message')
      : 'README.md already exists. How should Lumina handle the schema region?',
    options: [
      {
        value: 'merge',
        label: t ? t('prompt.readme_merge.option.merge.label') : 'Merge schema content',
        hint:  t ? t('prompt.readme_merge.option.merge.hint') : 'Rewrite only <!-- lumina:schema --> region; preserve everything else',
      },
      {
        value: 'backup',
        label: t ? t('prompt.readme_merge.option.backup.label') : 'Back up and replace',
        hint:  t ? t('prompt.readme_merge.option.backup.hint') : 'Save current README.md.bak, write fresh README.md',
      },
      {
        value: 'abort',
        label: t ? t('prompt.readme_merge.option.abort.label') : 'Abort install',
        hint:  t ? t('prompt.readme_merge.option.abort.hint') : 'Exit without changes',
      },
    ],
    initialValue: 'merge',
  });
  if (isCancel(action)) return 'abort';
  return action;
}
