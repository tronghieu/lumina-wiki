/**
 * @module installer/commands
 * @description Subcommand dispatch for the Lumina installer.
 *
 * Commands: install, uninstall, --re-link (as install flag), --version
 *
 * Install flow:
 *   1. Read manifest (detect fresh vs upgrade)
 *   2. Collect answers (prompts or --yes defaults / config file)
 *   3. Scaffold directories
 *   4. Copy/render files
 *   5. Create per-skill symlinks
 *   6. Write three state files atomically
 *   7. Print summary tree
 */

import { readFile, writeFile, rename, unlink, rm, access, copyFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  atomicWrite,
  safePath,
  ensureDir,
  copyDir,
  fileHash,
  linkDirectory,
} from './fs.js';
import {
  readManifest,
  writeManifest,
  readSkillsManifest,
  writeSkillsManifest,
  readFilesManifest,
  writeFilesManifest,
  MANIFEST_SCHEMA_VERSION,
} from './manifest.js';
import {
  render,
  renderReadme,
  extractSchemaRegion,
  replaceSchemaRegion,
} from './template-engine.js';
import {
  runInstallPrompts,
  runUninstallConfirm,
  runReadmeMergePrompt,
} from './prompts.js';
import { checkForUpdate } from './update-check.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'src', 'templates');
const SCRIPTS_DIR = join(PACKAGE_ROOT, 'src', 'scripts');
const SKILLS_DIR = join(PACKAGE_ROOT, 'src', 'skills');
const TOOLS_DIR = join(PACKAGE_ROOT, 'src', 'tools');

// Load package.json for version info
const require = createRequire(import.meta.url);
const PKG = (() => {
  try {
    return require(join(PACKAGE_ROOT, 'package.json'));
  } catch {
    return { version: '0.0.0' };
  }
})();

// ---------------------------------------------------------------------------
// Lazy color import
// ---------------------------------------------------------------------------

let pc;
async function getColor() {
  if (!pc) {
    pc = (await import('picocolors')).default;
  }
  return pc;
}

function noColor(str) { return str; }

async function getColorFns() {
  const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
  if (!isTTY) {
    return { green: noColor, yellow: noColor, red: noColor, bold: noColor, dim: noColor };
  }
  const p = await getColor();
  return { green: p.green, yellow: p.yellow, red: p.red, bold: p.bold, dim: p.dim };
}

// ---------------------------------------------------------------------------
// Directory scaffold spec
// ---------------------------------------------------------------------------

/** Directories always created (core pack) */
const CORE_WIKI_DIRS = [
  'wiki/sources', 'wiki/concepts', 'wiki/people', 'wiki/summary',
  'wiki/outputs', 'wiki/graph',
];

const RESEARCH_WIKI_DIRS = ['wiki/foundations', 'wiki/topics'];
const READING_WIKI_DIRS  = ['wiki/chapters', 'wiki/characters', 'wiki/themes', 'wiki/plot'];

const CORE_RAW_DIRS = ['raw/sources', 'raw/notes', 'raw/assets', 'raw/tmp'];
const RESEARCH_RAW_DIRS = ['raw/discovered'];

const LUMINA_DIRS = [
  '_lumina/config',
  '_lumina/schema',
  '_lumina/scripts',
  '_lumina/_state',
];
const RESEARCH_LUMINA_DIRS = ['_lumina/tools'];

const VALID_PACKS = new Set(['core', 'research', 'reading']);
const VALID_IDE_TARGETS = new Set(['claude_code', 'codex', 'cursor', 'gemini_cli', 'qwen', 'iflow', 'generic']);

// ---------------------------------------------------------------------------
// install command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  [opts.directory]   - Installation directory (BMAD-style canonical flag)
 * @param {string}  [opts.cwd]         - Backward-compat alias for `directory`
 * @param {boolean} opts.yes           - Accept defaults (--yes)
 * @param {boolean} opts.reLink        - Force re-compute symlink strategy
 * @param {boolean} opts.noUpdate      - Skip update check
 * @param {string|string[]} [opts.packs] - Pack override for non-interactive installs
 * @param {string|string[]} [opts.ideTargets] - IDE target override
 * @param {string} [opts.projectName]  - Hidden escape hatch; default = basename(directory)
 * @param {string} [opts.communicationLang]
 * @param {string} [opts.documentOutputLang]
 */
