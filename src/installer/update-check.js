/**
 * @module installer/update-check
 * @description Auto-update check for lumina-wiki.
 *
 * Runs `npm view lumina-wiki@latest version` with a 2-second hard timeout via
 * AbortController. On timeout or any error, silently returns null (never blocks
 * --version output).
 *
 * Suppressible via:
 *   - LUMINA_NO_UPDATE_CHECK=1 environment variable
 *   - --no-update flag (caller must check and skip calling this function)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/** Timeout in milliseconds for the npm registry check (NFR-Pe3, NFR-Pr2). */
const UPDATE_CHECK_TIMEOUT_MS = 2000;

/**
 * Check if a newer version of lumina-wiki is available on the npm registry.
 * Returns the latest version string if newer than currentVersion, null otherwise.
 * Never throws — all errors are silently swallowed to avoid blocking --version.
 *
 * @param {string} currentVersion - The installed package version (e.g. "0.1.0").
 * @returns {Promise<string|null>} Latest version string if newer, null if same/older/error.
 */
export async function checkForUpdate(currentVersion) {
  // Respect the opt-out environment variable
  if (process.env.LUMINA_NO_UPDATE_CHECK === '1') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const { stdout } = await execAsync('npm view lumina-wiki@latest version', {
      signal: controller.signal,
      timeout: UPDATE_CHECK_TIMEOUT_MS + 500, // belt-and-suspenders
    });
    clearTimeout(timer);

    const latestVersion = stdout.trim();
    if (!latestVersion) return null;

    if (isNewerVersion(latestVersion, currentVersion)) {
      return latestVersion;
    }
    return null;
  } catch (_err) {
    // AbortError, network error, npm not in PATH, etc. — silent failure
    clearTimeout(timer);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Split a version string into its numeric core and pre-release identifiers.
 * Tolerates a leading "v", partial versions ("2", "1.1"), and build metadata.
 *
 * @param {string} version - e.g. "1.12.0", "v1.12.0-next.0", "1.12.0+build.5".
 * @returns {{core: number[], pre: string[]}}
 */
function parseVersion(version) {
  const cleaned = String(version)
    .trim()
    .replace(/^v/, '')
    .split('+')[0]; // build metadata is never part of precedence

  const dash = cleaned.indexOf('-');
  const coreText = dash === -1 ? cleaned : cleaned.slice(0, dash);
  const preText = dash === -1 ? '' : cleaned.slice(dash + 1);

  const parts = coreText.split('.').map(Number);
  return {
    core: [parts[0] || 0, parts[1] || 0, parts[2] || 0],
    pre: preText ? preText.split('.') : [],
  };
}

/**
 * Compare pre-release identifier lists by semver precedence rules:
 * a stable release outranks any pre-release of the same core version,
 * numeric identifiers compare numerically and rank below alphanumeric ones,
 * and a longer identifier list wins when every shared field is equal.
 *
 * @param {string[]} a - Candidate identifiers ([] when stable).
 * @param {string[]} b - Baseline identifiers ([] when stable).
 * @returns {number} 1 if `a` is higher, -1 if lower, 0 if equal.
 */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;

    const aPart = a[i];
    const bPart = b[i];
    if (aPart === bPart) continue;

    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) > Number(bPart) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

/**
 * Compare two semver version strings.
 * Returns true if `candidate` is strictly newer than `baseline`.
 * Handles MAJOR.MINOR.PATCH plus pre-release suffixes, so someone running
 * a pre-release build (1.12.0-next.0) is still told about the stable
 * release it leads to (1.12.0).
 *
 * @param {string} candidate - Version to test.
 * @param {string} baseline  - Current version.
 * @returns {boolean}
 */
export function isNewerVersion(candidate, baseline) {
  const c = parseVersion(candidate);
  const b = parseVersion(baseline);

  for (let i = 0; i < 3; i += 1) {
    if (c.core[i] !== b.core[i]) return c.core[i] > b.core[i];
  }
  return comparePrerelease(c.pre, b.pre) > 0;
}
