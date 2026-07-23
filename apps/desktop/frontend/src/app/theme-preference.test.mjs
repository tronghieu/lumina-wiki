import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveThemePreference, toggleTheme } from './theme-preference.ts';

describe('theme-preference', () => {
  it('uses a valid stored theme before the system preference', () => {
    assert.equal(resolveThemePreference('light', true), 'light');
    assert.equal(resolveThemePreference('dark', false), 'dark');
  });

  it('falls back to the current system preference for missing or invalid storage', () => {
    assert.equal(resolveThemePreference(null, true), 'dark');
    assert.equal(resolveThemePreference('sepia', false), 'light');
  });

  it('toggles only between the supported themes', () => {
    assert.equal(toggleTheme('dark'), 'light');
    assert.equal(toggleTheme('light'), 'dark');
  });
});
