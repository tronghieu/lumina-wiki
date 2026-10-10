// Entry point of the wiki viewer: `node view.mjs` from inside a wiki workspace.
// Runs in the foreground until its starter ends it. stdout carries one JSON line, ever.
import fs from 'node:fs';
import path from 'node:path';

const EXIT = { no_workspace: 2, bind_refused: 2, no_free_port: 3, stale_server: 3, node_version: 3, internal: 3 };

// A second failure (a stderr write error) exits with the first code instead of looping.
let failedCode = null;

function fail(reason, error) {
  if (failedCode !== null) process.exit(failedCode);
  const code = EXIT[reason];
  failedCode = code;
  const line = JSON.stringify({ error, code, reason }) + '\n';
  process.stderr.write(line, () => process.exit(code));
}

function readVersion(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, '_lumina', 'manifest.json'), 'utf8')).packageVersion;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    return fail('node_version', 'Node 24 or newer is required');
  }
  const { rootIdentity, createViewerServer, probePort, choosePort, PORT_RANGE } = await import('./lib/server.mjs');
  const { findProjectRoot } = await import('../scripts/lint.mjs');

  const root = await findProjectRoot(process.cwd());
  const hasWiki = root !== null && (() => {
    try { return fs.statSync(path.join(root, 'wiki')).isDirectory(); } catch { return false; }
  })();
  if (!hasWiki) return fail('no_workspace', 'No wiki found here or in any parent folder');

  const realRoot = fs.realpathSync.native(root);
  const { rootId, basePort } = rootIdentity(realRoot);
  const version = readVersion(root);
  const server = createViewerServer({ root: realRoot, rootId, version });

  // One attempt at a time; each attempt removes the listener it did not use.
  const listen = (port) => new Promise((resolve, reject) => {
    const onListening = () => { server.off('error', onError); resolve(); };
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, '127.0.0.1');
  });

  // Registered before the port probe so a stop signal during startup still exits 0.
  const stop = () => {
    if (server.listening) server.close();
    server.closeAllConnections();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const result = await choosePort({ basePort, rootId, version, probe: probePort, listen });
  if (result.outcome === 'failed') {
    const { reason } = result;
    const text = {
      bind_refused: 'The system refused to open a local port, which usually means a sandbox, so run this command in your own terminal',
      no_free_port: `All ${PORT_RANGE} ports from ${basePort} are in use`,
      stale_server: `A viewer from another Lumina version is already serving this wiki${result.port ? ` on port ${result.port}` : ''}, so stop it and start again`,
    }[reason] ?? 'An unexpected error';
    return fail(reason in EXIT ? reason : 'internal', text);
  }

  const { port } = result;
  const reused = result.outcome === 'reused';
  const line = JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/`, port, reused }) + '\n';
  if (reused) return process.stdout.write(line, () => process.exit(0));

  if (port !== basePort) process.stderr.write(`Port ${basePort} was not available; the viewer is on port ${port}.\n`);
  process.stdout.write(line);
}

const internal = (e) => fail('internal', `An unexpected error: ${e?.message ?? e}`);
process.on('uncaughtException', internal);
process.on('unhandledRejection', internal);
main().catch(internal);
