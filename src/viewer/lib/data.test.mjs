/**
 * @file data.test.mjs
 * Contract tests for data.mjs, written from the spec and spine alone.
 * Run: node --test src/viewer/lib/data.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile, appendFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import * as data from './data.mjs';
import { readWiki, readPage, readLint } from './data.mjs';
import { resolveWikilinkTarget, buildBasenameIndex, runLint } from '../../scripts/lint.mjs';
import { EDGE_TYPES, WIKILINK_RE } from '../../scripts/schemas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(HERE, '..', 'test-fixtures', 'contract');
const WORKSPACE = join(CONTRACT, 'workspace');

const readJson = async (name) => JSON.parse(await readFile(join(CONTRACT, 'expected', name), 'utf8'));

/** Relative forward-slash paths of every file under dir. */
async function walkFiles(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(p, base));
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

/** Ids of the page set per AD-4, computed without the module under test. */
async function pageIdsOnDisk(root) {
  const wiki = join(root, 'wiki');
  return (await walkFiles(wiki))
    .filter((f) => f.endsWith('.md') && f.split('/')[0] !== 'graph')
    .map((f) => f.slice(0, -3));
}

/** Run fn against a fresh copy of the fixture workspace. */
async function withCopy(fn) {
  const root = await mkdtemp(join(tmpdir(), 'lumi-view-'));
  try {
    await cp(WORKSPACE, root, { recursive: true });
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const stripGenerated = ({ generatedAt, ...rest }) => rest;

test('module surface: exactly readWiki, readPage, readLint', () => {
  assert.deepEqual(Object.keys(data).sort(), ['readLint', 'readPage', 'readWiki']);
});

test('contract: readWiki equals expected/wiki.json', async () => {
  const result = await readWiki(WORKSPACE);
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  assert.ok(!Number.isNaN(Date.parse(result.generatedAt)));
  const expected = await readJson('wiki.json');
  for (const key of ['nodes', 'edges', 'communities']) assert.deepStrictEqual(result[key], expected[key], key);
});

test('schema is built from the engine tables', async () => {
  const { schema } = await readWiki(WORKSPACE);
  const { ENTITY_DIRS, REQUIRED_FRONTMATTER, WIKILINK_RE } = await import('../../scripts/schemas.mjs');
  assert.deepEqual(schema.entityTypes.map((t) => t.name), Object.keys(ENTITY_DIRS).filter((k) => k !== 'graph'));
  const base = Object.keys(REQUIRED_FRONTMATTER._base);
  for (const t of schema.entityTypes) {
    assert.ok(Array.isArray(t.required) && t.required.every((r) => typeof r === 'string'), t.name);
    for (const b of base) assert.ok(!t.required.includes(b), `${t.name} has base key ${b}`);
  }
  assert.ok(schema.entityTypes.find((t) => t.name === 'sources').required.includes('authors'));
  assert.deepEqual(schema.relationTypes.map((t) => t.name), EDGE_TYPES.map((t) => t.name));
  for (const t of schema.relationTypes) {
    assert.equal(typeof t.symmetric, 'boolean', t.name);
    assert.ok(t.reverse === null || typeof t.reverse === 'string', t.name);
    if (t.symmetric) assert.equal(t.reverse, t.name);
  }
  assert.equal(schema.wikilinkPattern, WIKILINK_RE.source);
});

test('contract: readPage equals each entry of expected/pages.json', async () => {
  const pages = await readJson('pages.json');
  assert.deepEqual(Object.keys(pages).sort(), ['index', 'readings/deep-work/01-focus', 'sources/lora-2']);
  for (const [id, expected] of Object.entries(pages)) {
    // The contract is the JSON on the wire; `links` has a null prototype in memory.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await readPage(WORKSPACE, id))), expected, id);
  }
});

test('contract: readLint equals expected/lint.json', async () => {
  assert.deepStrictEqual(await readLint(WORKSPACE), await readJson('lint.json'));
});

test('oracle: page nodes equal the walk of wiki/ minus graph/', async () => {
  const wiki = await readWiki(WORKSPACE);
  const nodeIds = wiki.nodes.filter((n) => n.kind === 'page').map((n) => n.id).sort();
  assert.deepEqual(nodeIds, (await pageIdsOnDisk(WORKSPACE)).sort());
});

test('oracle: every links value equals resolveWikilinkTarget', async () => {
  const ids = await pageIdsOnDisk(WORKSPACE);
  const pageSet = new Set(ids);
  const idx = buildBasenameIndex(pageSet);
  let checked = 0;
  for (const id of ids) {
    const page = await readPage(WORKSPACE, id);
    for (const [key, value] of Object.entries(page.links)) {
      const expected = key.includes('://') ? null : resolveWikilinkTarget(key, pageSet, idx);
      assert.equal(value, expected, `${id} -> ${key}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('oracle: non-null nodeIds equal resolved runLint finding files', async () => {
  const pageSet = new Set(await pageIdsOnDisk(WORKSPACE));
  const idx = buildBasenameIndex(pageSet);
  const { findings } = await runLint(WORKSPACE, {});
  const expected = new Set();
  for (const f of findings) {
    if (typeof f.file !== 'string') continue;
    const r = resolveWikilinkTarget(f.file, pageSet, idx);
    if (r !== null) expected.add(r);
  }
  const actual = new Set((await readLint(WORKSPACE)).findings.map((f) => f.nodeId).filter((n) => n !== null));
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.ok(actual.size > 0);
});

test('readWiki structure: order, endpoints, communities, titles', async () => {
  const { nodes, edges, communities } = await readWiki(WORKSPACE);
  const lt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i - 1].id < nodes[i].id, `node order at ${i}`);
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1], b = edges[i];
    const c = lt(a.from, b.from) || lt(a.type, b.type) || lt(a.to, b.to);
    assert.ok(c < 0, `edge order at ${i}`);
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    assert.ok(ids.has(e.from), `from ${e.from}`);
    assert.ok(ids.has(e.to), `to ${e.to}`);
  }
  for (const n of nodes) {
    assert.ok(n.community === null || (Number.isInteger(n.community) && n.community >= 0 && n.community < communities.length), n.id);
    if (n.kind === 'url' || n.kind === 'missing') {
      assert.equal(n.type, null, n.id);
      assert.equal(n.community, null, n.id);
    }
    assert.equal(typeof n.title, 'string');
    assert.ok(n.title.length > 0, n.id);
  }
});

test('no graph files: edges empty, pages still nodes', async () => {
  await withCopy(async (root) => {
    await rm(join(root, 'wiki', 'graph', 'edges.jsonl'));
    await rm(join(root, 'wiki', 'graph', 'citations.jsonl'));
    const wiki = await readWiki(root);
    assert.deepEqual(wiki.edges, []);
    const nodeIds = wiki.nodes.map((n) => n.id).sort();
    assert.deepEqual(nodeIds, (await pageIdsOnDisk(root)).sort());
  });
});

test('malformed edge rows do not change the result', async () => {
  await withCopy(async (root) => {
    const before = stripGenerated(await readWiki(root));
    await appendFile(join(root, 'wiki', 'graph', 'edges.jsonl'), [
      'null',
      '{"from":5,"type":"related_to","to":"concepts/rank"}',
      '{"from":"sources/lora","type":"related_to","to":7}',
      '{"from":"  ","type":"related_to","to":"concepts/rank"}',
      '{"from":"concepts/rank","type":"","to":"sources/lora"}',
      '',
    ].join('\n'));
    await appendFile(join(root, 'wiki', 'graph', 'citations.jsonl'), [
      'null',
      '{"from":5,"to":"sources/lora"}',
      '{"from":"sources/lora","to":7}',
      '42',
      '',
    ].join('\n'));
    assert.deepStrictEqual(stripGenerated(await readWiki(root)), before);
  });
});

test('one-way reverse pair collapses to the type that names the other', async () => {
  // features.reverse is appears_in; appears_in.reverse is null.
  const by = Object.fromEntries(EDGE_TYPES.map((e) => [e.name, e]));
  assert.equal(by.features.reverse, 'appears_in');
  assert.equal(by.appears_in.reverse, null);
  await withCopy(async (root) => {
    await appendFile(join(root, 'wiki', 'graph', 'edges.jsonl'), [
      '{"from":"sources/lora","type":"features","to":"concepts/adapters"}',
      '{"from":"concepts/adapters","type":"appears_in","to":"sources/lora","confidence":"low"}',
      '',
    ].join('\n'));
    const { edges } = await readWiki(root);
    const pair = edges.filter((e) => e.type === 'features' || e.type === 'appears_in');
    assert.equal(pair.length, 1);
    assert.equal(pair[0].type, 'features');
    assert.equal(pair[0].from, 'sources/lora');
    assert.equal(pair[0].to, 'concepts/adapters');
    assert.equal(pair[0].confidence, 'low');
  });
});

test('live read: a page added between calls appears', async () => {
  await withCopy(async (root) => {
    const first = await readWiki(root);
    assert.ok(!first.nodes.some((n) => n.id === 'concepts/fresh'));
    assert.equal(await readPage(root, 'concepts/fresh'), null);
    const lintBefore = await readLint(root);
    await writeFile(join(root, 'wiki', 'concepts', 'fresh.md'), '# Fresh\n');
    const lintAfter = await readLint(root);
    assert.ok(!lintBefore.findings.some((f) => f.nodeId === 'concepts/fresh'));
    assert.ok(lintAfter.findings.some((f) => f.nodeId === 'concepts/fresh'));
    const second = await readWiki(root);
    assert.ok(second.nodes.some((n) => n.id === 'concepts/fresh'));
    const page = await readPage(root, 'concepts/fresh');
    assert.equal(page.id, 'concepts/fresh');
    assert.equal(page.body, '# Fresh\n');
  });
});

test('hostile ids return null', async () => {
  const hostile = ['nope', '../README', '/etc/passwd', 'sources/lora.md', '__proto__', 'constructor', 'graph/notes', '', undefined];
  for (const id of hostile) {
    assert.equal(await readPage(WORKSPACE, id), null, String(id));
  }
});

test('links has a null prototype', async () => {
  const page = await readPage(WORKSPACE, 'sources/lora-2');
  assert.equal(Object.getPrototypeOf(page.links), null);
});

test('findings order: null files first, null lines first, nulls normalized', async () => {
  await withCopy(async (root) => {
    await appendFile(join(root, 'wiki', 'graph', 'edges.jsonl'),
      '{"from":5,"type":"uses_concept","to":"concepts/adapters"}\n');
    await appendFile(join(root, 'wiki', 'sources', 'deep-work.md'), '\nSee [[no-such-page]].\n');
    const { findings } = await readLint(root);
    assert.ok(findings.some((f) => f.file === null && f.nodeId === null));
    const lastNull = findings.map((f) => f.file === null).lastIndexOf(true);
    const firstStr = findings.findIndex((f) => typeof f.file === 'string');
    assert.ok(lastNull < firstStr, 'null files precede string files');
    const dw = findings.filter((f) => f.file === 'sources/deep-work.md');
    assert.ok(dw.some((f) => f.line === null) && dw.some((f) => typeof f.line === 'number'));
    const lastNullLine = dw.map((f) => f.line === null).lastIndexOf(true);
    const firstNumLine = dw.findIndex((f) => typeof f.line === 'number');
    assert.ok(lastNullLine < firstNumLine, 'null lines precede numeric lines');
  });
});

test('no writes: every file keeps its path and sha256', async () => {
  const snapshot = async (root) => {
    const out = {};
    for (const f of (await walkFiles(root)).sort()) out[f] = createHash('sha256').update(await readFile(join(root, f))).digest('hex');
    return out;
  };
  await withCopy(async (root) => {
    const before = await snapshot(root);
    await readLint(root);
    await readWiki(root);
    for (const id of await pageIdsOnDisk(root)) await readPage(root, id);
    assert.deepStrictEqual(await snapshot(root), before);
  });
});

test('missing wiki/ rejects all three reads', async () => {
  await withCopy(async (root) => {
    await rm(join(root, 'wiki'), { recursive: true });
    await assert.rejects(readWiki(root));
    await assert.rejects(readPage(root, 'index'));
    await assert.rejects(readLint(root));
  });
});

test('reverse self-loops collapse to one; symmetric self-loop stays once', async () => {
  await withCopy(async (root) => {
    await appendFile(join(root, 'wiki', 'graph', 'edges.jsonl'),
      '{"from":"concepts/rank","type":"has_part","to":"concepts/rank"}\n');
    const { edges } = await readWiki(root);
    const loops = edges.filter((e) => e.from === 'concepts/rank' && e.to === 'concepts/rank');
    assert.equal(loops.filter((e) => e.type === 'part_of' || e.type === 'has_part').length, 1);
    assert.equal(loops.filter((e) => e.type === 'related_to').length, 1);
  });
});

test('node order is by code unit, not locale', async () => {
  await withCopy(async (root) => {
    await writeFile(join(root, 'wiki', 'concepts', 'Zeta.md'), '# Zeta\n');
    const ids = (await readWiki(root)).nodes.map((n) => n.id);
    assert.ok(ids.indexOf('concepts/Zeta') < ids.indexOf('concepts/adapters'));
  });
});

test('odd titles, types, and file names', async () => {
  await withCopy(async (root) => {
    await writeFile(join(root, 'wiki', 'concepts', 'blank.md'), '---\ntitle: "   "\n---\nbody\n');
    await mkdir(join(root, 'wiki', 'constructor'));
    await writeFile(join(root, 'wiki', 'constructor', 'x.md'), '# x\n');
    await writeFile(join(root, 'wiki', 'concepts', '.md'), '# hidden\n');
    const { nodes } = await readWiki(root);
    assert.equal(nodes.find((n) => n.id === 'concepts/blank').title, 'blank');
    assert.equal(nodes.find((n) => n.id === 'constructor/x').type, null);
    assert.ok(!nodes.some((n) => n.id === 'concepts/'));
  });
});

test('colon in a page id still gets a community named after a page', { skip: process.platform === 'win32' }, async () => {
  await withCopy(async (root) => {
    await writeFile(join(root, 'wiki', 'concepts', 'a:b.md'), '# a:b\n');
    await appendFile(join(root, 'wiki', 'graph', 'edges.jsonl'),
      '{"from":"concepts/a:b","type":"related_to","to":"concepts/rank"}\n');
    const { nodes, communities } = await readWiki(root);
    const node = nodes.find((n) => n.id === 'concepts/a:b');
    assert.ok(Number.isInteger(node.community));
    const members = nodes.filter((n) => n.community === node.community && n.kind === 'page').map((n) => n.id);
    assert.ok(members.includes(communities[node.community].name));
  });
});

test('a finding file that names no page is not matched by base name', async () => {
  await withCopy(async (root) => {
    await rm(join(root, 'wiki', 'index.md'));
    await mkdir(join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(join(root, 'wiki', 'sources', 'index.md'), '---\ntitle: Sources index\n---\nbody\n');
    const { findings } = await readLint(root);
    const top = findings.filter((f) => f.file === 'index.md');
    if (top.length > 0) {
      for (const f of top) assert.equal(f.nodeId, null);
      return;
    }
    for (const f of findings) {
      if (typeof f.file === 'string' && f.file.endsWith('.md')) {
        assert.ok(f.nodeId === null || f.nodeId === f.file.slice(0, -3), `${f.file} -> ${f.nodeId}`);
      }
    }
  });
});

const FM = '---\ntitle: T\n---\n';

test('wikilink scan: link keys equal the engine pattern on every page and on awkward bodies', async () => {
  await withCopy(async (root) => {
    const awkward = '[[a]] [[a|b]] [[ a ]] [[|x]] [[]] [[a|]] [[a [[b]] [[[c]]] text ] [[d]] [[e]] [[e]]\n'
      + '```\n[[fenced]]\n```\n[[https://a.b]]\n';
    await writeFile(join(root, 'wiki', 'concepts', 'awkward.md'), FM + awkward);
    for (const id of await pageIdsOnDisk(root)) {
      const page = await readPage(root, id);
      const want = new Set([...page.body.matchAll(new RegExp(WIKILINK_RE.source, 'g'))].map((m) => m[1].trim()));
      assert.deepEqual(new Set(Object.keys(page.links)), want, id);
    }
  });
});

test('wikilink scan: pathological bodies return within 2000 ms', async () => {
  const bodies = {
    brackets: '['.repeat(400_000),
    openPipe: '[[a|'.repeat(100_000),
    loneClose: '[[a'.repeat(66_000) + ']',
    pipeClose: '[[|'.repeat(66_000) + ']]',
  };
  await withCopy(async (root) => {
    for (const [name, body] of Object.entries(bodies)) {
      await writeFile(join(root, 'wiki', 'concepts', `slow-${name}.md`), FM + body);
    }
    for (const name of Object.keys(bodies)) {
      const t0 = performance.now();
      await readPage(root, `concepts/slow-${name}`);
      const ms = performance.now() - t0;
      console.log(`readPage ${name}: ${ms.toFixed(0)} ms`);
      assert.ok(ms < 2000, `${name} took ${ms} ms`);
    }
    const t0 = performance.now();
    await readWiki(root);
    const ms = performance.now() - t0;
    console.log(`readWiki: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 2000, `readWiki took ${ms} ms`);
  });
});
