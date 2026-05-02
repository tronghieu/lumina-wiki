# Repository Guidelines

## Required Agent Context

Before editing code, templates, or skill prompts, read `docs/project-context.md`. It contains current rules, module contracts, invariants, testing workflow, and gotchas. For deeper orientation, use `docs/DEVELOPMENT.md` and `docs/planning-artifacts/architecture.md`.

## Project Structure & Module Organization

Lumina-Wiki is the source repo for an npm CLI scaffolder, not a generated wiki workspace. The CLI entry point is `bin/lumina.js`. Installer code lives in `src/installer/`, runtime scripts in `src/scripts/`, Python tools in `src/tools/`, skill prompts in `src/skills/`, and install templates in `src/templates/`. Tests are colocated as `*.test.js` or `*.test.mjs`; Python tests live in `src/tools/tests/`.

## Build, Test, and Development Commands

- `npm ci`: install Node dependencies exactly from `package-lock.json`.
- `npm run dev:sandbox`: install into a temporary sandbox. Use this instead of running `lumina install` in the repo root.
- `npm run test:all`: run installer, script, and Python tests.
- `npm run ci:idempotency`: install twice and verify watched paths do not drift.
- `npm run ci:package`: validate npm package contents and publish safety rules.

## Coding Style & Naming Conventions

Use Node >=20, ESM modules, and no transpilation. Keep command imports lazy to preserve cold start. Do not add native modules, `postinstall`, Jest, Vitest, or dev dependencies. Use `atomicWrite` for writes and `safePath` for user path fragments. Skills install as flat canonical IDs, for example `lumi-init` and `lumi-research-discover`.

## Agent-Specific Instructions

Treat the repo as two layers: installer code plus workspace payload. Never run `lumina install` against the repo root; use `npm run dev:sandbox` or a temp directory. Preserve idempotency: install and upgrade must not modify generated `wiki/` or `raw/` data. Generated workspaces use `README.md` as canonical schema; agent entry files are rendered stubs, not symlinks.

## Testing Guidelines

JavaScript uses built-in `node --test` with `node:assert/strict`; Python uses `pytest`. Name installer tests `src/installer/*.test.js`, script tests `src/scripts/*.test.mjs`, and tool tests `src/tools/tests/test_*.py`. Before pushing, run `npm run test:all`, `npm run ci:idempotency`, and `npm run ci:package`.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, for example `feat(installer): ...`, `docs(readme): ...`, `refactor(skills): ...`, and `chore(release): ...`. PRs should state the user-visible change, list tests run, call out idempotency or packaging impact, and link related issues or roadmap items when applicable.

## Security & Configuration Tips

Lumina-Wiki has zero telemetry; the only outbound call is the optional npm version check. Never write secrets to committed files. Research API keys belong in local `.env`; `.env.example` documents expected variables.
