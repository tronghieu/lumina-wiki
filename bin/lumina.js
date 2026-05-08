#!/usr/bin/env node
/**
 * lumina-wiki CLI entry point.
 * Exposes `lumina` and `lumi` bin aliases.
 *
 * Commands:
 *   lumina install      — scaffold or upgrade a Lumina Wiki workspace
 *   lumina uninstall    — remove Lumina-managed files (preserve wiki/ and raw/)
 *   lumina discover run — run scheduled discovery once
 *   lumina --version    — print version + optional update check
 *   lumina --help       — print usage
 *
 * Flags (all commands):
 *   --directory <path>  — installation directory (defaults to current directory)
 *   --cwd <path>        — backward-compat alias for --directory
 *   --yes, -y           — accept all defaults (non-interactive / CI)
 *   --no-update         — skip npm registry version check
 *   --re-link           — recompute symlink/junction/copy strategy
 *   --packs <list>      — comma-separated pack list for non-interactive install
 *   --ide-targets <list> — comma-separated IDE target list for non-interactive install
 *
 * Exit codes: 0 success, 1 user error, 2 filesystem error, 3 upgrade incompatibility
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load package.json synchronously (tiny; needed for --version immediately)
const require = createRequire(import.meta.url);
let PKG;
try {
  PKG = require('../package.json');
} catch {
  PKG = { version: '0.0.0', name: 'lumina-wiki' };
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

async function handleVersionOptionIfPresent(argv) {
  if (!argv.includes('--version') && !argv.includes('-v')) return false;

  process.stdout.write(PKG.version + '\n');

  if (!argv.includes('--no-update') && process.env.LUMINA_NO_UPDATE_CHECK !== '1') {
    try {
      const { checkForUpdate } = await import('../src/installer/update-check.js');
      const latest = await checkForUpdate(PKG.version);
      if (latest) {
        let yellow = (s) => s;
        if (process.stdout.isTTY && !process.env.NO_COLOR) {
          try {
            const pc = (await import('picocolors')).default;
            yellow = pc.yellow;
          } catch (_) {}
        }
        console.log(yellow(`\n  Update available: ${PKG.version} -> ${latest}`));
        console.log(`  Run: npx lumina-wiki@latest install\n`);
      }
    } catch (_) {
      // Silent failure — never block --version
    }
  }

  return true;
}

const handledVersion = await handleVersionOptionIfPresent(process.argv);
if (handledVersion) process.exit(0);

const { Command, Option } = await import('commander');
const program = new Command();

// ---------------------------------------------------------------------------
// Exit code contract (see docs/cli-contract.md and `--help` text below).
// Caught errors map as follows:
//   - RangeError (from safePath)        → 2 (path safety)
//   - err.code in {EACCES, EPERM}        → 2 (filesystem perms)
//   - err.code === 2 / err.code === 3    → preserved
//   - other string fs codes (E*)         → 3 (internal/io: ENOENT, EBUSY, EIO,
//                                            EROFS, ENOSPC, ENOTDIR, …)
//   - everything else                    → 1 (user error)
// ---------------------------------------------------------------------------
function exitCodeFor(err, defaultCode = 1) {
  if (err instanceof RangeError) return 2;
  if (err.code === 'EACCES' || err.code === 'EPERM') return 2;
  if (err.code === 2) return 2;
  if (err.code === 3) return 3;
  if (typeof err.code === 'string' && err.code.startsWith('E')) return 3;
  return defaultCode;
}

// ---------------------------------------------------------------------------
// Deprecation warnings — emitted to stderr once per invocation.
// Source of truth: docs/cli-contract.md.
// ---------------------------------------------------------------------------
let _cwdWarned = false;
function warnDeprecatedCwdIfUsed(cmdOpts, globalOpts) {
  if (_cwdWarned) return;
  if (cmdOpts.cwd != null || globalOpts.cwd != null) {
    process.stderr.write(
      '[deprecated] --cwd is deprecated and will be removed in v2.0. Use --directory instead.\n'
    );
    _cwdWarned = true;
  }
}

program
  .name('lumina')
  .description('Lumina Wiki — domain-agnostic, multi-IDE wiki scaffolder')
  .helpOption('-h, --help', 'display help')
  .addHelpText('after', `
Exit codes:
  0  success
  1  user error (bad flag, missing prereq)
  2  filesystem / safety (permission denied, path outside cwd, unknown pack slug)
  3  internal / network (atomicWrite failure, 5xx, upgrade incompatibility, lint catastrophic)

Flags applicable to all commands:
  --directory <path>  installation directory (defaults to current directory)
  --yes, -y           accept all defaults; non-interactive (CI use)
  --no-update         skip npm registry version check
  --re-link           recompute symlink/junction/copy strategy from platform
  --packs <list>      install packs: core,research,reading
  --ide-targets <list>  target CLIs: claude_code,codex,gemini_cli,qwen,iflow,cursor,generic
                          codex covers all AGENTS.md-compatible CLIs
                          (OpenAI CodexApp (ChatGPT), Amp, Crush, Goose, Auggie, OpenCode, etc.)

Examples:
  npx lumina-wiki install
  lumina install --yes
  lumina install --yes --packs core,research,reading --ide-targets claude_code,codex
  lumina install --directory /path/to/project
  lumina discover run --dry-run
  lumina uninstall
  lumina --version
`);

// ---------------------------------------------------------------------------
// Global options
// ---------------------------------------------------------------------------
program
  .option('--directory <path>', 'installation directory', process.cwd())
  .addOption(new Option('--cwd <path>', 'alias for --directory').hideHelp())
  .option('-y, --yes', 'accept all defaults (non-interactive)')
  .option('--no-update', 'skip npm registry version check')
  .option('--re-link', 'recompute symlink strategy from current platform capabilities');

// ---------------------------------------------------------------------------
// --version / -v — print immediately then do async update check
// ---------------------------------------------------------------------------
program
  .option('-v, --version', 'print version and check for updates');


// ---------------------------------------------------------------------------
// install subcommand
// ---------------------------------------------------------------------------
program
  .command('install')
  .description('scaffold or upgrade a Lumina Wiki workspace')
  .option('--directory <path>', 'installation directory')
  .addOption(new Option('--cwd <path>', 'alias for --directory').hideHelp())
  .option('-y, --yes', 'accept all defaults')
  .option('--no-update', 'skip update check')
  .option('--re-link', 'recompute symlink strategy')
  .option('--packs <list>', 'comma-separated packs to install: core,research,reading')
  .option('--ide-targets <list>', 'comma-separated IDE targets')
  .addOption(new Option('--project-name <name>', 'override auto-derived project name').hideHelp())
  .option('--communication-language <language>', 'language agents use when talking to the user')
  .option('--document-output-language <language>', 'language used for wiki documents')
  .option('--lang <code>', 'installer UI locale: en, vi, zh')
  .option('--force-locale-switch', 'allow switching installer locale during upgrade')
  .action(async (cmdOpts) => {
    const globalOpts = program.opts();
    warnDeprecatedCwdIfUsed(cmdOpts, globalOpts);
    const mergedDir      = cmdOpts.directory ?? cmdOpts.cwd ?? globalOpts.directory ?? globalOpts.cwd ?? process.cwd();
    const mergedYes      = cmdOpts.yes      ?? globalOpts.yes      ?? false;
    const mergedReLink   = cmdOpts.reLink   ?? globalOpts.reLink   ?? false;
    const mergedNoUpdate = cmdOpts.noUpdate ?? globalOpts.noUpdate ?? false;

    try {
      const { displayBanner } = await import('../src/installer/banner.js');
      await displayBanner();
      const { installCommand } = await import('../src/installer/commands.js');
      await installCommand({
        directory: resolve(mergedDir),
        yes:      Boolean(mergedYes),
        reLink:   Boolean(mergedReLink),
        noUpdate: Boolean(mergedNoUpdate),
        packs: cmdOpts.packs,
        ideTargets: cmdOpts.ideTargets,
        projectName: cmdOpts.projectName,
        communicationLang: cmdOpts.communicationLanguage,
        documentOutputLang: cmdOpts.documentOutputLanguage,
        lang: cmdOpts.lang,
        forceLocaleSwitch: Boolean(cmdOpts.forceLocaleSwitch),
      });
    } catch (err) {
      // Top-level catch: locale may not be resolved yet (pre-loadLocale path).
      // Error strings kept as EN literals — machine-readable, intentionally exempt.
      console.error(`[error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(exitCodeFor(err));
    }
  });

// ---------------------------------------------------------------------------
// uninstall subcommand
// ---------------------------------------------------------------------------
program
  .command('uninstall')
  .description('remove Lumina-managed files (wiki/ and raw/ are preserved)')
  .option('--directory <path>', 'installation directory')
  .addOption(new Option('--cwd <path>', 'alias for --directory').hideHelp())
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (cmdOpts) => {
    const globalOpts = program.opts();
    warnDeprecatedCwdIfUsed(cmdOpts, globalOpts);
    const mergedDir = cmdOpts.directory ?? cmdOpts.cwd ?? globalOpts.directory ?? globalOpts.cwd ?? process.cwd();
    const mergedYes = cmdOpts.yes ?? globalOpts.yes ?? false;

    try {
      const { uninstallCommand } = await import('../src/installer/commands.js');
      await uninstallCommand({
        cwd: resolve(mergedDir),
        yes: Boolean(mergedYes),
      });
    } catch (err) {
      console.error(`[error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(exitCodeFor(err));
    }
  });

// ---------------------------------------------------------------------------
// discover subcommand
// ---------------------------------------------------------------------------
const discover = program
  .command('discover')
  .description('scheduled discovery commands');

discover
  .command('run')
  .description('run scheduled discovery once')
  .option('--config <path>', 'watchlist config path')
  .option('--schedule <value>', 'filter by schedule: manual,daily,weekly,monthly')
  .option('--source <value>', 'filter by source: arxiv,s2')
  .option('--limit <number>', 'override per-source fetch limit')
  .option('--dry-run', 'show what would be written without changing files')
  .option('--json', 'print machine-readable summary')
  .action(async (cmdOpts) => {
    try {
      const { main } = await import('../src/scripts/discover-runner.mjs');
      const args = [];
      if (cmdOpts.config) args.push('--config', cmdOpts.config);
      if (cmdOpts.schedule) args.push('--schedule', cmdOpts.schedule);
      if (cmdOpts.source) args.push('--source', cmdOpts.source);
      if (cmdOpts.limit) args.push('--limit', String(cmdOpts.limit));
      if (cmdOpts.dryRun) args.push('--dry-run');
      if (cmdOpts.json) args.push('--json');
      const code = await main(args);
      process.exit(code);
    } catch (err) {
      console.error(`[error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      // Unhandled exceptions from discover-runner are by definition not user
      // errors (main() handles those), so default unknown → 3 (internal).
      process.exit(exitCodeFor(err, 3));
    }
  });

// ---------------------------------------------------------------------------
// Parse argv
// ---------------------------------------------------------------------------
program.parseAsync(process.argv).catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});
