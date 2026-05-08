# CLI Contract

This document is the source of truth for Lumina Wiki's command-line interface in v1.x. Anything listed as **STABLE** below is part of the public contract: it will not be renamed, removed, or have its semantic meaning changed without a major version bump and an entry in `CHANGELOG.md`.

Anything not listed here (hidden flags, undocumented behavior, output formatting) is **internal** and may change at any time without notice.

---

## Stability levels

| Level | Meaning | Change policy |
|---|---|---|
| **STABLE** | Documented public surface | No removal/rename without major version bump (v2.0+) and changelog entry |
| **DEPRECATED** | Still works; emits a warning | Removed at the next major version |
| **INTERNAL** | Hidden from `--help`; no contract | May change or disappear in any release |
| **EXPERIMENTAL** | Documented but explicitly marked subject to change | May break in minor versions |

Currently no flags are EXPERIMENTAL. The four stability levels exist so future additions can be introduced with a clear contract.

---

## Commands

### `lumina install`

Scaffold or upgrade a Lumina Wiki workspace.

| Flag | Stability | Purpose |
|---|---|---|
| `--directory <path>` | STABLE | Installation directory (defaults to `cwd`) |
| `--cwd <path>` | DEPRECATED | Alias for `--directory`. Will be removed in v2.0 (deprecation warning pending PR-3) |
| `-y`, `--yes` | STABLE | Non-interactive mode (CI use) |
| `--no-update` | STABLE | Skip npm registry version check |
| `--re-link` | STABLE | Recompute symlink/junction/copy strategy |
| `--packs <list>` | STABLE | Comma-separated packs: `core,research,reading`. `core` is always included regardless of this list |
| `--ide-targets <list>` | STABLE | Comma-separated IDE targets (see `--help` for full list) |
| `--communication-language <lang>` | STABLE | Language agents use when talking to the user |
| `--document-output-language <lang>` | STABLE | Language used for generated wiki documents |
| `--lang <code>` | STABLE | Installer UI locale: `en`, `vi`, `zh` |
| `--force-locale-switch` | STABLE | Allow switching installer locale during upgrade |
| `--project-name <name>` | INTERNAL | Override auto-derived project name (hidden) |

### `lumina uninstall`

Remove Lumina-managed files. `wiki/` and `raw/` are preserved.

| Flag | Stability | Purpose |
|---|---|---|
| `--directory <path>` | STABLE | Installation directory |
| `--cwd <path>` | DEPRECATED | Alias for `--directory` (deprecation warning pending PR-3) |
| `-y`, `--yes` | STABLE | Skip confirmation prompt |

### `lumina discover run`

Run scheduled discovery once.

| Flag | Stability | Purpose |
|---|---|---|
| `--config <path>` | STABLE | Watchlist config path |
| `--schedule <value>` | STABLE | Filter: `manual`, `daily`, `weekly`, `monthly` |
| `--source <value>` | STABLE | Filter by source: `arxiv`, `s2` |
| `--limit <number>` | STABLE | Override per-source fetch limit |
| `--dry-run` | STABLE | Preview without writing files |
| `--json` | STABLE | Machine-readable summary |

### Top-level

| Flag | Stability | Purpose |
|---|---|---|
| `-v`, `--version` | STABLE | Print version, then async update check |
| `-h`, `--help` | STABLE | Print usage |

---

## Exit codes

Every Lumina command exits with one of these codes. CI scripts may rely on this mapping.

| Code | Meaning | Triggers |
|---|---|---|
| **0** | Success | Operation completed |
| **1** | User error | Bad flag, unknown subcommand, missing required arg |
| **2** | Filesystem / safety | `EACCES`, `EPERM`, path traversal, unknown pack slug, missing required `--yes` in CI |
| **3** | Internal / network | atomicWrite mid-rename failure (`ENOENT`, `EBUSY`, `EIO`, `EROFS`, `ENOSPC`, …), 5xx network response, upgrade incompatibility (manifest references unknown pack), lint catastrophic failure |

### Documented exception

The lint script (`_lumina/scripts/lint.mjs`, run from inside an installed workspace — there is no `lumina lint` subcommand) follows ESLint/Ruff convention: **exit 1** means "unresolved findings exist" rather than "user error". This is intentional and will not change.

### Cancellation (Ctrl-C)

In v1.x, cancelling an interactive prompt exits **0**. This is documented as known-incorrect; a new code **4 = user cancelled** will be introduced in a follow-up release. CI scripts that need to distinguish "completed" from "cancelled" should not rely on exit 0 alone — check stdout for completion markers until code 4 is available.

---

## Environment variables

| Var | Stability | Purpose |
|---|---|---|
| `LUMINA_NO_UPDATE_CHECK=1` | STABLE | Suppress npm registry version check (equivalent to `--no-update`) |
| `DEBUG=<any>` | STABLE | Print stack traces on caught errors (any non-empty value enables) |
| `NO_COLOR=1` | STABLE | Disable ANSI color output (community standard) |
| `LUMINA_NO_CACHE=1` | STABLE | Bypass HTTP fetch cache (research-pack tools) |
| `LUMINA_CACHE_TTL=<seconds>` | STABLE | Override default 24h cache TTL |

---

## Backward compatibility policy

- **STABLE flags** survive every minor release in v1.x.
- **DEPRECATED flags** continue to function and emit a warning to stderr; they are removed in the next major release.
- **INTERNAL flags** carry no guarantees — do not rely on them in scripts.
- **Exit codes** in this document survive minor releases. Adding new codes (e.g. introducing `4` for cancellation) is non-breaking; changing the meaning of an existing code is breaking.
- The `--help` output formatting is **not** part of the contract. Tooling that parses help text is fragile by design — query flags directly via the documented names instead.

For the reasoning behind classifications, see discussion in [issue #4](https://github.com/tronghieu/lumina-wiki/issues/4).
