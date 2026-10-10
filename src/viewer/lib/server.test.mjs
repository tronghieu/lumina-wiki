// Tests the viewer server: routes, guards, headers, port choice, and live reads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rootIdentity, createViewerServer, probePort, choosePort, PORT_RANGE } from './server.mjs';
import { readWiki } from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.resolve(here, '..');
const contractDir = path.join(viewerDir, 'test-fixtures', 'contract');
const expectedDir = path.join(contractDir, 'expected');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ROOT_ID = '0123456789abcdef';
const VERSION = '9.9.9-test';

let tmp;
let workspace;
let server;
let port;
let failServer;
let failPort;

function assertNoCors(headers) {
  for (const k of Object.keys(headers)) {
    assert.ok(!k.toLowerCase().startsWith('access-control-'), `unexpected header ${k}`);
  }
}

function listenOnLoopback(srv) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

function closeServer(srv) {
  return new Promise((resolve) => {
    if (!srv || !srv.listening) return resolve();
    srv.close(() => resolve());
    if (srv.closeAllConnections) srv.closeAllConnections();
  });
}

// Built on http.request: fetch drops a Host override and rewrites paths.
function request(targetPort, urlPath, { method = 'GET', host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        path: urlPath,
        method,
        agent: false,
        headers: { Host: host ?? `127.0.0.1:${targetPort}`, ...headers },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          assertNoCors(res.headers);
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

const get = (p, opts) => request(port, p, opts);
const json = (r) => JSON.parse(r.body);

// For requests http.request cannot express. Resolves once one full response arrived.
function raw(targetPort, bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(targetPort, '127.0.0.1');
    let buf = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (err) return reject(err);
      const [head, ...rest] = buf.split('\r\n\r\n');
      const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(head)?.[1]);
      const headers = {};
      for (const line of head.split('\r\n').slice(1)) {
        const i = line.indexOf(':');
        headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
      }
      assertNoCors(headers);
      let body = rest.join('\r\n\r\n');
      if (/chunked/i.test(headers['transfer-encoding'] ?? '')) {
        let out = '';
        for (let at = 0; at < body.length; ) {
          const eol = body.indexOf('\r\n', at);
          const n = parseInt(body.slice(at, eol), 16);
          if (!n) break;
          out += body.slice(eol + 2, eol + 2 + n);
          at = eol + 2 + n + 2;
        }
        body = out;
      }
      resolve({ status, headers, body, raw: buf });
    };
    const check = () => {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      if (/transfer-encoding:\s*chunked/i.test(buf.slice(0, i))) {
        if (buf.endsWith('\r\n0\r\n\r\n')) finish();
        return;
      }
      const m = /content-length:\s*(\d+)/i.exec(buf.slice(0, i));
      const need = m ? Number(m[1]) : 0;
      if (Buffer.byteLength(buf.slice(i + 4)) >= need) finish();
    };
    sock.setEncoding('utf8');
    sock.setTimeout(10000, () => finish(new Error('raw request timed out')));
    sock.on('data', (d) => {
      buf += d;
      check();
    });
    sock.on('end', () => finish());
    sock.on('close', () => finish());
    sock.on('error', (e) => finish(e));
    sock.write(bytes);
  });
}

function assertSecurityHeaders(r) {
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['content-security-policy'], CSP);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'lumi-view-'));
  workspace = path.join(tmp, 'workspace');
  fs.cpSync(path.join(contractDir, 'workspace'), workspace, { recursive: true });
  server = createViewerServer({ root: workspace, rootId: ROOT_ID, version: VERSION });
  port = await listenOnLoopback(server);

  const boom = async () => {
    throw new Error('secret /abs/path');
  };
  failServer = createViewerServer({
    root: workspace,
    rootId: ROOT_ID,
    version: VERSION,
    data: { readWiki: boom, readPage: boom, readLint: boom },
  });
  failPort = await listenOnLoopback(failServer);
});

