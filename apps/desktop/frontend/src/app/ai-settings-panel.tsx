import { useEffect, useState } from 'react';

const AI_SETTINGS_STORAGE_KEY = 'lumina.desktop.aiSettings';
const DEFAULT_AI_SETTINGS = {
  provider: 'Local',
  model: 'local',
};

const AI_PROVIDERS = ['OpenAI', 'Anthropic', 'Gemini', 'Local'];

type AiSettings = typeof DEFAULT_AI_SETTINGS;

type AiSettingsPanelProps = {
  onClose: () => void;
};

function readStoredAiSettings(): AiSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_AI_SETTINGS;
  }

  try {
    const stored = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_AI_SETTINGS;
    }

    const parsed = JSON.parse(stored) as Partial<AiSettings>;
    const provider = typeof parsed.provider === 'string' && AI_PROVIDERS.includes(parsed.provider)
      ? parsed.provider
      : DEFAULT_AI_SETTINGS.provider;
    return {
      provider,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_AI_SETTINGS.model,
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function writeStoredAiSettings(settings: AiSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings are helpful but should never break graph browsing.
  }
}

export function AiSettingsPanel({ onClose }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState(readStoredAiSettings);

  useEffect(() => {
    writeStoredAiSettings(settings);
  }, [settings]);

  return (
    <section className="settings-panel" id="settings-panel" aria-label="Settings">
      <header>
        <div>
          <h2>Settings</h2>
          <span>AI model</span>
        </div>
        <button type="button" aria-label="Close settings" onClick={onClose}>x</button>
      </header>
      <label>
        <span>Provider</span>
        <select
          aria-label="AI provider"
          onChange={(event) => setSettings((current) => ({ ...current, provider: event.target.value }))}
          value={settings.provider}
        >
          {AI_PROVIDERS.map((provider) => (
            <option key={provider}>{provider}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <input
          aria-label="AI model"
          onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
          placeholder="Model name"
          value={settings.model}
        />
      </label>
    </section>
  );
}
