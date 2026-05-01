#!/usr/bin/env node
/**
 * CI package-readiness check.
 *
 * Runs `npm pack --dry-run --json`, rejects dev artifacts, and verifies the
 * runtime package contains the files required to install a workspace.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const npmCache = process.env.LUMINA_NPM_CACHE || join(tmpdir(), 'lumina-npm-cache');
const npmHome = join(tmpdir(), 'lumina-npm-home');
const npmUserConfig = join(npmHome, '.npmrc');
mkdirSync(npmCache, { recursive: true });
mkdirSync(npmHome, { recursive: true });
writeFileSync(npmUserConfig, `cache=${npmCache}\n`, 'utf8');

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
);
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmExecutable, [
  'pack',
  '--dry-run',
  '--json',
  '--cache',
  npmCache,
  '--userconfig',
  npmUserConfig,
], {
  encoding: 'utf8',
  timeout: 60000,
  env: {
    ...cleanEnv,
    HOME: npmHome,
    USERPROFILE: npmHome,
    npm_config_cache: npmCache,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_userconfig: npmUserConfig,
  },
});

if (result.status !== 0) {
  throw new Error([
    `npm pack --dry-run failed (${result.status})`,
    result.stdout?.trim(),
    result.stderr?.trim(),
  ].filter(Boolean).join('\n'));
}

const pack = JSON.parse(result.stdout)[0];
const files = pack.files.map(f => f.path);

const prohibitedPatterns = [
  /(^|\/).*\.test\.[cm]?js$/,
  /^src\/tools\/tests\//,
  /(^|\/)__pycache__\//,
  /\.pyc$/,
  /(^|\/)_lumina\/_state\//,
  /^docs\/planning-artifacts\//,
  /^\.github\//,
  /^scripts\/ci-/,
];

const requiredFiles = [
  'bin/lumina.js',
  'src/installer/commands.js',
  'src/scripts/wiki.mjs',
  'src/scripts/lint.mjs',
  'src/scripts/reset.mjs',
  'src/skills/core/init/SKILL.md',
  'src/skills/packs/research/discover/SKILL.md',
  'src/skills/packs/reading/chapter-ingest/SKILL.md',
  'src/templates/README.md',
  'src/tools/extract_pdf.py',
  'src/tools/prepare_source.py',
  'src/tools/requirements.txt',
  'README.md',
  'LICENSE',
];

const prohibited = files.filter(path => prohibitedPatterns.some(re => re.test(path)));
if (prohibited.length > 0) {
  throw new Error(`Package contains prohibited files:\n${prohibited.join('\n')}`);
}

const missing = requiredFiles.filter(path => !files.includes(path));
if (missing.length > 0) {
  throw new Error(`Package is missing required runtime files:\n${missing.join('\n')}`);
}

if (pack.scripts?.postinstall) {
  throw new Error('Package must not define a postinstall script');
}

console.log(`[ok] package ${pack.name}@${pack.version}: ${files.length} files`);