after(async () => {
  await closeServer(server);
  await closeServer(failServer);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---- routes ----

test('GET / serves index.html', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html; charset=utf-8$/i);
  assert.equal(r.body, fs.readFileSync(path.join(viewerDir, 'app', 'index.html'), 'utf8'));
  assertSecurityHeaders(r);
});

test('assets are served with their content types', async () => {
  const js = await get('/assets/viewer.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /^text\/javascript; charset=utf-8$/i);
  assert.equal(js.body, fs.readFileSync(path.join(viewerDir, 'app', 'viewer.js'), 'utf8'));
  const css = await get('/assets/viewer.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /^text\/css; charset=utf-8$/i);
  assert.equal(css.body, fs.readFileSync(path.join(viewerDir, 'app', 'viewer.css'), 'utf8'));
});

test('GET /api/health has the contract shape', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json; charset=utf-8$/i);
  assert.deepEqual(json(r), { app: 'lumina-view', version: VERSION, root: ROOT_ID });
});

// ---- method guard ----

for (const method of ['POST', 'PUT', 'DELETE']) {
  test(`${method} is 405 with Allow: GET`, async () => {
    const r = await get('/api/wiki', { method });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET');
    const b = json(r);
    assert.equal(b.error, 'method_not_allowed');
    assert.equal(typeof b.message, 'string');
    assertSecurityHeaders(r);
  });
}

test('HEAD is 405 with Allow: GET', async () => {
  const r = await get('/', { method: 'HEAD' });
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'GET');
  assertSecurityHeaders(r);
});

// ---- Host guard ----

test('foreign Host values are 403', async () => {
  for (const mk of [
    () => 'evil.example',
    () => '127.0.0.1:1',
    (p) => `[::1]:${p}`,
    (p) => `localhost.:${p}`,
  ]) {
    const host = mk(port);
    const r = await get('/api/health', { host });
    assert.equal(r.status, 403, host);
    const b = json(r);
    assert.equal(b.error, 'forbidden_host');
    assert.equal(typeof b.message, 'string');
  }
});

test('a request with no Host is 403', async () => {
  const r = await raw(port, 'GET / HTTP/1.1\r\n\r\n');
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error, 'forbidden_host');
  assertSecurityHeaders(r);
});

test('own Host is accepted in any case', async () => {
  const upper = await get('/api/health', { host: `LOCALHOST:${port}` });
  assert.equal(upper.status, 200);
  const ip = await get('/api/health', { host: `127.0.0.1:${port}` });
  assert.equal(ip.status, 200);
});

test('method guard runs before the Host guard', async () => {
  const r = await get('/', { method: 'POST', host: 'evil.example' });
  assert.equal(r.status, 405);
});

// ---- route guard ----

test('unknown paths are 404', async () => {
  for (const p of ['/api/nope', '/view.mjs', '/index.html', '/assets/viewer.js/']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    const b = json(r);
    assert.equal(b.error, 'not_found');
    assert.equal(typeof b.message, 'string');
  }
});

test('an unparseable target is 404 and the server keeps serving', async () => {
  const r = await raw(port, `GET http://[bad HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  assert.equal(r.status, 404);
  const ok = await get('/api/health');
  assert.equal(ok.status, 200);
});

test('odd request targets are 404', async () => {
  const targets = [
    '//evil.example/api/health',
    '/assets/../api/wiki',
    '/./api/health',
    '/%2e/api/health',
    '/api\\health',
    '//foo',
    'http://evil.example/api/health',
  ];
  for (const t of targets) {
    const r = await raw(port, `GET ${t} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    assert.equal(r.status, 404, t);
  }
});

test('a query string does not change the route', async () => {
  assert.equal((await get('/api/wiki?x=1')).status, 200);
});

test('page lookup: the first id wins', async () => {
  const r = await get('/api/page?id=sources%2Flora-2&id=nope');
  assert.equal(r.status, 200);
  assert.equal(json(r).id, 'sources/lora-2');
});

test('page lookup: known id is 200', async () => {
  const r = await get('/api/page?id=sources%2Flora');
  assert.equal(r.status, 200);
  assert.equal(json(r).id, 'sources/lora');
});

