# GEMINI.md

This file provides guidance to Gemini agents when working with the Lumina-Wiki codebase.

## Read these first

- **`docs/project-context.md`** — Full critical rules and patterns AI agents must follow. **Read before editing any code or skill prompt.**
- **`docs/DEVELOPMENT.md`** — Local dev/test workflows, sandbox helpers, and common pitfalls.
- **`docs/planning-artifacts/architecture.md`** — The locked v0.1 architecture decisions and rationale.

The user-facing `README.md` describes the **post-install workspace**. This repository **IS THE INSTALLER**, not a usage example. Do not run `lumina install` against the repo root; always use a sandbox.

## What this project is

Lumina-Wiki is an **npm-published, multi-IDE wiki scaffolder**. The `npx lumina-wiki install` command projects a single-source-of-truth template tree to create an LLM-maintainable knowledge workspace for various IDEs (Gemini, Claude, Codex, etc.).

This repository contains two main layers:
- **Installer**: `bin/lumina.js` + `src/installer/*.js` (Node ESM ≥20). It's designed to be idempotent, cross-platform, with atomic file writes and a symlink-to-copy fallback ladder.
- **Workspace Payload**: The content shipped to the user, including `src/scripts/*.mjs` (the wiki engine), `src/tools/*.py` (optional Python tools), `src/skills/**/*.md` (agent prompts), and `src/templates/**/*`.

## Common commands

```bash
# Local install into a temporary sandbox
npm run dev:sandbox
npm run dev:sandbox -- --keep                    # Keep the temp directory for inspection
npm run dev:sandbox -- --reuse                   # Use a stable path for the sandbox
npm run dev:sandbox -- --packs core,research     # Forward flags to the installer

# Direct invocation (CWD must be a sandbox, not the repo root)
node bin/lumina.js install --yes

# Tests
npm run test:all                                 # Run all installer, script, and Python tests
npm run test:installer                           # Run only installer tests
npm run test:scripts                             # Run only Node.js script tests
npm run test:python                              # Run only Python tests

# CI gates (run before push)
npm run ci:idempotency                           # Ensure reinstalling causes no drift
npm run ci:package                               # Validate the npm package contents
```
**Note:** This project has no `devDependencies`. Tests use the built-in `node --test` and `pytest`. **Do not add new test frameworks.**

## Architecture — The Big Picture

### Installer Flow (`src/installer/commands.js`)
The install process follows 18 steps, including:
1.  Read `_lumina/manifest.json` to detect if it's a fresh install or an upgrade.
2.  On fresh install, run interactive prompts (lazy-loading `@clack/prompts`).
3.  Force-insert the `core` pack. It cannot be excluded.
4.  Render all templates using `atomicWrite` (temp file -> fsync -> rename).
5.  Create per-skill symlinks using the **symlink ladder** (symlink → junction → copy).
6.  Atomically write three state files (`manifest.json`, `skills-manifest.csv`, `files-manifest.csv`).

### Workspace Contract (`src/scripts/schemas.mjs`)
- `schemas.mjs` is **pure data** and the single source of truth for all entity types, edge rules, and frontmatter requirements.
- `wiki.mjs` is the **only permitted path** for mutating the wiki graph and frontmatter. Skills must invoke it via `Bash` + JSON.
- `lint.mjs` provides linting and auto-fixing capabilities for the wiki structure.

### Wiki Invariants
- `raw/` is read-only by default.
- `graph/` is auto-generated and should not be hand-edited.
- **Bidirectional links are mandatory** with specific, configured exemptions.

## Non-negotiable Rules
1.  **Never use `writeFile` directly**; always use `atomicWrite`.
2.  **Never accept user-supplied paths without `safePath()`**.
3.  **Never add native modules** or a `postinstall` script.
4.  **Maintain the cold-start budget (< 300 ms)** by keeping heavy imports lazy.
5.  All original content. **OmegaWiki is for pattern inspiration only.** No code/schema/skills are copied.
6.  **Zero telemetry.** The only network call is the optional, timeout-bounded `npm view` check.

## Exit Code Contract
- `0`: Success
- `1`: User error (e.g., bad arguments)
- `2`: Filesystem, path safety, or permissions error
- `3`: Internal, upgrade incompatibility, or network error
