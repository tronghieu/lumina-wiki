export type AIProfile = {
  schemaVersion: number;
  id: string;
  role: 'chat' | 'embedding';
  kind: string;
  label: string;
  model: string;
  baseUrl: string;
  credentialRef?: string;
  timeoutMs: number;
  maxInputChars: number;
  maxHistoryChars: number;
  maxEvidenceChars: number;
  maxOutputTokens: number;
  dimensions?: number;
};

type AIProfileInput = Omit<AIProfile, 'role'> & { role: string };

export type AIProfiles = {
  chat?: AIProfileInput | null;
  embedding?: AIProfileInput | null;
};

export type SettingsViewModel = {
  chat: AIProfile;
  embedding: AIProfile | null;
  semanticEnabled: boolean;
};

export function settingsForSession(
  settings: SettingsViewModel,
  settingsSessionKey: string,
  currentSessionKey: string,
): SettingsViewModel {
  return settingsSessionKey === currentSessionKey
    ? settings
    : { ...settings, semanticEnabled: false };
}

export type CredentialRole = 'chat' | 'embedding';

export function settingsSectionTransition(section: CredentialRole): {
  section: CredentialRole;
  secret: string;
} {
  return { section, secret: '' };
}

export function credentialTargets(settings: SettingsViewModel): Array<{
  role: CredentialRole;
  credentialRef: string;
}> {
  const targets: Array<{ role: CredentialRole; credentialRef: string }> = [];
  if (settings.chat.credentialRef) {
    targets.push({ role: 'chat', credentialRef: settings.chat.credentialRef });
  }
  if (settings.embedding?.credentialRef) {
    targets.push({ role: 'embedding', credentialRef: settings.embedding.credentialRef });
  }
  return targets;
}

export type EmbeddingConsent = {
  profileId: string;
  granted: boolean;
  kind: string;
  disclosureVersion: number;
};

const emptyChatProfile: AIProfile = {
  schemaVersion: 1,
  id: 'chat-main',
  role: 'chat',
  kind: 'openai',
  label: 'Chat',
  model: '',
  baseUrl: '',
  credentialRef: '',
  timeoutMs: 30_000,
  maxInputChars: 20_000,
  maxHistoryChars: 40_000,
  maxEvidenceChars: 60_000,
  maxOutputTokens: 2_000,
};

export function normalizeSettings(profiles: AIProfiles): SettingsViewModel {
  const chat = normalizeProfile(profiles.chat, emptyChatProfile);
  const embedding = profiles.embedding
    ? normalizeProfile(profiles.embedding, {
        ...emptyChatProfile,
        id: 'embedding-main',
        role: 'embedding',
        label: 'Semantic search',
        maxHistoryChars: 0,
        maxEvidenceChars: 0,
        maxOutputTokens: 1,
        dimensions: 0,
      })
    : null;
  return { chat, embedding, semanticEnabled: false };
}

export function toProfileRequest(profile: AIProfile): Omit<AIProfile, 'schemaVersion'> {
  const request: Omit<AIProfile, 'schemaVersion'> = {
    id: profile.id,
    role: profile.role,
    kind: profile.kind,
    label: profile.label,
    model: profile.model,
    baseUrl: profile.baseUrl,
    timeoutMs: profile.timeoutMs,
    maxInputChars: profile.maxInputChars,
    maxHistoryChars: profile.maxHistoryChars,
    maxEvidenceChars: profile.maxEvidenceChars,
    maxOutputTokens: profile.maxOutputTokens,
  };
  if (profile.credentialRef) request.credentialRef = profile.credentialRef;
  if (profile.dimensions !== undefined) request.dimensions = profile.dimensions;
  return request;
}

export function credentialStatusLabel(status: string): string {
  return {
    missing: 'Not configured',
    persisted: 'Stored securely',
    session_only: 'Available for this session',
    locked: 'System credential store is locked',
    denied: 'Credential access was denied',
    unavailable: 'System credential store is unavailable',
    unsupported: 'Secure credential storage is unsupported',
    failure: 'Credential status unavailable',
  }[status] || 'Credential status unavailable';
}

export function consentRequired(
  profile: Pick<AIProfile, 'id' | 'kind'>,
  consent: EmbeddingConsent | null,
): boolean {
  if (!consent || !consent.granted || consent.disclosureVersion !== 1 || consent.profileId !== profile.id) {
    return true;
  }
  const expectedKind = profile.kind === 'local' ? 'local_cpu_disk' : 'remote_text';
  return consent.kind !== expectedKind;
}

export function encodeCredentialSecret(secret: string): string {
  const bytes = new TextEncoder().encode(secret);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function normalizeProfile(profile: AIProfileInput | null | undefined, fallback: AIProfile): AIProfile {
  if (!profile) return { ...fallback };
  return {
    ...fallback,
    ...profile,
    role: profile.role === 'embedding' ? 'embedding' : 'chat',
    credentialRef: profile.credentialRef || '',
  };
}
