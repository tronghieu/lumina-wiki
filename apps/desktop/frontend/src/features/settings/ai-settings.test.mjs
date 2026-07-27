import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consentRequired,
  credentialTargets,
  credentialStatusLabel,
  normalizeSettings,
  settingsSectionTransition,
  settingsForSession,
  toProfileRequest,
} from './ai-settings.ts';

const chat = {
  schemaVersion: 1,
  id: 'chat-main',
  role: 'chat',
  kind: 'openai',
  label: 'Chat',
  model: 'gpt',
  baseUrl: 'https://api.example.com',
  credentialRef: 'provider:main',
  timeoutMs: 30_000,
  maxInputChars: 10_000,
  maxHistoryChars: 20_000,
  maxEvidenceChars: 30_000,
  maxOutputTokens: 1_000,
};

describe('ai-settings', () => {
  it('disables semantic mode when settings belong to another workspace session', () => {
    const settings = {
      ...normalizeSettings({
        chat,
        embedding: { ...chat, id: 'embed-main', role: 'embedding', dimensions: 768 },
      }),
      semanticEnabled: true,
    };

    assert.equal(settingsForSession(settings, 'session-a:1', 'session-b:2').semanticEnabled, false);
    assert.equal(settingsForSession(settings, 'session-a:1', 'session-a:1'), settings);
  });

  it('clears an ephemeral secret whenever the credential role changes', () => {
    assert.deepEqual(settingsSectionTransition('embedding'), {
      section: 'embedding',
      secret: '',
    });
  });

  it('keeps chat and embedding credential lookups independent', () => {
    const settings = normalizeSettings({
      chat,
      embedding: {
        ...chat,
        id: 'embed-main',
        role: 'embedding',
        credentialRef: 'provider:embedding',
        dimensions: 768,
      },
    });

    assert.deepEqual(credentialTargets(settings), [
      { role: 'chat', credentialRef: 'provider:main' },
      { role: 'embedding', credentialRef: 'provider:embedding' },
    ]);
  });

  it('keeps chat and embedding profiles independent', () => {
    const settings = normalizeSettings({
      chat,
      embedding: { ...chat, id: 'embed-main', role: 'embedding', model: 'embed', dimensions: 768 },
    });
    assert.equal(settings.chat.model, 'gpt');
    assert.equal(settings.embedding.model, 'embed');
    assert.equal(settings.embedding.dimensions, 768);
  });

  it('defaults semantic mode off when no embedding profile exists', () => {
    const settings = normalizeSettings({ chat });
    assert.equal(settings.semanticEnabled, false);
    assert.equal(settings.embedding, null);
  });

  it('keeps semantic mode off until matching disclosure consent is confirmed', () => {
    const settings = normalizeSettings({
      chat,
      embedding: { ...chat, id: 'embed-main', role: 'embedding', dimensions: 768 },
    });
    assert.equal(settings.semanticEnabled, false);
  });

  it('never serializes credential secret text into a profile request', () => {
    const request = toProfileRequest({ ...normalizeSettings({ chat }).chat, secret: 'do-not-copy' });
    const { schemaVersion: _, ...expected } = chat;
    assert.equal('secret' in request, false);
    assert.deepEqual(request, expected);
  });

  it('maps only stable credential statuses to user-facing labels', () => {
    assert.equal(credentialStatusLabel('persisted'), 'Stored securely');
    assert.equal(credentialStatusLabel('session_only'), 'Available for this session');
    assert.equal(credentialStatusLabel('locked'), 'System credential store is locked');
    assert.equal(credentialStatusLabel('unknown-private-value'), 'Credential status unavailable');
  });

  it('requires matching profile, disclosure, kind, and granted state', () => {
    const profile = { id: 'embed-main', kind: 'openai' };
    assert.equal(consentRequired(profile, null), true);
    assert.equal(consentRequired(profile, {
      profileId: 'embed-main',
      kind: 'remote_text',
      disclosureVersion: 1,
      granted: true,
    }), false);
    assert.equal(consentRequired(profile, {
      profileId: 'other',
      kind: 'remote_text',
      disclosureVersion: 1,
      granted: true,
    }), true);
    assert.equal(consentRequired(profile, {
      profileId: 'embed-main',
      kind: 'remote_text',
      disclosureVersion: 1,
      granted: false,
    }), true);
  });
});