export async function installCommand(opts = {}) {
  const { yes = false, reLink = false } = opts;
  const initialDir = opts.directory ?? opts.cwd ?? process.cwd();
  let projectRoot = resolve(initialDir);
  const colors = await getColorFns();

  // 1. Read existing manifest at the initial path (upgrade detection)
  let existingManifest = null;
  try {
    existingManifest = await readManifest(projectRoot);
  } catch (err) {
    // Corrupted manifest → trigger --re-link semantics
    console.warn(colors.yellow(`[warn] Could not read existing manifest: ${err.message}. Treating as fresh install.`));
  }

  const isUpgrade = existingManifest !== null;

  // 2. Collect answers
  let answers;
  if (isUpgrade) {
    // Upgrade/reinstall: preserve existing choices, including --yes runs.
    answers = await readAnswersFromConfig(projectRoot, existingManifest);
  } else {
    answers = await runInstallPrompts({ acceptDefaults: yes, cwd: projectRoot });
    // Re-resolve projectRoot from the directory the user typed.
    if (answers.directory) {
      projectRoot = resolve(answers.directory);
    }
  }
  answers = applyInstallOverrides(answers, opts);

  const { projectName, researchPurpose, ideTargets, packs, communicationLang, documentOutputLang } = answers;
  const hasResearch = packs.includes('research');
  const hasReading  = packs.includes('reading');

  console.log('');
  if (isUpgrade) {
    console.log(colors.bold(`Upgrading Lumina Wiki in: ${projectRoot}`));
  } else {
    console.log(colors.bold(`Installing Lumina Wiki in: ${projectRoot}`));
  }

  // 3. Scaffold directories
  const dirsToCreate = [
    ...CORE_WIKI_DIRS,
    ...CORE_RAW_DIRS,
    ...LUMINA_DIRS,
    '.agents/skills',
  ];
  if (hasResearch) {
    dirsToCreate.push(...RESEARCH_WIKI_DIRS, ...RESEARCH_RAW_DIRS, ...RESEARCH_LUMINA_DIRS);
  }
  if (hasReading) {
    dirsToCreate.push(...READING_WIKI_DIRS);
  }

  for (const dir of dirsToCreate) {
    await ensureDir(join(projectRoot, dir));
  }

  // 4. Template variables
  const templateVars = {
    project_name:             projectName,
    communication_language:   communicationLang,
    document_output_language: documentOutputLang,
    pack_core:     true,
    pack_research: hasResearch,
    pack_reading:  hasReading,
    created_at:    new Date().toISOString().slice(0, 10),
    schema_version: String(MANIFEST_SCHEMA_VERSION),
  };

  // 5. Render + write config
  await renderAndWriteConfig(projectRoot, templateVars, answers);

  // 6. Render + write README (with region awareness)
  await renderAndWriteReadme(projectRoot, templateVars, researchPurpose, isUpgrade, yes);

  // 7. Render IDE stubs
  await renderIdeStubs(projectRoot, ideTargets, templateVars);

  // 8. Copy scripts
  await copyScripts(projectRoot);

  // 9. Copy skills
  const skillRows = await copySkills(projectRoot, packs);

  // 10. Copy Python tools (research pack)
  if (hasResearch) {
    await copyTools(projectRoot);
  }

  // 11. Render schema docs
  await renderSchemaDocs(projectRoot, templateVars);

  // 12. Render .env.example (research pack only)
  if (hasResearch) {
    await renderEnvExample(projectRoot);
  }

  // 13. Write .gitignore (only if not exists)
  await writeGitignore(projectRoot);

  // 14. Seed wiki/index.md and wiki/log.md (first install only)
  if (!isUpgrade) {
    await seedWikiFiles(projectRoot);
  }

  // 15. Create per-skill symlinks (.claude/skills/lumi-*) for Claude Code
  const symlinkStrategies = {};
  if (ideTargets.includes('claude_code')) {
    const { strategies } = await createSkillSymlinks(
      projectRoot, skillRows, existingManifest, reLink, colors
    );
    Object.assign(symlinkStrategies, strategies);
  }

  // 16. Build files-manifest rows
  const fileRows = await buildFilesManifest(projectRoot, packs, PKG.version);

  // 17. Write three state files atomically
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion:    MANIFEST_SCHEMA_VERSION,
    packageVersion:   PKG.version,
    installedAt:      existingManifest?.installedAt ?? now,
    updatedAt:        now,
    packs:            Object.fromEntries(packs.map(p => [p, { version: PKG.version, source: 'built-in' }])),
    ideTargets,
    symlinkStrategies,
    resolvedPaths: {
      projectRoot,
      wiki:    join(projectRoot, 'wiki'),
      raw:     join(projectRoot, 'raw'),
      agents:  join(projectRoot, '.agents'),
      lumina:  join(projectRoot, '_lumina'),
    },
  };

  await writeManifest(projectRoot, manifest);
  await writeSkillsManifest(projectRoot, skillRows);
  await writeFilesManifest(projectRoot, fileRows);

  // 18. Print summary
  console.log('');
  console.log(colors.green('[done] Lumina Wiki installed successfully.'));
  console.log(`  Project:  ${projectName}`);
  console.log(`  Packs:    ${packs.join(', ')}`);
  console.log(`  IDE:      ${ideTargets.join(', ')}`);
  console.log(`  Skills:   ${skillRows.length} installed`);
  if (Object.values(symlinkStrategies).some(s => s === 'copy')) {
    console.log(colors.yellow('  [warn] Some skills were copied instead of symlinked. Run "lumina install --re-link" after enabling Windows Developer Mode.'));
  }
}

