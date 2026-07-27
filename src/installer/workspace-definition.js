/**
 * Pure workspace definition shared by the CLI installer and Desktop contract
 * generator. This module performs no I/O and returns frozen values.
 */

import { join } from 'node:path';

import { ENTITY_DIRS, RAW_DIRS } from '../scripts/schemas.mjs';
import { MANIFEST_SCHEMA_VERSION } from './manifest.js';

const IDE_TARGETS = Object.freeze([
  'claude_code',
  'codex',
  'cursor',
  'gemini_cli',
  'qwen',
  'iflow',
  'generic',
]);

const LUMINA_DIRS = Object.freeze([
  '_lumina/config',
  '_lumina/schema',
  '_lumina/scripts',
  '_lumina/tools',
  '_lumina/_state',
]);

const SCRIPT_FILES = Object.freeze([
  'wiki.mjs',
  'lint.mjs',
  'reset.mjs',
  'schemas.mjs',
  'discover-runner.mjs',
  'external-ids.mjs',
  'parse-ids.mjs',
  'merge-ids.mjs',
  'build-source.mjs',
]);

const SCRIPT_LIB_FILES = Object.freeze([
  'watchlist-config.mjs',
  'discovery-state.mjs',
]);

const CORE_TOOL_FILES = Object.freeze([
  'extract_pdf.py',
  'fetch_pdf.py',
  'id_utils.py',
  'verify_quotes.py',
]);

export const RESEARCH_TOOL_FILES = Object.freeze([
  '_env.py',
  '_cache.py',
  'discover.py',
  'init_discovery.py',
  'prepare_source.py',
  'fetch_arxiv.py',
  'fetch_wikipedia.py',
  'fetch_s2.py',
  'fetch_deepxiv.py',
  'fetch_openalex.py',
  'fetch_unpaywall.py',
  'fetch_core.py',
  'resolve_pdf.py',
  'fetch_rss.py',
  'fetch_scite.py',
  'fetch_altmetric.py',
]);

const SCHEMA_DOCS = Object.freeze([
  'page-templates.md',
  'cross-reference-packs.md',
  'graph-packs.md',
  'lumi-help.csv',
  'lumi-help-runbook.md',
]);

const CORE_SKILLS = Object.freeze([
  ['init', 'lumi-init', '/lumi-init'],
  ['ingest', 'lumi-ingest', '/lumi-ingest'],
  ['ask', 'lumi-ask', '/lumi-ask'],
  ['edit', 'lumi-edit', '/lumi-edit'],
  ['check', 'lumi-check', '/lumi-check'],
  ['reset', 'lumi-reset', '/lumi-reset'],
  ['verify', 'lumi-verify', '/lumi-verify'],
  ['migrate-legacy', 'lumi-migrate-legacy', '/lumi-migrate-legacy'],
  ['help', 'lumi-help', '/lumi-help'],
]);

const RESEARCH_SKILLS = Object.freeze([
  ['discover', 'lumi-research-discover', '/lumi-research-discover'],
  ['survey', 'lumi-research-survey', '/lumi-research-survey'],
  ['prefill', 'lumi-research-prefill', '/lumi-research-prefill'],
  ['setup', 'lumi-research-setup', '/lumi-research-setup'],
  ['topic', 'lumi-research-topic', '/lumi-research-topic'],
  ['rank', 'lumi-research-rank', '/lumi-research-rank'],
  ['watchlist', 'lumi-research-watchlist', '/lumi-research-watchlist'],
  ['watch-run', 'lumi-research-watch-run', '/lumi-research-watch-run'],
]);

const READING_SKILLS = Object.freeze([
  ['chapter-ingest', 'lumi-reading-chapter-ingest', '/lumi-reading-chapter-ingest'],
  ['character-track', 'lumi-reading-character-track', '/lumi-reading-character-track'],
  ['theme-map', 'lumi-reading-theme-map', '/lumi-reading-theme-map'],
  ['plot-recap', 'lumi-reading-plot-recap', '/lumi-reading-plot-recap'],
]);

const LEARNING_SKILLS = Object.freeze([
  ['reflect', 'lumi-learning-reflect', '/lumi-learning-reflect'],
]);

const INDEX_SEED = '# Wiki Index\n\n_This catalog is updated by /lumi-ingest and /lumi-init._\n';
const LOG_SEED = '# Wiki Log\n\n_Append-only activity log. Updated by each skill invocation._\n';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CORE_PROFILE = deepFreeze({
  id: 'core-generic-en',
  packs: ['core'],
  ideTargets: ['generic'],
  locale: 'en',
  communicationLang: 'English',
  documentOutputLang: 'English',
  projectName: '',
  researchPurpose: '',
});

function hasPack(packs, pack) {
  return packs.includes(pack);
}

