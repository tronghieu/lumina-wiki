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

Currently no *flags* are EXPERIMENTAL — every documented flag below is STABLE, DEPRECATED, or INTERNAL. `lumina wikis`'s committed JSON response fields (see that section) are the first use of the EXPERIMENTAL level; the four stability levels exist so future additions can be introduced with a clear contract.

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
| `--agents <targets>` | STABLE | Install skills globally for AI agent platforms: `openclaw`, `hermes` (comma-separated). Its own flag/prompt group, deliberately separate from `--ide-targets` — writes no workspace payload, only the platform's global skills directory |
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

### `lumina wikis <subcommand>`

Manage the global wiki registry (`~/.lumina/wikis.json`) and per-wiki health checks. Full behavioral contract, including exact JSON shapes and the registration flow: `docs/specs/spec-librarian-mode/registry-and-cli.md`. Lazy-loaded, same as `discover run`.

**Command names and their flags are STABLE** — same policy as `install`/`uninstall`, and for the same reason: a subcommand or flag name is cheap to hold stable and expensive to relearn if renamed. **JSON response payloads are EXPERIMENTAL**, except for a committed subset called out per subcommand below — see "JSON payload stability" at the end of this section for why.

#### `wikis add <path>`

| Flag | Stability | Purpose |
|---|---|---|
| `--name <name>` | STABLE | Display name (defaults to the directory name) |
| `--alias <alias>` | STABLE | Alternative name to match on `resolve` (repeatable) |
| `--description <text>` | STABLE | Short description; becomes the wiki's own purpose text when provisioning |
| `--provision` | STABLE | Create a new wiki at `<path>` first, then register it (requires `--yes`) |
| `--packs <list>` | STABLE | Comma-separated packs to install when provisioning (default: `core`) |
| `-y`, `--yes` | STABLE | Confirm that provisioning may write files |
| `--json` | STABLE | Machine-readable output |

Committed JSON fields (`add`, with or without `--provision`): `key`, `provisioned`, `alreadyRegistered` (present, `true`, only on an idempotent-retry success — see registry-and-cli.md), `entry.name`, `entry.path`, `entry.aliases`, `entry.packs`. Everything else in the payload (`entry.description`, `entry.addedAt`, `versionSkew`, `created`) is informational.

#### `wikis inspect <path>`

| Flag | Stability | Purpose |
|---|---|---|
| `--packs <list>` | STABLE | Packs to evaluate an existing wiki's structure against (default: `core`) |
| `--json` | STABLE | Machine-readable output |

Committed JSON fields: `schemaVersion`, `state` (enum: `missing`, `empty`, `unmanaged`, `wiki-partial`, `wiki-ok`), `registered`, `registeredAs`, `asks`. Everything else (`exists`, `entryCount`, `sampleEntries`, `missing`, `willCreate`, `hint`) is informational — useful to read and act on in the moment, not a promise about future shape.

#### `wikis remove <name>`

| Flag | Stability | Purpose |
|---|---|---|
| `--json` | STABLE | Machine-readable output |

#### `wikis list`

| Flag | Stability | Purpose |
|---|---|---|
| `--json` | STABLE | Machine-readable output |

#### `wikis resolve <query>`

| Flag | Stability | Purpose |
|---|---|---|
| `--json` | STABLE | Machine-readable output |

#### `wikis doctor [name]`

| Flag | Stability | Purpose |
|---|---|---|
| `--fix` | STABLE | Repair missing folders and seed files (never overwrites existing files) |
| `--json` | STABLE | Machine-readable output |

Committed JSON fields: `schemaVersion`, `wikis[].key`, `wikis[].reachable`, `wikis[].hasManifest`, `wikis[].structureOk`, `wikis[].lintOk`. `wikis[].issues` (the array's exact string contents) is informational — surface it to the user, don't parse it.

#### Exit codes

`wikis` subcommands follow the global exit-code contract above — no new codes, no new meanings. One `wikis`-specific behavior worth calling out: `add --provision` without `--yes` deliberately exits **2**, not 1 — the missing confirmation is treated as a safety gate (the agent must have actually asked the user first), not a bad argument.

#### JSON payload stability — why EXPERIMENTAL, and what's committed

A flag is a small, slow-moving surface: a name, spelled one way, either passed or not. A JSON response is a much larger one — every key is a potential compatibility promise, and nested shape, field types, and array ordering can all shift independently. Committing to the full payload of `inspect` or `add --provision` would turn every future improvement to that payload into a breaking-change negotiation, over fields nobody has been shown to depend on.

Instead, each subcommand above lists a **committed subset** — chosen by one concrete test: *would an agent word a response to the user wrongly if it didn't know this field existed?* `alreadyRegistered` is the motivating example: an agent unaware of it would describe a harmless retry as a failure. Fields in the committed subset get the same guarantee as a STABLE flag. Everything else in a payload is explicitly **informational** — useful to read and act on in the moment, but subject to being added, removed, or reshaped in a minor release. Do not branch on an informational field's absence, its exact array ordering, or its nested shape.

The committed subset itself is currently marked **EXPERIMENTAL**, not STABLE, because this whole surface has not yet survived a single release — `wikis` and its JSON shapes are new in this unreleased version, and the exact field set was still moving as this contract was written. **Promotion trigger:** the committed subset promotes to STABLE at the first minor release in which it ships unchanged from the release before it — an observable, checkable condition (diff `CHANGELOG.md`/git tags), not a judgment call about whether it "feels" stable enough yet.

#### Internal dependency: `lumi-hub`

Lumina's own `lumi-hub` skill (ships with `--agents openclaw|hermes` installs; `src/skills/agents/hub/SKILL.md`) branches on the committed-subset fields above — `state`, `asks`, `registered`, `provisioned`, `alreadyRegistered`. A breaking change to any of them does not merely inconvenience an external integrator: it breaks a component of this project that ships and versions **separately** from the CLI — a user's chat-platform skill install can be older or newer than the `lumina` binary it talks to. Treat this coupling as real even though it is invisible from either file read in isolation.

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

Cancelling an interactive prompt (Ctrl-C or declining a confirm prompt) exits **4**. CI scripts may rely on this to distinguish user cancellation from successful completion (exit 0) or errors (exit 2/3).

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
