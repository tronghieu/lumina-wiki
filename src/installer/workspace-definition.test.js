import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  CORE_PROFILE,
  buildConfigObject,
  buildManifestObject,
  buildTemplateVariables,
  managedFilePaths,
  projectWorkspace,
  workspaceDirectories,
  workspacePayloadSources,
  workspaceSkillDefinitions,
} from './workspace-definition.js';

test('core profile is a frozen generic English installer selection', () => {
  assert.deepEqual(CORE_PROFILE, {
    id: 'core-generic-en',
    packs: ['core'],
    ideTargets: ['generic'],
    locale: 'en',
    communicationLang: 'English',
    documentOutputLang: 'English',
    projectName: '',
    researchPurpose: '',
  });
  assert.ok(Object.isFrozen(CORE_PROFILE));
  assert.ok(Object.isFrozen(CORE_PROFILE.packs));
  assert.ok(Object.isFrozen(CORE_PROFILE.ideTargets));
});

test('workspaceDirectories derives the current core tree from schema authority', () => {
  const directories = workspaceDirectories(CORE_PROFILE.packs);

  assert.deepEqual(directories, [
    'wiki/sources',
    'wiki/concepts',
    'wiki/people',
    'wiki/summary',
    'wiki/outputs',
    'wiki/graph',
    'wiki/readings',
    'raw/sources',
    'raw/notes',
    'raw/assets',
    'raw/tmp',
    'raw/download',
    '_lumina/config',
    '_lumina/schema',
    '_lumina/scripts',
    '_lumina/tools',
    '_lumina/_state',
    '.agents/skills',
  ]);
  assert.ok(!directories.includes('wiki/reflections'));
  assert.ok(Object.isFrozen(directories));
});

test('core generic profile selects nine inert skills and no IDE link or stub', () => {
  const skills = workspaceSkillDefinitions(CORE_PROFILE.packs);
  assert.deepEqual(
    skills.map(skill => skill.canonicalId),
    [
      'lumi-init',
      'lumi-ingest',
      'lumi-ask',
      'lumi-edit',
      'lumi-check',
      'lumi-reset',
      'lumi-verify',
      'lumi-migrate-legacy',
      'lumi-help',
    ],
  );
  assert.ok(skills.every(skill => skill.pack === 'core'));
  assert.ok(skills.every(Object.isFrozen));

  const managed = managedFilePaths(CORE_PROFILE.packs, CORE_PROFILE.ideTargets);
  assert.ok(!managed.some(path => /^(?:CLAUDE|AGENTS|GEMINI|QWEN|IFLOW)\.md$/.test(path)));
  assert.ok(!managed.some(path => path.startsWith('.cursor/')));
  assert.ok(!workspacePayloadSources(CORE_PROFILE.packs).some(source => source.targetPath.startsWith('.claude/')));
});

test('fixed clock produces canonical UTC template variables', () => {
  const variables = buildTemplateVariables(
    {
      ...CORE_PROFILE,
      projectName: 'Thư viện "Lumina"',
    },
    new Date('2026-07-25T23:59:59-07:00'),
  );

  assert.deepEqual(variables, {
    project_name: 'Thư viện "Lumina"',
    locale: 'en',
    communication_language: 'English',
    document_output_language: 'English',
    pack_core: true,
    pack_research: false,
    pack_reading: false,
    pack_learning: false,
    created_at: '2026-07-26',
    schema_version: '4',
  });
  assert.ok(Object.isFrozen(variables));
});

