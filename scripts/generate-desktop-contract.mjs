#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { atomicWrite } from '../src/installer/fs.js';
import {
  FILES_CSV_HEADER,
  MANIFEST_SCHEMA_VERSION,
  SKILLS_CSV_HEADER,
} from '../src/installer/manifest.js';
import {
  CORE_PROFILE,
  projectWorkspace,
} from '../src/installer/workspace-definition.js';
import { DEFAULT_README_PURPOSE } from '../src/installer/template-engine.js';
import {
  EDGE_TYPES,
  ENTITY_DIRS,
  ENUMS,
  EXEMPTION_GLOBS,
  EXTERNAL_ID_NAMESPACES,
  LINT_CHECK_IDS,
  PACK_MANIFEST_SHAPE,
  RAW_DIRS,
  REQUIRED_FRONTMATTER,
  SCHEMA_VERSION,
} from '../src/scripts/schemas.mjs';

const CONTRACT_VERSION = 1;
const MATERIALIZATION_VERSION = 1;
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ASSETS_DIR = join(
  DEFAULT_REPO_ROOT,
  'apps',
  'desktop',
  'internal',
  'contract',
  'assets',
);
const DEFAULT_FIXTURE = join(
  DEFAULT_REPO_ROOT,
  'apps',
  'desktop',
  'internal',
  'contract',
  'testdata',
  'core-generic-en.json',
);

