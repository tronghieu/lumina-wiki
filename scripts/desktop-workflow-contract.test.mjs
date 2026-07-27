import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/desktop.yml', import.meta.url);

async function workflow() {
  return readFile(workflowUrl, 'utf8');
}

test('desktop quality is a full engineering gate under patched Go', async () => {
  const source = await workflow();
  assert.ok((source.match(/go-version:\s*"1\.25\.12"/g) ?? []).length >= 2);
  for (const command of [
    'npm run test:desktop-contract',
    'npm run test:desktop-workflow',
    'npm run desktop:contract:check',
    'go test ./...',
    'go test -race ./internal/workspace ./internal/appprivate ./internal/appstate ./internal/ai ./internal/ai/workspaceid',
    'npm run test',
    'npm run build',
    'npm run test:a11y',
    'npm run test:visual',
  ]) {
    assert.ok(source.includes(command), `missing quality gate: ${command}`);
  }
});

test('native package jobs install or copy then launch that clean artifact for five seconds', async () => {
  const source = await workflow();
  assert.ok(
    source.includes(
      'go test ./internal/integration ./internal/workspace ./internal/appprivate ./internal/appstate ./internal/ai/workspaceid',
    ),
    'package jobs must prove the native lifecycle before packaging',
  );
  assert.match(source, /sudo dpkg -i/);
  assert.match(source, /ProgramFiles.*lumina-desktop\.exe/);
  assert.match(source, /Start-Sleep -Seconds 5/);
  assert.match(source, /sleep 5/);

  assert.match(source, /mktemp -d/);
  assert.match(source, /Applications/);
  assert.match(source, /cp -R .*lumina-desktop\.app/);
  assert.doesNotMatch(
    source,
    /if \[ "\$RUNNER_OS" = "macOS" \]; then\s+artifact="bin\/lumina-desktop\.app/s,
    'macOS must launch a fresh copy, not the build output',
  );
});

test('package failure diagnostics are bounded and never upload raw runtime or private state', async () => {
  const source = await workflow();
  assert.ok(
    source.indexOf('Initialize sanitized package diagnostics')
      < source.indexOf('Verify exact Go toolchain and Desktop contract'),
    'diagnostics must exist before the first package preflight can fail',
  );
  assert.match(source, /package-diagnostics/);
  assert.match(source, /phase=package-build\\nresult=started/);
  assert.doesNotMatch(source, /apps\/desktop\/package-smoke\.log/);
  assert.doesNotMatch(source, /package-diagnostics\/.*(?:workspace|private-state|history|credentials|secret)/i);
  assert.match(source, /if:\s*failure\(\)/);
  assert.match(source, /if-no-files-found:\s*error/);
});

test('package smoke never repurposes the user home directory', async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /(?:^|\s)HOME\s*=/m);
  assert.doesNotMatch(source, /\$env:HOME\s*=/i);
  assert.match(source, /XDG_CONFIG_HOME/);
  assert.match(source, /Library\/Application Support\/lumina-wiki-desktop/);
});