test('config composer exactly matches current core/generic/en semantics', () => {
  const input = { ...CORE_PROFILE, projectName: 'Lumina Library' };
  const variables = buildTemplateVariables(input, new Date('2026-07-25T01:35:42.123Z'));
  const config = buildConfigObject(input, variables);

  assert.deepEqual(config, {
    project_name: 'Lumina Library',
    locale: 'en',
    communication_language: 'English',
    document_output_language: 'English',
    created_at: '2026-07-25',
    ide_targets: {
      claude_code: false,
      codex: false,
      cursor: false,
      gemini_cli: false,
      qwen: false,
      iflow: false,
      generic: true,
    },
    packs: {
      core: true,
      research: false,
      reading: false,
      learning: false,
    },
    paths: {
      raw: 'raw',
      wiki: 'wiki',
      agents: '.agents',
      _lumina: '_lumina',
      index: 'wiki/index.md',
      log: 'wiki/log.md',
    },
    wiki: {
      link_syntax: 'obsidian',
      slug_style: 'kebab-case',
      log_prefix: '## [{{date}}] {{skill}} | {{details}}',
      bidirectional_links: {
        mode: 'exempt-only',
        exemptions: ['foundations/**', 'outputs/**', '*://*'],
      },
      graph: {
        enabled: true,
        edge_types_core: ['related_to', 'builds_on', 'contradicts', 'cites', 'mentions', 'part_of'],
      },
    },
    lint: {
      default_mode: 'report',
      checks: {
        broken_links: true,
        orphan_pages: true,
        missing_reverse_links: true,
        log_format: true,
        index_freshness: true,
        stale_claims: false,
      },
    },
    integrations: {
      qmd_search: false,
      obsidian_vault: false,
      marp_slides: false,
    },
    telemetry: false,
  });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.wiki.bidirectional_links.exemptions));
});

test('manifest composer uses one fixed instant and target-derived paths', () => {
  const projectRoot = join('held-root', 'Lumina Library');
  const manifest = buildManifestObject({
    baseManifest: { legacyMigrationNeeded: true },
    packageVersion: '1.9.2',
    locale: 'en',
    packs: ['core'],
    ideTargets: ['generic'],
    symlinkStrategies: {},
    projectRoot,
  }, new Date('2026-07-25T01:35:42.123Z'));

  assert.deepEqual(manifest, {
    legacyMigrationNeeded: true,
    schemaVersion: 4,
    packageVersion: '1.9.2',
    locale: 'en',
    installedAt: '2026-07-25T01:35:42.123Z',
    updatedAt: '2026-07-25T01:35:42.123Z',
    packs: {
      core: { version: '1.9.2', source: 'built-in' },
    },
    ideTargets: ['generic'],
    symlinkStrategies: {},
    resolvedPaths: {
      projectRoot,
      wiki: join(projectRoot, 'wiki'),
      raw: join(projectRoot, 'raw'),
      agents: join(projectRoot, '.agents'),
      lumina: join(projectRoot, '_lumina'),
    },
  });
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.resolvedPaths));
});

test('projectWorkspace projects inventory and state from one fixed clock', () => {
  const projectRoot = join('held-root', 'Lumina Library');
  const workspace = projectWorkspace({
    ...CORE_PROFILE,
    projectName: 'Lumina "Đọc" Wiki',
    packageVersion: '1.9.2',
    projectRoot,
    symlinkStrategies: {},
  }, { now: new Date('2026-07-25T01:35:42.123Z') });

  assert.equal(workspace.templateVariables.created_at, '2026-07-25');
  assert.equal(workspace.config.project_name, 'Lumina "Đọc" Wiki');
  assert.equal(workspace.state.manifest.installedAt, '2026-07-25T01:35:42.123Z');
  assert.equal(workspace.state.manifest.updatedAt, '2026-07-25T01:35:42.123Z');
  assert.deepEqual(
    workspace.state.skillRows.map(row => row.relative_path),
    workspace.skills.map(skill => `.agents/skills/${skill.canonicalId}`),
  );
  assert.equal(workspace.state.skillRows[0].target_link_path, '');
  assert.ok(workspace.directories.includes('_lumina/_state'));
  assert.ok(workspace.payloadSources.some(source => source.targetPath === 'README.md'));
  assert.ok(Object.isFrozen(workspace));
  assert.ok(Object.isFrozen(workspace.state.skillRows));
});
