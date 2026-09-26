#!/usr/bin/env node
/**
 * @module project
 * @description Project engine CLI (AD-5). Subcommands so far: `scope`,
 * `config-check` (story 1), `build`, `status` (story 2), `facts-write`,
 * `verify-evidence` (story 3), `lint` (story 4); every other subcommand
 * exits 1. JSON to stdout; `{error, code}` to stderr.
 *
 * Usage: node project.mjs <subcommand>
 *
 * Exit codes (AD-14):
 *   0  success (for `lint`: no finding at or above --fail-on)
 *   1  bad arguments or unknown subcommand (for `lint`: also a finding at or above --fail-on)
 *   2  invalid config, no project root, or unsafe/colliding scope
 *   3  internal error or newer schemaVersion, or Node < 24
 */

import { realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  findRoot, loadConfig, ontologyVersion, ConfigError, SchemaVersionError, CURRENT_SCHEMA_VERSION,
} from './lib/config.mjs';
import { contentHash } from './lib/hash.mjs';
import { selectScope, ScopeCollisionError } from './lib/scope.mjs';
import { parseAll } from './lib/parse.mjs';
import {
  buildGraph, loadFacts, computeDocStatus, makeResolverContext, resolveFactRef, sortFindings, makeFinding,
} from './lib/graph.mjs';
import { assertSafeRelPath, atomicWrite, withLock, LockTimeoutError } from './lib/fsx.mjs';
import { prepareEnvelope, serializeEnvelope, verifyEvidence } from './lib/factfile.mjs';
import { lintGraph } from './lib/lint.mjs';
import { RULES } from './ontology.mjs';

const MIN_NODE_MAJOR = 24;
const SUBCOMMANDS = new Set(['scope', 'config-check', 'build', 'status', 'facts-write', 'verify-evidence', 'lint']);
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

/**
 * Every in-scope doc's freshness state (AD-12), shared by `status` and
 * `lint` (P13) so the two never compute it two different ways.
 * @returns {{docs: {path: string, hash: string, state: string}[], summary: object}}
 */
function computeDocStatuses({
  parsed, facts, graph, ontologyVer,
}) {
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
    docs.push({ path: doc.path, hash: doc.hash, state });
    summary[STATUS_SUMMARY_KEY[state]] += 1;
  }
  return { docs, summary };
}

async function runStatus(root, config) {
  try {
    const parsed = await parseAll(root, config);
    const facts = await loadFacts(root);
    const graph = buildGraph({ config, parsed, facts, exists: existsUnderRoot(root) });
    const ontologyVer = ontologyVersion(config);
    const { docs, summary } = computeDocStatuses({
      parsed, facts, graph, ontologyVer,
    });
    console.log(JSON.stringify({ docs, summary }));
  } catch (e) {
    failForEngineError(e);
  }
}

// ---------------------------------------------------------------------------
// facts-write (AD-10, AD-18, AD-20, AD-22, AD-23)
// ---------------------------------------------------------------------------

