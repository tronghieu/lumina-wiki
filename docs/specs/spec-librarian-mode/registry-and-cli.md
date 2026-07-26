# Wiki Registry & `lumina wikis` CLI

Companion to SPEC-librarian-mode (CAP-1..CAP-5). Normative contract for the registry file and subcommand behavior.

## Registry file

Location: `~/.lumina/wikis.json`. Overridable via an environment variable (e.g. `LUMINA_HOME`) so tests never touch the real home directory. Created on first `wikis add`. All writes atomic (temp + fsync + rename), matching installer discipline.

```json
{
  "version": 1,
  "wikis": {
    "ai-engineering": {
      "name": "AI Engineering",
      "aliases": ["ai engineering", "kỹ thuật AI", "ai-eng"],
      "path": "/Users/hieu/wikis/ai-engineering",
      "description": "LLM engineering, agents, ML papers",
      "packs": ["core", "research"]
    }
  }
}
```

- Key: kebab-case slug of `name` — the stable identifier.
- Key computation and resolve-time comparison use one shared `normalizeKey()` (NFC → casefold → diacritic-strip → kebab) — never compare a normalized query against a raw stored value.
- `name`: user-given display name, any language.
- `aliases`: alternative spoken references ("wiki AI Engineering" today, "kỹ thuật AI" tomorrow). Matching is case-insensitive and diacritic-insensitive.
- `path`: absolute. Validated by existence + `_lumina/manifest.json` presence, not `safePath` (which is for in-workspace relative fragments).
- `packs`: mirror of the wiki's own manifest; never authoritative on its own; refreshed as a side effect of every successful `resolve` (and by `doctor`).
- The field name `topics` is forbidden anywhere in this schema.

## Path identity

Every place this contract says "the same directory" or "already registered" means filesystem identity, not a literal string match. Three ways the same directory compares unequal as plain strings: case (macOS/Windows are case-insensitive: `/Users/x/Wiki` and `/Users/x/wiki` are the same directory), a symlinked parent (`/tmp/w` vs `/private/tmp/w` on macOS), and hardlinked/bind-mounted paths. `sameDirectory(a, b)` (`src/installer/registry.js`) resolves this:

1. **Fast path** — `resolve()` + NFC-normalize both sides, string-compare (`pathsEqual`). No `stat` call when the strings already match, so a fleet with many registered wikis doesn't pay a `stat` per existing entry on the common case.
2. **Slow path**, only when the strings differ — `stat()` both sides and compare `{dev, ino}` (`sameFileIdentity`). Definitive on every platform.
3. **Windows zero-inode case is inconclusive, not a match.** `stat().ino` (and sometimes `.dev`) can come back `0` on some Windows filesystems/configurations. Treating a falsy value as a real identifier would make two genuinely *different* directories that both happen to report `ino: 0` compare as identical — the opposite failure from the one this check exists to prevent, and a worse one: it would tell a user registering their second real wiki that it's already registered as the first, with no way to proceed. A falsy `dev`/`ino` on either side is therefore inconclusive; the check falls back to the (already-negative) string comparison rather than asserting a match.
4. A `stat()` failure on either path (`ENOENT`, permissions, …) also falls back to the string comparison — never a bare `false` invented from an error the check can't interpret.

This one function backs three separate behaviors, listed below: `add`'s duplicate-path rejection, `add --provision`'s idempotent-retry check, and `inspect`'s `registered`/`registeredAs` fields (a registered wiki reached through a different case or a symlinked parent must still report `registered: true`, or `inspect` would wrongly point the agent at `add --provision`, which the duplicate-path guard would then correctly refuse — a confusing round trip for no reason).

## Subcommands

All support `--json`; exit codes follow the project contract (0 success, 1 user error, 2 fs/path/unknown, 3 internal, 4 cancelled). Lazy-loaded to protect the cold-start budget.

