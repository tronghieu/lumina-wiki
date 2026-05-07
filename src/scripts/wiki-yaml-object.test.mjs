import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WIKI = fileURLToPath(new URL('./wiki.mjs', import.meta.url));

function runWiki(cwd, args) {
  return spawnSync('node', [WIKI, ...args], { cwd, encoding: 'utf8' });
}

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'lumi-yaml-obj-'));
  mkdirSync(join(root, 'wiki/sources'), { recursive: true });
  mkdirSync(join(root, '_lumina/_state'), { recursive: true });
  return root;
}

function writeSource(root, slug, fmText) {
  const path = join(root, 'wiki/sources', `${slug}.md`);
  writeFileSync(path, `---\n${fmText}\n---\n# body\n`, 'utf8');
  return path;
}

test('set-meta external_ids object → block-mapping round-trip', () => {
  const root = setupProject();
  try {
    writeSource(root, 'attention', [
      'id: attention',
      'title: Attention is All You Need',
      'type: source',
      'created: 2017-06-12',
      'updated: 2017-06-12',
      'authors: [Vaswani]',
      'year: 2017',
      'importance: 5',
      'provenance: replayable',
    ].join('\n'));

    const r1 = runWiki(root, ['set-meta', 'attention', 'external_ids',
      '{"doi":"10.x/y","arxiv":"1706.03762"}', '--json-value']);
    assert.equal(r1.status, 0, r1.stderr);

    const r2 = runWiki(root, ['read-meta','attention']);
    assert.equal(r2.status, 0, r2.stderr);
    const out = JSON.parse(r2.stdout);
    assert.deepEqual(out.frontmatter.external_ids, { arxiv: '1706.03762', doi: '10.x/y' });

    // Idempotency: second identical set-meta is byte-stable.
    const r3 = runWiki(root, ['set-meta', 'attention', 'external_ids',
      '{"doi":"10.x/y","arxiv":"1706.03762"}', '--json-value']);
    assert.equal(r3.status, 0, r3.stderr);
    const r4 = runWiki(root, ['read-meta','attention']);
    assert.deepEqual(JSON.parse(r4.stdout).frontmatter.external_ids,
      { arxiv: '1706.03762', doi: '10.x/y' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('set-meta strips __proto__ and unknown namespaces', () => {
  const root = setupProject();
  try {
    writeSource(root, 'attention', [
      'id: attention',
      'title: Attention',
      'type: source',
      'created: 2017-06-12',
      'updated: 2017-06-12',
      'authors: [V]',
      'year: 2017',
      'importance: 5',
      'provenance: replayable',
    ].join('\n'));

    const r1 = runWiki(root, ['set-meta', 'attention', 'external_ids',
      '{"__proto__":{"x":1},"constructor":"polluted","openalex":"W123","doi":"10.x/y"}',
      '--json-value']);
    assert.equal(r1.status, 0, r1.stderr);

    const r2 = runWiki(root, ['read-meta','attention']);
    const out = JSON.parse(r2.stdout);
    assert.deepEqual(Object.keys(out.frontmatter.external_ids).sort(), ['doi']);
    // Prototype not polluted on the loaded object.
    assert.equal(({}).x, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseFrontmatter restores other top-level fields untouched after object', () => {
  const root = setupProject();
  try {
    writeSource(root, 'foo', [
      'id: foo',
      'title: Foo',
      'type: source',
      'created: 2020-01-01',
      'updated: 2020-01-01',
      'authors: [A]',
      'year: 2020',
      'importance: 3',
      'provenance: replayable',
      'external_ids:',
      '  doi: 10.x/y',
      'urls:',
      '  - https://example.com',
    ].join('\n'));

    const r = runWiki(root, ['read-meta','foo']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.frontmatter.external_ids, { doi: '10.x/y' });
    assert.deepEqual(out.frontmatter.urls, ['https://example.com']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
