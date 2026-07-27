import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertExternalWorkspaceRoot,
  canonicalJSON,
  checkDesktopContract,
  collectPayloadSources,
  generateDesktopContract,
  payloadRootDigest,
  sha256,
  validateLogicalPath,
} from './generate-desktop-contract.mjs';
import { installCommand } from '../src/installer/commands.js';
import {
  readFilesManifest,
  readManifest,
  readSkillsManifest,
} from '../src/installer/manifest.js';
import {
  CORE_PROFILE,
  buildConfigObject,
  buildManifestObject,
  buildTemplateVariables,
} from '../src/installer/workspace-definition.js';
import { render, renderReadme } from '../src/installer/template-engine.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = join(REPO_ROOT, 'scripts', 'generate-desktop-contract.mjs');
const FIXTURE = join(REPO_ROOT, 'apps', 'desktop', 'internal', 'contract', 'testdata', 'core-generic-en.json');

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'lumina-desktop-contract-test-'));
}

async function snapshot(root) {
  const result = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const path = relative(root, absolute).split('\\').join('/');
      if (entry.isDirectory()) {
        result.push({ path, kind: 'directory' });
        await walk(absolute);
      } else {
        result.push({ path, kind: 'file', bytes: await readFile(absolute) });
      }
    }
  }
  await walk(root);
  return result;
}

function serializeCsv(rows, columns) {
  const escape = value => {
    const string = String(value ?? '');
    return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  };
  return `${[
    columns.join(','),
    ...rows.map(row => columns.map(column => escape(row[column])).join(',')),
  ].join('\n')}\n`;
}

test('canonical JSON sorts object keys recursively, preserves arrays, and ends in one LF', () => {
  assert.equal(
    canonicalJSON({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }, 1] }),
    '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "list": [\n    {\n      "c": 5,\n      "d": 4\n    },\n    1\n  ],\n  "z": 1\n}\n',
  );
});

