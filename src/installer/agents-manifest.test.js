/**
 * Tests for src/installer/agents-manifest.js
 *
 * Uses node:test + node:assert. Every test sets LUMINA_HOME to its own
 * mkdtemp dir so the real home directory is never touched.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readAgentsManifest,
  writeAgentsManifest,
  agentsManifestPath,
  AGENTS_MANIFEST_SCHEMA_VERSION,
} from './agents-manifest.js';

let luminaHomeDir;
let previousLuminaHome;

beforeEach(async () => {
  previousLuminaHome = process.env.LUMINA_HOME;
  luminaHomeDir = await mkdtemp(join(tmpdir(), 'lumina-agents-manifest-test-'));
  process.env.LUMINA_HOME = luminaHomeDir;
});

afterEach(async () => {
  if (previousLuminaHome === undefined) delete process.env.LUMINA_HOME;
  else process.env.LUMINA_HOME = previousLuminaHome;
  await rm(luminaHomeDir, { recursive: true, force: true });
});

describe('agentsManifestPath', () => {
  test('is scoped under LUMINA_HOME/agents/<platform>-manifest.json', () => {
    const path = agentsManifestPath('openclaw');
    assert.equal(path, join(luminaHomeDir, 'agents', 'openclaw-manifest.json'));
  });
});

describe('readAgentsManifest', () => {
  test('returns null when the manifest does not exist', async () => {
    const result = await readAgentsManifest('openclaw');
    assert.equal(result, null);
  });

  test('throws err.code = 3 on corrupt JSON', async () => {
    const path = agentsManifestPath('openclaw');
    await mkdir(join(luminaHomeDir, 'agents'), { recursive: true });
    await writeFile(path, '{ not json', 'utf8');
    await assert.rejects(() => readAgentsManifest('openclaw'), (err) => {
      assert.equal(err.code, 3);
      return true;
    });
  });

  test('throws err.code = 3 when version > 1', async () => {
    const path = agentsManifestPath('openclaw');
    await mkdir(join(luminaHomeDir, 'agents'), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 2, platform: 'openclaw', skills: [] }), 'utf8');
    await assert.rejects(() => readAgentsManifest('openclaw'), (err) => {
      assert.equal(err.code, 3);
      return true;
    });
  });
});

describe('writeAgentsManifest / readAgentsManifest round-trip', () => {
  test('writes and reads back the manifest', async () => {
    await writeAgentsManifest('openclaw', ['lumi-init', 'lumi-ingest', 'lumi-hub']);
    const result = await readAgentsManifest('openclaw');

    assert.equal(result.version, AGENTS_MANIFEST_SCHEMA_VERSION);
    assert.equal(result.platform, 'openclaw');
    assert.deepEqual(result.skills, ['lumi-init', 'lumi-ingest', 'lumi-hub']);
    assert.ok(result.installedAt);
    assert.ok(!Number.isNaN(Date.parse(result.installedAt)));
  });

  test('two platforms get independent manifest files', async () => {
    await writeAgentsManifest('openclaw', ['lumi-init']);
    await writeAgentsManifest('hermes', ['lumi-init', 'lumi-ask']);

    const openclaw = await readAgentsManifest('openclaw');
    const hermes = await readAgentsManifest('hermes');

    assert.deepEqual(openclaw.skills, ['lumi-init']);
    assert.deepEqual(hermes.skills, ['lumi-init', 'lumi-ask']);
  });

  test('overwriting persists the new skill list', async () => {
    await writeAgentsManifest('openclaw', ['lumi-init']);
    await writeAgentsManifest('openclaw', ['lumi-init', 'lumi-hub']);
    const result = await readAgentsManifest('openclaw');
    assert.deepEqual(result.skills, ['lumi-init', 'lumi-hub']);
  });

  test('an empty skills array round-trips cleanly', async () => {
    await writeAgentsManifest('openclaw', []);
    const result = await readAgentsManifest('openclaw');
    assert.deepEqual(result.skills, []);
  });
});
