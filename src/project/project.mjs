#!/usr/bin/env node
/**
 * @module project
 * @description Project engine CLI (AD-5). Story 1 wires two subcommands,
 * `scope` and `config-check`; every other subcommand exits 1. JSON to
 * stdout; `{error, code}` to stderr.
 *
 * Usage: node project.mjs <subcommand>
 *
 * Exit codes (AD-14):
 *   0  success
 *   1  bad arguments or unknown subcommand
 *   2  invalid config, no project root, or unsafe/colliding scope
 *   3  internal error or newer schemaVersion, or Node < 24
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { findRoot, loadConfig, ontologyVersion, ConfigError, SchemaVersionError } from './lib/config.mjs';
import { selectScope, ScopeCollisionError } from './lib/scope.mjs';

const MIN_NODE_MAJOR = 24;
const SUBCOMMANDS = new Set(['scope', 'config-check']);
// Filesystem errors that mean "we can't reach the path", not "the engine is
// broken": the repo-wide contract (docs/project-context.md, README) maps
// these to exit 2, not 3.
const PATH_ACCESS_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EISDIR']);

function fail(code, error, extra = {}) {
  console.error(JSON.stringify({ error, code, ...extra }));
  process.exitCode = code;
}

/** Exit code for an error not already handled as ConfigError/SchemaVersionError/etc. */
function exitCodeForError(e) {
  return e && PATH_ACCESS_ERROR_CODES.has(e.code) ? 2 : 3;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    fail(3, `Node.js >= ${MIN_NODE_MAJOR} required, got ${process.versions.node}`);
    return false;
  }
  return true;
}

async function runScope(root, config) {
  try {
    const { files, warnings } = await selectScope(root, config.sources);
    console.log(JSON.stringify({ files, warnings }));
  } catch (e) {
    if (e instanceof ScopeCollisionError) {
      fail(2, e.message, { pairs: e.pairs });
      return;
    }
    if (e instanceof RangeError) {
      fail(2, e.message);
      return;
    }
    fail(exitCodeForError(e), `internal error: ${e.message}`);
  }
}

function runConfigCheck(config) {
  console.log(JSON.stringify({
    ok: true,
    schemaVersion: config.schemaVersion,
    ontologyVersion: ontologyVersion(config),
  }));
}

export async function main(argv = process.argv.slice(2)) {
  if (!checkNodeVersion()) return;

  const [subcommand, ...rest] = argv;
  if (!subcommand || !SUBCOMMANDS.has(subcommand) || rest.length > 0) {
    fail(1, `unknown subcommand or bad arguments: ${JSON.stringify(argv)}`);
    return;
  }

  const root = await findRoot(process.cwd());
  if (root === null) {
    fail(2, 'no project root found: no ancestor holds _lumina/config/project.yaml');
    return;
  }

  let config;
  try {
    config = await loadConfig(root);
  } catch (e) {
    if (e instanceof ConfigError) {
      fail(e.code, e.message, { errors: e.errors });
      return;
    }
    if (e instanceof SchemaVersionError) {
      fail(e.code, e.message);
      return;
    }
    fail(exitCodeForError(e), `internal error: ${e.message}`);
    return;
  }

  if (subcommand === 'scope') {
    await runScope(root, config);
  } else if (subcommand === 'config-check') {
    runConfigCheck(config);
  }
}

/** True when this file is the script Node was invoked on, not merely imported. */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

// Run main only when invoked directly.
if (isMainModule()) {
  main().catch((e) => {
    fail(exitCodeForError(e), `internal error: ${e.message}`);
  });
}
