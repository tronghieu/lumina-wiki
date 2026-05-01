/**
 * @module installer/prompts
 * @description Interactive prompt wrapper using @clack/prompts.
 *
 * The five PRD-locked install prompts (in order):
 *   1. Project name
 *   2. Research purpose (multi-line free-form, optional)
 *   3. IDE targets (multi-select)
 *   4. Packs (multi-select; core always included)
 *   5. Language pair (communication_language, document_output_language)
 *
 * When --yes flag is active, all prompts are skipped and defaults are returned.
 * Respects NO_COLOR and TTY detection via @clack/prompts internals.
 */

import { basename } from 'node:path';

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
 * Default install answers (used with --yes).
 *
 * @param {string} [cwd]
 * @returns {InstallAnswers}
 */
export function defaultAnswers(cwd = process.cwd()) {
  return {
    projectName:          defaultProjectName(cwd),
    researchPurpose:      '',
    ideTargets:           ['claude_code'],
    packs:                ['core'],
    communicationLang:    'English',
    documentOutputLang:   'English',
  };
}

// ---------------------------------------------------------------------------
// Prompt types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} InstallAnswers
 * @property {string}   projectName
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
 * Calls process.exit(0) if the user cancels (Ctrl-C).
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.acceptDefaults=false] - Skip prompts; return defaults.
 * @param {string}  [opts.cwd]                  - Project root for defaults.
 * @returns {Promise<InstallAnswers>}
 */
export async function runInstallPrompts({ acceptDefaults = false, cwd = process.cwd() } = {}) {
  if (acceptDefaults) {
    return defaultAnswers(cwd);
  }

  const { intro, outro, text, multiselect, select, isCancel, cancel } = await getClack();

  intro('Lumina Wiki Installer');

  // ── Prompt 1: Project name ──────────────────────────────────────────────
  const projectNameRaw = await text({
    message: 'Project name',
    placeholder: defaultProjectName(cwd),
    defaultValue: defaultProjectName(cwd),
  });
  if (isCancel(projectNameRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const projectName = projectNameRaw || defaultProjectName(cwd);

  // ── Prompt 2: Research purpose (multi-line free-form, optional) ─────────
  const researchPurposeRaw = await text({
    message: 'Research purpose (optional — describe what this wiki is for)',
    placeholder: 'e.g. Track flash-attention variants for a survey',
  });
  if (isCancel(researchPurposeRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const researchPurpose = researchPurposeRaw || '';

  // ── Prompt 3: IDE targets ────────────────────────────────────────────────
  const ideTargetsRaw = await multiselect({
    message: 'IDE targets (space to toggle, enter to confirm)',
    options: [
      { value: 'claude_code', label: 'Claude Code',  hint: 'CLAUDE.md + .claude/skills/ symlinks' },
      { value: 'codex',       label: 'Codex',         hint: 'AGENTS.md stub' },
      { value: 'cursor',      label: 'Cursor',        hint: '.cursor/rules/lumina.mdc stub' },
      { value: 'gemini_cli',  label: 'Gemini CLI',    hint: 'GEMINI.md stub' },
      { value: 'generic',     label: 'Generic',       hint: 'README.md only' },
    ],
    initialValues: ['claude_code'],
    required: false,
  });
  if (isCancel(ideTargetsRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const ideTargets = Array.isArray(ideTargetsRaw) && ideTargetsRaw.length > 0
    ? ideTargetsRaw
    : ['claude_code'];

  // ── Prompt 4: Packs ──────────────────────────────────────────────────────
  const packsRaw = await multiselect({
    message: 'Packs to install (core is always included)',
    options: [
      { value: 'research', label: 'Research',  hint: 'discover/survey/prefill/setup skills + Python tools' },
      { value: 'reading',  label: 'Reading',   hint: 'chapter-ingest/character-track/theme-map/plot-recap skills' },
    ],
    required: false,
  });
  if (isCancel(packsRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const selectedPacks = Array.isArray(packsRaw) ? packsRaw : [];
  const packs = ['core', ...selectedPacks.filter(p => p !== 'core')];

  // ── Prompt 5: Language pair ──────────────────────────────────────────────
  const communicationLangRaw = await text({
    message: 'Communication language (how the LLM talks to you)',
    placeholder: 'English',
    defaultValue: 'English',
  });
  if (isCancel(communicationLangRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const communicationLang = communicationLangRaw || 'English';

  const documentOutputLangRaw = await text({
    message: 'Document output language (language wiki pages are written in)',
    placeholder: 'English',
    defaultValue: 'English',
  });
  if (isCancel(documentOutputLangRaw)) { cancel('Installation cancelled.'); process.exit(0); }
  const documentOutputLang = documentOutputLangRaw || 'English';

  return {
    projectName,
    researchPurpose,
    ideTargets,
    packs,
    communicationLang,
    documentOutputLang,
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
 * @returns {Promise<{confirmed: boolean, stripReadme: boolean}|null>}
 */
export async function runUninstallConfirm({ acceptDefaults = false } = {}) {
  if (acceptDefaults) {
    return { confirmed: true, stripReadme: false };
  }

  const { confirm, select, isCancel, cancel } = await getClack();

  const confirmed = await confirm({
    message: 'Uninstall Lumina Wiki? This will remove _lumina/, .agents/, and IDE stub files. wiki/ and raw/ are preserved.',
    initialValue: false,
  });
  if (isCancel(confirmed) || !confirmed) return null;

  const readmeAction = await select({
    message: 'What to do with README.md?',
    options: [
      { value: false, label: 'Keep README.md intact (default)', hint: 'Lumina schema region remains as plain markdown' },
      { value: true,  label: 'Strip schema region',              hint: 'Remove <!-- lumina:schema --> block; keep your content' },
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
 * @returns {Promise<'merge'|'backup'|'abort'>}
 */
export async function runReadmeMergePrompt({ acceptDefaults = false } = {}) {
  if (acceptDefaults) return 'merge';

  const { select, isCancel } = await getClack();

  const action = await select({
    message: 'README.md already exists. How should Lumina handle the schema region?',
    options: [
      { value: 'merge',  label: 'Merge schema content', hint: 'Rewrite only <!-- lumina:schema --> region; preserve everything else' },
      { value: 'backup', label: 'Back up and replace',  hint: 'Save current README.md.bak, write fresh README.md' },
      { value: 'abort',  label: 'Abort install',        hint: 'Exit without changes' },
    ],
    initialValue: 'merge',
  });
  if (isCancel(action)) return 'abort';
  return action;
}