| Command | Behavior |
|---|---|
| `inspect <path> [--packs <list>]` | Read-only, zero-side-effect classification of any path (does not need to be a wiki, or even exist) into `missing` \| `empty` \| `unmanaged` \| `wiki-partial` \| `wiki-ok`, plus whether it is already registered (via "Path identity" above, not a string match — a registered wiki reached through a different case or a symlinked parent still reports `registered: true`), existing entry count/sample, and an `asks` list of what a caller still needs to collect before registering it. Never writes anything, in any state. Phase 1 of the chat-driven onboarding flow `lumi-hub` owns end to end (`docs/specs/spec-librarian-mode/routing-protocol.md`, `src/skills/agents/hub/SKILL.md`). |
| `add <path> [--name <n>] [--alias <a>]... [--description <text>]` | Without `--provision`: validates path exists and contains `_lumina/manifest.json`; otherwise exit 2. Derives `packs` from the wiki's manifest. Writes registry only — never inside the wiki. Rejects (exit 1) a name/alias that already resolves to a different wiki, and (exit 1) a path already registered under a different key — see "Repeated registration of the same directory" below. Not idempotent: repeating this exact call a second time exits 1 (own-key collision) rather than succeeding — that forgiveness exists only for `add --provision`, below. |
| `add <path> --provision --yes [--packs <list>]` | Additive-only creation + registration in one step, gated on `--yes` (exit 2 without it — confirms the writes were approved by the user in chat, not assumed). If `<path>` has no `_lumina/manifest.json` yet, provisions it via the installer's `minimal` profile (see "Minimal install profile" below) using `--description` as the wiki's own purpose text, then registers it. If `<path>` already has a valid `_lumina/manifest.json`, installs nothing — registers only, and reports `versionSkew` when that wiki's `packageVersion` differs from the running hub's. Upgrading an existing wiki's engine is never a side effect of this command. **Idempotent on an exact repeat** — see "Repeated registration of the same directory" below. |
| `remove <name>` | Registry-only removal; never touches the wiki directory. |
| `list` | Full registry to stdout — the agent's reasoning input for topic matching. |
| `resolve <query>` | Matches key, `name`, then `aliases`. Success: absolute path + metadata. Not found or ambiguous: exit 2 with candidate list in the JSON error so the agent can ask the user. Side effect on success: refreshes the wiki's `packs` from its live manifest. |
| `doctor [name] [--fix]` | With a name, checks/repairs that single wiki (must already be registered); without, sweeps the whole registry. Iterates the target(s): path exists → manifest present → structure check → `lint.mjs`. Aggregated JSON report; a broken wiki is flagged without aborting the sweep. `--fix` applies only additive structure repair plus `lint --fix`'s existing safe checks. Distinct from `inspect`: `doctor` takes a registered wiki *name* and knows the registry; `inspect` takes a bare *path* and knows nothing about it. |

## Minimal install profile

`add --provision` provisions a brand-new wiki using the installer's `minimal` profile (`installCommand({ ..., profile: 'minimal', ideTargets: ['generic'] })`), not the classic `full` profile a human-run `lumina install` produces. A minimal-profile wiki gets exactly:

- `README.md` (its `## Project Purpose` section filled from `add --provision`'s `--description`)
- `_lumina/` (config, schema, scripts, state)
- `wiki/`, `raw/`, `graph/`

It does **not** get `.claude/skills/`, `.agents/skills/`, or any IDE entry-point stub (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc`) — the wiki is managed entirely by skills already installed globally for the chat platform, so per-project copies would be redundant. If the user later wants to open the same wiki in a code editor, a normal `full`-profile `lumina install` run inside it adds those pieces on top; provisioning never does this automatically.

The profile is recorded as a top-level `profile: "full" | "minimal"` field in `_lumina/manifest.json`. A manifest with no `profile` field — every wiki that existed before this field was introduced — is read as `"full"`, never as an error or an unrecognized value; `checkLayout(root, packs, { profile })` and `inspect`'s own layout check both apply this fallback identically, so an old manifest is never misclassified.

## Repeated registration of the same directory

What happens when the same directory is registered a second time depends on how exactly the second attempt matches the first, and on whether `--provision` was used:

- **Exact repeat, `add --provision --yes` only** — same `--name` (or the same derived key, `basename(path)`, when `--name` is omitted), same directory (per "Path identity" above). Treated as success, not an error: a chat agent (OpenClaw/Hermes, via Telegram/Lark) retries commands routinely — a redelivered message, a network hiccup that leaves it unsure whether the last command landed, a user repeating themselves — and an error on a harmless retry would get worded to the user as a failure that never actually happened. The command looks up the key it would register under *before* calling the registry write path, and if that key already maps to an entry at the same directory, returns `{key, entry, provisioned: false, alreadyRegistered: true}` without writing the registry again. This is deliberately narrow and deliberately **not** extended to plain `add` — a plain `add` retried with the identical `--name`/path still hits the registry's own duplicate-key guard and exits 1, because `add` without `--provision` is not the agent-retry endpoint this behavior exists for. An agent that wants idempotent registration uses `--provision --yes`, whether or not the directory actually needs provisioning.
- **Anything else — a genuine conflict, exit 1.** A different `--name` against a directory already registered, or the same `--name` against a directory already registered as something else, is rejected by both `add` and `add --provision` alike: `"<path>" is already registered as "<name>" (key "<key>"). A directory can only be registered once — add "<name>" as an alias on that entry instead of registering it again, or run "lumina wikis remove <key>" first if you want to re-register this path under a different name.` This is a registry invariant enforced once, for every caller — not something specific to one CLI path. Without it, `list` and `doctor` would both double-count the same wiki, and an agent summarizing the fleet in chat would misreport its size.

## Doctor report shape

```json
{
  "schemaVersion": 1,
  "wikis": [
    {
      "key": "ai-engineering",
      "path": "/Users/hieu/wikis/ai-engineering",
      "reachable": true,
      "hasManifest": true,
      "structureOk": true,
      "lintOk": true,
      "issues": []
    }
  ]
}
```

## Non-destructive law

No `wikis` subcommand ever deletes or overwrites content inside a wiki directory. Repair (structure assurance, CAP-4) and `add --provision` (CAP-2/CAP-3) are the only two commands that create anything inside a wiki directory at all, and both are additive-only: they create missing required directories/files, or a brand-new wiki's initial structure, and never rewrite a pre-existing file.
