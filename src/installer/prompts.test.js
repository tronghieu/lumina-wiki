import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPromptList,
  defaultAnswers,
  LOCALE_LANGUAGE_NAME,
  LOCALE_LABELS,
  runInstallPrompts,
  runUpgradeModePrompt,
  runLocaleOnlyPrompt,
  runProjectModePrompt,
  runProjectTargetsPrompt,
  runProjectUninstallConfirm,
  runProjectUninstallFactsPrompt,
} from './prompts.js';

test('buildPromptList: locale is FIRST prompt', () => {
  const list = buildPromptList(null, 'en');
  assert.equal(list[0].id, 'locale');
});

test('buildPromptList: ordering is locale, directory, researchPurpose, ideTargets, agentTargets, packs, communicationLang, documentOutputLang', () => {
  const list = buildPromptList(null, 'en');
  const ids = list.map(p => p.id);
  assert.deepEqual(ids, [
    'locale', 'directory', 'researchPurpose', 'ideTargets', 'agentTargets',
    'packs', 'communicationLang', 'documentOutputLang',
  ]);
});

test('buildPromptList: cascade default reflects chosen locale', () => {
  const list = buildPromptList(null, 'vi');
  const comm = list.find(p => p.id === 'communicationLang');
  assert.equal(comm.defaultValue, 'Vietnamese');
});

test('buildPromptList: existing manifest locale used as default', () => {
  const list = buildPromptList({ locale: 'zh' }, 'en');
  const localePrompt = list.find(p => p.id === 'locale');
  assert.equal(localePrompt.defaultValue, 'zh');
});

test('LOCALE_LABELS hardcoded native names', () => {
  const map = Object.fromEntries(LOCALE_LABELS.map(o => [o.value, o.label]));
  assert.equal(map.en, 'English');
  assert.equal(map.vi, 'Tiếng Việt');
  assert.equal(map.zh, '中文');
});

test('LOCALE_LANGUAGE_NAME maps each locale', () => {
  assert.equal(LOCALE_LANGUAGE_NAME.en, 'English');
  assert.equal(LOCALE_LANGUAGE_NAME.vi, 'Vietnamese');
  assert.equal(LOCALE_LANGUAGE_NAME.zh, 'Chinese');
});

test('defaultAnswers cascades locale to language fields', () => {
  const a = defaultAnswers(undefined, 'vi');
  assert.equal(a.locale, 'vi');
  assert.equal(a.communicationLang, 'Vietnamese');
  assert.equal(a.documentOutputLang, 'Vietnamese');
});

test('defaultAnswers default locale en', () => {
  const a = defaultAnswers();
  assert.equal(a.locale, 'en');
  assert.equal(a.communicationLang, 'English');
});

// ── Upgrade menu (BMAD-style) ────────────────────────────────────────────────

test('runInstallPrompts acceptDefaults=true still returns defaults (regression: modifyAnswers must not short-circuit this)', async () => {
  const a = await runInstallPrompts({ acceptDefaults: true, cwd: '/tmp/some-project', defaultLocale: 'vi' });
  assert.equal(a.locale, 'vi');
  assert.deepEqual(a.packs, ['core']);
  assert.deepEqual(a.ideTargets, ['claude_code']);
  assert.equal(a.communicationLang, 'Vietnamese');
  assert.equal(a.documentOutputLang, 'Vietnamese');
});

test('runUpgradeModePrompt is exported as a function', () => {
  // Cannot drive it end-to-end without mocking @clack/prompts (no such
  // harness exists in this suite yet) — this guards against the export
  // being accidentally removed or renamed.
  assert.equal(typeof runUpgradeModePrompt, 'function');
});

// ── Project mode prompts (spec-project-docs-overlay, story 7) ──────────────
// The interactive branch of each of these (what options a TTY session would
// see) can't be driven without mocking @clack/prompts, same limitation as
// runUpgradeModePrompt above. The acceptDefaults=true branch is real
// production code (the --yes path), so it's tested directly here.

test('runProjectModePrompt acceptDefaults=true resolves to classic without prompting', async () => {
  const mode = await runProjectModePrompt({ acceptDefaults: true });
  assert.equal(mode, 'classic');
});

test('runProjectTargetsPrompt acceptDefaults=true resolves to claude_code without prompting', async () => {
  const targets = await runProjectTargetsPrompt({ acceptDefaults: true });
  assert.deepEqual(targets, ['claude_code']);
});

test('runProjectUninstallConfirm acceptDefaults=true confirms without prompting', async () => {
  const confirmed = await runProjectUninstallConfirm({ acceptDefaults: true });
  assert.equal(confirmed, true);
});

test('runProjectUninstallFactsPrompt acceptDefaults=true defaults to No (facts/config prompt would default to No interactively too)', async () => {
  const proceed = await runProjectUninstallFactsPrompt({ acceptDefaults: true });
  assert.equal(proceed, false);
});

test('runLocaleOnlyPrompt acceptDefaults=true returns the given initialLocale', async () => {
  const locale = await runLocaleOnlyPrompt({ acceptDefaults: true, initialLocale: 'vi' });
  assert.equal(locale, 'vi');
});