test('CLI rejects every flag except --check', () => {
  const result = spawnSync(process.execPath, [GENERATOR, '--unknown'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node scripts\/generate-desktop-contract\.mjs \[--check\]/);
});

test('logical paths reject absolute, traversal, dot, empty, NUL, and backslash forms', () => {
  for (const path of [
    '',
    '.',
    './x',
    '../x',
    'x/../y',
    '/x',
    'C:\\x',
    'x\\y',
    'x//y',
    'x/\0y',
    'CON',
    'dir/NUL.txt',
    'name.',
    'name ',
    'dir/name:stream',
  ]) {
    assert.throws(() => validateLogicalPath(path), { name: 'RangeError' }, path);
  }
  assert.equal(validateLogicalPath('.agents/skills/lumi-init/SKILL.md'), '.agents/skills/lumi-init/SKILL.md');
});

test('payload collection rejects duplicate and case-colliding targets', async () => {
  const root = await tempDir();
  try {
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: root,
        directories: [],
        sources: [
          { sourcePath: 'a.txt', targetPath: 'same.txt', kind: 'static' },
          { sourcePath: 'b.txt', targetPath: 'same.txt', kind: 'static' },
        ],
      }),
      /duplicate logical path/i,
    );
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: root,
        directories: [],
        sources: [
          { sourcePath: 'a.txt', targetPath: 'Case.txt', kind: 'static' },
          { sourcePath: 'b.txt', targetPath: 'case.txt', kind: 'static' },
        ],
      }),
      /case-colliding logical path/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('payload collection fails closed for missing and symlink sources', async () => {
  const root = await tempDir();
  try {
    await writeFile(join(root, 'real.txt'), 'bytes');
    await symlink(join(root, 'real.txt'), join(root, 'link.txt'));
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: root,
        directories: [],
        sources: [{ sourcePath: 'missing.txt', targetPath: 'missing.txt', kind: 'static' }],
      }),
      /missing selected source/i,
    );
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: root,
        directories: [],
        sources: [{ sourcePath: 'link.txt', targetPath: 'link.txt', kind: 'static' }],
      }),
      /symlink/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('payload collection rejects a symlink in any selected source ancestor', async () => {
  const root = await tempDir();
  try {
    const repo = join(root, 'repo');
    const outside = join(root, 'outside');
    await mkdir(repo);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await symlink(outside, join(repo, 'via-link'), 'dir');
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: repo,
        directories: [],
        sources: [{
          sourcePath: 'via-link/secret.txt',
          targetPath: 'secret.txt',
          kind: 'static',
        }],
      }),
      /symlink component/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace safety guard rejects repository paths and symlinks into them', async () => {
  const root = await tempDir();
  try {
    const descendant = join(REPO_ROOT, 'src');
    const link = join(root, 'repo-link');
    await symlink(REPO_ROOT, link, 'dir');
    await assert.rejects(
      () => assertExternalWorkspaceRoot(REPO_ROOT, REPO_ROOT),
      /outside repository/i,
    );
    await assert.rejects(
      () => assertExternalWorkspaceRoot(REPO_ROOT, descendant),
      /outside repository/i,
    );
    await assert.rejects(
      () => assertExternalWorkspaceRoot(REPO_ROOT, link),
      /outside repository/i,
    );
    assert.equal(
      await assertExternalWorkspaceRoot(REPO_ROOT, root),
      await import('node:fs/promises').then(fs => fs.realpath(root)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('payload collection rejects special filesystem entries', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir();
  try {
    const fifo = join(root, 'pipe');
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    await assert.rejects(
      () => collectPayloadSources({
        repoRoot: root,
        directories: [],
        sources: [{ sourcePath: 'pipe', targetPath: 'pipe', kind: 'static' }],
      }),
      /special filesystem entry/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hash helpers use bytes and the canonical payload record format', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const entries = [
    { path: 'empty', kind: 'directory', size: 0, sha256: null },
    { path: 'file.txt', kind: 'static', size: 3, sha256: sha256(Buffer.from('abc')) },
  ];
  assert.equal(payloadRootDigest(entries), sha256(Buffer.from(
    'directory\u0000empty\u00000\u0000-\nstatic\u0000file.txt\u00003\u0000ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n',
  )));
});

test('repeated generation is byte-identical and contract is strict core-generic-en data', async () => {
  const root = await tempDir();
  try {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: first, fixturePath: FIXTURE });
    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: second, fixturePath: FIXTURE });
    assert.deepEqual(await snapshot(first), await snapshot(second));

    const raw = await readFile(join(first, 'contract.json'), 'utf8');
    assert.equal(raw, canonicalJSON(JSON.parse(raw)));
    assert.ok(!raw.includes(REPO_ROOT));
    assert.ok(!raw.includes(root));
    assert.ok(!raw.includes(FIXTURE));
    const contract = JSON.parse(raw);
    const packageVersion = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
    ).version;
    assert.deepEqual(contract.versions, {
      contract: 1,
      installerPackage: packageVersion,
      manifestSchema: 4,
      wikiSchema: '0.1.0',
    });
    assert.equal(contract.profile.id, 'core-generic-en');
    assert.deepEqual(contract.profile.packs, ['core']);
    assert.deepEqual(contract.profile.ideTargets, ['generic']);
    assert.equal(contract.skills.length, 9);
    assert.ok(!('operations' in contract));
    assert.ok(contract.directories.includes('.agents/skills'));
    assert.ok(contract.directories.includes('_lumina/_state'));
    assert.ok(contract.directories.includes('wiki/readings'));
    assert.ok(!contract.directories.includes('wiki/reflections'));
    assert.equal(contract.limits.fileCount, contract.payload.totalFiles);
    assert.equal(contract.limits.directoryCount, contract.payload.totalDirectories);
    assert.equal(contract.limits.totalBytes, contract.payload.totalBytes);
    assert.ok(contract.limits.maxFileBytes > 0);
    assert.ok(contract.limits.maxLogicalPathBytes > 0);
    assert.equal(contract.materialization.version, 1);
    assert.deepEqual(contract.materialization.runtimeInputs, ['projectName', 'now', 'root']);
    assert.ok(contract.materialization.allowedSubstitutions.includes('project_name'));
    assert.equal(contract.materialization.hash.algorithm, 'sha256');
    assert.equal(contract.materialization.render.lineEndings, 'lf');
    assert.match(
      contract.materialization.render.readme.defaultPurpose,
      /Describe what this wiki is for/,
    );
    assert.equal(
      contract.materialization.state.skillsCsv.rows[0].relative_path,
      '.agents/skills/lumi-init',
    );

    const checksum = await readFile(join(first, 'contract.sha256'), 'utf8');
    assert.equal(checksum, `${sha256(Buffer.from(raw))}\n`);
    await readFile(join(first, 'payload', '.gitignore'));
    await readFile(join(first, 'payload', '.agents', 'skills', 'lumi-init', 'SKILL.md'));
    await readFile(join(first, 'payload', '_lumina', 'scripts', 'wiki.mjs'));
    await assert.rejects(() => readFile(join(first, 'payload', '.claude', 'skills', 'lumi-init', 'SKILL.md')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generated inventory conforms to a canonical core-generic-en installer workspace', async () => {
  const root = await tempDir();
  try {
    const assets = join(root, 'assets');
    const workspace = join(root, 'workspace');
    const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
    await mkdir(workspace);
    await assertExternalWorkspaceRoot(REPO_ROOT, workspace);
    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: assets, fixturePath: FIXTURE });
    await installCommand({
      cwd: workspace,
      yes: true,
      noUpdate: true,
      packs: CORE_PROFILE.packs,
      ideTargets: CORE_PROFILE.ideTargets,
      projectName: fixture.projectName,
      communicationLang: CORE_PROFILE.communicationLang,
      documentOutputLang: CORE_PROFILE.documentOutputLang,
      lang: CORE_PROFILE.locale,
    }, { now: new Date(fixture.now) });

    const contract = JSON.parse(await readFile(join(assets, 'contract.json'), 'utf8'));
    const actual = await snapshot(workspace);
    const actualPaths = actual.map(item => item.path).sort();
    const expectedPaths = [
      ...contract.directories,
      ...contract.payload.entries.map(entry => entry.path),
      contract.state.manifestPath,
      contract.state.skillsCsvPath,
      contract.state.filesCsvPath,
      '_lumina/config/lumina.config.yaml',
    ].sort();
    assert.deepEqual(actualPaths, expectedPaths);

    for (const entry of contract.payload.entries.filter(item => item.kind === 'static')) {
      assert.deepEqual(
        await readFile(join(workspace, ...entry.path.split('/'))),
        await readFile(join(assets, 'payload', ...entry.path.split('/'))),
        entry.path,
      );
    }

    const yaml = await import('js-yaml');
    const actualConfig = yaml.load(
      await readFile(join(workspace, '_lumina', 'config', 'lumina.config.yaml'), 'utf8'),
    );
    const profile = { ...CORE_PROFILE, projectName: fixture.projectName };
    const expectedConfig = structuredClone(
      buildConfigObject(profile, buildTemplateVariables(profile, new Date(fixture.now))),
    );
    assert.deepEqual(actualConfig, expectedConfig);
    const actualVariables = buildTemplateVariables(
      profile,
      new Date(fixture.now),
    );
    for (const entry of contract.payload.entries.filter(item => item.kind === 'template')) {
      const template = await readFile(
        join(assets, 'payload', ...entry.path.split('/')),
        'utf8',
      );
      const expected = entry.path === 'README.md'
        ? renderReadme(template, actualVariables, '')
        : render(template, actualVariables);
      assert.equal(
        await readFile(join(workspace, ...entry.path.split('/')), 'utf8'),
        expected,
        entry.path,
      );
    }

    const manifest = await readManifest(workspace);
    assert.deepEqual(
      manifest,
      buildManifestObject({
        packageVersion: contract.versions.installerPackage,
        locale: 'en',
        packs: ['core'],
        ideTargets: ['generic'],
        symlinkStrategies: {},
        projectRoot: workspace,
      }, new Date(fixture.now)),
    );
    assert.equal(
      await readFile(join(workspace, contract.state.manifestPath), 'utf8'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const skillRows = await readSkillsManifest(workspace);
    const expectedSkillRows = contract.skills.map(skill => ({
      canonical_id: skill.canonicalId,
      display_name: skill.displayName,
      pack: skill.pack,
      source: 'built-in',
      relative_path: `.agents/skills/${skill.canonicalId}`,
      target_link_path: '',
      version: contract.versions.installerPackage,
    }));
    assert.deepEqual(skillRows, expectedSkillRows);
    assert.equal(
      await readFile(join(workspace, contract.state.skillsCsvPath), 'utf8'),
      serializeCsv(expectedSkillRows, contract.state.skillsCsvHeader.split(',')),
    );

    const fileRows = await readFilesManifest(workspace);
    const expectedFileRows = await Promise.all(
      contract.state.managedFilePaths.map(async relativePath => ({
        relative_path: relativePath,
        sha256: sha256(await readFile(join(workspace, ...relativePath.split('/')))),
        source_pack: 'core',
        installed_version: contract.versions.installerPackage,
      })),
    );
    assert.deepEqual(fileRows, expectedFileRows);
    assert.equal(
      await readFile(join(workspace, contract.state.filesCsvPath), 'utf8'),
      serializeCsv(expectedFileRows, contract.state.filesCsvHeader.split(',')),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--check detects modified, missing, and extra generated files without rewriting assets', async () => {
  const root = await tempDir();
  try {
    const assets = join(root, 'assets');
    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: assets, fixturePath: FIXTURE });
    const pristine = await snapshot(assets);
    await checkDesktopContract({ repoRoot: REPO_ROOT, assetsDir: assets, fixturePath: FIXTURE });
    assert.deepEqual(await snapshot(assets), pristine);

    await writeFile(join(assets, 'contract.sha256'), 'modified\n');
    const modified = await snapshot(assets);
    await assert.rejects(
      () => checkDesktopContract({ repoRoot: REPO_ROOT, assetsDir: assets, fixturePath: FIXTURE }),
      /generated desktop contract differs/i,
    );
    assert.deepEqual(await snapshot(assets), modified);

    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: assets, fixturePath: FIXTURE });
    await rm(join(assets, 'payload', '.gitignore'));
    await assert.rejects(
      () => checkDesktopContract({ repoRoot: REPO_ROOT, assetsDir: assets, fixturePath: FIXTURE }),
      /generated desktop contract differs/i,
    );

    await generateDesktopContract({ repoRoot: REPO_ROOT, outputDir: assets, fixturePath: FIXTURE });
    await mkdir(join(assets, 'extra'));
    await writeFile(join(assets, 'extra', 'file'), 'extra');
    await assert.rejects(
      () => checkDesktopContract({ repoRoot: REPO_ROOT, assetsDir: assets, fixturePath: FIXTURE }),
      /generated desktop contract differs/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
