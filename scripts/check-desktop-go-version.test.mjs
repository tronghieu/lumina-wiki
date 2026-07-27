import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPROVED_DESKTOP_GO_TOOLCHAIN,
  checkDesktopGoVersion,
  isPatchedForDesktop,
  parseGoToolchainVersion,
} from './check-desktop-go-version.mjs';

function goResult(version, status = 0) {
  return {
    status,
    stdout: status === 0 ? `go version ${version} darwin/arm64\n` : '',
    stderr: status === 0 ? '' : 'go failed',
  };
}

test('parses the canonical go version output', () => {
  assert.deepEqual(parseGoToolchainVersion('go version go1.25.12 darwin/arm64\n'), {
    major: 1,
    minor: 25,
    patch: 12,
    name: 'go1.25.12',
  });
  assert.throws(() => parseGoToolchainVersion('go version devel'), /unable to parse/i);
});

test('patched policy is branch-aware and rejects vulnerable 1.26 releases', () => {
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.25.11 linux/amd64')), false);
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.25.12 linux/amd64')), true);
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.26.0 linux/amd64')), false);
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.26.4 linux/amd64')), false);
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.26.5 linux/amd64')), true);
  assert.equal(isPatchedForDesktop(parseGoToolchainVersion('go version go1.27.0 linux/amd64')), false);
});

test('preflight requires the exact reviewed environment and runtime toolchain', () => {
  const env = { GOTOOLCHAIN: APPROVED_DESKTOP_GO_TOOLCHAIN };
  assert.equal(
    checkDesktopGoVersion({
      env,
      runGoVersion: () => goResult(APPROVED_DESKTOP_GO_TOOLCHAIN),
    }).name,
    APPROVED_DESKTOP_GO_TOOLCHAIN,
  );
  assert.throws(
    () => checkDesktopGoVersion({
      env: {},
      runGoVersion: () => goResult(APPROVED_DESKTOP_GO_TOOLCHAIN),
    }),
    /GOTOOLCHAIN must be exactly/i,
  );
  assert.throws(
    () => checkDesktopGoVersion({
      env,
      runGoVersion: () => goResult('go1.26.1'),
    }),
    /not patched/i,
  );
  assert.throws(
    () => checkDesktopGoVersion({
      env,
      runGoVersion: () => goResult('go1.26.5'),
    }),
    /not reviewed/i,
  );
});

test('preflight reports go command failures', () => {
  assert.throws(
    () => checkDesktopGoVersion({
      env: { GOTOOLCHAIN: APPROVED_DESKTOP_GO_TOOLCHAIN },
      runGoVersion: () => goResult(APPROVED_DESKTOP_GO_TOOLCHAIN, 2),
    }),
    /go version failed/i,
  );
});
