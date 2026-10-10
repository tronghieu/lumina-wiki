// Process tests for view.mjs: the real entry runs as a child in a throwaway workspace (AD-10, AD-11).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import { rootIdentity, PORT_RANGE } from './lib/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_MJS = join(HERE, 'view.mjs');
const BUNDLE = join(HERE, 'app', 'viewer.js');
const LINE_DEADLINE_MS = 10_000;
const IS_WIN = process.platform === 'win32';
const T = { timeout: 30_000 };

// The base port derives from the real path, and os.tmpdir() is a link or a short name on some runners.
async function makeWorkspace(version) {
  const dir = await mkdtemp(join(realpathSync.native(tmpdir()), 'lumi-view-'));
  await mkdir(join(dir, 'wiki', 'sources'), { recursive: true });
  await writeFile(join(dir, 'wiki', 'sources', 'lora-note.md'), '---\ntitle: LoRA note\n---\nBody.\n');
  await writeFile(join(dir, 'wiki', 'index.md'), '# Index\n');
  if (version !== undefined) await writeManifest(dir, version);
  return realpathSync.native(dir);
}

async function writeManifest(dir, version) {
  await mkdir(join(dir, '_lumina'), { recursive: true });
  await writeFile(join(dir, '_lumina', 'manifest.json'), JSON.stringify({ packageVersion: version }, null, 2));
}

function start(cwd, { args = [VIEW_MJS], env } = {}) {
  const child = spawn(process.execPath, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exit = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  const line = new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(
      () => finish(reject, new Error(`no stdout line within ${LINE_DEADLINE_MS} ms; stderr: ${err}`)),
      LINE_DEADLINE_MS,
    );
    child.stdout.on('data', () => {
      const i = out.indexOf('\n');
      if (i < 0) return;
      try { finish(resolve, JSON.parse(out.slice(0, i))); } catch (e) { finish(reject, e); }
    });
    exit.then(() => {
      if (!out.includes('\n')) finish(reject, new Error(`child exited before a stdout line; stderr: ${err}`));
    });
  });
  line.catch(() => {}); // The test awaits it; this only prevents an unhandled rejection on early exit.
  return { child, line, exit, stdout: () => out, stderr: () => err };
}

async function stop(h) {
  if (h.child.exitCode === null && h.child.signalCode === null) {
    h.child.kill();
    await h.exit;
  }
}

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

