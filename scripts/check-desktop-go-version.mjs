#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const APPROVED_DESKTOP_GO_TOOLCHAIN = 'go1.25.12';

export function parseGoToolchainVersion(output) {
  const match = /\bgo version go(\d+)\.(\d+)\.(\d+)\b/.exec(output);
  if (!match) throw new Error(`unable to parse Go version output: ${JSON.stringify(output)}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    name: `go${match[1]}.${match[2]}.${match[3]}`,
  };
}

export function isPatchedForDesktop(version) {
  if (version.major !== 1) return false;
  if (version.minor === 25) return version.patch >= 12;
  if (version.minor === 26) return version.patch >= 5;
  return false;
}

export function checkDesktopGoVersion({
  env = process.env,
  runGoVersion = () => spawnSync('go', ['version'], {
    encoding: 'utf8',
    env,
  }),
} = {}) {
  if (env.GOTOOLCHAIN !== APPROVED_DESKTOP_GO_TOOLCHAIN) {
    throw new Error(
      `GOTOOLCHAIN must be exactly ${APPROVED_DESKTOP_GO_TOOLCHAIN}; received `
      + `${JSON.stringify(env.GOTOOLCHAIN ?? '')}`,
    );
  }

  const result = runGoVersion();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`go version failed (${result.status}): ${result.stderr || result.stdout}`);
  }

  const version = parseGoToolchainVersion(result.stdout);
  if (!isPatchedForDesktop(version)) {
    throw new Error(`Go ${version.name} is not patched for Desktop rooted filesystem work`);
  }
  if (version.name !== APPROVED_DESKTOP_GO_TOOLCHAIN) {
    throw new Error(
      `Go ${version.name} is patched but not reviewed; expected `
      + APPROVED_DESKTOP_GO_TOOLCHAIN,
    );
  }
  return version;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const version = checkDesktopGoVersion();
    process.stdout.write(`[ok] Desktop Go toolchain: ${version.name}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