export function workspaceDirectories(packs) {
  const directories = [];
  for (const { dir, pack } of Object.values(ENTITY_DIRS)) {
    if (hasPack(packs, pack)) directories.push(`wiki/${dir.replace(/\/$/, '')}`);
  }
  for (const [dir, pack] of Object.entries(RAW_DIRS)) {
    if (hasPack(packs, pack)) directories.push(`raw/${dir}`);
  }
  directories.push(...LUMINA_DIRS, '.agents/skills');
  return Object.freeze(directories);
}

function skillDefinitions(rows, pack, srcPackPath) {
  return rows.map(([name, canonicalId, displayName]) => deepFreeze({
    name,
    canonicalId,
    displayName,
    pack,
    srcPackPath,
  }));
}

export function workspaceSkillDefinitions(packs) {
  const definitions = [];
  if (hasPack(packs, 'core')) {
    definitions.push(...skillDefinitions(CORE_SKILLS, 'core', 'core'));
  }
  if (hasPack(packs, 'research')) {
    definitions.push(...skillDefinitions(RESEARCH_SKILLS, 'research', 'packs/research'));
  }
  if (hasPack(packs, 'reading')) {
    definitions.push(...skillDefinitions(READING_SKILLS, 'reading', 'packs/reading'));
  }
  if (hasPack(packs, 'learning')) {
    definitions.push(...skillDefinitions(LEARNING_SKILLS, 'learning', 'packs/learning'));
  }
  return Object.freeze(definitions);
}

function fileSource(group, sourcePath, targetPath, kind = 'static') {
  return deepFreeze({ group, sourcePath, targetPath, kind });
}

function inlineSource(group, targetPath, content) {
  return deepFreeze({ group, targetPath, kind: 'static', content });
}

export function workspacePayloadSources(packs) {
  const sources = [
    fileSource('readme', 'src/templates/README.md', 'README.md', 'template'),
    ...SCRIPT_FILES.map(file => fileSource(
      'script',
      `src/scripts/${file}`,
      `_lumina/scripts/${file}`,
    )),
    ...SCRIPT_LIB_FILES.map(file => fileSource(
      'script',
      `src/scripts/lib/${file}`,
      `_lumina/scripts/lib/${file}`,
    )),
    fileSource('changelog', 'CHANGELOG.md', '_lumina/CHANGELOG.md'),
    ...SCHEMA_DOCS.map(file => fileSource(
      'schema',
      `src/templates/_lumina/schema/${file}`,
      `_lumina/schema/${file}`,
      'template',
    )),
    ...CORE_TOOL_FILES.map(file => fileSource(
      'tool',
      `src/tools/${file}`,
      `_lumina/tools/${file}`,
    )),
    fileSource('tool', 'src/tools/requirements.txt', '_lumina/tools/requirements.txt'),
    fileSource('gitignore', 'src/templates/.gitignore', '.gitignore'),
    inlineSource('seed', 'wiki/index.md', INDEX_SEED),
    inlineSource('seed', 'wiki/log.md', LOG_SEED),
  ];

  if (hasPack(packs, 'research')) {
    const environmentExample = ['.env', 'example'].join('.');
    sources.push(
      ...RESEARCH_TOOL_FILES.map(file => fileSource(
        'tool',
        `src/tools/${file}`,
        `_lumina/tools/${file}`,
      )),
      fileSource(
        'env',
        `src/templates/${environmentExample}`,
        environmentExample,
        'template',
      ),
      fileSource(
        'watchlist',
        'src/templates/_lumina/config/watchlist.yml',
        '_lumina/config/watchlist.yml',
        'template',
      ),
    );
  }

  for (const skill of workspaceSkillDefinitions(packs)) {
    sources.push(fileSource(
      'skill',
      `src/skills/${skill.srcPackPath}/${skill.name}`,
      `.agents/skills/${skill.canonicalId}`,
    ));
  }

  return Object.freeze(sources);
}

const IDE_MANAGED_PATHS = Object.freeze({
  claude_code: 'CLAUDE.md',
  codex: 'AGENTS.md',
  cursor: '.cursor/rules/lumina.mdc',
  gemini_cli: 'GEMINI.md',
  qwen: 'QWEN.md',
  iflow: 'IFLOW.md',
});

export function managedFilePaths(packs, ideTargets = IDE_TARGETS) {
  const paths = [
    'README.md',
    '_lumina/config/lumina.config.yaml',
    ...SCHEMA_DOCS.map(file => `_lumina/schema/${file}`),
  ];
  for (const target of IDE_TARGETS) {
    if (ideTargets.includes(target) && IDE_MANAGED_PATHS[target]) {
      paths.push(IDE_MANAGED_PATHS[target]);
    }
  }
  if (hasPack(packs, 'research')) paths.push(['.env', 'example'].join('.'));
  return Object.freeze(paths);
}

