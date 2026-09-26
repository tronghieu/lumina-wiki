#!/usr/bin/env node
/**
 * @module project
 * @description Project engine CLI (AD-5). Subcommands: `scope`,
 * `config-check`, `build`, `status`, `facts-write`, `verify-evidence`,
 * `lint`, `query`, `view`, `facts-prune`; every other subcommand exits 1.
 * JSON to stdout; `{error, code}` to stderr.
 *
 * Usage: node project.mjs <subcommand>
 *
 * Exit codes (AD-14):
 *   0  success (for `lint`: no finding at or above --fail-on)
 *   1  bad arguments or unknown subcommand (for `lint`: also a finding at or above --fail-on)
 *   2  invalid config, no project root, unsafe/colliding scope, an unsafe path argument, or (for
 *      `query`) a ref with no node / a citing doc not in scope
 *   3  internal error or newer schemaVersion, Node < 24, or (for `facts-prune`) one or more files it could not delete
 *
 * `view` (CAP-12): writes `_lumina/graph/view.html`, the one
 * self-contained graph viewer page. `./lib/view.mjs` (and, through it, the
 * vendored `force-graph` bundle) is imported lazily inside `runView`, never
 * at module top level, so `status`/`lint`/etc. never load it (cold-start
 * budget, AD-16).
 */

import { realpathSync, statSync } from 'node:fs';
import {
  readFile, unlink, readdir, rmdir, realpath,
} from 'node:fs/promises';
import {
  join, dirname, relative, isAbsolute, sep,
} from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  findRoot, loadConfig, ontologyVersion, ConfigError, SchemaVersionError, CURRENT_SCHEMA_VERSION,
} from './lib/config.mjs';
import { contentHash } from './lib/hash.mjs';
import { selectScope, ScopeCollisionError } from './lib/scope.mjs';
import { parseAll } from './lib/parse.mjs';
import {
  buildGraph, loadFacts, computeDocStatus, makeResolverContext, resolveFactRef, sortFindings, makeFinding, cmp, isNewerSchema,
  PREFIXED_ID_RE, foldPath,
} from './lib/graph.mjs';
import { assertSafeRelPath, atomicWrite, withLock, LockTimeoutError } from './lib/fsx.mjs';
import {
  prepareEnvelope, serializeEnvelope, verifyEvidence, findPruneCandidates, canonicalizeObject,
} from './lib/factfile.mjs';
import { lintGraph } from './lib/lint.mjs';
import {
  queryNode, queryList, queryNeighbors, buildCtx, atFor, nodeMetaType,
} from './lib/query.mjs';
import { RULES, META_TYPES, META_RELATIONS } from './ontology.mjs';

const MIN_NODE_MAJOR = 24;
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
  const { files, warnings } = await selectScope(root, config.sources);
  console.log(JSON.stringify({ files, warnings }));
}

async function runConfigCheck(root, config) {
  await selectScope(root, config.sources); // AD-8: a case-fold collision fails config-check too (exit 2)
  console.log(JSON.stringify({
    ok: true,
    schemaVersion: config.schemaVersion,
    ontologyVersion: ontologyVersion(config),
  }));
}

/** `exists(path)` for `buildGraph`: true when `path` (repo-relative) is a *file* on disk (a directory link target must not become a `doc:` node). Cached per instance -- one `existsUnderRoot(root)` shared by every check a single command makes, instead of a fresh `statSync` for the same path from each of `buildGraph` and the resolver. */
function existsUnderRoot(root) {
  const cache = new Map();
  return (path) => {
    if (cache.has(path)) return cache.get(path);
    let result;
    try {
      result = statSync(join(root, path)).isFile();
    } catch {
      result = false;
    }
    cache.set(path, result);
    return result;
  };
}

/**
 * The one failure mapping every subcommand's `run` uses (called from
 * `main`'s single try/catch around it): a lock timeout is exit 3, an error
 * some inner step already tagged with `projectExitCode` (e.g. `facts-write`'s
 * stdin/hash checks) keeps that code, `ScopeCollisionError`/`RangeError` are
 * exit 2 with their own message, everything else is `exitCodeForError`'s
 * generic 2/3 split.
 */
