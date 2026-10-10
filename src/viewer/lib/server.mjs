import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import * as defaultData from './data.mjs';

const APP_DIR = new URL('../app/', import.meta.url);

// Fixed route-to-file map: no request text is ever joined onto a directory.
const ASSETS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/assets/viewer.js': ['viewer.js', 'text/javascript; charset=utf-8'],
  '/assets/viewer.css': ['viewer.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export const PORT_RANGE = 20;

export function rootIdentity(realRoot) {
  const digest = crypto.createHash('sha256').update(Buffer.from(realRoot, 'utf8')).digest();
  return {
    rootId: digest.toString('hex').slice(0, 16),
    basePort: 28000 + (digest.readUInt32BE(0) % 1000),
  };
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

function sendJson(res, status, obj, extra) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), extra);
}

function fail(res, status, error, message, extra) {
  sendJson(res, status, { error, message }, extra);
}

export function createViewerServer({ root, rootId, version, data = defaultData }) {
  async function handle(req, res) {
    if (req.method !== 'GET') {
      return fail(res, 405, 'method_not_allowed', 'only GET is supported', { Allow: 'GET' });
    }
    // AD-9: Host check defeats DNS rebinding.
    const port = server.address()?.port;
    const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return fail(res, 403, 'forbidden_host', 'host not allowed');
    }
    // Routes match the target as sent; no URL normalization can alias a path onto a route.
    const q = req.url.indexOf('?');
    const pathname = q < 0 ? req.url : req.url.slice(0, q);
    const searchParams = new URLSearchParams(q < 0 ? '' : req.url.slice(q + 1));

    if (Object.hasOwn(ASSETS, pathname)) {
      const [file, type] = ASSETS[pathname];
      return send(res, 200, type, await fs.readFile(new URL(file, APP_DIR)));
    }
    if (pathname === '/api/health') return sendJson(res, 200, { app: 'lumina-view', version, root: rootId });
    if (pathname === '/api/wiki') return sendJson(res, 200, await data.readWiki(root));
    if (pathname === '/api/lint') return sendJson(res, 200, await data.readLint(root));
    if (pathname === '/api/page') {
      const id = searchParams.get('id');
      const page = id ? await data.readPage(root, id) : null;
      if (page == null) return fail(res, 404, 'not_found', 'not found');
      return sendJson(res, 200, page);
    }
    return fail(res, 404, 'not_found', 'not found');
  }

  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    handle(req, res).catch((err) => {
      try {
        const q = req.url.indexOf('?');
        process.stderr.write(
          `viewer: internal error on ${JSON.stringify(q < 0 ? req.url : req.url.slice(0, q))}: ${err?.stack ?? String(err)}\n`,
        );
        if (res.headersSent) return res.destroy();
        fail(res, 500, 'internal', 'internal error');
      } catch {
        res.destroy();
      }
    });
  });
  return server;
}

export function probePort(port) {
  return new Promise((resolve) => {
    let done = false;
    let connected = false;
    let timer;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      headers: { Host: `127.0.0.1:${port}` },
      agent: false,
    });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(result);
    };
    // AD-11: a listener on loopback accepts at once, so only a refusal or a silent second means the port is free.
    req.on('socket', (socket) => {
      timer = setTimeout(() => finish({ state: 'free' }), 1000);
      socket.once('connect', () => {
        connected = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish({ state: 'busy' }), 2000);
      });
    });
    req.on('error', (err) => finish({ state: err?.code === 'ECONNREFUSED' ? 'free' : 'busy' }));
    req.on('response', (res) => {
      if (res.statusCode !== 200) return finish({ state: 'busy' });
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 65536) return finish({ state: 'busy' });
        chunks.push(c);
      });
      res.on('error', () => finish({ state: 'busy' }));
      res.on('end', () => {
        try {
          const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(health && health.app === 'lumina-view' ? { state: 'viewer', health } : { state: 'busy' });
        } catch {
          finish({ state: 'busy' });
        }
      });
    });
    req.end();
  });
}

export async function choosePort({ basePort, rootId, version, probe, listen }) {
  const ports = Array.from({ length: PORT_RANGE }, (_, i) => basePort + i);

  // A live viewer for this root is reused; a different version of it is a stale server.
  const verdict = (port, r) =>
    r.state === 'viewer' && r.health?.root === rootId
      ? r.health.version === version
        ? { outcome: 'reused', port }
        : { outcome: 'failed', reason: 'stale_server', port }
      : null;

  const results = await Promise.all(ports.map((p) => probe(p)));
  for (let i = 0; i < PORT_RANGE; i++) {
    const v = verdict(ports[i], results[i]);
    if (v) return v;
  }

  let sawEacces = false;
  for (let i = 0; i < PORT_RANGE; i++) {
    if (results[i].state !== 'free') continue;
    try {
      await listen(ports[i]);
      return { outcome: 'started', port: ports[i] };
    } catch (err) {
      if (err?.code === 'EADDRINUSE') {
        // Lost a race: someone bound the port after the probe. Re-check who.
        const v = verdict(ports[i], await probe(ports[i]));
        if (v) return v;
      } else if (err?.code === 'EACCES') sawEacces = true;
      else if (err?.code === 'EPERM') return { outcome: 'failed', reason: 'bind_refused' };
      else throw err;
    }
  }
  return { outcome: 'failed', reason: sawEacces ? 'bind_refused' : 'no_free_port' };
}
