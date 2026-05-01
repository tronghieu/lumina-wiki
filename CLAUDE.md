# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

- **`docs/project-context.md`** — full critical rules and patterns AI agents must follow. **Read before editing any code or skill prompt.**
- **`docs/DEVELOPMENT.md`** — local dev/test workflows, sandbox helpers, dev-loop pitfalls.
- **`docs/planning-artifacts/architecture.md`** — locked v0.1 architecture decisions and rationale.

The user-facing `README.md` describes the **post-install workspace** (`raw/`, `wiki/`, `/lumi-*` slash commands). This repo IS the installer — not a usage example. Don't run `lumina install` against the repo root; always use a sandbox.

## What this project is

Lumina-Wiki is an **npm-published, multi-IDE wiki scaffolder**. `npx lumina-wiki install` projects a single source-of-truth template tree onto whichever IDE the user picks (Claude Code, Codex, Gemini, Cursor, generic), creating an LLM-maintainable knowledge workspace. After install, agents drive the wiki via `/lumi-*` skills which call Node/Python tools through `Bash`.

Two layers in this repo:

- **Installer** — `bin/lumina.js` + `src/installer/*.js` (Node ESM ≥20). Idempotent, cross-platform, atomic file writes, symlink fallback ladder.
- **Workspace payload** — `src/scripts/*.mjs` (Node wiki engine), `src/tools/*.py` (Python research-pack tools, opt-in), `src/skills/**/*.md` (markdown agent prompts), `src/templates/**/*` (rendered into the user's project on install).

## Common commands

```bash
# Local install into temp sandbox (creates dir, git inits, installs, prints tree, cleans up)
npm run dev:sandbox
npm run dev:sandbox -- --keep                    # keep tmp dir
npm run dev:sandbox -- --reuse                   # stable path: $TMPDIR/lumi-sandbox
npm run dev:sandbox -- --packs core,research     # forward flags to installer

# Direct invocation (cwd must be a sandbox, not the repo)
node bin/lumina.js install --yes

# Tests
npm run test:all                                 # installer + scripts + Python
npm run test:installer                           # node --test src/installer/*.test.js
npm run test:scripts                             # node --test src/scripts/*.test.mjs
npm run test:python                              # pytest src/tools/tests -q
npm run test:fs                                  # one module: fs helpers
npm run test:manifest                            # one module: manifest read/write
npm run test:template                            # one module: template engine
npm run test:update                              # one module: update-check

# Single test file (any path)
node --test src/installer/fs.test.js
node --test src/scripts/wiki.test.mjs

# CI gates (run before push — same as GitHub Actions)
npm run ci:idempotency                           # install twice → git diff over watched paths must be empty
npm run ci:package                               # npm pack --dry-run, validate files allowlist + postinstall ban
```

No `devDependencies`. Tests use built-in `node --test` (`node:test` + `node:assert/strict`) and `pytest`. **Do not add Jest, Vitest, or any test framework.**

## Architecture — the big picture

### Installer flow (`src/installer/commands.js`)

18 numbered steps in source. Key shape:

1. Read `_lumina/manifest.json` — `null` = fresh install, non-null = upgrade.
2. Fresh: interactive prompts (lazy-load `@clack/prompts`). Upgrade: read YAML config first, manifest fallback.
3. `applyInstallOverrides` merges CLI flags. **`core` pack is always force-inserted** via `unique(['core', ...rest])` — cannot be excluded.
4. Render templates (`src/installer/template-engine.js`) and write everything via `atomicWrite` (temp + `fd.datasync()` + rename).
5. Per-skill symlinks under `.claude/skills/lumi-*` go through the **symlink ladder**: `symlink` → `junction` (Windows) → `copy` fallback. Chosen strategy persisted in `manifest.symlinkStrategies` for idempotent re-use.
6. Three state files written last, atomically: `manifest.json`, `_lumina/_state/skills-manifest.csv`, `_lumina/_state/files-manifest.csv`.

`bin/lumina.js` is ESM and lazy-imports every subcommand inside `.action()` callbacks to keep cold-start under 300 ms. **Do not promote lazy imports to top-level `import` statements.**

### Workspace contract (single source of truth: `src/scripts/schemas.mjs`)

`schemas.mjs` is **pure data, no I/O, no side effects** — entity types, edge types (28 directed), required frontmatter per type, exemption globs. Both `wiki.mjs` and `lint.mjs` import it. Schema changes propagate from here.

Two write paths into the workspace, both `atomicWrite`-discipline:

- **`wiki.mjs`** — only allowed path for graph/frontmatter mutation. Skills invoke via `Bash` + JSON, never `import`. JSON to stdout for reads, JSON status for mutations, `{"error":"…","code":2|3}` to stderr.
- **`lint.mjs`** — `--fix` for L01/L03/L06/L07/L09 (kebab slugs, missing reverse edges, dedupe symmetric, refresh `<!-- lumina:index -->` block). 9 checks total.

`reset.mjs` is the only deletion path; `--scope all` includes `wiki + state` but **never `raw/`**.

### Wiki invariants (the heart of the project)

- **`raw/`** is read-only by default. Only `raw/tmp/` and `raw/discovered/` accept new files (additions only, no overwrites).
- **`graph/`** auto-generated; never hand-edit `edges.jsonl` or `citations.jsonl`.
- **Bidirectional links mandatory**: every forward link writes its reverse in the same operation. Exempt-only mode: `foundations/**`, `outputs/**`, `*://*` are the only forward-without-reverse exceptions.
- **`log.md` append-only**, **`index.md`** updated on every ingest.
- Sections marked `<!-- user-edited -->` are preserved on upgrade — append, don't overwrite.

### Skills (v0.1 = 14 total)

- Core (6, always installed): `/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`
- Research pack (4, opt-in): `/lumi-discover`, `/lumi-survey`, `/lumi-prefill`, `/lumi-setup`
- Reading pack (4, opt-in): `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`

Each skill is `src/skills/<subtree>/<name>/SKILL.md` with frontmatter (`name`, `description`, `allowed-tools`). Body opens with "Read `README.md` at the project root before this SKILL.md."

### Entry-point stub pattern

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc` — all are **rendered stubs** (~5 lines) redirecting to `README.md`. **They are NOT symlinks.** README.md is the canonical agent-context file. The `<!-- lumina:schema --> ... <!-- /lumina:schema -->` markers are the only region the installer rewrites on upgrade — markers must be on their own lines.

## Non-negotiable rules

The full list lives in `docs/project-context.md` §3. The ones most likely to bite you when editing:

1. **Never use `writeFile` directly** — always `atomicWrite` (or temp+fsync+`os.replace` in Python).
2. **Never accept user-supplied paths without `safePath()`** — rejects `..`, absolute paths, Windows drive letters, backslash traversals.
3. **Never add native modules.** No `node-gyp`, no `bcrypt`-style packages.
4. **Never add a `postinstall` script.** `ci-package.mjs` blocks publish if one exists.
5. **`devDependencies: {}` is a feature** — don't add test frameworks.
6. **Cold-start budget < 300 ms** — keep lazy imports lazy.
7. **No emoji in shipped files** unless explicitly requested.
8. **No cross-model review** anywhere — single-model self-check only. No `llm-review` MCP, no second-model verdict gates.
9. **OmegaWiki** at `../OmegaWiki` is read-only **prior art for patterns only** — never copy code/schema/skills, never mention in user-facing strings (PRD, README, installer output, skill prompts, errors). All content is originally authored.
10. **Zero telemetry** — only outbound call is the optional `npm view` update check (2 s timeout, suppressible via `--no-update` or `LUMINA_NO_UPDATE_CHECK=1`).

## Idempotency invariant — what CI watches

`scripts/ci-idempotency.mjs` runs `git diff --exit-code` after the second install over: `README.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/`, `.claude/`, `.agents/`, `_lumina/config/`, `_lumina/schema/`, `_lumina/scripts/`, `_lumina/tools/`, `.env.example`, `wiki/`, `raw/`.

**Intentionally ignored**: `_lumina/manifest.json`, `_lumina/_state/*` (runtime state with timestamps). Don't rely on these being byte-stable across installs.

## Exit code contract

- `0` success
- `1` user error (bad args)
- `2` filesystem / path safety / unknown slug / missing `--yes`
- `3` internal / fs failure / upgrade incompatibility / 5xx network

`EACCES` / `EPERM` / `RangeError` (from `safePath`) all map to exit 2 at `bin/lumina.js`.