// ---------------------------------------------------------------------------
// uninstall command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  opts.cwd
 * @param {boolean} opts.yes
 */
export async function uninstallCommand(opts = {}) {
  const { cwd = process.cwd(), yes = false } = opts;
  const projectRoot = resolve(cwd);
  const colors = await getColorFns();

  const result = await runUninstallConfirm({ acceptDefaults: yes });
  if (!result || !result.confirmed) {
    console.log(colors.yellow('Uninstall cancelled.'));
    process.exit(0);
  }

  const { stripReadme } = result;

  // Read manifest to know what to clean up
  let manifest = null;
  try {
    manifest = await readManifest(projectRoot);
  } catch (_) {}

  // Remove _lumina/ (except we preserve wiki/ and raw/)
  await rm(join(projectRoot, '_lumina'), { recursive: true, force: true });
  console.log(colors.green('[done] Removed _lumina/'));

  // Remove .agents/
  await rm(join(projectRoot, '.agents'), { recursive: true, force: true });
  console.log(colors.green('[done] Removed .agents/'));

  // Remove .claude/skills/lumi-* symlinks
  try {
    const claudeSkillsDir = join(projectRoot, '.claude', 'skills');
    const entries = await readdir_safe(claudeSkillsDir);
    for (const entry of entries) {
      if (entry.startsWith('lumi-')) {
        await rm(join(claudeSkillsDir, entry), { recursive: true, force: true });
      }
    }
  } catch (_) {}

  // Remove IDE stub files
  const ideTargets = manifest?.ideTargets ?? ['claude_code'];
  const stubFiles = ideTargetStubFiles(ideTargets);
  for (const f of stubFiles) {
    await unlink(join(projectRoot, f)).catch(() => {});
  }

  // Handle README
  if (stripReadme) {
    try {
      const readmePath = join(projectRoot, 'README.md');
      const content = await readFile(readmePath, 'utf8');
      const openMarker = '<!-- lumina:schema -->';
      const closeMarker = '<!-- /lumina:schema -->';
      const start = content.indexOf(openMarker);
      const end = content.indexOf(closeMarker);
      if (start !== -1 && end !== -1) {
        const stripped = content.slice(0, start) + content.slice(end + closeMarker.length);
        await atomicWrite(readmePath, stripped);
        console.log(colors.green('[done] Stripped schema region from README.md'));
      }
    } catch (_) {}
  }

  console.log(colors.green('[done] Uninstall complete. wiki/ and raw/ preserved.'));
}