test('page lookup: missing, unknown, and traversal ids are 404', async () => {
  for (const q of ['/api/page', '/api/page?id=sources%2Fnope', '/api/page?id=../README']) {
    const r = await get(q);
    assert.equal(r.status, 404, q);
    assert.equal(json(r).error, 'not_found');
  }
});

// ---- contract ----

test('/api/wiki matches the expected JSON', async () => {
  const r = await get('/api/wiki');
  assert.equal(r.status, 200);
  const body = json(r);
  const expected = readJson(path.join(expectedDir, 'wiki.json'));
  assert.equal(typeof body.generatedAt, 'string');
  assert.deepEqual(body.nodes, expected.nodes);
  assert.deepEqual(body.edges, expected.edges);
  assert.deepEqual(body.communities, expected.communities);
  assert.deepEqual(body.schema, JSON.parse(JSON.stringify((await readWiki(workspace)).schema)));
});

test('/api/lint matches the expected JSON', async () => {
  const r = await get('/api/lint');
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), readJson(path.join(expectedDir, 'lint.json')));
});

test('/api/page matches the expected JSON for every fixture id', async () => {
  const pages = readJson(path.join(expectedDir, 'pages.json'));
  for (const [id, expected] of Object.entries(pages)) {
    const r = await get(`/api/page?id=${encodeURIComponent(id)}`);
    assert.equal(r.status, 200, id);
    assert.deepEqual(json(r), expected, id);
  }
});

// ---- headers ----

test('AD-9 headers are exact on 200, 403, 404, 405, and 500', async () => {
  const rows = [
    await get('/api/health'),
    await get('/api/health', { host: 'evil.example' }),
    await get('/api/nope'),
    await get('/api/health', { method: 'POST' }),
    await request(failPort, '/api/wiki'),
  ];
  assert.deepEqual(
    rows.map((r) => r.status),
    [200, 403, 404, 405, 500],
  );
  for (const r of rows) assertSecurityHeaders(r);
});

// ---- 500 ----

test('a throwing read is 500 with a fixed message and the server keeps running', async () => {
  const r = await request(failPort, '/api/wiki');
  assert.equal(r.status, 500);
  assert.equal(json(r).error, 'internal');
  assert.ok(!r.body.includes('secret'));
  assert.ok(!r.body.includes('/abs/path'));
  for (const p of ['/api/lint', '/api/page?id=index']) {
    const x = await request(failPort, p);
    assert.equal(x.status, 500, p);
    assert.ok(!x.body.includes('secret'));
  }
  const h = await request(failPort, '/api/health');
  assert.equal(h.status, 200);
});

// ---- rootIdentity ----

test('rootIdentity is fixed for a known path', () => {
  assert.deepEqual(rootIdentity('/some/where/my wiki/ünï'), { rootId: '8b8796edaaadead5', basePort: 28021 });
  const { basePort } = rootIdentity('/tmp/other');
  assert.ok(basePort >= 28000 && basePort <= 28999);
});

// ---- choosePort with fakes ----

const BASE = 28100;
const RANGE = Array.from({ length: PORT_RANGE }, (_, i) => BASE + i);
const err = (code) => Object.assign(new Error(code), { code });

function fakes({ probes = {}, listens = {}, fallback = { state: 'free' } } = {}) {
  const listened = [];
  const probed = [];
  const probeCount = {};
  return {
    listened,
    probed,
    probe: async (p) => {
      probed.push(p);
      probeCount[p] = (probeCount[p] ?? 0) + 1;
      const v = probes[p];
      const r = typeof v === 'function' ? v(probeCount[p]) : (v ?? fallback);
      return r;
    },
    listen: async (p) => {
      listened.push(p);
      const l = listens[p];
      if (l === undefined) return;
      throw err(l);
    },
  };
}
const choose = (f, version = '1.0.0') =>
  choosePort({ basePort: BASE, rootId: ROOT_ID, version, probe: f.probe, listen: f.listen });
const viewer = (root = ROOT_ID, version = '1.0.0') => ({
  state: 'viewer',
  health: { app: 'lumina-view', version, root },
});

