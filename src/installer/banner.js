/**
 * @module installer/banner
 * @description Render the Lumina Wiki install banner (logo + tagline + intro).
 *
 * Uses raw ANSI escape codes so the yellow logo renders consistently across
 * all terminals that support colour, regardless of TTY detection quirks in
 * subshells. Respects NO_COLOR by emitting plain text.
 *
 * Narrow terminals (<80 cols) get a compact fallback so lines do not wrap.
 */

const NO_COLOR = Boolean(process.env.NO_COLOR);

const ANSI = {
  reset:  NO_COLOR ? '' : '\x1b[0m',
  yellow: NO_COLOR ? '' : '\x1b[33m',
  bright: NO_COLOR ? '' : '\x1b[93m',
  dim:    NO_COLOR ? '' : '\x1b[2m',
};

const yellow = (s) => `${ANSI.bright}${s}${ANSI.reset}`;
const dim    = (s) => `${ANSI.dim}${s}${ANSI.reset}`;

const LOGO_WIDE = [
  '██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗   ██╗    ██╗██╗██╗  ██╗██╗',
  '██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗  ██║    ██║██║██║ ██╔╝██║',
  '██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║  ██║ █╗ ██║██║█████╔╝ ██║',
  '██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║  ██║███╗██║██║██╔═██╗ ██║',
  '███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║  ╚███╔███╔╝██║██║  ██╗██║',
  '╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚══╝╚══╝ ╚═╝╚═╝  ╚═╝╚═╝',
];

const LOGO_NARROW = [
  '██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗ ',
  '██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗',
  '██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║',
  '██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║',
  '███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║',
  '╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝',
];

const SEPARATOR = '━'.repeat(72);

/**
 * Print the install-time banner to stdout.
 * Safe to call unconditionally; respects NO_COLOR.
 *
 * @returns {Promise<void>}
 */
export async function displayBanner() {
  const termWidth = process.stdout.columns || 80;
  const lines = termWidth >= 80 ? LOGO_WIDE : LOGO_NARROW;

  process.stdout.write('\n');
  for (const line of lines) {
    process.stdout.write(yellow(line) + '\n');
  }
  process.stdout.write('\n');
  process.stdout.write('             ' + yellow('Where Knowledge Starts to Glow') + '\n');
  process.stdout.write(dim('             © Lumina Wiki') + '\n');
  process.stdout.write('\n');
  process.stdout.write(dim(SEPARATOR) + '\n\n');

  process.stdout.write(
    'A self-maintaining research wiki, scaffolded into your project in one\n' +
    'command. Realises Karpathy\'s LLM-Wiki pattern: the agent compiles\n' +
    'knowledge into a persistent, structured wiki instead of re-deriving it\n' +
    'from raw chunks on every query. Cross-platform, multi-IDE, pack-based.\n\n'
  );

  process.stdout.write(yellow('🌟 100% free. 100% open source. Always.') + '\n');
  process.stdout.write('   No paywalls. No gated content. Knowledge shared, not sold.\n\n');

  process.stdout.write(yellow('🌐 CONNECT:') + '\n');
  process.stdout.write('   GitHub:   https://github.com/tronghieu/lumina-wiki\n');
  process.stdout.write('   Issues:   https://github.com/tronghieu/lumina-wiki/issues\n');
  process.stdout.write('   npm:      https://www.npmjs.com/package/lumina-wiki\n\n');

  process.stdout.write(yellow('⭐ SUPPORT THE PROJECT:') + '\n');
  process.stdout.write('   Star us:  https://github.com/tronghieu/lumina-wiki\n\n');

  process.stdout.write(dim(SEPARATOR) + '\n\n');
}
