#!/usr/bin/env node
/**
 * lumina-wiki CLI entry point.
 * Exposes `lumina` and `lumi` bin aliases.
 *
 * Commands:
 *   lumina install      — scaffold or upgrade a Lumina Wiki workspace
 *   lumina uninstall    — remove Lumina-managed files (preserve wiki/ and raw/)
 *   lumina --version    — print version + optional update check
 *   lumina --help       — print usage
 *
 * Flags (all commands):
 *   --cwd <path>        — operate against a different project root
 *   --yes, -y           — accept all defaults (non-interactive / CI)
 *   --no-update         — skip npm registry version check
 *   --re-link           — recompute symlink/junction/copy strategy
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

const { Command } = await import('commander');
const program = new Command();

program
  .name('lumina')
  .description('Lumina Wiki — domain-agnostic, multi-IDE wiki scaffolder')
  .helpOption('-h, --help', 'display help')
  .addHelpText('after', `
Exit codes:
  0  success
  1  user error (bad flag, missing prereq)
  2  filesystem error (permission denied, path outside cwd)
  3  upgrade incompatibility (manifest references unknown pack)

Flags applicable to all commands:
  --cwd <path>     project root (defaults to current directory)
  --yes, -y        accept all defaults; non-interactive (CI use)
  --no-update      skip npm registry version check
  --re-link        recompute symlink/junction/copy strategy from platform

Examples:
  npx lumina-wiki install
  lumina install --yes
  lumina install --cwd /path/to/project
  lumina uninstall
  lumina --version
`);

// ---------------------------------------------------------------------------
// Global options
// ---------------------------------------------------------------------------
program
  .option('--cwd <path>', 'project root directory', process.cwd())
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
  .option('--cwd <path>', 'project root directory')
  .option('-y, --yes', 'accept all defaults')
  .option('--no-update', 'skip update check')
  .option('--re-link', 'recompute symlink strategy')
  .action(async (cmdOpts) => {
    const globalOpts = program.opts();
    const mergedCwd      = cmdOpts.cwd      ?? globalOpts.cwd      ?? process.cwd();
    const mergedYes      = cmdOpts.yes      ?? globalOpts.yes      ?? false;
    const mergedReLink   = cmdOpts.reLink   ?? globalOpts.reLink   ?? false;
    const mergedNoUpdate = cmdOpts.noUpdate ?? globalOpts.noUpdate ?? false;

    try {
      const { installCommand } = await import('../src/installer/commands.js');
      await installCommand({
        cwd:      resolve(mergedCwd),
        yes:      Boolean(mergedYes),
        reLink:   Boolean(mergedReLink),
        noUpdate: Boolean(mergedNoUpdate),
      });
    } catch (err) {
      const isPermError  = err.code === 'EACCES' || err.code === 'EPERM';
      const isRangeError = err instanceof RangeError;
      console.error(`[error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(isPermError || isRangeError ? 2 : 1);
    }
  });

// ---------------------------------------------------------------------------
// uninstall subcommand
// ---------------------------------------------------------------------------
program
  .command('uninstall')
  .description('remove Lumina-managed files (wiki/ and raw/ are preserved)')
  .option('--cwd <path>', 'project root directory')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (cmdOpts) => {
    const globalOpts = program.opts();
    const mergedCwd = cmdOpts.cwd ?? globalOpts.cwd ?? process.cwd();
    const mergedYes = cmdOpts.yes ?? globalOpts.yes ?? false;

    try {
      const { uninstallCommand } = await import('../src/installer/commands.js');
      await uninstallCommand({
        cwd: resolve(mergedCwd),
        yes: Boolean(mergedYes),
      });
    } catch (err) {
      console.error(`[error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(2);
    }
  });

// ---------------------------------------------------------------------------
// Parse argv
// ---------------------------------------------------------------------------
program.parseAsync(process.argv).catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});
