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
 */

import { readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { addWiki, removeWiki, listWikis, resolveWiki, refreshPacks } from './registry.js';
import { checkLayout } from './layout.js';
import { ensureDir } from './fs.js';

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

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

async function runAdd(args, options, json) {
  const rawPath = args[0];
  if (!rawPath) {
    return emitError(json, 'Usage: lumina wikis add <path> [--name <name>] [--alias <alias>]... [--description <text>]', 1);
  }

  const dirPath = expandToAbsolute(rawPath);
  const aliases = normalizeAliases(options.alias);

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
    // Refresh failures are tolerated — resolve still succeeds with the
    // last-known packs.
    const refreshResult = await refreshPacks(key).catch(() => null);
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

  let layoutReport = await checkLayout(wikiPath, packsForLayout);

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
    layoutReport = await checkLayout(wikiPath, packsForLayout);
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
 * @param {'add'|'remove'|'list'|'resolve'|'doctor'} subcommand
 * @param {string[]} args - positional arguments for the subcommand
 * @param {Object} options - parsed flags (json, name, alias, description, fix)
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