function failForEngineError(e) {
  if (e instanceof LockTimeoutError) {
    fail(3, e.message);
    return;
  }
  if (e && e.projectExitCode) {
    fail(e.projectExitCode, e.message);
    return;
  }
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
 * not a broken reference either. Nor is an unprefixed object: `facts-write`
 * keeps an object as written only when it never resolved, so it can't have
 * stopped resolving (it still gets its P09).
 */
function makeRefResolves(graph, docPath) {
  return (fact) => {
    if (fact.kind !== 'edge') return true; // an attr fact (e.g. status) has no target reference to resolve
    if (typeof fact.object === 'string' && !PREFIXED_ID_RE.test(fact.object)) return true;
    return graph.resolution.get(`${docPath}\u0000${fact.id}`) !== 'dangling';
  };
}

/**
 * parsed + facts + graph (AD-19): the one loader `build`, `status`, `lint`,
 * `query`, and `view` all start from, instead of each repeating the same
 * three calls. `exists` defaults to a fresh `existsUnderRoot(root)`; `view`
 * and `query` pass in the same one they also hand `makeResolve`, so a
 * command that needs both never builds (and caches) it twice.
 */
async function loadGraph(root, config, exists = existsUnderRoot(root)) {
  const [parsed, facts] = await Promise.all([parseAll(root, config), loadFacts(root)]);
  const graph = buildGraph({
    config, parsed, facts, exists,
  });
  return { parsed, facts, graph };
}

/** The `(raw, citingDoc) => resolveFactRef(...)` resolver `facts-write`, `query`, and `view` each built the same way from `{config, parsed, exists}` -- one function instead of three copies. `exists` defaults to a fresh `existsUnderRoot(root)`. */
function makeResolve(root, config, parsed, exists = existsUnderRoot(root)) {
  const resolverCtx = makeResolverContext({ config, parsed, exists });
  return (raw, citingDoc) => resolveFactRef(raw, citingDoc, resolverCtx);
}

async function runBuild(root, config) {
  const { graph } = await loadGraph(root, config);
  console.log(JSON.stringify(graph));
}

const STATUS_SUMMARY_KEY = {
  fresh: 'fresh',
  changed: 'changed',
  stale: 'stale',
  'never-ingested': 'neverIngested',
};

/**
 * Case-insensitive envelope lookup (case-only rename, AD-10), exact key
 * first, built once per command instead of once per doc: a per-doc scan on
 * a miss -- every `never-ingested` doc is one -- is O(docs x facts) for
 * `status`/`lint`/`query`/`view` on a real corpus.
 */
function makeEnvelopeLookup(facts) {
  const folded = new Map(); // folded key -> first-seen original key
  for (const key of facts.keys()) {
    const norm = foldPath(key);
    if (!folded.has(norm)) folded.set(norm, key);
  }
  return (docPath) => {
    if (facts.has(docPath)) return facts.get(docPath);
    const origKey = folded.get(foldPath(docPath));
    return origKey === undefined ? undefined : facts.get(origKey);
  };
}

/**
 * Every in-scope doc's freshness state (AD-12), shared by `status` and
 * `lint` (P13) so the two never compute it two different ways.
 * @returns {{docs: {path: string, hash: string, state: string}[], summary: object}}
 */
function computeDocStatuses({
  parsed, facts, graph, ontologyVer,
}) {
  const lookupEnvelope = makeEnvelopeLookup(facts);
  const docs = [];
  const summary = { fresh: 0, changed: 0, stale: 0, neverIngested: 0 };
  for (const doc of parsed.docs) {
    const envelope = lookupEnvelope(doc.path);
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

/** `loadGraph()` plus the freshness loop (AD-12): `status`, `lint`, `query`, and `view` all need it; `build` doesn't, so it stays a separate step. */
async function loadGraphWithStatus(root, config, exists = existsUnderRoot(root)) {
  const { parsed, facts, graph } = await loadGraph(root, config, exists);
  const ontologyVer = ontologyVersion(config);
  const { docs: statusDocs, summary } = computeDocStatuses({
    parsed, facts, graph, ontologyVer,
  });
  return {
    parsed, facts, graph, ontologyVer, statusDocs, summary,
  };
}

async function runStatus(root, config) {
  const { statusDocs, summary } = await loadGraphWithStatus(root, config);
  console.log(JSON.stringify({ docs: statusDocs, summary }));
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

/** Run `fn` while holding the engine's one lock file (`_lumina/_state/lock`), with the two env-var timing overrides shared by every mutating command (`facts-write`, `facts-prune`) -- one lock policy, not two copies. */
function withProjectLock(root, fn) {
  const lockPath = join(root, '_lumina', '_state', 'lock');
  const staleMs = envPositiveInt('LUMINA_PROJECT_LOCK_STALE_MS', 30000);
  const timeoutMs = envPositiveInt('LUMINA_PROJECT_LOCK_TIMEOUT_MS', 10000);
  return withLock(lockPath, fn, { staleMs, timeoutMs });
}

async function runFactsWrite(root, config) {
  let stdinText;
  try {
    stdinText = await readStdinText();
  } catch (e) {
    failForEngineError(e);
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
    failForEngineError(e);
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

  const resolve = makeResolve(root, config, parsed);

  let envelope;
  try {
    envelope = prepareEnvelope(input, { parsed, resolve, ontologyVersion: ontologyVersion(config) });
  } catch (e) {
    fail(1, e.message, e.errors ? { errors: e.errors } : {});
    return;
  }

  const factFilePath = join(root, '_lumina', 'facts', `${input.source}.json`);

  try {
    await withProjectLock(root, async () => {
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

      let existingJson;
      try {
        existingJson = JSON.parse(await readFile(factFilePath, 'utf8'));
      } catch {
        existingJson = undefined; // no existing file, or it doesn't parse -- nothing newer to protect
      }
      if (isNewerSchema(existingJson?.schemaVersion, CURRENT_SCHEMA_VERSION)) {
        const err = new Error(
          `refusing to replace ${input.source}.json: its schemaVersion (${existingJson.schemaVersion}) is newer than this engine supports (${CURRENT_SCHEMA_VERSION})`,
        );
        err.projectExitCode = 3;
        throw err;
      }
      await atomicWrite(factFilePath, serializeEnvelope(envelope));
    });
  } catch (e) {
    failForEngineError(e);
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
  const [parsed, facts] = await Promise.all([parseAll(root, config), loadFacts(root)]);
  const findings = verifyEvidence({ parsed, facts, exists: existsUnderRoot(root) });
  console.log(JSON.stringify({ findings }));
}

// ---------------------------------------------------------------------------
// lint (CAP-9, AD-14, AD-27): agent-free, report-only. Folds P01-P08
// (lib/lint.mjs) with buildGraph's own P09/P10/P11/P12/P17-P21, P13 (stale
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

/**
 * The full lint finding set (CAP-9's `lint` output, folded with CAP-12's
 * `view` highlighting): P09-P12/P17-P21 from `buildGraph()`, P01-P08 from
 * `lintGraph`, P13 (stale facts, from the shared status loop), P14/P15 from
 * `verifyEvidence`, and P16 (scope warnings). One assembly, called by both
 * `runLint` and `runView` -- not a second copy (code map: "reuse runLint's
 * findings assembly").
 */
function assembleFindings({
  parsed, facts, graph, statusDocs, exists,
}) {
  return sortFindings([
    ...graph.findings, // P09, P10, P11, P12, P17-P21
    ...lintGraph({ graph, parsed }), // P01-P08
    ...statusDocs
      .filter((d) => d.state === 'stale')
      .map((d) => makeFinding('P13', d.path, 1, `stale facts: ${d.path}`)),
    ...verifyEvidence({ parsed, facts, exists }), // P14, P15
    ...parsed.warnings.map((w) => makeFinding('P16', '_lumina/config/project.yaml', 1, w.message)),
  ]);
}

async function runLint(root, config, failOn) {
  const exists = existsUnderRoot(root);
  const {
    parsed, facts, graph, statusDocs,
  } = await loadGraphWithStatus(root, config, exists);

  const sorted = assembleFindings({
    parsed, facts, graph, statusDocs, exists,
  });
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
}

// ---------------------------------------------------------------------------
// view (CAP-12, AD-16): writes the one self-contained `_lumina/graph/
// view.html`. No argument (bad args -> exit 1, handled by `main`'s own
// SUBCOMMANDS/rest-args check, same as every non-lint/query subcommand).
// `./lib/view.mjs` is imported lazily, right here, not at module top level,
// so `status`/`lint`/etc. never load the viewer or the vendored force-graph
// bundle (cold-start row of the I/O matrix).
// ---------------------------------------------------------------------------

async function runView(root, config) {
  const exists = existsUnderRoot(root);
  const {
    parsed, facts, graph, statusDocs, summary,
  } = await loadGraphWithStatus(root, config, exists);
  const findings = assembleFindings({
    parsed, facts, graph, statusDocs, exists,
  });

  // Enrich every node with the `metaType`/`at` that `query.mjs` already
  // knows how to compute (reused, not recomputed a second way): doc nodes
  // already carry `metaType` from `buildGraph`, but frag/concept/id nodes
  // don't, and no node carries its own source location.
  const resolve = makeResolve(root, config, parsed, exists);
  const qctx = buildCtx({ graph, parsed, resolve });
  const enrichedGraph = {
    nodes: graph.nodes.map((n) => ({ ...n, metaType: nodeMetaType(n, resolve), at: atFor(n, qctx) })),
    edges: graph.edges,
  };
  const freshness = { docs: statusDocs, summary };

  const { renderView } = await import('./lib/view.mjs');
  const html = await renderView({ graph: enrichedGraph, findings, freshness });
  const viewPath = join(root, '_lumina', 'graph', 'view.html');
  await atomicWrite(viewPath, html);
  console.log(JSON.stringify({ ok: true, file: '_lumina/graph/view.html', url: pathToFileURL(viewPath).href }));
}

// ---------------------------------------------------------------------------
// query (CAP-7, CAP-10, AD-28): `node <ref>`, `list --meta-type T [--status
// S]`, `neighbors <ref> --direction in|out [--relation R]`. Read-only,
// computed live from `buildGraph`; every response carries `freshness`.
// `resolve <citing-doc> <object>` answers what `facts-write` would do with
// that object (no graph, no freshness, no lock).
// ---------------------------------------------------------------------------

const QUERY_OPS = new Set(['node', 'list', 'neighbors', 'resolve']);
const DIRECTIONS = new Set(['in', 'out']);

/** @throws {Error} on a missing/unknown op, bad flags, a missing `<ref>`, or an extra positional; RangeError on an unsafe `resolve` citing-doc path. */
function parseQueryArgs(rest) {
  const [op, ...opArgs] = rest;
  if (!op || !QUERY_OPS.has(op)) {
    throw new Error(`query: op must be "node", "list", "neighbors", or "resolve", got ${JSON.stringify(op ?? null)}`);
  }

  if (op === 'resolve') {
    const { positionals } = parseArgs({ args: opArgs, options: {}, allowPositionals: true });
    if (positionals.length !== 2 || positionals[1] === '') {
      throw new Error('query resolve: expected <citing-doc> and a non-empty <object>');
    }
    assertSafeRelPath(positionals[0]);
    return { op, from: positionals[0], object: positionals[1] };
  }

  if (op === 'node') {
    const { positionals } = parseArgs({ args: opArgs, options: {}, allowPositionals: true });
    if (positionals.length !== 1) throw new Error('query node: expected exactly one <ref>');
    return { op, ref: positionals[0] };
  }

  if (op === 'list') {
    const { values, positionals } = parseArgs({
      args: opArgs,
      options: { 'meta-type': { type: 'string' }, status: { type: 'string' } },
      allowPositionals: true,
    });
    if (positionals.length > 0) throw new Error('query list: unexpected positional argument');
    const metaType = values['meta-type'];
    if (typeof metaType !== 'string' || !Object.hasOwn(META_TYPES, metaType)) {
      throw new Error(`query list: --meta-type must be one of ${Object.keys(META_TYPES).join(', ')}, got ${JSON.stringify(metaType ?? null)}`);
    }
    if (values.status === '') {
      throw new Error('query list: --status must not be empty');
    }
    return { op, metaType, status: values.status };
  }

  // neighbors
  const { values, positionals } = parseArgs({
    args: opArgs,
    options: { direction: { type: 'string' }, relation: { type: 'string' } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) throw new Error('query neighbors: expected exactly one <ref>');
  const direction = values.direction;
  if (!DIRECTIONS.has(direction)) {
    throw new Error(`query neighbors: --direction must be "in" or "out", got ${JSON.stringify(direction ?? null)}`);
  }
  if (values.relation !== undefined && !META_RELATIONS.includes(values.relation)) {
    throw new Error(`query neighbors: --relation must be one of ${META_RELATIONS.join(', ')}, got ${JSON.stringify(values.relation)}`);
  }
  return {
    op, ref: positionals[0], direction, relation: values.relation,
  };
}

/**
 * `query resolve`: `object` canonicalized from `from` exactly as
 * `facts-write` would (`canonicalizeObject`, same resolver). Prints
 * `{ok, from, object, resolution, target?, inScope?, error?}`; `target` only
 * when resolved, `inScope` only for a resolved doc:/frag: target, `error`
 * (the rejection reason) only when rejected.
 */
async function runQueryResolve(root, config, { from, object }) {
  const parsed = await parseAll(root, config);
  const citingDoc = parsed.docs.find((d) => d.path === from);
  if (!citingDoc) {
    fail(2, `citing doc not in scope: ${from}`);
    return;
  }
  const out = { ok: true, from, object };
  try {
    const c = canonicalizeObject(object, citingDoc, makeResolve(root, config, parsed));
    out.resolution = c.resolution;
    if (c.resolution === 'resolved') {
      out.target = c.object;
      if (typeof c.inScope === 'boolean') out.inScope = c.inScope;
    }
  } catch (e) {
    out.resolution = 'rejected';
    out.error = e.message;
  }
  console.log(JSON.stringify(out));
}

async function runQuery(root, config, queryArgs) {
  if (queryArgs.op === 'resolve') {
    await runQueryResolve(root, config, queryArgs);
    return;
  }
  const exists = existsUnderRoot(root);
  const {
    parsed, graph, statusDocs, summary,
  } = await loadGraphWithStatus(root, config, exists);
  const freshness = {
    stale: summary.stale,
    changed: summary.changed,
    neverIngested: summary.neverIngested,
    staleDocs: statusDocs.filter((d) => d.state === 'stale').map((d) => d.path).sort(),
  };

  const resolve = makeResolve(root, config, parsed, exists);

  let payload;
  if (queryArgs.op === 'node') {
    const result = queryNode(queryArgs.ref, { graph, parsed, resolve });
    if (!result) {
      fail(2, `no node resolves for ref: ${queryArgs.ref}`);
      return;
    }
    payload = { op: 'node', ...result };
  } else if (queryArgs.op === 'list') {
    const items = queryList({ metaType: queryArgs.metaType, status: queryArgs.status }, { graph, parsed, resolve });
    payload = { op: 'list', items };
  } else {
    const items = queryNeighbors(
      queryArgs.ref,
      { direction: queryArgs.direction, relation: queryArgs.relation },
      { graph, parsed, resolve },
    );
    if (!items) {
      fail(2, `no node resolves for ref: ${queryArgs.ref}`);
      return;
    }
    payload = { op: 'neighbors', items };
  }

  console.log(JSON.stringify({ schemaVersion: 1, ...payload, freshness }));
}

// ---------------------------------------------------------------------------
// facts-prune (AD-10): removes committed fact files whose doc was actually
// deleted, never one that merely fell out of scope (a scope edit or a typo)
// -- that would lose paid-for facts. Classification is `findPruneCandidates`
// (lib/factfile.mjs), reused from `verifyEvidence`'s own detection logic;
// this function only does the I/O -- read, lock, validate, delete, remove
// now-empty directories.
//
// `[<fact file>...]` positionals are the approval list from a prior
// `--dry-run`: the real run deletes only listed files still removable after
// re-classifying under the lock, an approved-but-stale file is `skipped`,
// and any removable file *not* listed is left untouched. No positionals ->
// the whole removable set (plain CLI use).
// ---------------------------------------------------------------------------

/** @throws {Error} on an unknown flag, or a positional that isn't a safe path inside `_lumina/facts/`. */
function parseFactsPruneArgs(rest) {
  const { values, positionals } = parseArgs({ args: rest, options: { 'dry-run': { type: 'boolean' } }, allowPositionals: true });
  for (const p of positionals) {
    assertSafeRelPath(p); // throws RangeError on '..'/absolute/drive-letter/backslash
    if (!p.startsWith('_lumina/facts/')) {
      throw new Error(`facts-prune: positional must be a path inside _lumina/facts/, got ${JSON.stringify(p)}`);
    }
  }
  return { dryRun: values['dry-run'] === true, positionals };
}

/**
 * `path` at or below `dir` (equal counts -- a fact file can sit directly in
 * `_lumina/facts/` itself). Used for the pre-unlink realpath safety check.
 * A name that merely starts with ".." (e.g. "..notes.md.json") is a real
 * directory entry, not a traversal -- only an actual ".." segment escapes.
 */
function isWithin(path, dir) {
  const rel = relative(dir, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Strictly *inside* `dir` (`dir` itself does not count) -- stops `pruneEmptyDirUpTo` at `_lumina/facts/` without ever removing it. */
function isStrictlyInside(path, dir) {
  return relative(dir, path) !== '' && isWithin(path, dir);
}

/** Remove `dir` if left empty, then recurse upward toward (but never past) `stopAt`. */
async function pruneEmptyDirUpTo(dir, stopAt) {
  if (!isStrictlyInside(dir, stopAt)) return;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return; // already gone
  }
  if (entries.length > 0) return;
  try {
    await rmdir(dir);
  } catch {
    return; // race or already gone; not fatal to facts-prune
  }
  await pruneEmptyDirUpTo(join(dir, '..'), stopAt);
}

function sortByFile(items) {
  return [...items].sort((a, b) => cmp(a.file, b.file));
}

/** `requested` split against `removableSet`: `toDelete` (still removable) and `skipped` (`{file, reason: 'not-removable'}` for a stale approval) -- the one partition both the dry run and the real run report. */
function partitionApproved(requested, removableSet) {
  const toDelete = [];
  const skipped = [];
  for (const file of requested) {
    if (removableSet.has(file)) toDelete.push(file);
    else skipped.push({ file, reason: 'not-removable' });
  }
  return { toDelete, skipped };
}

async function runFactsPrune(root, config, { dryRun, positionals }) {
  const exists = existsUnderRoot(root);
  const classify = async () => {
    const [parsed, facts] = await Promise.all([parseAll(root, config), loadFacts(root)]);
    return findPruneCandidates({ parsed, facts, exists });
  };

  const requested = positionals.length > 0 ? positionals : null;
  // A real run re-classifies under the lock (a concurrent facts-write/ingest
  // could have changed what's removable since the caller's own dry run), so
  // classifying here too would be wasted work -- only the dry-run path needs
  // this one.
  let result = dryRun ? await classify() : null;

  const removed = [];
  const skipped = [];
  const failed = [];

  if (dryRun) {
    // Report-only: no lock, nothing on disk changes. With an approval
    // list, report exactly what a real run would do with it.
    if (requested) {
      const partition = partitionApproved(requested, new Set(result.removed));
      removed.push(...partition.toDelete);
      skipped.push(...partition.skipped);
    } else {
      removed.push(...result.removed);
    }
  } else {
    const factsRoot = join(root, '_lumina', 'facts');

    await withProjectLock(root, async () => {
      result = await classify();
      const removable = new Set(result.removed);
      let toDelete;
      if (requested) {
        const partition = partitionApproved(requested, removable);
        toDelete = partition.toDelete;
        skipped.push(...partition.skipped);
      } else {
        toDelete = result.removed;
      }

      if (toDelete.length === 0) return;

      // Validate before the first unlink: factsRoot's own realpath, then
      // (per file, right before that file's unlink) its parent dir's --
      // must resolve at or under it. Guards a symlinked `_lumina/facts/`
      // entry pointing outside the tree.
      const factsRootReal = await realpath(factsRoot);
      for (const relFile of toDelete) {
        const absFile = join(root, relFile);
        try {
          const parentReal = await realpath(dirname(absFile));
          if (!isWithin(parentReal, factsRootReal)) {
            throw new Error(`refusing to remove outside _lumina/facts/: ${relFile}`);
          }
          await unlink(absFile);
          removed.push(relFile);
        } catch (e) {
          if (e.code === 'ENOENT') continue; // already gone; not a failure, not re-reported
          failed.push({ file: relFile, error: e.message });
        }
      }
      for (const relFile of removed) {
        await pruneEmptyDirUpTo(dirname(join(root, relFile)), factsRoot);
      }
    });
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    removed: removed.sort(),
    kept: result.kept,
    skipped: sortByFile(skipped),
    failed: sortByFile(failed),
    warnings: result.warnings,
  }));
  process.exitCode = failed.length > 0 ? 3 : 0;
}

// One table instead of a `SUBCOMMANDS` set, a `SELF_PARSING_SUBCOMMANDS`
// set, and a 10-branch if/else chain: `main` looks up the subcommand,
// rejects extra args when there's no `parse`, runs `parse` (when present)
// inside one try/catch mapped to exit 1 (2 for an unsafe path), then runs `run` inside one
// try/catch mapped to `failForEngineError`. `run(root, config, args)` --
// `args` is `undefined` for a subcommand with no `parse` step.
const COMMANDS = {
  scope: { run: runScope },
  'config-check': { run: runConfigCheck },
  build: { run: runBuild },
  status: { run: runStatus },
  'facts-write': { run: runFactsWrite },
  'verify-evidence': { run: runVerifyEvidence },
  lint: { parse: parseLintArgs, run: runLint },
  query: { parse: parseQueryArgs, run: runQuery },
  view: { run: runView },
  'facts-prune': { parse: parseFactsPruneArgs, run: runFactsPrune },
};

export async function main(argv = process.argv.slice(2)) {
  if (!checkNodeVersion()) return;

  const [subcommand, ...rest] = argv;
  const cmd = subcommand && Object.hasOwn(COMMANDS, subcommand) ? COMMANDS[subcommand] : undefined;
  // A subcommand with no `parse` step (everything but lint/query/facts-prune)
  // still rejects anything after its own name.
  if (!cmd || (!cmd.parse && rest.length > 0)) {
    fail(1, `unknown subcommand or bad arguments: ${JSON.stringify(argv)}`);
    return;
  }

  // Parsed before the root/config lookup: a bad flag is a bad argument
  // (exit 1) regardless of whether a project root exists.
  let args;
  if (cmd.parse) {
    try {
      args = cmd.parse(rest);
    } catch (e) {
      fail(e instanceof RangeError ? 2 : 1, e.message); // AD-14: an unsafe path argument is exit 2
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

  try {
    await cmd.run(root, config, args);
  } catch (e) {
    failForEngineError(e);
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
