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
 * Compare two semver version strings.
 * Returns true if `candidate` is strictly newer than `baseline`.
 * Handles simple MAJOR.MINOR.PATCH format without pre-release suffixes.
 *
 * @param {string} candidate - Version to test.
 * @param {string} baseline  - Current version.
 * @returns {boolean}
 */
export function isNewerVersion(candidate, baseline) {
  const parseParts = (v) => {
    const parts = String(v).replace(/^v/, '').split('.').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  const [cMajor, cMinor, cPatch] = parseParts(candidate);
  const [bMajor, bMinor, bPatch] = parseParts(baseline);

  if (cMajor !== bMajor) return cMajor > bMajor;
  if (cMinor !== bMinor) return cMinor > bMinor;
  return cPatch > bPatch;
}
