/**
 * @module installer/wikis-command
 * @description Implements the `lumina wikis <verb>` CLI surface — the
 * agent-facing entry point onto the global wiki registry (registry.js) and
 * per-wiki structure/lint health (layout.js + each wiki's own engine).
 *
 * Contract: docs/specs/spec-librarian-mode/registry-and-cli.md.
 * Architecture: AD-3 (deterministic resolver), AD-4 (version-correct engine
 * invocation — always spawn the target wiki's own `_lumina/scripts/lint.mjs`,
 * never a copy from this repo/hub), AD-5/AD-6 (layout is pure data; repair is
 * additive-only and installer-faithful), AD-9 (lazy-loaded, no cold-start
 * regression), AD-11 (reuses the existing JSON/exit-code contract verbatim).
 *
 * `wikisCommand(subcommand, args, options)` never throws and never calls
 * process.exit — it prints to stdout/stderr itself and RETURNS the exit
 * code; the caller (bin/lumina.js) is responsible for `process.exit(code)`.
 * This mirrors discover-runner.mjs's `main()` contract and keeps this module
 * spawnSync-testable without a subprocess per assertion.
 *
 * Exit codes (project contract): 0 success, 1 user error, 2 fs/path/unknown,
 * 3 internal, 4 cancelled. In --json mode, errors are always
 * `{"error":"...","code":N}` on stderr; plain-text mode prints
 * `[error] ...` on stderr.
 *
 * `inspect` (read-only) + `add --provision` implement the chat-driven
 * "bare directory -> registered wiki" flow: an agent calls `inspect` to
 * classify a path with zero side effects, asks the user whatever `asks`
 * says it must, then calls `add --provision --yes` to actually create/
 * register the wiki. `installCommand` is invoked as a direct import (not a
 * subprocess), always with `profile: 'minimal'` (CAP-8: workspace managed by
 * globally-installed agent skills, no per-project `.agents/skills` copies).
 * `checkLayout(root, packs, {profile})` — both here (doctorOne) and in
 * `buildInspectReport` — must read the target's own `manifest.profile`
 * (missing field = 'full') rather than assume 'full', or a minimal-profile
 * wiki will be misreported as broken.
 */

