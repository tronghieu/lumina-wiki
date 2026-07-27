import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EmbeddingConsentResultDTO,
  IndexStatusDTO,
  SessionReferenceDTO,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import {
  consentRequired,
  credentialTargets,
  normalizeSettings,
  settingsSectionTransition,
  toProfileRequest,
  type AIProfile,
  type SettingsViewModel,
} from './ai-settings';
import { settingsGateway, type SettingsGateway } from './settings-gateway';
import { createSessionRequestGuard } from '../shared/session-request-guard';

export function useAISettingsController(
  session: SessionReferenceDTO | null,
  onProfilesChange: (settings: SettingsViewModel) => void,
  gateway: SettingsGateway = settingsGateway,
) {
  const requestGuard = useMemo(createSessionRequestGuard, []);
  const sessionKey = requestGuard.setSession(session);
  const [settings, setSettings] = useState<SettingsViewModel>(() => normalizeSettings({}));
  const [settingsSessionKey, setSettingsSessionKey] = useState(sessionKey);
  const [section, setSection] = useState<'chat' | 'embedding'>('chat');
  const [secret, setSecret] = useState('');
  const [credentialStatuses, setCredentialStatuses] = useState({
    chat: 'missing',
    embedding: 'missing',
  });
  const [consent, setConsent] = useState<EmbeddingConsentResultDTO | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatusDTO | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const visibleSettings = settingsSessionKey === sessionKey
    ? settings
    : { ...settings, semanticEnabled: false };
  const profile = section === 'chat' ? visibleSettings.chat : visibleSettings.embedding;
  const credentialStatus = credentialStatuses[section];

  const refresh = useCallback(async () => {
    const requestToken = requestGuard.begin();
    setBusy('loading');
    setMessage('');
    try {
      const loaded = normalizeSettings(await gateway.listProfiles());
      if (!requestGuard.isCurrent(requestToken)) return;
      setSettings(loaded);
      setSettingsSessionKey(sessionKey);
      setConsent(null);
      setIndexStatus(null);
      onProfilesChange(loaded);
      const statusEntries = await Promise.all(credentialTargets(loaded).map(async (target) => [
        target.role,
        (await gateway.credentialStatus({ credentialRef: target.credentialRef })).status,
      ] as const));
      if (!requestGuard.isCurrent(requestToken)) return;
      setCredentialStatuses({
        chat: statusEntries.find(([role]) => role === 'chat')?.[1] ?? 'missing',
        embedding: statusEntries.find(([role]) => role === 'embedding')?.[1] ?? 'missing',
      });
      if (session && loaded.embedding) {
        const request = { session, embeddingProfileId: loaded.embedding.id };
        const [nextConsent, nextIndex] = await Promise.all([
          gateway.embeddingConsentStatus(request),
          gateway.indexStatus(request),
        ]);
        if (!requestGuard.isCurrent(requestToken)) return;
        setConsent(nextConsent);
        setIndexStatus(nextIndex);
        const nextSettings = {
          ...loaded,
          semanticEnabled: !consentRequired(loaded.embedding, nextConsent),
        };
        setSettings(nextSettings);
        onProfilesChange(nextSettings);
      }
    } catch {
      if (requestGuard.isCurrent(requestToken)) setMessage('AI settings are unavailable.');
    } finally {
      if (requestGuard.isCurrent(requestToken)) setBusy('');
    }
  }, [gateway, onProfilesChange, requestGuard, session, sessionKey]);

  useEffect(() => {
    void refresh();
    return () => setSecret('');
  }, [refresh]);

  async function saveProfile() {
    if (!profile) return;
    const requestToken = requestGuard.begin();
    setBusy('profile');
    setMessage('');
    try {
      await gateway.saveProfile(toProfileRequest(profile));
      if (!requestGuard.isCurrent(requestToken)) return;
      setMessage(`${section === 'chat' ? 'Chat' : 'Search'} profile saved.`);
      await refresh();
    } catch {
      if (requestGuard.isCurrent(requestToken)) setMessage('Profile could not be saved.');
    } finally {
      if (requestGuard.isCurrent(requestToken)) setBusy('');
    }
  }

  async function saveCredential() {
    const credentialRef = profile?.credentialRef?.trim();
    if (!credentialRef || !secret) return;
    setBusy('credential');
    setMessage('');
    try {
      const result = await gateway.saveCredential({ credentialRef, secret });
      if (result.disposition === 'session_confirmation_required' && result.challenge) {
        const confirmed = await gateway.confirmSessionCredential({ nonce: result.challenge.nonce, secret });
        setCredentialStatuses((current) => ({ ...current, [section]: confirmed.status }));
      } else {
        setCredentialStatuses((current) => ({ ...current, [section]: 'persisted' }));
      }
      setMessage('Credential saved.');
    } catch {
      setMessage('Credential could not be saved.');
    } finally {
      setSecret('');
      setBusy('');
    }
  }

  async function removeCredential() {
    const credentialRef = profile?.credentialRef?.trim();
    if (!credentialRef) return;
    setBusy('credential');
    try {
      const result = await gateway.deleteCredential({ credentialRef });
      setCredentialStatuses((current) => ({ ...current, [section]: result.status }));
      setMessage(result.deleted ? 'Credential removed.' : 'Credential was not present.');
    } catch {
      setMessage('Credential could not be removed.');
    } finally {
      setSecret('');
      setBusy('');
    }
  }

  async function updateConsent(grant: boolean) {
    if (!session || !settings.embedding) return;
    const requestToken = requestGuard.begin();
    const request = { session, embeddingProfileId: settings.embedding.id };
    setBusy('consent');
    try {
      const next = grant
        ? await gateway.grantEmbeddingConsent(request)
        : await gateway.revokeEmbeddingConsent(request);
      if (!requestGuard.isCurrent(requestToken)) return;
      setConsent(next);
      const nextSettings = { ...settings, semanticEnabled: next.granted };
      setSettings(nextSettings);
      setSettingsSessionKey(sessionKey);
      onProfilesChange(nextSettings);
      setMessage(next.granted ? 'Semantic disclosure accepted.' : 'Semantic disclosure revoked.');
    } catch {
      if (requestGuard.isCurrent(requestToken)) setMessage('Semantic consent could not be changed.');
    } finally {
      if (requestGuard.isCurrent(requestToken)) setBusy('');
    }
  }

  async function changeIndex(action: 'build' | 'cancel' | 'clear') {
    if (!session || !settings.embedding) return;
    const requestToken = requestGuard.begin();
    const request = { session, embeddingProfileId: settings.embedding.id };
    setBusy('index');
    try {
      if (action === 'cancel') {
        await gateway.cancelIndex(request);
      } else {
        const nextIndex = action === 'build' ? await gateway.buildIndex(request) : await gateway.clearIndex(request);
        if (requestGuard.isCurrent(requestToken)) setIndexStatus(nextIndex);
      }
      if (!requestGuard.isCurrent(requestToken)) return;
      setMessage(`Index ${action} request completed.`);
    } catch {
      if (requestGuard.isCurrent(requestToken)) {
        setMessage(`Index ${action} request failed. Workspace text search remains available.`);
      }
    } finally {
      if (requestGuard.isCurrent(requestToken)) setBusy('');
    }
  }

  function enableSemantic(enabled: boolean) {
    const embedding = enabled ? settings.embedding ?? newEmbeddingProfile(settings.chat) : settings.embedding;
    const nextSettings = { ...settings, semanticEnabled: enabled, embedding };
    const currentConsent = settingsSessionKey === sessionKey ? consent : null;
    const appSettings = {
      ...nextSettings,
      semanticEnabled: Boolean(enabled && embedding && !consentRequired(embedding, currentConsent)),
    };
    setSettings(nextSettings);
    setSettingsSessionKey(sessionKey);
    onProfilesChange(appSettings);
  }

  function updateProfile(field: keyof AIProfile, value: string | number) {
    setSettings((current) => {
      if (section === 'chat') return { ...current, chat: { ...current.chat, [field]: value } };
      return current.embedding
        ? { ...current, embedding: { ...current.embedding, [field]: value } }
        : current;
    });
  }

  function selectSection(next: 'chat' | 'embedding') {
    const transition = settingsSectionTransition(next);
    setSecret(transition.secret);
    setSection(transition.section);
  }

  return {
    busy,
    changeIndex,
    consent: settingsSessionKey === sessionKey ? consent : null,
    credentialStatus,
    enableSemantic,
    indexStatus: settingsSessionKey === sessionKey ? indexStatus : null,
    message,
    profile,
    removeCredential,
    saveCredential,
    saveProfile,
    secret,
    section,
    setSecret,
    setSection: selectSection,
    settings: visibleSettings,
    updateConsent,
    updateProfile,
  };
}

function newEmbeddingProfile(chat: AIProfile): AIProfile {
  return {
    ...chat,
    id: 'embedding-main',
    role: 'embedding',
    label: 'Semantic search',
    model: '',
    dimensions: 0,
    maxHistoryChars: 0,
    maxEvidenceChars: 0,
    maxOutputTokens: 1,
  };
}
