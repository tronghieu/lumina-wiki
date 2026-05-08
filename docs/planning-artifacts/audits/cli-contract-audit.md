---
date: '2026-05-06'
type: 'audit'
status: 'draft'
related-roadmap: 'Stability Lock (Near-term)'
---

# CLI Contract Audit

Source review for **Stability Lock** roadmap item: enumerate current CLI surface, identify inconsistencies, propose stability classification.

## Scope

Files reviewed:
- `bin/lumina.js` (entry point, commander setup)
- `src/installer/commands.js`, `src/installer/prompts.js` (install/uninstall paths)
- `src/scripts/wiki.mjs`, `src/scripts/lint.mjs`, `src/scripts/reset.mjs`, `src/scripts/discover-runner.mjs`

## CLI surface (current)

### Subcommands

`install`, `uninstall`, `discover run`, top-level `--version`/`-v`/`--help`/`-h`.

### Flags — proposed classification

#### Global (all commands)

| Flag | State | Proposal |
|---|---|---|
| `--directory <path>` | public, documented | **STABLE** |
| `--cwd <path>` | hidden alias (backward-compat) | **DEPRECATE** — emit warning, remove at v2.0 |
| `-y, --yes` | public | **STABLE** |
| `--no-update` | public | **STABLE** |
| `--re-link` | public | **STABLE** |

#### `install`-only

| Flag | State | Proposal |
|---|---|---|
| `--packs <list>` | public | **STABLE** |
| `--ide-targets <list>` | public | **STABLE** |
| `--project-name <name>` | hidden | **INTERNAL** (keep hidden, no contract) |
| `--communication-language <lang>` | public | **STABLE** |
| `--document-output-language <lang>` | public | **STABLE** |

#### `discover run`-only

`--config`, `--schedule` (manual\|daily\|weekly\|monthly), `--source` (arxiv\|s2), `--limit`, `--dry-run`, `--json` — all proposed **STABLE**.

#### Environment variables

`LUMINA_NO_UPDATE_CHECK=1`, `DEBUG`, `NO_COLOR` — all proposed **STABLE**.

## Exit code contract — proposed

| Code | Meaning | Trigger examples |
|---|---|---|
| 0 | success | Operation completed |
| 1 | user error | Bad flag, missing required arg, unknown command |
| 2 | filesystem / safety | EACCES, EPERM, path traversal, unknown slug, missing required `--yes` in CI |
| 3 | internal / network | atomicWrite mid-rename failure, network 5xx, upgrade incompatibility, lint catastrophic |
| 130 _(or 4 — TBD)_ | user cancelled | Ctrl-C in interactive prompt |

**Lint exception:** `lint.mjs` exits `1` to mean "unresolved findings" (eslint-style). This conflicts with global "1 = user error". Either:
- (a) document as legitimate exception (`lint` is check-tool semantics), OR
- (b) move lint findings to a new code (e.g. `5`).

## Inconsistencies found

### A. `--help` exit-code text narrower than reality

`bin/lumina.js:78-83` reads:

```
3  upgrade incompatibility (manifest references unknown pack)
```

Reality: code 3 is also used by `discover run` for any non-2 error, by `lint.mjs` for internal errors, etc. CLAUDE.md already defines code 3 broadly ("internal / fs failure / 5xx network").

**Fix (non-breaking):** broaden `--help` text to match.

### B. `lint.mjs` exit 1 conflicts with global contract

`src/scripts/lint.mjs:1316`:

```js
process.exit(hasUnresolved ? 1 : 0);
```

Code 1 in global contract = "user error". Here it means "lint found issues". Needs decision (see "Lint exception" above).

### C. `install` error mapping loses signal

`bin/lumina.js:170`:

```js
process.exit(isPermError || isRangeError || err.code === 2 ? 2 : 1);
```

`atomicWrite` failures mid-rename (ENOENT/EBUSY/EIO) fall to `1` (user error) — should be `3` (internal).

**Fix (non-breaking):** add fs-error code branch → `3`.

### D. `uninstall` always exits 2

`bin/lumina.js:197`: any error during uninstall returns `2` regardless of cause. Same fix as C.

### E. Ctrl-C exits 0 (silent success)

`src/installer/prompts.js` × 7 sites:

```js
if (isCancel(...)) { cancel('Installation cancelled.'); process.exit(0); }
```

CI scripts cannot distinguish user-cancelled installs from successful installs. **This is a breaking change** to fix — needs owner decision on target code (130 SIGINT convention vs. new `4`).

### F. Global opts redeclared per subcommand

`bin/lumina.js:127-133`, `:181-184`: `install` and `uninstall` redeclare `--directory`/`--yes`/etc. instead of inheriting via `program.opts()`. Functional via merge fallback; internal hygiene only — out of scope for Stability Lock.

### G. No tests pin the contract

`bin/lumina.js` has no `.test.js` companion. Contract is unenforced — flag rename today = silent CI pass.

**Fix:** add `bin/lumina.flags.test.js` covering:
- Help output enumerates all STABLE flags by exact name
- Exit code matrix (path traversal → 2, bad flag → 1, etc.)
- `--cwd` emits deprecation warning (after deprecation lands)

## Summary

- **STABLE** flags: 14 (most already correct in usage)
- **DEPRECATE**: 1 (`--cwd`)
- **INTERNAL/hidden**: 1 (`--project-name`)
- **Non-breaking fixes**: A, C, D, G
- **Owner decision required**: B (lint exception) and E (cancellation exit — breaking)

## Unresolved questions for owner

1. **`--cwd` deprecation path:** emit warning in v1.x and remove at v2.0, or keep silent forever?
2. **Cancellation exit code:** accept breaking change to 130 (SIGINT), introduce new code 4, or keep 0?
3. **`lint` exit 1:** document as legitimate check-tool exception, or move findings to a new code (e.g. 5)?
4. **`--project-name`:** promote to public flag or keep INTERNAL?