function occupy(port, host) {
  return new Promise((resolve, reject) => {
    const s = net.createServer((sock) => sock.destroy());
    s.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve(null) : reject(e)));
    s.listen(port, host, () => resolve(s));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent: false, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error(`GET ${path} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

async function waitUntil(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// True when a TCP connection is accepted within the deadline; false on refusal, error, or timeout.
function reachable(host, port, ms = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(ms, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// A child that never exits must fail the test, not hang it.
function exitWithin(h, ms = LINE_DEADLINE_MS) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`child still running after ${ms} ms; stderr: ${h.stderr()}`)), ms);
  });
  return Promise.race([h.exit, deadline]).finally(() => clearTimeout(timer));
}

// The script treats any entry named wiki as a workspace marker, file or folder.
async function ancestorHoldsWiki(dir) {
  for (let up = dir; ; up = dirname(up)) {
    try { await access(join(up, 'wiki')); return up; } catch { /* absent */ }
    if (dirname(up) === up) return null;
  }
}

function lastJsonLine(text) {
  const lines = text.trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]);
}

// Tracks everything a test starts and tears it down in the order Windows needs.
async function withEnv(fn) {
  const children = [];
  const listeners = [];
  const dirs = [];
  const env = {
    workspace: async (version) => { const d = await makeWorkspace(version); dirs.push(d); return d; },
    tmp: async () => { const d = await mkdtemp(join(realpathSync.native(tmpdir()), 'lumi-view-bare-')); dirs.push(d); return realpathSync.native(d); },
    start: (cwd, opts) => { const h = start(cwd, opts); children.push(h); return h; },
    hold: async (port) => {
      const socks = new Set();
      const srv = net.createServer((sock) => { socks.add(sock); });
      await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', resolve); });
      listeners.push({ close: (cb) => { for (const k of socks) k.destroy(); srv.close(cb); } });
    },
    occupy: async (port, host) => { const s = await occupy(port, host); if (s) listeners.push(s); return s; },
  };
  try {
    await fn(env);
  } finally {
    for (const h of children) await stop(h);
    for (const s of listeners) await new Promise((r) => s.close(() => r()));
    for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const inRange = (port, basePort) => port >= basePort && port < basePort + PORT_RANGE;

describe('view.mjs process contract', () => {
  it('starts, reports one line, and answers health', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { rootId, basePort } = rootIdentity(ws);
      const h = env.start(ws);
      const line = await h.line;
      assert.deepEqual(Object.keys(line).sort(), ['ok', 'port', 'reused', 'url']);
      assert.equal(line.ok, true);
      assert.equal(line.reused, false);
      assert.equal(line.url, `http://127.0.0.1:${line.port}/`);
      assert.ok(inRange(line.port, basePort), `port ${line.port} outside range from ${basePort}`);
      const res = await get(line.port, '/api/health');
      assert.equal(res.status, 200);
      const health = JSON.parse(res.body.toString('utf8'));
      assert.equal(health.app, 'lumina-view');
      assert.equal(health.root, rootId);
      await get(line.port, '/api/wiki');
      assert.equal(h.stdout().split('\n').length - 1, 1, 'stdout must hold exactly one newline');
    });
  });

  it('starts from a subfolder of the workspace', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { rootId, basePort } = rootIdentity(ws);
      const h = env.start(join(ws, 'wiki', 'sources'));
      const line = await h.line;
      assert.equal(line.url, `http://127.0.0.1:${line.port}/`);
      assert.ok(inRange(line.port, basePort));
      const health = JSON.parse((await get(line.port, '/api/health')).body.toString('utf8'));
      assert.equal(health.root, rootId);
    });
  });

  it('fails with no_workspace outside a workspace', T, async (t) => {
    await withEnv(async (env) => {
      const bare = await env.tmp();
      const holder = await ancestorHoldsWiki(dirname(bare));
      if (holder) { t.skip(`an ancestor holds wiki: ${holder}`); return; }
      const h = env.start(bare);
      const { code } = await exitWithin(h);
      assert.equal(code, 2);
      assert.equal(h.stdout(), '');
      const err = lastJsonLine(h.stderr());
      assert.equal(err.reason, 'no_workspace');
      assert.equal(err.code, 2);
    });
  });

  it('reuses a running viewer for the same root', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const a = env.start(ws);
      const la = await a.line;
      const b = env.start(ws);
      const lb = await b.line;
      assert.equal(lb.reused, true);
      assert.equal(lb.port, la.port);
      assert.equal((await b.exit).code, 0);
      assert.equal((await get(la.port, '/api/health')).status, 200);
    });
  });

  it('ends two simultaneous starts as one server and one reuse', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const a = env.start(ws);
      const b = env.start(ws);
      const [la, lb] = await Promise.all([a.line, b.line]);
      assert.deepEqual([la.reused, lb.reused].sort(), [false, true]);
      assert.equal(la.url, lb.url);
      const reuser = la.reused ? a : b;
      assert.equal((await reuser.exit).code, 0);
    });
  });

  it('refuses a running viewer of another version with stale_server', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace('1.0.0');
      const a = env.start(ws);
      await a.line;
      await writeManifest(ws, '2.0.0');
      const b = env.start(ws);
      const { code } = await b.exit;
      assert.equal(code, 3);
      assert.equal(b.stdout(), '');
      const err = lastJsonLine(b.stderr());
      assert.equal(err.reason, 'stale_server');
      assert.ok(err.error.includes(String((await a.line).port)), `error names the other viewer's port: ${err.error}`);
    });
  });

  it('leaves a base port held on 127.0.0.1 and names both ports', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { basePort } = rootIdentity(ws);
      await env.occupy(basePort, '127.0.0.1');
      const h = env.start(ws);
      const line = await h.line;
      assert.ok(line.port > basePort && inRange(line.port, basePort), `port ${line.port}, base ${basePort}`);
      const sentence = `Port ${basePort} was not available; the viewer is on port ${line.port}.`;
      await waitUntil(() => h.stderr().includes(sentence), 2000); // stderr may trail stdout.
      assert.ok(h.stderr().includes(sentence), `stderr: ${h.stderr()}`);
      assert.equal(h.stderr().split(/\r?\n/).filter((l) => l.trim() !== '').length, 1, 'one stderr line');
    });
  });

  it('never listens on a base port held on 0.0.0.0', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { basePort } = rootIdentity(ws);
      await env.occupy(basePort, '0.0.0.0');
      const h = env.start(ws);
      const line = await h.line;
      assert.notEqual(line.port, basePort);
      assert.ok(inRange(line.port, basePort));
    });
  });

  it('fails with no_free_port when the whole range is held', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { basePort } = rootIdentity(ws);
      for (let i = 0; i < PORT_RANGE; i += 1) await env.occupy(basePort + i, '127.0.0.1');
      const h = env.start(ws);
      const { code } = await h.exit;
      assert.equal(code, 3);
      assert.equal(h.stdout(), '');
      assert.equal(lastJsonLine(h.stderr()).reason, 'no_free_port');
    });
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    it(`releases the port and writes no file on ${signal}`, { ...T, skip: signal === 'SIGINT' && IS_WIN }, async () => {
      await withEnv(async (env) => {
        const ws = await env.workspace();
        const before = await listFiles(ws);
        const h = env.start(ws);
        const line = await h.line;
        h.child.kill(signal);
        const { code } = await h.exit;
        if (!IS_WIN) assert.equal(code, 0);
        assert.ok(await waitUntil(() => canBind(line.port), 5000), `port ${line.port} still held`);
        assert.deepEqual(await listFiles(ws), before);
      });
    });
  }

  it('serves the committed bundle and the live page list', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const h = env.start(ws);
      const { port } = await h.line;
      const asset = await get(port, '/assets/viewer.js');
      assert.equal(asset.status, 200);
      assert.ok(asset.body.equals(await readFile(BUNDLE)), 'served bytes differ from app/viewer.js');
      const wiki = JSON.parse((await get(port, '/api/wiki')).body.toString('utf8'));
      assert.ok(wiki.nodes.some((n) => n.id === 'sources/lora-note'), 'created page is listed');
    });
  });

  it('listens on loopback only', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { port } = await env.start(ws).line;
      assert.equal(await reachable('127.0.0.1', port), true, 'loopback must answer');
      assert.equal(await reachable('::1', port), false, 'reachable on ::1');
      const external = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
      if (external) assert.equal(await reachable(external.address, port), false, `reachable on ${external.address}`);
    });
  });

  it('fails with node_version below Node 24', T, async () => {
    await withEnv(async (env) => {
      const dir = await env.tmp();
      const preload = join(dir, 'old-node.mjs');
      await writeFile(preload, "Object.defineProperty(process.versions, 'node', { value: '22.11.0' });\n");
      const h = env.start(dir, { args: ['--import', pathToFileURL(preload).href, VIEW_MJS] });
      const { code } = await exitWithin(h);
      assert.equal(code, 3);
      assert.equal(h.stdout(), '');
      const err = lastJsonLine(h.stderr());
      assert.equal(err.reason, 'node_version');
      assert.equal(err.code, 3);
    });
  });

  for (const [errno, exitCode, reason] of [['EPERM', 2, 'bind_refused'], ['EACCES', 2, 'bind_refused'], ['EWHATEVER', 3, 'internal']]) {
    it(`maps a ${errno} listen failure to ${reason}`, T, async () => {
      await withEnv(async (env) => {
        const ws = await env.workspace();
        const dir = await env.tmp();
        const preload = join(dir, 'fail-listen.mjs');
        await writeFile(preload, [
          "import net from 'node:net';",
          'net.Server.prototype.listen = function listen() {',
          "  const code = process.env.LISTEN_CODE;",
          "  process.nextTick(() => this.emit('error', Object.assign(new Error('listen ' + code), { code })));",
          '  return this;',
          '};',
          '',
        ].join('\n'));
        const h = env.start(ws, { args: ['--import', pathToFileURL(preload).href, VIEW_MJS], env: { LISTEN_CODE: errno } });
        const { code } = await exitWithin(h);
        assert.equal(code, exitCode);
        assert.equal(h.stdout(), '');
        const err = lastJsonLine(h.stderr());
        assert.equal(err.reason, reason);
        assert.equal(err.code, exitCode);
      });
    });
  }

  for (const [label, content] of [['unparseable', '{'], ['non-string packageVersion', JSON.stringify({ packageVersion: 5 })]]) {
    it(`starts with no version when the manifest is ${label}`, T, async () => {
      await withEnv(async (env) => {
        const ws = await env.workspace();
        await mkdir(join(ws, '_lumina'), { recursive: true });
        await writeFile(join(ws, '_lumina', 'manifest.json'), content);
        const line = await env.start(ws).line;
        assert.equal(line.reused, false);
        const health = JSON.parse((await get(line.port, '/api/health')).body.toString('utf8'));
        assert.equal(health.version, null);
      });
    });
  }

  it('fails with no_workspace when wiki is a file', T, async (t) => {
    await withEnv(async (env) => {
      const dir = await env.tmp();
      const holder = await ancestorHoldsWiki(dirname(dir));
      if (holder) { t.skip(`an ancestor holds wiki: ${holder}`); return; }
      await writeFile(join(dir, 'wiki'), 'not a folder\n');
      const h = env.start(dir);
      const { code } = await exitWithin(h);
      assert.equal(code, 2);
      assert.equal(h.stdout(), '');
      assert.equal(lastJsonLine(h.stderr()).reason, 'no_workspace');
    });
  });

  it('exits by itself when stdout is closed', T, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const h = env.start(ws);
      h.child.stdout.destroy();
      const { code, signal } = await exitWithin(h);
      assert.ok(signal !== null || code !== 0, `exit code ${code}`);
    });
  });

  it('stops cleanly when signalled before the line is printed', { ...T, skip: IS_WIN }, async () => {
    await withEnv(async (env) => {
      const ws = await env.workspace();
      const { basePort } = rootIdentity(ws);
      await env.hold(basePort); // Accepts and never answers, so the probe waits.
      const h = env.start(ws);
      await new Promise((r) => setTimeout(r, 500)); // The signal must land before the probe ends.
      h.child.kill('SIGTERM');
      const { code } = await exitWithin(h);
      assert.equal(code, 0);
      assert.equal(h.stdout(), '');
    });
  });
});
