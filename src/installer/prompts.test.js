import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptList, defaultAnswers, LOCALE_LANGUAGE_NAME, LOCALE_LABELS } from './prompts.js';

test('buildPromptList: locale is FIRST prompt', () => {
  const list = buildPromptList(null, 'en');
  assert.equal(list[0].id, 'locale');
});

test('buildPromptList: ordering is locale, directory, researchPurpose, ideTargets, packs, communicationLang, documentOutputLang', () => {
  const list = buildPromptList(null, 'en');
  const ids = list.map(p => p.id);
  assert.deepEqual(ids, [
    'locale', 'directory', 'researchPurpose', 'ideTargets',
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