/**
 * Read all of `stream` as a UTF-8 string. Rejects a TTY (interactive) stream
 * -- `facts-write` needs piped JSON. `stream` is a parameter (default
 * `process.stdin`) so tests can exercise the TTY-rejection branch with a
 * fake stream instead of a real pty.
 */
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) {
    const err = new Error('facts-write requires JSON on stdin, not a TTY');
    err.projectExitCode = 1;
    throw err;
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** `process.env[name]` as a positive integer, else `fallback`. Both lock env vars are test-only timing overrides -- blank, non-integer, zero, and negative all fall back to the real default. */
function envPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function runFactsWrite(root, config) {
  let stdinText;
  try {
    stdinText = await readStdinText();
  } catch (e) {
    fail(e.projectExitCode ?? exitCodeForError(e), e.message);
    return;
  }

  let input;
  try {
    input = JSON.parse(stdinText);
  } catch (e) {
    fail(1, `bad stdin: not valid JSON: ${e.message}`);
    return;
  }
  if (
    !input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.source !== 'string'
    || typeof input.sourceHash !== 'string'
    || !Array.isArray(input.facts)
  ) {
    fail(1, 'bad stdin: expected {source, sourceHash, facts: []}');
    return;
  }

  try {
    assertSafeRelPath(input.source);
  } catch (e) {
    fail(2, e.message);
    return;
  }

  let parsed;
  try {
    parsed = await parseAll(root, config);
  } catch (e) {
    failForEngineError(e);
    return;
  }

  const doc = parsed.docs.find((d) => d.path === input.source);
  if (!doc) {
    fail(2, `source not in scope: ${input.source}`);
    return;
  }
  if (input.sourceHash !== doc.hash) {
    fail(1, `re-read the doc: sourceHash does not match the current content of ${input.source}`);
    return;
  }

  const resolverCtx = makeResolverContext({ config, parsed, exists: existsUnderRoot(root) });
  const resolve = (raw, citingDoc) => resolveFactRef(raw, citingDoc, resolverCtx);

  let envelope;
  try {
    envelope = prepareEnvelope(input, {
      parsed,
      texts: parsed.texts,
      resolve,
      ontologyVersion: ontologyVersion(config),
    });
  } catch (e) {
    fail(1, e.message, e.errors ? { errors: e.errors } : {});
    return;
  }

  const lockPath = join(root, '_lumina', '_state', 'lock');
  const factFilePath = join(root, '_lumina', 'facts', `${input.source}.json`);
  const staleMs = envPositiveInt('LUMINA_PROJECT_LOCK_STALE_MS', 30000);
  const timeoutMs = envPositiveInt('LUMINA_PROJECT_LOCK_TIMEOUT_MS', 10000);

  try {
    await withLock(lockPath, async () => {
      // Re-check under the lock: `parsed` (and its `doc.hash`) was read
      // before we ever waited for the lock, so a writer that raced us to
      // acquire it first could have changed the doc in between. Without
      // this, an older snapshot could overwrite facts checked against a
      // newer one.
      const currentBytes = await readFile(join(root, input.source));
      if (contentHash(currentBytes) !== input.sourceHash) {
        const err = new Error(`re-read the doc: sourceHash does not match the current content of ${input.source}`);
        err.projectExitCode = 1;
        throw err;
      }

      let existingSchemaVersion;
      try {
        const existingJson = JSON.parse(await readFile(factFilePath, 'utf8'));
        existingSchemaVersion = existingJson?.schemaVersion;
      } catch {
        existingSchemaVersion = undefined; // no existing file, or it doesn't parse -- nothing newer to protect
      }
      if (typeof existingSchemaVersion === 'number' && existingSchemaVersion > CURRENT_SCHEMA_VERSION) {
        const err = new Error(
          `refusing to replace ${input.source}.json: its schemaVersion (${existingSchemaVersion}) is newer than this engine supports (${CURRENT_SCHEMA_VERSION})`,
        );
        err.projectExitCode = 3;
        throw err;
      }
      await atomicWrite(factFilePath, serializeEnvelope(envelope));
    }, { staleMs, timeoutMs });
  } catch (e) {
    if (e instanceof LockTimeoutError) {
      fail(3, e.message);
      return;
    }
    if (e.projectExitCode) {
      fail(e.projectExitCode, e.message);
      return;
    }
    fail(exitCodeForError(e), `internal error: ${e.message}`);
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    source: input.source,
    file: `_lumina/facts/${input.source}.json`,
    facts: envelope.facts.length,
  }));
}

// ---------------------------------------------------------------------------
// verify-evidence (CAP-11, AD-22): report-only. Exits 0 whenever it runs
// (findings are reported, never a failure); a bad config or an fs/internal
// error still exits 2/3, same as `build`/`status` (see `failForEngineError`).
// ---------------------------------------------------------------------------

async function runVerifyEvidence(root, config) {
  try {
    const parsed = await parseAll(root, config);
    const facts = await loadFacts(root);
    const findings = verifyEvidence({ parsed, texts: parsed.texts, facts });
    console.log(JSON.stringify({ findings }));
  } catch (e) {
    failForEngineError(e);
  }
}