// ---------------------------------------------------------------------------
// version command
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.noUpdate
 */
export async function versionCommand(opts = {}) {
  const { noUpdate = false } = opts;
  const colors = await getColorFns();

  // Print version immediately (cold-start < 300ms)
  process.stdout.write(PKG.version + '\n');

  // Then do async update check (bounded by 2s timeout)
  if (!noUpdate && process.env.LUMINA_NO_UPDATE_CHECK !== '1') {
    const latest = await checkForUpdate(PKG.version);
    if (latest) {
      console.log(colors.yellow(`\n  Update available: ${PKG.version} -> ${latest}`));
      console.log(`  Run: npx lumina-wiki@latest install\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readAnswersFromConfig(projectRoot, existingManifest) {
  // Try reading lumina.config.yaml for stored answers
  try {
    const yaml = await import('js-yaml');
    const configPath = join(projectRoot, '_lumina', 'config', 'lumina.config.yaml');
    const raw = await readFile(configPath, 'utf8');
    const config = yaml.load(raw) || {};

    const ideTargets = Object.entries(config.ide_targets || {})
      .filter(([_, v]) => v)
      .map(([k]) => k);

    const packs = Object.entries(config.packs || {})
      .filter(([_, v]) => v)
      .map(([k]) => k);

    return {
      directory:          projectRoot,
      projectName:        config.project_name || basename(projectRoot),
      researchPurpose:    '',
      ideTargets:         ideTargets.length ? ideTargets : ['claude_code'],
      packs:              packs.length ? packs : ['core'],
      communicationLang:  config.communication_language || 'English',
      documentOutputLang: config.document_output_language || 'English',
    };
  } catch (_) {
    // Fall back to manifest data
    const ideTargets = existingManifest?.ideTargets ?? ['claude_code'];
    const packs = Object.keys(existingManifest?.packs ?? { core: true });
    return {
      directory:          projectRoot,
      projectName:        basename(projectRoot),
      researchPurpose:    '',
      ideTargets,
      packs:              packs.length ? packs : ['core'],
      communicationLang:  'English',
      documentOutputLang: 'English',
    };
  }
}

function parseListOption(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parts = Array.isArray(value)
    ? value
    : String(value).split(',');
  const result = parts.map(p => String(p).trim()).filter(Boolean);
  if (result.length === 0) {
    const err = new Error(`${label} must contain at least one value`);
    err.code = 2;
    throw err;
  }
  return result;
}

function unique(values) {
  return [...new Set(values)];
}

function validateValues(values, validSet, label) {
  const invalid = values.filter(v => !validSet.has(v));
  if (invalid.length > 0) {
    const err = new Error(`Unknown ${label}: ${invalid.join(', ')}. Valid values: ${[...validSet].join(', ')}`);
    err.code = 2;
    throw err;
  }
}

function applyInstallOverrides(answers, opts) {
  const next = { ...answers };

  const packOverride = parseListOption(opts.packs, '--packs');
  if (packOverride) {
    validateValues(packOverride, VALID_PACKS, 'pack');
    next.packs = unique(['core', ...packOverride.filter(p => p !== 'core')]);
  } else {
    next.packs = unique(['core', ...(next.packs || []).filter(p => p !== 'core')]);
  }

  const ideOverride = parseListOption(opts.ideTargets, '--ide-targets');
  if (ideOverride) {
    validateValues(ideOverride, VALID_IDE_TARGETS, 'IDE target');
    next.ideTargets = unique(ideOverride);
  }

  if (opts.projectName) next.projectName = String(opts.projectName);
  if (opts.communicationLang) next.communicationLang = String(opts.communicationLang);
  if (opts.documentOutputLang) next.documentOutputLang = String(opts.documentOutputLang);

  return next;
}

async function renderAndWriteConfig(projectRoot, templateVars, answers) {
  const yaml = await import('js-yaml');

  // Build config object
  const config = {
    project_name: templateVars.project_name,
    communication_language: templateVars.communication_language,
    document_output_language: templateVars.document_output_language,
    created_at: templateVars.created_at,
    ide_targets: {
      claude_code: answers.ideTargets.includes('claude_code'),
      codex:       answers.ideTargets.includes('codex'),
      cursor:      answers.ideTargets.includes('cursor'),
      gemini_cli:  answers.ideTargets.includes('gemini_cli'),
      qwen:        answers.ideTargets.includes('qwen'),
      iflow:       answers.ideTargets.includes('iflow'),
      generic:     answers.ideTargets.includes('generic'),
    },
    packs: {
      core:     true,
      research: answers.packs.includes('research'),
      reading:  answers.packs.includes('reading'),
    },
    paths: {
      raw:     'raw',
      wiki:    'wiki',
      agents:  '.agents',
      _lumina: '_lumina',
      index:   'wiki/index.md',
      log:     'wiki/log.md',
    },
    wiki: {
      link_syntax:  'obsidian',
      slug_style:   'kebab-case',
      log_prefix:   '## [{{date}}] {{skill}} | {{details}}',
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
  };

  const configPath = join(projectRoot, '_lumina', 'config', 'lumina.config.yaml');
  const configContent = `# lumina.config.yaml — workspace config managed by lumina-wiki installer.\n` +
    `# Lives at _lumina/config/lumina.config.yaml. Editable by hand.\n\n` +
    yaml.dump(config, { lineWidth: 100, noRefs: true });

  await atomicWrite(configPath, configContent);
}

async function renderAndWriteReadme(projectRoot, templateVars, purpose, isUpgrade, acceptDefaults) {
  const readmePath = join(projectRoot, 'README.md');
  const templatePath = join(TEMPLATES_DIR, 'README.md');

  let templateContent;
  try {
    templateContent = await readFile(templatePath, 'utf8');
  } catch (_) {
    templateContent = defaultReadmeTemplate(templateVars);
  }

  // Check if README exists
  let existingReadme = null;
  try {
    existingReadme = await readFile(readmePath, 'utf8');
  } catch (_) {}

  if (existingReadme !== null) {
    if (isUpgrade) {
      // Upgrade: rewrite only the schema region
      const newSchemaContent = render(extractSchemaTemplate(templateContent), templateVars);
      const updated = replaceOrAppendSchemaRegion(existingReadme, newSchemaContent);
      await atomicWrite(readmePath, updated);
      return;
    }

    // First install with existing README: ask user
    const action = await runReadmeMergePrompt({ acceptDefaults });
    if (action === 'abort') {
      console.log('Aborted: README.md left unchanged.');
      process.exit(0);
    }
    if (action === 'backup') {
      await copyFile(readmePath, readmePath + '.bak');
    }
    if (action === 'merge') {
      const newSchemaContent = render(extractSchemaTemplate(templateContent), templateVars);
      const updated = replaceOrAppendSchemaRegion(existingReadme, newSchemaContent);
      await atomicWrite(readmePath, updated);
      return;
    }
  }

  // Fresh render
  const rendered = renderReadme(templateContent, templateVars, purpose);
  await atomicWrite(readmePath, rendered);
}

function extractSchemaTemplate(fullTemplate) {
  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const lines = fullTemplate.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const startLine = lines.findIndex(line => line.trim() === openMarker);
  const endLine = lines.findIndex((line, idx) => idx > startLine && line.trim() === closeMarker);
  if (startLine === -1 || endLine === -1) return fullTemplate;
  return lines.slice(startLine + 1, endLine).join('\n');
}

async function renderIdeStubs(projectRoot, ideTargets, templateVars) {
  for (const target of ideTargets) {
    const stubContent = buildIdeStub(target, templateVars);
    if (!stubContent) continue;
    const stubPath = ideTargetFilePath(projectRoot, target);
    if (!stubPath) continue;
    await ensureDir(dirname(stubPath));
    await atomicWrite(stubPath, stubContent);
  }
}

function ideTargetFilePath(projectRoot, target) {
  switch (target) {
    case 'claude_code': return join(projectRoot, 'CLAUDE.md');
    case 'codex':       return join(projectRoot, 'AGENTS.md');
    case 'gemini_cli':  return join(projectRoot, 'GEMINI.md');
    case 'cursor':      return join(projectRoot, '.cursor', 'rules', 'lumina.mdc');
    case 'qwen':        return join(projectRoot, 'QWEN.md');
    case 'iflow':       return join(projectRoot, 'IFLOW.md');
    case 'generic':     return null; // No stub needed; README.md is the entry point
    default:            return null;
  }
}

function ideTargetStubFiles(ideTargets) {
  return ideTargets
    .map(t => {
      switch (t) {
        case 'claude_code': return 'CLAUDE.md';
        case 'codex':       return 'AGENTS.md';
        case 'gemini_cli':  return 'GEMINI.md';
        case 'cursor':      return '.cursor/rules/lumina.mdc';
        case 'qwen':        return 'QWEN.md';
        case 'iflow':       return 'IFLOW.md';
        default:            return null;
      }
    })
    .filter(Boolean);
}

function buildIdeStub(target, vars) {
  const name = vars.project_name || 'this wiki';
  switch (target) {
    case 'claude_code':
      return `# Claude Code — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'codex':
      return `# AGENTS.md — Lumina Wiki\n\nThis file is the entry point for any CLI agent that reads \`AGENTS.md\` (Codex, Amp, Crush, Goose, Auggie, OpenCode, Kimi Code, Mistral Vibe, and other AGENTS.md-compatible tools).\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'gemini_cli':
      return `# Gemini CLI — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'cursor':
      return `---\ndescription: Lumina Wiki workspace rules for Cursor\nglobs: ["**/*.md"]\nalwaysApply: true\n---\n\n# Cursor — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'qwen':
      return `# Qwen Code — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    case 'iflow':
      return `# iFlow CLI — Lumina Wiki\n\nYou are the wiki maintainer for **${name}**.\n\nRead \`README.md\` at the project root first — it contains the full schema, page types, link conventions, and skill list for this workspace.\n\nCommunicate with the user in **${vars.communication_language}**. Write wiki pages in **${vars.document_output_language}**.\n`;
    default:
      return null;
  }
}

async function copyScripts(projectRoot) {
  const destDir = join(projectRoot, '_lumina', 'scripts');
  const scriptFiles = ['wiki.mjs', 'lint.mjs', 'reset.mjs', 'schemas.mjs'];
  for (const file of scriptFiles) {
    const src = join(SCRIPTS_DIR, file);
    const dest = join(destDir, file);
    try {
      await copyFile(src, dest);
    } catch (_) {
      // Scripts may not exist yet (P4+ work); skip gracefully
    }
  }
}

async function copySkills(projectRoot, packs) {
  const skillRows = [];
  const skillDefs = getSkillDefs(packs);

  for (const skill of skillDefs) {
    // srcPackPath uses forward slashes — join handles OS differences
    const srcDir = join(SKILLS_DIR, ...skill.srcPackPath.split('/'), skill.name);
    const destDir = join(projectRoot, '.agents', 'skills', skill.canonicalId);

    await access(join(srcDir, 'SKILL.md'), fsConstants.F_OK);
    await rm(destDir, { recursive: true, force: true });
    await ensureDir(destDir);
    await copyDir(srcDir, destDir);

    skillRows.push({
      canonical_id:    skill.canonicalId,
      display_name:    skill.displayName,
      pack:            skill.pack,
      source:          'built-in',
      relative_path:   `.agents/skills/${skill.canonicalId}`,
      target_link_path: join('.claude', 'skills', skill.canonicalId),
      version:         PKG.version,
    });
  }

  return skillRows;
}

function replaceOrAppendSchemaRegion(existingContent, newSchemaContent) {
  if (extractSchemaRegion(existingContent) !== null) {
    return replaceSchemaRegion(existingContent, newSchemaContent);
  }

  const openMarker = '<!-- lumina:schema -->';
  const closeMarker = '<!-- /lumina:schema -->';
  const schemaBody = newSchemaContent.startsWith('\n') ? newSchemaContent : '\n' + newSchemaContent;
  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  return `${existingContent}${separator}${openMarker}${schemaBody}${closeMarker}\n`;
}

function getSkillDefs(packs) {
  const defs = [];

  if (packs.includes('core')) {
    const coreSkills = [
      { name: 'init',    canonicalId: 'lumi-init',    displayName: '/lumi-init' },
      { name: 'ingest',  canonicalId: 'lumi-ingest',  displayName: '/lumi-ingest' },
      { name: 'ask',     canonicalId: 'lumi-ask',     displayName: '/lumi-ask' },
      { name: 'edit',    canonicalId: 'lumi-edit',    displayName: '/lumi-edit' },
      { name: 'check',   canonicalId: 'lumi-check',   displayName: '/lumi-check' },
      { name: 'reset',   canonicalId: 'lumi-reset',   displayName: '/lumi-reset' },
    ];
    for (const s of coreSkills) {
      defs.push({ ...s, pack: 'core', srcPackPath: 'core' });
    }
  }

  if (packs.includes('research')) {
    const researchSkills = [
      { name: 'discover', canonicalId: 'lumi-research-discover', displayName: '/lumi-research-discover' },
      { name: 'survey',   canonicalId: 'lumi-research-survey',   displayName: '/lumi-research-survey' },
      { name: 'prefill',  canonicalId: 'lumi-research-prefill',  displayName: '/lumi-research-prefill' },
      { name: 'setup',    canonicalId: 'lumi-research-setup',    displayName: '/lumi-research-setup' },
    ];
    for (const s of researchSkills) {
      defs.push({ ...s, pack: 'research', srcPackPath: 'packs/research' });
    }
  }

  if (packs.includes('reading')) {
    const readingSkills = [
      { name: 'chapter-ingest',   canonicalId: 'lumi-reading-chapter-ingest',   displayName: '/lumi-reading-chapter-ingest' },
      { name: 'character-track',  canonicalId: 'lumi-reading-character-track',  displayName: '/lumi-reading-character-track' },
      { name: 'theme-map',        canonicalId: 'lumi-reading-theme-map',        displayName: '/lumi-reading-theme-map' },
      { name: 'plot-recap',       canonicalId: 'lumi-reading-plot-recap',       displayName: '/lumi-reading-plot-recap' },
    ];
    for (const s of readingSkills) {
      defs.push({ ...s, pack: 'reading', srcPackPath: 'packs/reading' });
    }
  }

  return defs;
}

async function copyTools(projectRoot) {
  const destDir = join(projectRoot, '_lumina', 'tools');
  const toolFiles = [
    '_env.py', 'discover.py', 'init_discovery.py', 'prepare_source.py',
    'fetch_arxiv.py', 'fetch_wikipedia.py', 'fetch_s2.py', 'fetch_deepxiv.py',
  ];
  for (const file of toolFiles) {
    const src = join(TOOLS_DIR, file);
    const dest = join(destDir, file);
    try {
      await copyFile(src, dest);
    } catch (_) {
      // Tool not yet authored; skip
    }
  }
}

async function renderSchemaDocs(projectRoot, templateVars) {
  const schemaDir = join(projectRoot, '_lumina', 'schema');
  const schemaDocs = ['page-templates.md', 'cross-reference-packs.md', 'graph-packs.md'];

  for (const doc of schemaDocs) {
    const templatePath = join(TEMPLATES_DIR, '_lumina', 'schema', doc);
    const destPath = join(schemaDir, doc);
    let content;
    try {
      const raw = await readFile(templatePath, 'utf8');
      content = render(raw, templateVars);
    } catch (_) {
      content = `# ${doc}\n\n_This file is managed by the Lumina installer._\n`;
    }
    await atomicWrite(destPath, content);
  }
}

async function renderEnvExample(projectRoot) {
  const templatePath = join(TEMPLATES_DIR, '.env.example');
  const destPath = join(projectRoot, '.env.example');
  let content;
  try {
    content = await readFile(templatePath, 'utf8');
  } catch (_) {
    content = `# .env.example — API keys for Lumina Wiki research pack tools\n` +
      `# Copy to .env and fill in your values. Never commit .env.\n\n` +
      `# Semantic Scholar API key (optional; improves rate limits)\n` +
      `SEMANTIC_SCHOLAR_API_KEY=\n\n` +
      `# DeepXiv token (optional; enables full-text PDF access)\n` +
      `DEEPXIV_TOKEN=\n\n` +
      `# arXiv does not require an API key in v0.1\n`;
  }
  await atomicWrite(destPath, content);
}

async function writeGitignore(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  let exists = false;
  try {
    await access(gitignorePath, fsConstants.F_OK);
    exists = true;
  } catch (_) {}

  if (!exists) {
    const templatePath = join(TEMPLATES_DIR, '.gitignore');
    let content;
    try {
      content = await readFile(templatePath, 'utf8');
    } catch (_) {
      content = `# Lumina Wiki — generated by lumina-wiki installer\n` +
        `_lumina/_state/\nraw/tmp/\n.env\nnode_modules/\n`;
    }
    await atomicWrite(gitignorePath, content);
  }
}

async function seedWikiFiles(projectRoot) {
  const indexPath = join(projectRoot, 'wiki', 'index.md');
  const logPath   = join(projectRoot, 'wiki', 'log.md');

  // Only seed if files don't exist
  try { await access(indexPath, fsConstants.F_OK); } catch (_) {
    await atomicWrite(indexPath, '# Wiki Index\n\n_This catalog is updated by /lumi-ingest and /lumi-init._\n');
  }
  try { await access(logPath, fsConstants.F_OK); } catch (_) {
    await atomicWrite(logPath, '# Wiki Log\n\n_Append-only activity log. Updated by each skill invocation._\n');
  }
}

async function createSkillSymlinks(projectRoot, skillRows, existingManifest, reLink, colors) {
  const strategies = {};

  for (const skill of skillRows) {
    const target   = resolve(projectRoot, skill.relative_path);
    const linkPath = resolve(projectRoot, '.claude', 'skills', skill.canonical_id);

    const existingStrategy = reLink ? null : (existingManifest?.symlinkStrategies?.[skill.canonical_id] ?? null);

    try {
      const result = await linkDirectory(target, linkPath, existingStrategy);
      strategies[skill.canonical_id] = result.strategy;
      if (result.warning) {
        console.log(colors.yellow(`  [warn] ${result.message}`));
      }
    } catch (err) {
      console.log(colors.red(`  [error] Failed to link ${skill.canonical_id}: ${err.message}`));
    }
  }

  return { strategies };
}

async function buildFilesManifest(projectRoot, packs, pkgVersion) {
  const managedFiles = [
    'README.md',
    '_lumina/config/lumina.config.yaml',
    '_lumina/schema/page-templates.md',
    '_lumina/schema/cross-reference-packs.md',
    '_lumina/schema/graph-packs.md',
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    'QWEN.md',
    'IFLOW.md',
    '.cursor/rules/lumina.mdc',
  ];

  if (packs.includes('research')) {
    managedFiles.push('.env.example');
  }

  const rows = [];
  for (const relPath of managedFiles) {
    const absPath = join(projectRoot, relPath);
    let sha256 = '';
    try {
      sha256 = await fileHash(absPath);
    } catch (_) {}
    if (!sha256) continue;

    const packForFile = relPath.startsWith('.env.example') ? 'research' : 'core';
    rows.push({
      relative_path:     relPath,
      sha256,
      source_pack:       packForFile,
      installed_version: pkgVersion,
    });
  }

  return rows;
}

function defaultReadmeTemplate(vars) {
  return `# ${vars.project_name}\n\n<!-- lumina:schema -->\n\n_Schema region managed by Lumina Wiki installer._\n\n<!-- /lumina:schema -->\n`;
}

async function readdir_safe(dirPath) {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(dirPath);
  } catch (_) {
    return [];
  }
}
