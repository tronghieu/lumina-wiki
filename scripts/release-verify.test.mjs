import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveChannel } from './release-verify.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('deriveChannel', () => {
  // Each row is the contract publish.yml documents in its own comments.
  const stable = [
    ['1.13.0', 'a plain version publishes to latest'],
    ['1.12.0', 'the version that was never tagged is still a stable one'],
    ['0.1.0', 'pre-1.0 versions are stable too'],
  ];

  for (const [version, why] of stable) {
    test(`${version} -> latest (${why})`, () => {
      assert.deepEqual(deriveChannel(version), { channel: 'latest', prerelease: false });
    });
  }

  const prerelease = [
    ['1.12.0-next.0', 'next'],
    ['1.13.0-next.0', 'next'],
    ['1.12.0-rc.1', 'rc'],
    ['1.12.0-beta.7', 'beta'],
    ['1.2.3-next', 'next', 'no counter is still a channel'],
    ['1.2.3-next-beta.0', 'next-beta', 'a hyphen inside the identifier survives'],
  ];

  for (const [version, channel, why] of prerelease) {
    test(`${version} -> ${channel}${why ? ` (${why})` : ''}`, () => {
      assert.deepEqual(deriveChannel(version), { channel, prerelease: true });
    });
  }

  // Build metadata is not part of precedence, and is stripped before the
  // pre-release identifier is read. It can itself contain or trail a hyphen,
  // which is exactly where a naive split gets this wrong.
  test('1.2.3+build-next is stable, not a next release', () => {
    assert.deepEqual(deriveChannel('1.2.3+build-next'), { channel: 'latest', prerelease: false });
  });

  test('1.2.3-next+build keeps its channel after metadata is stripped', () => {
    assert.deepEqual(deriveChannel('1.2.3-next+build'), { channel: 'next', prerelease: true });
  });

  // An identifier that cannot be read as a channel is a hard stop. Publishing
  // it would either move `latest` by accident or be refused by npm after the
  // gates have already run.
  const rejected = [
    ['1.2.3-', 'empty identifier'],
    ['1.2.3-NEXT.0', 'uppercase'],
    ['1.2.3-0.1', 'purely numeric'],
    ['1.2.3-1', 'numeric'],
    ['1.2.3-latest', 'literally latest, which would move the default channel'],
    ['1.2.3-x', 'npm parses x as a version range'],
    ['1.2.3-v1', 'npm parses v1 as a version range'],
    ['1.2.3-v12', 'any v-then-digits parses as a range'],
  ];

  for (const [version, why] of rejected) {
    test(`${version} is refused (${why})`, () => {
      const result = deriveChannel(version);
      assert.ok(result.error, `expected ${version} to be refused, got ${JSON.stringify(result)}`);
      assert.match(result.error, /unusable pre-release channel/);
    });
  }

  test('a rejected version never reports a channel to publish to', () => {
    for (const [version] of rejected) {
      const result = deriveChannel(version);
      assert.equal(result.channel, undefined);
      assert.equal(result.prerelease, undefined);
    }
  });
});

// deriveChannel is a deliberate mirror of the bash in publish.yml. Nothing
// stops the two from drifting except this: if the workflow's conditions are
// edited, this fails and points at the copy that also needs updating.
describe('publish.yml has not drifted from deriveChannel', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/publish.yml'), 'utf8');

  const required = [
    ['precedence="${version%%+*}"', 'strips build metadata before reading the identifier'],
    ['channel="${precedence#*-}"', 'takes everything after the first hyphen'],
    ['channel="${channel%%.*}"', 'then everything before the first dot'],
    ['^[a-z][a-z0-9-]*$', 'shape of an acceptable channel'],
    ['[ "$channel" = "latest" ]', 'refuses to move the default channel'],
    ['[ "$channel" = "x" ]', 'refuses the x range'],
    ['^v[0-9]+$', 'refuses v-then-digits ranges'],
  ];

  for (const [snippet, why] of required) {
    test(`still present: ${why}`, () => {
      assert.ok(
        workflow.includes(snippet),
        `publish.yml no longer contains ${JSON.stringify(snippet)}. ` +
          'If the channel rules changed there, update deriveChannel in ' +
          'scripts/release-verify.mjs to match, then update this test.',
      );
    });
  }

  test('the workflow still triggers only on v* tags', () => {
    // The whole premise of release-verify is that nothing else publishes.
    assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*-\s*["']v\*["']/);
  });
});