// ---------------------------------------------------------------------------
// lint (CAP-9, AD-14, AD-27): agent-free, report-only. Folds P01-P08
// (lib/lint.mjs) with buildGraph's own P09/P10/P11/P12/P17-P20, P13 (stale
// facts, from the shared status loop), P14/P15 (verifyEvidence), and P16
// (scope warnings). `--fail-on error|warning` (default error).
// ---------------------------------------------------------------------------

// Every finding severity ranks here (for computing the "worst" finding);
// only 'error'/'warning' are valid `--fail-on` values (there's no reaching
// 'info': it's the lowest rank, never a promise the CLI makes).
const SEVERITY_RANK = { error: 2, warning: 1, info: 0 };
const FAIL_ON_VALUES = new Set(['error', 'warning']);

/** @throws {Error} on an unknown flag, an extra positional, or a `--fail-on` value other than error/warning. */
function parseLintArgs(rest) {
  const { values } = parseArgs({ args: rest, options: { 'fail-on': { type: 'string' } }, allowPositionals: false });
  const failOn = values['fail-on'] ?? 'error';
  if (!FAIL_ON_VALUES.has(failOn)) {
    throw new Error(`--fail-on must be "error" or "warning", got ${JSON.stringify(failOn)}`);
  }
  return failOn;
}

async function runLint(root, config, failOn) {
  try {
    const parsed = await parseAll(root, config);
    const facts = await loadFacts(root);
    const graph = buildGraph({ config, parsed, facts, exists: existsUnderRoot(root) });
    const ontologyVer = ontologyVersion(config);
    const { docs: statusDocs } = computeDocStatuses({
      parsed, facts, graph, ontologyVer,
    });

    const findings = [
      ...graph.findings, // P09, P10, P11, P12, P17-P20
      ...lintGraph({ graph, parsed }), // P01-P08
      ...statusDocs
        .filter((d) => d.state === 'stale')
        .map((d) => makeFinding('P13', d.path, 1, `stale facts: ${d.path}`)),
      ...verifyEvidence({ parsed, texts: parsed.texts, facts }), // P14, P15
      ...parsed.warnings.map((w) => makeFinding('P16', '_lumina/config/project.yaml', 1, w.message)),
    ];

    const sorted = sortFindings(findings);
    const summary = { errors: 0, warnings: 0, infos: 0 };
    for (const f of sorted) {
      if (f.severity === 'error') summary.errors += 1;
      else if (f.severity === 'warning') summary.warnings += 1;
      else if (f.severity === 'info') summary.infos += 1;
    }

    console.log(JSON.stringify({
      schemaVersion: 1,
      checks_run: RULES.map((r) => r.id),
      findings: sorted,
      summary,
    }));

    const threshold = SEVERITY_RANK[failOn];
    const worst = sorted.reduce((max, f) => Math.max(max, SEVERITY_RANK[f.severity]), -1);
    process.exitCode = worst >= threshold ? 1 : 0;
  } catch (e) {
    failForEngineError(e);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (!checkNodeVersion()) return;

  const [subcommand, ...rest] = argv;
  // `lint` parses its own flags (`--fail-on`) via `parseLintArgs`; every
  // other subcommand still rejects anything after its own name.
  if (!subcommand || !SUBCOMMANDS.has(subcommand) || (subcommand !== 'lint' && rest.length > 0)) {
    fail(1, `unknown subcommand or bad arguments: ${JSON.stringify(argv)}`);
    return;
  }

  // Parsed before the root/config lookup: a bad flag is a bad argument
  // (exit 1) regardless of whether a project root exists.
  let failOn;
  if (subcommand === 'lint') {
    try {
      failOn = parseLintArgs(rest);
    } catch (e) {
      fail(1, e.message);
      return;
    }
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
  } else if (subcommand === 'facts-write') {
    await runFactsWrite(root, config);
  } else if (subcommand === 'verify-evidence') {
    await runVerifyEvidence(root, config);
  } else if (subcommand === 'lint') {
    await runLint(root, config, failOn);
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