test('choosePort: all busy is no_free_port and nothing is listened', async () => {
  const f = fakes({ fallback: { state: 'busy' } });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'no_free_port' });
  assert.equal(f.listened.length, 0);
  assert.deepEqual([...new Set(f.probed)].sort((a, b) => a - b), RANGE);
});

test('choosePort: EACCES on every free port is bind_refused', async () => {
  const listens = Object.fromEntries(RANGE.map((p) => [p, 'EACCES']));
  const f = fakes({ listens });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'bind_refused' });
  assert.deepEqual(f.listened, RANGE);
});

test('choosePort: EPERM fails at once after one listen', async () => {
  const f = fakes({ listens: { [BASE]: 'EPERM' } });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'bind_refused' });
  assert.deepEqual(f.listened, [BASE]);
});

test('choosePort: a same-root, same-version viewer is reused without listening', async () => {
  const f = fakes({ probes: { [BASE + 3]: viewer() } });
  assert.deepEqual(await choose(f), { outcome: 'reused', port: BASE + 3 });
  assert.equal(f.listened.length, 0);
});

test('choosePort: a same-root viewer of another version is stale_server', async () => {
  const f = fakes({ probes: { [BASE + 3]: viewer(ROOT_ID, '0.9.0') } });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'stale_server', port: BASE + 3 });
  assert.equal(f.listened.length, 0);
});

test('choosePort: the lowest same-root viewer wins', async () => {
  const f = fakes({ probes: { [BASE + 2]: viewer(), [BASE + 5]: viewer(ROOT_ID, '0.9.0') } });
  assert.deepEqual(await choose(f), { outcome: 'reused', port: BASE + 2 });
});

test('choosePort: a viewer for another root is skipped', async () => {
  const f = fakes({ probes: { [BASE]: viewer('ffffffffffffffff') } });
  assert.deepEqual(await choose(f), { outcome: 'started', port: BASE + 1 });
  assert.deepEqual(f.listened, [BASE + 1]);
});

test('choosePort: a free base port is started', async () => {
  const f = fakes();
  assert.deepEqual(await choose(f), { outcome: 'started', port: BASE });
  assert.deepEqual(f.listened, [BASE]);
});

test('choosePort: EADDRINUSE then a same-root viewer is reused', async () => {
  const f = fakes({
    listens: { [BASE]: 'EADDRINUSE' },
    probes: { [BASE]: (n) => (n === 1 ? { state: 'free' } : viewer()) },
  });
  assert.deepEqual(await choose(f), { outcome: 'reused', port: BASE });
});

test('choosePort: EADDRINUSE then busy moves on to the next port', async () => {
  const f = fakes({
    listens: { [BASE]: 'EADDRINUSE' },
    probes: { [BASE]: (n) => (n === 1 ? { state: 'free' } : { state: 'busy' }) },
  });
  assert.deepEqual(await choose(f), { outcome: 'started', port: BASE + 1 });
  assert.deepEqual(f.listened, [BASE, BASE + 1]);
});

test('choosePort: EACCES on the base port then a free port is started there', async () => {
  const f = fakes({ listens: { [BASE]: 'EACCES' } });
  assert.deepEqual(await choose(f), { outcome: 'started', port: BASE + 1 });
});

test('choosePort: EACCES on some ports with the rest busy is bind_refused', async () => {
  const probes = Object.fromEntries(RANGE.slice(2).map((p) => [p, { state: 'busy' }]));
  const f = fakes({ probes, listens: { [BASE]: 'EACCES', [BASE + 1]: 'EACCES' } });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'bind_refused' });
});

test('choosePort: EADDRINUSE then a stale viewer is stale_server with its port', async () => {
  const f = fakes({
    listens: { [BASE]: 'EADDRINUSE' },
    probes: { [BASE]: (n) => (n === 1 ? { state: 'free' } : viewer(ROOT_ID, '0.9.0')) },
  });
  assert.deepEqual(await choose(f), { outcome: 'failed', reason: 'stale_server', port: BASE });
});