export function buildTemplateVariables(input, now = new Date()) {
  const packs = input.packs ?? [];
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf())) throw new TypeError('now must be a valid instant');
  return deepFreeze({
    project_name: input.projectName,
    locale: input.locale,
    communication_language: input.communicationLang,
    document_output_language: input.documentOutputLang,
    pack_core: true,
    pack_research: hasPack(packs, 'research'),
    pack_reading: hasPack(packs, 'reading'),
    pack_learning: hasPack(packs, 'learning'),
    created_at: instant.toISOString().slice(0, 10),
    schema_version: String(MANIFEST_SCHEMA_VERSION),
  });
}

export function buildConfigObject(input, templateVars) {
  const packs = input.packs ?? [];
  const ideTargets = input.ideTargets ?? [];
  return deepFreeze({
    project_name: templateVars.project_name,
    locale: templateVars.locale,
    communication_language: templateVars.communication_language,
    document_output_language: templateVars.document_output_language,
    created_at: templateVars.created_at,
    ide_targets: {
      claude_code: ideTargets.includes('claude_code'),
      codex: ideTargets.includes('codex'),
      cursor: ideTargets.includes('cursor'),
      gemini_cli: ideTargets.includes('gemini_cli'),
      qwen: ideTargets.includes('qwen'),
      iflow: ideTargets.includes('iflow'),
      generic: ideTargets.includes('generic'),
    },
    packs: {
      core: true,
      research: hasPack(packs, 'research'),
      reading: hasPack(packs, 'reading'),
      learning: hasPack(packs, 'learning'),
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
        exemptions: [
          'foundations/**',
          'outputs/**',
          '*://*',
          ...(hasPack(packs, 'learning') ? ['reflections/**'] : []),
        ],
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
}

export function buildManifestObject(input, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf())) throw new TypeError('now must be a valid instant');
  const timestamp = instant.toISOString();
  const baseManifest = structuredClone(input.baseManifest ?? {});
  return deepFreeze({
    ...baseManifest,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    packageVersion: input.packageVersion,
    locale: input.locale,
    installedAt: input.installedAt ?? baseManifest.installedAt ?? timestamp,
    updatedAt: timestamp,
    packs: Object.fromEntries(
      input.packs.map(pack => [pack, {
        version: input.packageVersion,
        source: 'built-in',
      }]),
    ),
    ideTargets: [...input.ideTargets],
    symlinkStrategies: { ...input.symlinkStrategies },
    resolvedPaths: {
      projectRoot: input.projectRoot,
      wiki: join(input.projectRoot, 'wiki'),
      raw: join(input.projectRoot, 'raw'),
      agents: join(input.projectRoot, '.agents'),
      lumina: join(input.projectRoot, '_lumina'),
    },
  });
}

/**
 * Build the complete pure installer projection for one selection and instant.
 * Callers may use only the portions relevant to their workflow, but all
 * inventory and state-row mappings originate here.
 */
export function projectWorkspace(selection, { now = new Date() } = {}) {
  const instant = now instanceof Date ? new Date(now.valueOf()) : new Date(now);
  if (Number.isNaN(instant.valueOf())) throw new TypeError('now must be a valid instant');

  const packs = [...(selection.packs ?? [])];
  const ideTargets = [...(selection.ideTargets ?? [])];
  const templateVariables = buildTemplateVariables(selection, instant);
  const skills = workspaceSkillDefinitions(packs);
  const packageVersion = selection.packageVersion;
  const claudeCode = ideTargets.includes('claude_code');
  const skillRows = skills.map(skill => ({
    canonical_id: skill.canonicalId,
    display_name: skill.displayName,
    pack: skill.pack,
    source: 'built-in',
    relative_path: `.agents/skills/${skill.canonicalId}`,
    target_link_path: claudeCode ? `.claude/skills/${skill.canonicalId}` : '',
    version: packageVersion,
  }));

  const manifest = packageVersion && selection.projectRoot
    ? buildManifestObject({
      baseManifest: selection.baseManifest,
      packageVersion,
      locale: selection.locale,
      installedAt: selection.installedAt,
      packs,
      ideTargets,
      symlinkStrategies: selection.symlinkStrategies ?? {},
      projectRoot: selection.projectRoot,
    }, instant)
    : null;

  return deepFreeze({
    profile: {
      packs,
      ideTargets,
      locale: selection.locale,
      communicationLang: selection.communicationLang,
      documentOutputLang: selection.documentOutputLang,
      projectName: selection.projectName,
      researchPurpose: selection.researchPurpose ?? '',
    },
    directories: workspaceDirectories(packs),
    payloadSources: workspacePayloadSources(packs),
    skills,
    templateVariables,
    config: buildConfigObject(selection, templateVariables),
    state: {
      managedFilePaths: managedFilePaths(packs, ideTargets),
      manifest,
      skillRows,
    },
  });
}
