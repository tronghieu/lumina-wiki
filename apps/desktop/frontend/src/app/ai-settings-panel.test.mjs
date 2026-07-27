import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const panel = readFileSync(new URL('./ai-settings-panel.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../features/settings/settings-gateway.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../features/settings/use-ai-settings-controller.ts', import.meta.url), 'utf8');
const settingsSources = `${panel}\n${controller}`;

test('AI settings use backend gateways without frontend persistence', () => {
  assert.doesNotMatch(settingsSources, /localStorage|sessionStorage/);
  assert.match(settingsSources, /gateway\.listProfiles/);
  assert.match(settingsSources, /gateway\.saveProfile/);
  assert.match(settingsSources, /gateway\.saveCredential/);
  assert.match(panel, /type="password"/);
  assert.match(controller, /finally\s*\{[\s\S]*setSecret\(''\)/);
});

test('credential gateway encodes byte-slice arguments and never exposes a getter', () => {
  assert.match(gateway, /encodeCredentialSecret\(request\.secret\)/);
  assert.doesNotMatch(gateway, /getCredential|credentialValue|readSecret/i);
});

test('semantic mode changes propagate to the app chat configuration', () => {
  assert.match(
    controller,
    /function enableSemantic[\s\S]*const nextSettings[\s\S]*const appSettings[\s\S]*onProfilesChange\(appSettings\)/,
  );
});