test('choosePort: an unknown error code rejects', async () => {
  const f = fakes({ listens: { [BASE]: 'EWHATEVER' } });
  await assert.rejects(choose(f), (e) => e.code === 'EWHATEVER');
});

// ---- probePort on real sockets ----

test('probePort: a running viewer is a viewer', async () => {
  const r = await probePort(port);
  assert.equal(r.state, 'viewer');
  assert.equal(r.health.app, 'lumina-view');
});

test('probePort: a just-closed port is free', async () => {
  const s = net.createServer();
  const p = await listenOnLoopback(s);
  await new Promise((resolve) => s.close(resolve));
  assert.deepEqual(await probePort(p), { state: 'free' });
});

test('probePort: a listener that never replies is busy', { timeout: 10000 }, async () => {
  const socks = new Set();
  const s = net.createServer((c) => {
    socks.add(c);
    c.on('error', () => {});
  });
  const p = await listenOnLoopback(s);
  try {
    assert.equal((await probePort(p)).state, 'busy');
  } finally {
    for (const c of socks) c.destroy();
    await new Promise((resolve) => s.close(resolve));
  }
});

async function probeAgainst(handler) {
  const s = http.createServer(handler);
  const p = await listenOnLoopback(s);
  try {
    return await probePort(p);
  } finally {
    await closeServer(s);
  }
}

test('probePort: a 200 with a non-JSON body is busy', async () => {
  assert.deepEqual(await probeAgainst((q, r) => r.end('hello')), { state: 'busy' });
});

test('probePort: a 200 JSON body without app lumina-view is busy', async () => {
  assert.deepEqual(await probeAgainst((q, r) => r.end('{"status":"ok"}')), { state: 'busy' });
});

test('probePort: a 200 body over 64 KiB is busy', async () => {
  const big = JSON.stringify({ app: 'lumina-view', pad: 'x'.repeat(70000) });
  assert.deepEqual(await probeAgainst((q, r) => r.end(big)), { state: 'busy' });
});

test('probePort: a redirect is not followed', async () => {
  let hits = 0;
  const target = http.createServer((req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ app: 'lumina-view', version: '1', root: ROOT_ID }));
  });
  const targetPort = await listenOnLoopback(target);
  const redirector = http.createServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/api/health` });
    res.end();
  });
  const redirPort = await listenOnLoopback(redirector);
  try {
    assert.equal((await probePort(redirPort)).state, 'busy');
    assert.equal(hits, 0);
  } finally {
    await closeServer(redirector);
    await closeServer(target);
  }
});

// ---- live reads: own workspace copy and own server, so the shared copy is never touched ----

test('live reads: page edits, new pages, and lint see the files on disk', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'lumi-live-'));
  const ws = path.join(dir, 'workspace');
  fs.cpSync(path.join(contractDir, 'workspace'), ws, { recursive: true });
  const srv = createViewerServer({ root: ws, rootId: ROOT_ID, version: VERSION });
  try {
    const p = await listenOnLoopback(srv);
    const read = (u) => request(p, u);

    const before = json(await read('/api/page?id=sources%2Flora'));
    const file = path.join(ws, 'wiki', 'sources', 'lora.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\nLive edited marker.\n');
    const after = json(await read('/api/page?id=sources%2Flora'));
    assert.ok(!before.body.includes('Live edited marker.'));
    assert.ok(after.body.includes('Live edited marker.'));

    fs.writeFileSync(path.join(ws, 'wiki', 'concepts', 'live-added.md'), '---\ntitle: Live Added\n---\n\nBody.\n');
    const wiki = json(await read('/api/wiki'));
    assert.ok(wiki.nodes.some((n) => n.id === 'concepts/live-added'));

    fs.writeFileSync(path.join(ws, 'wiki', 'concepts', 'no-frontmatter.md'), 'Just a body.\n');
    const lint = json(await read('/api/lint'));
    assert.ok(lint.findings.some((f) => f.nodeId === 'concepts/no-frontmatter'));
  } finally {
    await closeServer(srv);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