import { readFile, access, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { addWiki, removeWiki, listWikis, resolveWiki, refreshPacks, normalizeKey, sameDirectory } from './registry.js';
import { checkLayout } from './layout.js';
import { ensureDir } from './fs.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Path helper — resolve a user-typed path to absolute.
//
// Deliberately NOT importing prompts.js: prompts.js is lazy-loaded and pulls
// in @clack/prompts on first use elsewhere in the process; importing it here
// would tie this module's cold start to that lazy-load contract for no
// benefit. This is the same trim → `~` expand → resolve logic as
// `expandUserPath` in prompts.js, just relative to cwd instead of a caller
// supplied fallback.
// ---------------------------------------------------------------------------

function expandToAbsolute(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return process.cwd();
  let expanded = trimmed;
  if (expanded === '~') expanded = homedir();
  else if (expanded.startsWith('~/')) expanded = `${homedir()}/${expanded.slice(2)}`;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

function normalizeAliases(alias) {
  if (!alias) return [];
  return Array.isArray(alias) ? alias : [alias];
}

function parsePacks(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

function hubPackageVersion() {
  try {
    return require('../../package.json').version;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emitError(json, message, code, extra = {}) {
  if (json) {
    process.stderr.write(JSON.stringify({ error: message, code, ...extra }) + '\n');
  } else {
    process.stderr.write(`[error] ${message}\n`);
    if (extra.candidates && extra.candidates.length) {
      process.stderr.write('Candidates:\n');
      for (const c of extra.candidates) process.stderr.write(`  ${c.key}  (${c.name})\n`);
    }
    if (extra.created && extra.created.length) {
      process.stderr.write('Created before the failure (not rolled back):\n');
      for (const c of extra.created) process.stderr.write(`  ${c}\n`);
    }
    if (extra.lastKnownPath) {
      process.stderr.write(`Last-known path: ${extra.lastKnownPath}\n`);
    }
  }
  return code;
}

function emitSuccess(json, obj, humanFn) {
  if (json) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } else {
    humanFn();
  }
  return 0;
}

function sortedCandidates(candidates) {
  return (candidates || []).slice().sort((a, b) => a.key.localeCompare(b.key));
}

// Suppress installCommand's own console.log progress output while running it
// in --json mode, so stdout stays a single parseable JSON line. installCommand
// has no quiet/silent option of its own (it's designed to run under the CLI's
// own banner + progress UI), and it never writes to stderr, so this is safe:
// nothing installCommand needs the caller to see is lost, only echoed.
//
// TODO(installer-core): replace this with a real `opts.quiet` on
// installCommand once one exists, so it never prints in the first place
// instead of us muting global console state around the call. Not done here —
// commands.js is owned by another agent.
//
// The try/finally is load-bearing: if installCommand throws (bad path,
// EACCES, disk full, bad --packs value, ...) console.log/info MUST still be
// restored, or every subsequent message in this process — including the
// error we're about to surface via process.stderr.write in the catch above
// this call — would go silently missing. See wikis-command.test.js: "a
// mid-provision throw restores console.log and still surfaces the error".
async function withSuppressedConsoleIfJson(json, fn) {
  if (!json) return fn();
  const originalLog = console.log;
  const originalInfo = console.info;
  console.log = () => {};
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
  }
}

// ---------------------------------------------------------------------------
// Shared fs probing (inspect + add --provision)
// ---------------------------------------------------------------------------

/**
 * Top-level entry names in `dirPath`, excluding `.git`/`.DS_Store`, sorted.
 * Returns `null` (not `[]`) when `dirPath` does not exist, so callers can
 * distinguish "missing" from "empty" without a second stat call.
 *
 * @param {string} dirPath
 * @returns {Promise<string[]|null>}
 */
async function listTopLevelEntries(dirPath) {
  let names;
  try {
    names = await readdir(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    const e = new Error(`Could not read directory "${dirPath}": ${err.message}`);
    e.code = 2;
    throw e;
  }
  return names.filter((n) => n !== '.git' && n !== '.DS_Store').sort();
}

async function readManifestQuiet(dirPath) {
  try {
    return JSON.parse(await readFile(join(dirPath, '_lumina', 'manifest.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function findRegistryMatch(absPath) {
  const reg = await listWikis();
  // sameDirectory(), not a plain string compare — a registered wiki reached
  // through a case-different spelling (macOS/Windows) or a symlinked parent
  // (e.g. /tmp -> /private/tmp on macOS, which this project's own tests run
  // under) must still be recognized as already registered, or inspect would
  // wrongly report it unregistered and point the agent at add --provision,
  // which addWiki's duplicate-path guard would then correctly refuse.
  for (const [key, entry] of Object.entries(reg.wikis)) {
    if (await sameDirectory(entry.path, absPath)) return { registered: true, registeredAs: key };
  }
  return { registered: false, registeredAs: null };
}

// ---------------------------------------------------------------------------
// inspect — read-only classification of a bare path, phase 1 of the chat
// flow (inspect -> agent asks the user -> add --provision).
// ---------------------------------------------------------------------------

const WILL_CREATE = ['README.md', '_lumina/', 'wiki/', 'raw/', 'graph/'];

function emptyMissing() {
  return { dirs: [], seedFiles: [], engine: [] };
}

function buildHint(absPath, state, registered, provisionable, packs) {
  if (registered) return null;
  if (provisionable) {
    const packsArg = (packs && packs.length ? packs : ['core']).join(',');
    return `lumina wikis add "${absPath}" --provision --yes --json --name "<name>" --alias "<alias>" --description "<text>" --packs ${packsArg}`;
  }
  // Already a wiki, just unregistered — no --provision, no --packs/--description.
  return `lumina wikis add "${absPath}" --json --name "<name>" --alias "<alias>"`;
}

function assembleInspectReport(absPath, state, exists, entryCount, sampleEntries, missing, willCreate, registryMatch, packs) {
  const { registered, registeredAs } = registryMatch;
  const provisionable = state === 'missing' || state === 'empty' || state === 'unmanaged';
  const asks = registered ? [] : provisionable ? ['name', 'alias', 'description', 'packs'] : ['name', 'alias'];
  const hint = buildHint(absPath, state, registered, provisionable, packs);

  return {
    schemaVersion: 1,
    path: absPath,
    exists,
    state,
    registered,
    registeredAs,
    entryCount,
    sampleEntries,
    missing,
    willCreate,
    asks,
    hint,
  };
}

/**
 * Never writes anything. Classifies `absPath` into one of five states —
 * see module doc / registry-and-cli.md for the full state table.
 *
 * @param {string} absPath
 * @param {string[]} packs - packs to evaluate an existing wiki's layout
 *   against when its own manifest lists none, and to fill the `--packs`
 *   placeholder in `hint` when provisioning applies.
 */
async function buildInspectReport(absPath, packs) {
  const registryMatch = await findRegistryMatch(absPath);

  let st = null;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const e = new Error(`Could not inspect "${absPath}": ${err.message}`);
      e.code = 2;
      throw e;
    }
  }

  if (!st) {
    return assembleInspectReport(absPath, 'missing', false, 0, [], emptyMissing(), [...WILL_CREATE], registryMatch, packs);
  }

  if (!st.isDirectory()) {
    const e = new Error(`Path exists but is not a directory: "${absPath}"`);
    e.code = 2;
    throw e;
  }

  const entries = (await listTopLevelEntries(absPath)) ?? [];
  if (entries.length === 0) {
    return assembleInspectReport(absPath, 'empty', true, 0, [], emptyMissing(), [...WILL_CREATE], registryMatch, packs);
  }

  const manifest = await readManifestQuiet(absPath);
  if (!manifest) {
    return assembleInspectReport(
      absPath, 'unmanaged', true, entries.length, entries.slice(0, 5),
      emptyMissing(), [...WILL_CREATE], registryMatch, packs,
    );
  }

  const packsForLayout = Object.keys(manifest.packs || {});
  const effectivePacks = packsForLayout.length ? packsForLayout : packs;
  // manifest.profile is part of the concurrent minimal-profile work; a
  // manifest without it means 'full' (per the agreed contract).
  const layoutReport = await checkLayout(absPath, effectivePacks, { profile: manifest.profile || 'full' });
  const state = layoutReport.ok ? 'wiki-ok' : 'wiki-partial';
  const missing = {
    dirs: layoutReport.missingDirs,
    seedFiles: layoutReport.missingSeedFiles,
    engine: layoutReport.missingEngine,
  };
  return assembleInspectReport(absPath, state, true, entries.length, [], missing, [], registryMatch, packs);
}

function printInspectHuman(report) {
  console.log(`${report.path}  [${report.state}]`);
  console.log(`  exists: ${report.exists}`);
  console.log(`  registered: ${report.registered}${report.registeredAs ? ` (as "${report.registeredAs}")` : ''}`);
  if (report.sampleEntries.length) {
    console.log(`  ${report.entryCount} existing entr${report.entryCount === 1 ? 'y' : 'ies'}, e.g. ${report.sampleEntries.join(', ')}`);
  }
  for (const d of report.missing.dirs) console.log(`  - missing directory: ${d}`);
  for (const f of report.missing.seedFiles) console.log(`  - missing seed file: ${f}`);
  for (const p of report.missing.engine) console.log(`  - missing engine path: ${p}`);
  if (report.willCreate.length) console.log(`  provisioning would create: ${report.willCreate.join(', ')}`);
  if (report.asks.length) console.log(`  before provisioning, ask the user for: ${report.asks.join(', ')}`);
  if (report.hint) console.log(`  next: ${report.hint}`);
}

async function runInspect(args, options, json) {
  const rawPath = args[0];
  if (!rawPath) {
    return emitError(json, 'Usage: lumina wikis inspect <path> [--packs <list>] [--json]', 1);
  }

  const absPath = expandToAbsolute(rawPath);
  const packs = parsePacks(options.packs, ['core']);

  try {
    const report = await buildInspectReport(absPath, packs);
    return emitSuccess(json, report, () => printInspectHuman(report));
  } catch (err) {
    return emitError(json, err.message, err.code ?? 2);
  }
}

// ---------------------------------------------------------------------------
// add [--provision]
// ---------------------------------------------------------------------------

async function runAdd(args, options, json) {
  const rawPath = args[0];
  if (!rawPath) {
    return emitError(
      json,
      'Usage: lumina wikis add <path> [--name <name>] [--alias <alias>]... [--description <text>] [--provision --yes [--packs <list>]]',
      1,
    );
  }

  const dirPath = expandToAbsolute(rawPath);
  const aliases = normalizeAliases(options.alias);
  const provision = Boolean(options.provision);

  if (provision && !options.yes) {
    return emitError(
      json,
      `Provisioning writes files to "${dirPath}". Pass --yes to confirm the user has approved this (the agent must ask before running this).`,
      2,
    );
  }

  if (!provision) {
    try {
      const result = await addWiki({
        dirPath,
        name: options.name,
        aliases,
        description: options.description || '',
      });
      return emitSuccess(json, result, () => {
        console.log(`Added wiki "${result.entry.name}" as "${result.key}"`);
        console.log(`  path: ${result.entry.path}`);
        if (result.entry.aliases.length) console.log(`  aliases: ${result.entry.aliases.join(', ')}`);
        if (result.entry.packs.length) console.log(`  packs: ${result.entry.packs.join(', ')}`);
      });
    } catch (err) {
      return emitError(json, err.message, err.code ?? 1);
    }
  }

  return runAddWithProvision({ dirPath, options, aliases, json });
}

/**
 * `add --provision --yes`. Two branches:
 *  - `dirPath` already has `_lumina/manifest.json` -> register only, never
 *    install/upgrade/touch the directory (running the installer there would
 *    silently take the upgrade path and rewrite an engine the user may not
 *    want changed). Idempotent for a genuine retry (see below).
 *  - otherwise (missing / empty / unmanaged) -> installCommand(profile:
 *    'minimal', ...) then addWiki(...). Relies entirely on installCommand's
 *    own skip-if-exists discipline to avoid clobbering pre-existing files in
 *    an unmanaged directory — verified by a byte-identical test, not
 *    re-implemented here.
 */
async function runAddWithProvision({ dirPath, options, aliases, json }) {
  const manifest = await readManifestQuiet(dirPath);

  if (manifest) {
    // Idempotent retry. `add --provision` is the endpoint a chat agent
    // (OpenClaw/Hermes, over Telegram/Lark) drives, and retries are normal
    // there: a redelivered message, a network hiccup that leaves the agent
    // unsure whether its last command landed, a user repeating themselves.
    // In every one of those cases the agent re-runs the EXACT same command —
    // same --name, same path. Without this check, addWiki()'s duplicate-key
    // guard below would turn that into an error, and the agent has no
    // reliable way to tell "already done, relax" apart from "something is
    // wrong". So: if the name/alias this call would register under already
    // resolves to THIS SAME directory, there is genuinely nothing to do —
    // report success instead of calling addWiki() at all.
    //
    // Deliberately narrow: only the *exact* same key (from --name, or the
    // same basename() fallback when --name is omitted) pointing at the
    // *same directory* (sameDirectory() — case/symlink/hardlink-aware, not
    // just a string compare, for the same reason as addWiki()'s duplicate-
    // path guard below) short-circuits here. A different --name still
    // reaches addWiki() below and registers normally (or now collides with
    // a name/alias OR a path already used by a DIFFERENT wiki, which is a
    // real conflict and must keep failing — registry.js's guards, untouched
    // by this file).
    const candidateKey = normalizeKey(options.name || basename(dirPath));
    const registryBeforeAdd = await listWikis();
    const existingEntry = registryBeforeAdd.wikis[candidateKey];
    if (existingEntry && await sameDirectory(existingEntry.path, dirPath)) {
      return emitSuccess(
        json,
        { key: candidateKey, entry: existingEntry, provisioned: false, alreadyRegistered: true },
        () => {
          console.log(`"${existingEntry.name}" (${candidateKey}) is already registered at this path — nothing to do.`);
          console.log(`  path: ${existingEntry.path}`);
        },
      );
    }

    try {
      const result = await addWiki({
        dirPath,
        name: options.name,
        aliases,
        description: options.description || '',
      });
      const extra = { provisioned: false };
      const hubVersion = hubPackageVersion();
      const wikiVersion = manifest.packageVersion || null;
      if (hubVersion && wikiVersion && hubVersion !== wikiVersion) {
        extra.versionSkew = { wiki: wikiVersion, hub: hubVersion };
      }
      return emitSuccess(json, { ...result, ...extra }, () => {
        console.log(`Registered existing wiki "${result.entry.name}" as "${result.key}" (already a Lumina wiki; directory not touched).`);
        console.log(`  path: ${result.entry.path}`);
        if (extra.versionSkew) {
          console.log(`  version skew: wiki=${extra.versionSkew.wiki} hub=${extra.versionSkew.hub}`);
        }
        if (result.entry.aliases.length) console.log(`  aliases: ${result.entry.aliases.join(', ')}`);
        if (result.entry.packs.length) console.log(`  packs: ${result.entry.packs.join(', ')}`);
      });
    } catch (err) {
      return emitError(json, err.message, err.code ?? 1);
    }
  }

  let stBefore = null;
  try {
    stBefore = await stat(dirPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      return emitError(json, `Could not inspect "${dirPath}": ${err.message}`, 2);
    }
  }
  if (stBefore && !stBefore.isDirectory()) {
    return emitError(json, `Path exists but is not a directory: "${dirPath}"`, 2);
  }

  let before;
  try {
    before = (await listTopLevelEntries(dirPath)) ?? [];
  } catch (err) {
    return emitError(json, err.message, err.code ?? 2);
  }

  const packs = parsePacks(options.packs, ['core']);
  const description = options.description || '';

  try {
    const { installCommand } = await import('./commands.js');
    await withSuppressedConsoleIfJson(json, () => installCommand({
      directory: dirPath,
      yes: true,
      profile: 'minimal',
      packs,
      ideTargets: ['generic'],
      purpose: description,
      noUpdate: true,
    }));
  } catch (err) {
    return emitError(json, `Provisioning failed at "${dirPath}": ${err.message}`, err.code ?? 3);
  }

  let after;
  try {
    after = (await listTopLevelEntries(dirPath)) ?? [];
  } catch (_) {
    after = before;
  }
  const beforeSet = new Set(before);
  const created = after.filter((name) => !beforeSet.has(name)).sort();

  try {
    const result = await addWiki({ dirPath, name: options.name, aliases, description });
    return emitSuccess(json, { ...result, provisioned: true, created }, () => {
      console.log(`Provisioned and added wiki "${result.entry.name}" as "${result.key}"`);
      console.log(`  path: ${result.entry.path}`);
      if (created.length) console.log(`  created: ${created.join(', ')}`);
      if (result.entry.aliases.length) console.log(`  aliases: ${result.entry.aliases.join(', ')}`);
      if (result.entry.packs.length) console.log(`  packs: ${result.entry.packs.join(', ')}`);
    });
  } catch (err) {
    return emitError(
      json,
      `${err.message} NOTE: the directory at "${dirPath}" was already provisioned by this command and was NOT rolled back. ` +
      'Tell the user it exists, then retry "lumina wikis add" with a different --name/--alias to register it.',
      err.code ?? 1,
      { created },
    );
  }
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

async function runRemove(args, options, json) {
  const query = args[0];
  if (!query) {
    return emitError(json, 'Usage: lumina wikis remove <name>', 1);
  }

  try {
    const result = await removeWiki(query);
    return emitSuccess(json, result, () => {
      console.log(`Removed wiki "${result.entry.name}" (${result.key}) from the registry.`);
      console.log('Its files were not touched.');
    });
  } catch (err) {
    return emitError(json, err.message, err.code ?? 2, { candidates: sortedCandidates(err.candidates) });
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

async function runList(args, options, json) {
  const reg = await listWikis();
  const keys = Object.keys(reg.wikis);

  return emitSuccess(json, reg, () => {
    if (!keys.length) {
      console.log('No wikis registered. Use "lumina wikis add <path>" to register one.');
      return;
    }
    for (const key of keys) {
      const entry = reg.wikis[key];
      console.log(`${key}  —  ${entry.name}`);
      console.log(`  path: ${entry.path}`);
      if (entry.aliases && entry.aliases.length) console.log(`  aliases: ${entry.aliases.join(', ')}`);
      if (entry.packs && entry.packs.length) console.log(`  packs: ${entry.packs.join(', ')}`);
    }
  });
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

async function runResolve(args, options, json) {
  const query = args[0];
  if (!query) {
    return emitError(json, 'Usage: lumina wikis resolve <query>', 1);
  }

  try {
    const { key, entry } = await resolveWiki(query);
    // AD-3 side effect: refresh this wiki's packs from its live manifest.
    // Most refresh failures are tolerated — resolve still succeeds with the
    // last-known packs (e.g. 'unchanged', or a registry read failure caught
    // below). But `code: 'manifest-unreadable'` means the registered
    // directory has been deleted, moved, or replaced, or its
    // _lumina/manifest.json is missing/corrupt — i.e. the resolved path is
    // no longer a valid wiki at all. Silently falling back there would hand
    // a global agent skill a stale path it would treat as a live wiki, so
    // that class must fail resolve outright instead of degrading quietly.
    const refreshResult = await refreshPacks(key).catch(() => null);
    if (refreshResult && !refreshResult.refreshed && refreshResult.code === 'manifest-unreadable') {
      return emitError(
        json,
        `Wiki "${key}" could not be resolved: its registered directory may have been deleted, moved, or replaced, or its manifest is unreadable (${refreshResult.reason}). ` +
        `Run "lumina wikis doctor ${key}" to diagnose, or re-register with "lumina wikis add" if it moved.`,
        2,
        { key, lastKnownPath: entry.path, reason: refreshResult.reason },
      );
    }
    const packs = refreshResult && refreshResult.refreshed ? refreshResult.packs : entry.packs;
    const result = { key, ...entry, packs };

    return emitSuccess(json, result, () => {
      console.log(`Resolved "${query}" -> "${result.name}" (${key})`);
      console.log(`  path: ${result.path}`);
      if (result.packs && result.packs.length) console.log(`  packs: ${result.packs.join(', ')}`);
    });
  } catch (err) {
    return emitError(json, err.message, err.code ?? 2, { candidates: sortedCandidates(err.candidates) });
  }
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

/**
 * Structure + lint health for one registered wiki. Never throws — every
 * failure mode is captured in the returned report's `issues` array.
 *
 * @param {string} key
 * @param {import('./registry.js').WikiEntry} entry
 * @param {boolean} fix
 * @returns {Promise<{key: string, path: string, reachable: boolean, hasManifest: boolean, structureOk: boolean, lintOk: boolean, issues: string[]}>}
 */
async function doctorOne(key, entry, fix) {
  const wikiPath = entry.path;
  const issues = [];

  let reachable = false;
  try {
    await access(wikiPath, fsConstants.F_OK);
    reachable = true;
  } catch (_) {
    issues.push(`Wiki directory not found: ${wikiPath}`);
    return { key, path: wikiPath, reachable: false, hasManifest: false, structureOk: false, lintOk: false, issues };
  }

  const manifestPath = join(wikiPath, '_lumina', 'manifest.json');
  let manifest = null;
  let hasManifest = false;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    hasManifest = true;
  } catch (_) {
    issues.push('Missing or unreadable _lumina/manifest.json');
  }

  const packsForLayout = hasManifest
    ? Object.keys(manifest.packs || {})
    : (entry.packs && entry.packs.length ? entry.packs : ['core']);
  // A manifest without a profile field means 'full' (pre-profile installs).
  const profile = hasManifest ? (manifest.profile || 'full') : 'full';
  const layoutOpts = { profile };

  let layoutReport = await checkLayout(wikiPath, packsForLayout, layoutOpts);

  if (fix && (layoutReport.missingDirs.length || layoutReport.missingSeedFiles.length)) {
    for (const dir of layoutReport.missingDirs) {
      await ensureDir(join(wikiPath, ...dir.split('/')));
    }
    if (layoutReport.missingSeedFiles.length) {
      // Lazy import — only paid for when a fix actually needs to recreate a
      // seed file, keeping the add/list/resolve verbs' cold start unaffected.
      const { seedWikiFiles } = await import('./commands.js');
      await seedWikiFiles(wikiPath);
    }
    // Never touch engineCriticalPaths (README.md, _lumina/config,
    // _lumina/scripts) — those can only be correctly produced by re-running
    // the installer (AD-6).
    layoutReport = await checkLayout(wikiPath, packsForLayout, layoutOpts);
  }

  const structureOk = layoutReport.ok;
  for (const dir of layoutReport.missingDirs) issues.push(`Missing directory: ${dir}`);
  for (const f of layoutReport.missingSeedFiles) issues.push(`Missing seed file: ${f}`);
  for (const p of layoutReport.missingEngine) {
    issues.push(`Missing engine path: ${p} (re-run: npx lumina-wiki install --yes in this wiki)`);
  }

  let lintOk = false;
  const canLint = hasManifest && layoutReport.missingEngine.length === 0;
  if (canLint) {
    const lintScript = join(wikiPath, '_lumina', 'scripts', 'lint.mjs');
    const result = spawnSync(process.execPath, [lintScript, '--json'], {
      cwd: wikiPath,
      encoding: 'utf8',
      timeout: 30000,
    });
    lintOk = result.status === 0;
    if (!lintOk) {
      let parsed = null;
      try { parsed = JSON.parse(result.stdout); } catch (_) { /* stdout wasn't JSON */ }
      if (parsed && Array.isArray(parsed.findings)) {
        const unresolved = parsed.findings.filter((f) => !f.fix_applied);
        const ids = unresolved.slice(0, 5).map((f) => f.id);
        issues.push(
          `Lint found ${unresolved.length} unresolved issue(s): ${ids.join(', ')}${unresolved.length > ids.length ? ', …' : ''}`,
        );
      } else {
        issues.push(`Lint exited with code ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
      }
    }
  } else {
    issues.push('Lint skipped: engine or manifest unavailable for this wiki');
  }

  // Side effect, same as `resolve` — keep the registry's packs mirror fresh.
  // Failures are tolerated (AD-3/CAP-5): doctor never aborts the sweep.
  await refreshPacks(key).catch(() => {});

  return { key, path: wikiPath, reachable: true, hasManifest, structureOk, lintOk, issues };
}

function printDoctorHuman(result) {
  for (const w of result.wikis) {
    const healthy = w.reachable && w.hasManifest && w.structureOk && w.lintOk;
    console.log(`${w.key}  [${healthy ? 'ok' : 'issues'}]`);
    console.log(`  path: ${w.path}`);
    for (const issue of w.issues) console.log(`  - ${issue}`);
  }
}

async function runDoctor(args, options, json) {
  const name = args[0];
  const fix = Boolean(options.fix);

  let targets;
  if (name) {
    try {
      const resolved = await resolveWiki(name);
      targets = [resolved];
    } catch (err) {
      return emitError(json, err.message, err.code ?? 2, { candidates: sortedCandidates(err.candidates) });
    }
  } else {
    const reg = await listWikis();
    targets = Object.entries(reg.wikis).map(([key, entry]) => ({ key, entry }));
  }

  const wikiReports = [];
  for (const { key, entry } of targets) {
    // Sweep never aborts on a broken wiki (CAP-5) — doctorOne never throws.
    wikiReports.push(await doctorOne(key, entry, fix));
  }

  const result = { schemaVersion: 1, wikis: wikiReports };
  const anyIssue = wikiReports.some((w) => !w.reachable || !w.hasManifest || !w.structureOk || !w.lintOk);
  const code = anyIssue ? 1 : 0;

  if (json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printDoctorHuman(result);
  }
  return code;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * @param {'add'|'remove'|'list'|'resolve'|'doctor'|'inspect'} subcommand
 * @param {string[]} args - positional arguments for the subcommand
 * @param {Object} options - parsed flags (json, name, alias, description,
 *   fix, provision, packs, yes)
 * @returns {Promise<number>} process exit code; caller must process.exit(code)
 */
export async function wikisCommand(subcommand, args = [], options = {}) {
  const json = Boolean(options.json);

  try {
    switch (subcommand) {
      case 'add': return await runAdd(args, options, json);
      case 'remove': return await runRemove(args, options, json);
      case 'list': return await runList(args, options, json);
      case 'resolve': return await runResolve(args, options, json);
      case 'doctor': return await runDoctor(args, options, json);
      case 'inspect': return await runInspect(args, options, json);
      default:
        return emitError(json, `Unknown "wikis" subcommand: "${subcommand}"`, 1);
    }
  } catch (err) {
    // Safety net — each runX above handles its own domain errors; this only
    // catches truly unexpected failures (e.g. corrupt registry JSON, which
    // readRegistry() throws with err.code = 3).
    const code = typeof err.code === 'number' ? err.code : 3;
    return emitError(json, err.message, code);
  }
}
