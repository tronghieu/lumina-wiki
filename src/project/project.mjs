#!/usr/bin/env node
/**
 * @module project
 * @description Project engine CLI (AD-5). Subcommands so far: `scope`,
 * `config-check` (story 1), `build`, `status` (story 2); every other
 * subcommand exits 1. JSON to stdout; `{error, code}` to stderr.
 *
 * Usage: node project.mjs <subcommand>
 *
 * Exit codes (AD-14):
 *   0  success
 *   1  bad arguments or unknown subcommand
 *   2  invalid config, no project root, or unsafe/colliding scope
 *   3  internal error or newer schemaVersion, or Node < 24
 */

import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findRoot, loadConfig, ontologyVersion, ConfigError, SchemaVersionError, CURRENT_SCHEMA_VERSION,
} from './lib/config.mjs';
import { selectScope, ScopeCollisionError } from './lib/scope.mjs';
import { parseAll } from './lib/parse.mjs';
import { buildGraph, loadFacts, computeDocStatus } from './lib/graph.mjs';

const MIN_NODE_MAJOR = 24;
const SUBCOMMANDS = new Set(['scope', 'config-check', 'build', 'status']);
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

/** `exists(path)` for `buildGraph`: true when `path` (repo-relative) is a *file* on disk (a directory link target must not become a `doc:` node). */
function existsUnderRoot(root) {
  return (path) => {
    try {
      return statSync(join(root, path)).isFile();
    } catch {
      return false;
    }
  };
}

/** Map/RangeError-aware failure for `build`/`status`, matching `runScope`'s handling of the same underlying `selectScope` errors. */
function failForEngineError(e) {
  if (e instanceof ScopeCollisionError) {
    fail(2, e.message, { pairs: e.pairs });
    return;
  }
  if (e instanceof RangeError) {
    fail(2, e.message);
    return;
  }
  const code = exitCodeForError(e);
  fail(code, code === 2 ? e.message : `internal error: ${e.message}`);
}

/**
 * Build a `refResolves(fact)` predicate for one doc from `buildGraph`'s own
 * per-fact `resolution` outcome (AD-12: "its reference no longer resolves").
 * Only `dangling` counts as not resolving -- a self-loop, an ignored link
 * (URL/directory), or a plain resolved reference are all fine; a fact with
 * no recorded outcome (an attr fact, or one `buildGraph` never reached) is
 * not a broken reference either.
 */
function makeRefResolves(graph, docPath) {
  return (fact) => {
    if (fact.kind !== 'edge') return true; // an attr fact (e.g. status) has no target reference to resolve
    return graph.resolution.get(`${docPath}\u0000${fact.id}`) !== 'dangling';
  };
}

async function runBuild(root, config) {
  try {
    const parsed = await parseAll(root, config);
    const facts = await loadFacts(root);
    const graph = buildGraph({ config, parsed, facts, exists: existsUnderRoot(root) });
    console.log(JSON.stringify(graph));
  } catch (e) {
    failForEngineError(e);
  }
}

const STATUS_SUMMARY_KEY = {
  fresh: 'fresh',
  changed: 'changed',
  stale: 'stale',
  'never-ingested': 'neverIngested',
};

/** `doc`'s current full text, preferring `parseAll`'s own decoded text over a second read of the file. */

async function runStatus(root, config) {
  try {
    const parsed = await parseAll(root, config);
    const facts = await loadFacts(root);
    const graph = buildGraph({ config, parsed, facts, exists: existsUnderRoot(root) });
    const ontologyVer = ontologyVersion(config);

    const docs = [];
    const summary = { fresh: 0, changed: 0, stale: 0, neverIngested: 0 };
    for (const doc of parsed.docs) {
      const envelope = facts.get(doc.path);
      const sourceText = parsed.texts.get(doc.path) ?? '';
      const refResolves = makeRefResolves(graph, doc.path);
      const state = computeDocStatus({
        path: doc.path,
        hash: doc.hash,
        envelope,
        ontologyVersion: ontologyVer,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        sourceText,
        refResolves,
      });
      docs.push({ path: doc.path, state });
      summary[STATUS_SUMMARY_KEY[state]] += 1;
    }
    console.log(JSON.stringify({ docs, summary }));
  } catch (e) {
    failForEngineError(e);
  }
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
  } else if (subcommand === 'build') {
    await runBuild(root, config);
  } else if (subcommand === 'status') {
    await runStatus(root, config);
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
