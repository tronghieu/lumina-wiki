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

## Subcommands

All support `--json`; exit codes follow the project contract (0 success, 1 user error, 2 fs/path/unknown, 3 internal, 4 cancelled). Lazy-loaded to protect the cold-start budget.

| Command | Behavior |
|---|---|
| `add <path> [--name <n>] [--alias <a>]...` | Validates path exists and contains `_lumina/manifest.json`; otherwise exit 2 (interactive mode may offer to run install first). Derives `packs` from the wiki's manifest. Writes registry only — never inside the wiki. Rejects (exit 1) a name/alias that already resolves to a different wiki. |
| `remove <name>` | Registry-only removal; never touches the wiki directory. |
| `list` | Full registry to stdout — the agent's reasoning input for topic matching. |
| `resolve <query>` | Matches key, `name`, then `aliases`. Success: absolute path + metadata. Not found or ambiguous: exit 2 with candidate list in the JSON error so the agent can ask the user. Side effect on success: refreshes the wiki's `packs` from its live manifest. |
| `doctor [name] [--fix]` | With a name, checks/repairs that single wiki; without, sweeps the whole registry. Iterates the target(s): path exists → manifest present → structure check → `lint.mjs`. Aggregated JSON report; a broken wiki is flagged without aborting the sweep. `--fix` applies only additive structure repair plus `lint --fix`'s existing safe checks. |

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

No `wikis` subcommand ever deletes or overwrites content inside a wiki directory. Repair (structure assurance, CAP-4) creates missing required directories/files only; pre-existing files are never rewritten.
