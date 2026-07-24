import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { SessionReferenceDTO } from '../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/models';
import {
  consentRequired,
  credentialStatusLabel,
  type SettingsViewModel,
} from '../features/settings/ai-settings';
import type { SettingsGateway } from '../features/settings/settings-gateway';
import { useAISettingsController } from '../features/settings/use-ai-settings-controller';

type AiSettingsPanelProps = {
  session: SessionReferenceDTO | null;
  gateway?: SettingsGateway;
  onClose: () => void;
  onProfilesChange: (settings: SettingsViewModel) => void;
};

export function AiSettingsPanel({ session, gateway, onClose, onProfilesChange }: AiSettingsPanelProps) {
  const controller = useAISettingsController(session, onProfilesChange, gateway);
  const dialogRef = useRef<HTMLElement>(null);
  const profile = controller.profile;

  function close() {
    controller.setSecret('');
    onClose();
  }

  function handleDialogKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    )];
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    void controller.saveProfile();
  }

  return (
    <div className="settings-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        ref={dialogRef}
        className="settings-panel"
        id="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleDialogKey}
      >
        <header>
          <div>
            <h2 id="settings-title" tabIndex={-1}>AI Settings</h2>
            <span>Backend-owned profiles and credentials</span>
          </div>
          <button type="button" aria-label="Close settings" onClick={close}>×</button>
        </header>
        <nav className="settings-tabs" aria-label="AI settings sections">
          <button type="button" aria-pressed={controller.section === 'chat'} onClick={() => controller.setSection('chat')}>Chat</button>
          <button type="button" aria-pressed={controller.section === 'embedding'} onClick={() => controller.setSection('embedding')}>Search</button>
        </nav>

        {controller.section === 'embedding' && (
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={controller.settings.semanticEnabled}
              onChange={(event) => controller.enableSemantic(event.target.checked)}
            />
            <span>Enable semantic search</span>
          </label>
        )}

        {profile && (controller.section === 'chat' || controller.settings.semanticEnabled) && (
          <form className="settings-form" onSubmit={saveProfile}>
            <label><span>Provider kind</span><input value={profile.kind} onChange={(event) => controller.updateProfile('kind', event.target.value)} /></label>
            <label><span>Profile label</span><input value={profile.label} onChange={(event) => controller.updateProfile('label', event.target.value)} /></label>
            <label><span>Model</span><input value={profile.model} onChange={(event) => controller.updateProfile('model', event.target.value)} /></label>
            <label><span>Base URL</span><input value={profile.baseUrl} onChange={(event) => controller.updateProfile('baseUrl', event.target.value)} /></label>
            <label><span>Credential reference</span><input value={profile.credentialRef || ''} onChange={(event) => controller.updateProfile('credentialRef', event.target.value)} /></label>
            {controller.section === 'embedding' && (
              <label><span>Dimensions</span><input type="number" min="1" value={profile.dimensions || ''} onChange={(event) => controller.updateProfile('dimensions', Number(event.target.value))} /></label>
            )}
            <div className="settings-actions">
              <button type="submit" disabled={Boolean(controller.busy)}>Save profile</button>
            </div>
          </form>
        )}

        {profile?.credentialRef && (
          <section className="credential-settings">
            <span>{credentialStatusLabel(controller.credentialStatus)}</span>
            <label>
              <span>{controller.credentialStatus === 'missing' ? 'Add credential' : 'Replace credential'}</span>
              <input type="password" autoComplete="off" value={controller.secret} onChange={(event) => controller.setSecret(event.target.value)} />
            </label>
            <div className="settings-actions">
              <button type="button" disabled={!controller.secret || Boolean(controller.busy)} onClick={() => void controller.saveCredential()}>Save credential</button>
              <button type="button" disabled={Boolean(controller.busy)} onClick={() => void controller.removeCredential()}>Remove</button>
            </div>
          </section>
        )}

        {controller.section === 'embedding' && controller.settings.semanticEnabled && controller.settings.embedding && (
          <section className="index-settings">
            <strong>Semantic index</strong>
            <span>{controller.indexStatus ? `${controller.indexStatus.state}: ${controller.indexStatus.vectors} vectors` : 'Not loaded'}</span>
            <span>{consentRequired(controller.settings.embedding, controller.consent) ? 'Disclosure consent required' : 'Disclosure accepted'}</span>
            <div className="settings-actions">
              <button type="button" disabled={!session || Boolean(controller.busy)} onClick={() => void controller.updateConsent(true)}>Accept disclosure</button>
              <button type="button" disabled={!controller.consent?.granted || Boolean(controller.busy)} onClick={() => void controller.updateConsent(false)}>Revoke</button>
              <button type="button" disabled={!session || consentRequired(controller.settings.embedding, controller.consent) || Boolean(controller.busy)} onClick={() => void controller.changeIndex('build')}>Build</button>
              <button type="button" disabled={!session || Boolean(controller.busy)} onClick={() => void controller.changeIndex('cancel')}>Cancel build</button>
              <button type="button" disabled={!session || Boolean(controller.busy)} onClick={() => void controller.changeIndex('clear')}>Clear index</button>
            </div>
            <p>When semantic search is unavailable, Lumina uses workspace text search.</p>
          </section>
        )}
        {controller.message && <p className="settings-message" role="status">{controller.message}</p>}
      </section>
    </div>
  );
}
