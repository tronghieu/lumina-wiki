import {
  BuildIndex,
  CancelIndex,
  ClearIndex,
  ConfirmSessionCredential,
  CredentialStatus,
  DeleteAIProfile,
  DeleteCredential,
  EmbeddingConsentStatus,
  GrantEmbeddingConsent,
  IndexStatus,
  ListAIProfiles,
  RevokeEmbeddingConsent,
  SaveAIProfile,
  SaveCredential,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service';
import { encodeCredentialSecret } from './ai-settings';

export const settingsGateway = {
  buildIndex: BuildIndex,
  cancelIndex: CancelIndex,
  clearIndex: ClearIndex,
  confirmSessionCredential(request: { nonce: string; secret: string }) {
    return ConfirmSessionCredential({ ...request, secret: encodeCredentialSecret(request.secret) });
  },
  credentialStatus: CredentialStatus,
  deleteCredential: DeleteCredential,
  deleteProfile: DeleteAIProfile,
  embeddingConsentStatus: EmbeddingConsentStatus,
  grantEmbeddingConsent: GrantEmbeddingConsent,
  indexStatus: IndexStatus,
  listProfiles: ListAIProfiles,
  revokeEmbeddingConsent: RevokeEmbeddingConsent,
  saveCredential(request: { credentialRef: string; secret: string }) {
    return SaveCredential({ ...request, secret: encodeCredentialSecret(request.secret) });
  },
  saveProfile: SaveAIProfile,
};

export type SettingsGateway = typeof settingsGateway;