function compareUtf8(a, b) {
  return Buffer.from(a).compare(Buffer.from(b));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort(compareUtf8)) {
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJSON(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateLogicalPath(path) {
  if (typeof path !== 'string') throw new TypeError('logical path must be a string');
  if (
    path.length === 0
    || path.includes('\0')
    || path.includes('\\')
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
    || isAbsolute(path)
  ) {
    throw new RangeError(`unsafe logical path: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || segments.some(segment => (
      segment.endsWith('.')
      || segment.endsWith(' ')
      || /[:*?"<>|]/.test(segment)
      || windowsReserved.test(segment)
    ))
    || path !== path.normalize('NFC')
  ) {
    throw new RangeError(`unsafe logical path: ${JSON.stringify(path)}`);
  }
  return path;
}

async function assertSourcePath(repoRoot, sourcePath) {
  try {
    validateLogicalPath(sourcePath);
  } catch {
    throw new RangeError(`unsafe selected source path: ${JSON.stringify(sourcePath)}`);
  }
  const absolute = resolve(repoRoot, sourcePath);
  const rel = relative(resolve(repoRoot), absolute);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new RangeError(`selected source escapes repository: ${sourcePath}`);
  }

  let current = resolve(repoRoot);
  for (const segment of sourcePath.split('/')) {
    current = join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`missing selected source: ${current}`);
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`selected source has a symlink component: ${current}`);
    }
  }
  return absolute;
}

export async function assertExternalWorkspaceRoot(repoRoot, workspaceRoot) {
  const [canonicalRepo, canonicalWorkspace] = await Promise.all([
    realpath(repoRoot),
    realpath(workspaceRoot),
  ]);
  const rel = relative(canonicalRepo, canonicalWorkspace);
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))) {
    throw new RangeError(`workspace root must be outside repository: ${workspaceRoot}`);
  }
  return canonicalWorkspace;
}

function registerEntry(entries, foldedPaths, entry, { allowSameDirectory = false } = {}) {
  validateLogicalPath(entry.path);
  const existing = entries.get(entry.path);
  if (existing) {
    if (allowSameDirectory && existing.kind === 'directory' && entry.kind === 'directory') {
      return;
    }
    throw new RangeError(`duplicate logical path: ${entry.path}`);
  }
  const folded = entry.path.toLowerCase();
  const collision = foldedPaths.get(folded);
  if (collision && collision !== entry.path) {
    throw new RangeError(`case-colliding logical path: ${collision} and ${entry.path}`);
  }
  foldedPaths.set(folded, entry.path);
  entries.set(entry.path, entry);
}

function parentLogicalPaths(path) {
  const parents = [];
  let current = path;
  while (current.includes('/')) {
    current = current.slice(0, current.lastIndexOf('/'));
    parents.push(current);
  }
  return parents.reverse();
}

async function collectTree({
  absolute,
  logical,
  kind,
  entries,
  foldedPaths,
}) {
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`missing selected source: ${absolute}`);
    }
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`selected source is a symlink: ${absolute}`);
  if (info.isFile()) {
    const bytes = await readFile(absolute);
    registerEntry(entries, foldedPaths, {
      path: logical,
      kind,
      size: bytes.byteLength,
      sha256: sha256(bytes),
      bytes,
    });
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`selected source is a special filesystem entry: ${absolute}`);
  }

  registerEntry(
    entries,
    foldedPaths,
    { path: logical, kind: 'directory', size: 0, sha256: null },
    { allowSameDirectory: true },
  );
  const children = await readdir(absolute);
  children.sort(compareUtf8);
  for (const child of children) {
    await collectTree({
      absolute: join(absolute, child),
      logical: `${logical}/${child}`,
      kind,
      entries,
      foldedPaths,
    });
  }
}

export async function collectPayloadSources(definition) {
  const repoRoot = resolve(definition.repoRoot);
  const entries = new Map();
  const foldedPaths = new Map();

  for (const directory of definition.directories ?? []) {
    for (const parent of parentLogicalPaths(directory)) {
      registerEntry(
        entries,
        foldedPaths,
        { path: parent, kind: 'directory', size: 0, sha256: null },
        { allowSameDirectory: true },
      );
    }
    registerEntry(entries, foldedPaths, {
      path: validateLogicalPath(directory),
      kind: 'directory',
      size: 0,
      sha256: null,
    });
  }

  for (const source of definition.sources ?? []) {
    const logical = validateLogicalPath(source.targetPath);
    for (const parent of parentLogicalPaths(logical)) {
      registerEntry(
        entries,
        foldedPaths,
        { path: parent, kind: 'directory', size: 0, sha256: null },
        { allowSameDirectory: true },
      );
    }
    if (Object.hasOwn(source, 'content')) {
      const bytes = Buffer.from(source.content, 'utf8');
      registerEntry(entries, foldedPaths, {
        path: logical,
        kind: source.kind,
        size: bytes.byteLength,
        sha256: sha256(bytes),
        bytes,
      });
      continue;
    }
    const absolute = await assertSourcePath(repoRoot, source.sourcePath);
    await collectTree({
      absolute,
      logical,
      kind: source.kind,
      entries,
      foldedPaths,
    });
  }

  return [...entries.values()].sort((a, b) => compareUtf8(a.path, b.path));
}

export function payloadRootDigest(entries) {
  const records = [...entries]
    .sort((a, b) => compareUtf8(a.path, b.path))
    .map(entry => (
      `${entry.kind}\0${entry.path}\0${entry.size}\0${entry.sha256 ?? '-'}\n`
    ))
    .join('');
  return sha256(Buffer.from(records, 'utf8'));
}

function materializationRecipe(workspace, installerPackage) {
  const runtimeConfig = structuredClone(workspace.config);
  runtimeConfig.project_name = '$runtime.projectName';
  runtimeConfig.created_at = '$runtime.now.utcDate';
  const runtimeManifest = structuredClone(workspace.state.manifest);
  runtimeManifest.installedAt = '$runtime.now.rfc3339';
  runtimeManifest.updatedAt = '$runtime.now.rfc3339';
  runtimeManifest.resolvedPaths = {
    projectRoot: '$runtime.root',
    wiki: '$runtime.root/wiki',
    raw: '$runtime.root/raw',
    agents: '$runtime.root/.agents',
    lumina: '$runtime.root/_lumina',
  };
  return {
    version: MATERIALIZATION_VERSION,
    runtimeInputs: ['projectName', 'now', 'root'],
    allowedSubstitutions: [
      'project_name',
      'locale',
      'communication_language',
      'document_output_language',
      'pack_core',
      'pack_research',
      'pack_reading',
      'pack_learning',
      'created_at',
      'schema_version',
    ],
    clock: {
      input: 'one injected instant',
      createdAt: 'UTC date YYYY-MM-DD',
      installedAt: 'UTC RFC3339',
      updatedAt: 'same bytes as installedAt',
    },
    config: runtimeConfig,
    directoriesSource: 'contract.directories',
    files: [
      { path: 'README.md', source: 'README.md', action: 'render-readme' },
      {
        path: '_lumina/config/lumina.config.yaml',
        action: 'serialize-config',
      },
      { path: '_lumina/manifest.json', action: 'serialize-manifest' },
      {
        path: '_lumina/_state/skills-manifest.csv',
        action: 'serialize-skills-csv',
      },
      {
        path: '_lumina/_state/files-manifest.csv',
        action: 'serialize-files-csv-after-target-hashes',
      },
    ],
    hash: {
      algorithm: 'sha256',
      filesManifestInput: 'exact materialized target bytes',
      output: 'lowercase hex',
    },
    manifest: runtimeManifest,
    payload: {
      source: 'contract.payload.entries',
      staticEntryKind: 'static',
      templateEntryKind: 'template',
      templateAction: 'render with materialization substitutions',
    },
    render: {
      engine: 'lumina-template-v1',
      lineEndings: 'lf',
      conditionals: 'non-nested-truthy',
      unknownVariables: 'empty-string',
      readme: {
        purpose: '',
        defaultPurpose: DEFAULT_README_PURPOSE,
        heading: '## Project Purpose',
        insertion: 'immediately before the first <!-- lumina:schema --> marker',
      },
    },
    serialization: {
      config: {
        format: 'lumina-yaml-v1',
        header: [
          '# lumina.config.yaml — workspace config managed by lumina-wiki installer.',
          '# Lives at _lumina/config/lumina.config.yaml. Editable by hand.',
          '',
        ],
        indentation: 2,
        keyOrder: 'UTF-8 byte order',
        lineWidth: 100,
      },
      manifest: {
        format: 'canonical-json-v1',
        indentation: 2,
        keyOrder: 'UTF-8 byte order',
      },
      csv: {
        format: 'lumina-csv-v1',
        delimiter: ',',
        quote: '"',
        quoteWhen: 'field contains comma, quote, CR, or LF',
        escapedQuote: '""',
      },
      finalNewline: true,
    },
    state: {
      filesCsv: {
        columns: FILES_CSV_HEADER.split(','),
        rows: 'contract.state.managedFilePaths in order after exact target hashes',
        sourcePack: 'core',
        installedVersion: installerPackage,
      },
      skillsCsv: {
        columns: SKILLS_CSV_HEADER.split(','),
        rows: workspace.state.skillRows,
        relativePath: '.agents/skills/{canonical_id}',
      },
      writeOrder: [
        'payload and rendered files',
        '_lumina/manifest.json',
        '_lumina/_state/skills-manifest.csv',
        '_lumina/_state/files-manifest.csv',
      ],
    },
  };
}

async function packageVersion(repoRoot) {
  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json must contain a non-empty version');
  }
  return packageJson.version;
}

async function readConformanceFixture(fixturePath) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (fixture.profile !== CORE_PROFILE.id) {
    throw new Error(`fixture profile must be ${CORE_PROFILE.id}`);
  }
  if (typeof fixture.projectName !== 'string' || fixture.projectName.length === 0) {
    throw new Error('fixture projectName must be non-empty');
  }
  const now = new Date(fixture.now);
  if (Number.isNaN(now.valueOf()) || now.toISOString() !== fixture.now) {
    throw new Error('fixture now must be canonical UTC ISO-8601');
  }
  return { fixture, now };
}

async function buildGeneratedContract({ repoRoot, fixturePath }) {
  const { now } = await readConformanceFixture(fixturePath);
  const version = await packageVersion(repoRoot);
  const workspace = projectWorkspace({
    ...CORE_PROFILE,
    projectName: '$runtime.projectName',
    packageVersion: version,
    projectRoot: '$runtime.root',
    symlinkStrategies: {},
  }, { now });
  const directories = workspace.directories;
  const sources = workspace.payloadSources;
  const collected = await collectPayloadSources({ repoRoot, directories, sources });
  const directoryEntries = collected.filter(entry => entry.kind === 'directory');
  const fileEntries = collected.filter(entry => entry.kind !== 'directory');
  const skills = workspace.skills.map(skill => ({
    canonicalId: skill.canonicalId,
    displayName: skill.displayName,
    inert: true,
    name: skill.name,
    pack: skill.pack,
    sourcePath: `src/skills/${skill.srcPackPath}/${skill.name}`,
  }));
  const payloadEntries = fileEntries.map(({ path, kind, size, sha256: digest }) => ({
    path,
    kind,
    size,
    sha256: digest,
  }));
  const allDigestEntries = collected.map(({ path, kind, size, sha256: digest }) => ({
    path,
    kind,
    size,
    sha256: digest,
  }));
  const totalBytes = fileEntries.reduce((total, entry) => total + entry.size, 0);

  const contract = {
    versions: {
      contract: CONTRACT_VERSION,
      installerPackage: version,
      manifestSchema: MANIFEST_SCHEMA_VERSION,
      wikiSchema: SCHEMA_VERSION,
    },
    profile: CORE_PROFILE,
    directories: directoryEntries.map(entry => entry.path),
    limits: {
      directoryCount: directoryEntries.length,
      fileCount: fileEntries.length,
      maxFileBytes: Math.max(...fileEntries.map(entry => entry.size)),
      maxLogicalPathBytes: Math.max(
        ...collected.map(entry => Buffer.byteLength(entry.path, 'utf8')),
      ),
      totalBytes,
    },
    lintCheckIds: LINT_CHECK_IDS,
    materialization: materializationRecipe(workspace, version),
    payload: {
      entries: payloadEntries,
      rootDigest: payloadRootDigest(allDigestEntries),
      rootDigestRecord: '<kind>\\0<path>\\0<size>\\0<sha256-or-dash>\\n',
      totalBytes,
      totalDirectories: directoryEntries.length,
      totalFiles: fileEntries.length,
    },
    schema: {
      edgeTypes: EDGE_TYPES,
      entityDirs: ENTITY_DIRS,
      enums: ENUMS,
      exemptionGlobs: EXEMPTION_GLOBS,
      externalIdNamespaces: EXTERNAL_ID_NAMESPACES,
      lintCheckIds: LINT_CHECK_IDS,
      packManifestShape: PACK_MANIFEST_SHAPE,
      rawDirs: RAW_DIRS,
      requiredFrontmatter: REQUIRED_FRONTMATTER,
    },
    skills,
    state: {
      filesCsvHeader: FILES_CSV_HEADER,
      filesCsvPath: '_lumina/_state/files-manifest.csv',
      managedFilePaths: workspace.state.managedFilePaths,
      manifestPath: '_lumina/manifest.json',
      skillsCsvHeader: SKILLS_CSV_HEADER,
      skillsCsvPath: '_lumina/_state/skills-manifest.csv',
    },
  };

  return { contract, collected };
}

async function writeGeneratedTree(stageDir, generated) {
  const payloadDir = join(stageDir, 'payload');
  await mkdir(payloadDir, { recursive: true });
  for (const entry of generated.collected) {
    const destination = join(payloadDir, ...entry.path.split('/'));
    if (entry.kind === 'directory') {
      await mkdir(destination, { recursive: true });
    } else {
      await atomicWrite(destination, entry.bytes);
    }
  }
  const contractBytes = canonicalJSON(generated.contract);
  await atomicWrite(join(stageDir, 'contract.json'), contractBytes);
  await atomicWrite(
    join(stageDir, 'contract.sha256'),
    `${sha256(Buffer.from(contractBytes, 'utf8'))}\n`,
  );
}

async function replaceGeneratedTree(outputDir, stageDir) {
  const backupDir = `${outputDir}.backup-${randomUUID()}`;
  let hadOutput = false;
  try {
    await access(outputDir);
    hadOutput = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (hadOutput) await rename(outputDir, backupDir);
  try {
    await rename(stageDir, outputDir);
  } catch (error) {
    if (hadOutput) await rename(backupDir, outputDir).catch(() => {});
    throw error;
  }
  if (hadOutput) {
    // Replacement already committed. Cleanup failure must not report the
    // generation itself as failed or attempt an impossible rollback.
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateDesktopContract({
  repoRoot = DEFAULT_REPO_ROOT,
  outputDir = DEFAULT_ASSETS_DIR,
  fixturePath = DEFAULT_FIXTURE,
} = {}) {
  const absoluteRoot = resolve(repoRoot);
  const absoluteOutput = resolve(outputDir);
  const absoluteFixture = resolve(fixturePath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  const stageDir = join(
    dirname(absoluteOutput),
    `.${basename(absoluteOutput)}.stage-${randomUUID()}`,
  );
  await mkdir(stageDir);
  try {
    const generated = await buildGeneratedContract({
      repoRoot: absoluteRoot,
      fixturePath: absoluteFixture,
    });
    await writeGeneratedTree(stageDir, generated);
    await replaceGeneratedTree(absoluteOutput, stageDir);
    return generated.contract;
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

async function treeSnapshot(root) {
  const items = new Map();
  async function walk(current, logicalPrefix = '') {
    let children;
    try {
      children = await readdir(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`generated tree is missing: ${root}`);
      throw error;
    }
    children.sort(compareUtf8);
    for (const child of children) {
      const absolute = join(current, child);
      const logical = logicalPrefix ? `${logicalPrefix}/${child}` : child;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`generated tree contains symlink: ${logical}`);
      if (info.isDirectory()) {
        items.set(logical, { kind: 'directory' });
        await walk(absolute, logical);
      } else if (info.isFile()) {
        items.set(logical, { kind: 'file', bytes: await readFile(absolute) });
      } else {
        throw new Error(`generated tree contains special entry: ${logical}`);
      }
    }
  }
  await walk(root);
  return items;
}

async function compareGeneratedTrees(expectedDir, actualDir) {
  const [expected, actual] = await Promise.all([
    treeSnapshot(expectedDir),
    treeSnapshot(actualDir),
  ]);
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort(compareUtf8);
  const differences = [];
  for (const path of paths) {
    const left = expected.get(path);
    const right = actual.get(path);
    if (!left) {
      differences.push(`extra ${path}`);
    } else if (!right) {
      differences.push(`missing ${path}`);
    } else if (left.kind !== right.kind) {
      differences.push(`kind ${path}`);
    } else if (left.kind === 'file' && !left.bytes.equals(right.bytes)) {
      differences.push(`modified ${path}`);
    }
  }
  if (differences.length > 0) {
    throw new Error(`generated desktop contract differs: ${differences.join(', ')}`);
  }
}

export async function checkDesktopContract({
  repoRoot = DEFAULT_REPO_ROOT,
  assetsDir = DEFAULT_ASSETS_DIR,
  fixturePath = DEFAULT_FIXTURE,
} = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'lumina-desktop-contract-check-'));
  try {
    const generatedDir = join(temporaryRoot, 'assets');
    await generateDesktopContract({
      repoRoot,
      outputDir: generatedDir,
      fixturePath,
    });
    await compareGeneratedTrees(generatedDir, resolve(assetsDir));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(args) {
  if (args.length === 0) {
    await generateDesktopContract();
    return;
  }
  if (args.length === 1 && args[0] === '--check') {
    await checkDesktopContract();
    return;
  }
  throw new Error(`usage: node scripts/generate-desktop-contract.mjs [--check]`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
