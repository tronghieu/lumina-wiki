# Product Brief: Lumina-Wiki

> **Tagline:** *Where Knowledge Starts to Glow.*

**Status:** Draft v1 · **Date:** 2026-05-01 · **Author:** Lưu Trọng Hiếu (with Mary, BMad Business Analyst) · **License:** MIT

---

## Executive Summary

Lumina-Wiki is a one-command installer (`npx lumina-wiki install`) that scaffolds a self-maintaining research wiki into any project, ready for any LLM agent — Claude Code, Codex, Cursor, Gemini CLI — to read, ingest, cross-reference, and lint over time. It realizes Andrej Karpathy's *LLM-Wiki* pattern (the LLM compiles knowledge into a persistent, structured wiki rather than re-deriving it from raw chunks on every query) with the structural discipline proven by ΩmegaWiki, but rebuilt cross-platform, multi-IDE, and pack-based so the user picks only the surface area they need.

The build artifact (an npm package) and the workspace artifact (the user's wiki) are strictly separated: the npm package ships skills, schema templates, and the installer; the user's project gets `.agents/` (single source of truth for skills + schema), `wiki/` (LLM-maintained), and `raw/` (user-owned, immutable). Every IDE-specific entry point — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/lumi-*` — is a symlink into `.agents/`, so upgrades touch one location and propagate everywhere.

This is a personal tool first. The author is the primary user; alignment with their research workflow is the only success criterion that matters in v0.1. If others find it useful, that is a free externality.

---

## The Problem

Karpathy's LLM-Wiki post describes a pattern, not a product. ΩmegaWiki implements the pattern beautifully but with three frictions that make it the wrong starting point for a generalist user:

1. **Academic-paper-shaped.** Its 9 entity types (papers, claims, experiments, ideas, foundations, …) and 24 skills (`/daily-arxiv`, `/rebuttal`, `/exp-run`, …) assume the user is publishing CS/AI papers. Anyone doing technical research outside that mold has to fork and prune.
2. **Setup is bash-flavored.** `setup.sh` + `setup.ps1` work, but the workflow is opinionated about Python venvs, Claude Code as the only runtime, and a manual git-clone-then-script flow. Cross-platform polish lags.
3. **No clean build/workspace boundary.** The repo is the workspace. Upgrading means rebasing your wiki on top of upstream changes — friction every time the framework evolves.

Karpathy's broader concern stands too: **most LLM-with-documents tooling rediscovers knowledge on every query.** RAG retrieves chunks; the LLM re-synthesizes from scratch every time. Nothing accumulates. The user wants the *opposite* — a knowledge artifact that compounds with every source ingested.

---

## The Solution

`npx lumina-wiki install` runs an interactive scaffolder that, in under a minute, drops a working research-wiki workspace into the user's project:

- **Schema-first.** A single `CLAUDE.md` (symlinked as `AGENTS.md` / `GEMINI.md`) tells any LLM agent how the wiki is structured, what conventions apply, and what skills are available. The LLM becomes a disciplined wiki maintainer rather than a generic chatbot.
- **Skill bundles, not monoliths.** A small `core` skill set (init, ingest, ask, edit, check, reset) is always installed. Optional packs — `research` (ported and trimmed from ΩmegaWiki: discover, ideate, novelty, survey, paper-plan/draft/compile, rebuttal, daily-arxiv, exp-*) and `reading` (chapter-ingest, character-track, theme-map) — extend the wiki for specific domains.
- **Single source of truth.** All skills and schema live in `.agents/`. IDE-specific touchpoints (`.claude/skills/lumi-*`, `AGENTS.md`, `.cursor/rules/`, `GEMINI.md`) are symlinks. Edit once; every agent sees the change.
- **Bidirectional-link discipline.** The wiki enforces ΩmegaWiki's most valuable invariant: when a forward link is written, the reverse link is written in the same operation. Three pragmatic exemptions (`foundations/**`, `outputs/**`, external URLs) are declared in config rather than left implicit.
- **Cross-platform from day one.** Pure Node ≥20 installer; Python is opt-in for skills inside packs that need it.

The user runs one command, answers four prompts (project name, IDE targets, packs, language pair), and walks away with a wiki that any modern coding agent can immediately maintain.

---

## What Makes This Different

Four wedges, all live simultaneously:

| Wedge | Versus | Why it wins |
|-------|--------|-------------|
| **Cross-platform installer** | ΩmegaWiki's `setup.sh` / `setup.ps1` | One Node command, no shell-scripting drift, Windows works without WSL for the install path. |
| **Multi-IDE via symlink** | ΩmegaWiki (Claude Code only) | Schema and skills are agent-agnostic; symlinks expose them under each IDE's expected path. The user is never re-locked to one runtime. |
| **Pack system** | Monolithic 24-skill install | Surface area matches the user's actual domain. Researchers get research; readers get reading; nobody pays the cognitive tax of skills they will not use. |
| **Domain-agnostic core** | Academic-paper bias of ΩmegaWiki | The 4 core page types (Source, Concept, Person, Summary) work for papers, books, articles, and beyond. Specialization comes from packs, not from the core. |

The unfair advantage is execution speed and personal-fit-first design. ΩmegaWiki had to satisfy a research lab; Lumina-Wiki only has to satisfy one user this quarter. That constraint is a feature.

---

## Who This Serves

**Primary user — the author (and only user that matters for v0.1).** A solo technical operator using Claude Code as their daily agent, who wants a personal research wiki built and maintained automatically as they read technical papers, articles, and source materials. Already comfortable with: git, npm, markdown, Obsidian, the BMad Method workflow. Not interested in: forking and pruning a 24-skill academic suite by hand.

**Secondary user — the curious hacker.** Anyone who reads Karpathy's LLM-Wiki post, wants to try the pattern, owns Claude Code or Codex, and would rather `npx` something than clone-and-script. Not actively designed for. If they show up, great; if they don't, no signal to chase.

Explicitly **not serving** in v0.1: enterprise teams, multi-user collaboration, non-developer end users, mobile-only workflows.

---

## Success Criteria

Personal-use bar — measurable but unambitious by design:

1. **Self-dogfooded daily.** Author runs at least one of (`/lumi-ingest`, `/lumi-ask`, `/lumi-check`) ≥3 days/week for 4 consecutive weeks post-launch.
2. **Wiki actually compounds.** After 30 days of use, the wiki contains ≥30 sources, ≥50 concepts, with ≥80% of pages reachable via bidirectional links (lint-verified).
3. **Multi-IDE works.** Author uses Lumina-Wiki under Claude Code *and* one other agent (Codex, Cursor, or Gemini CLI) without schema drift or symlink breakage.
4. **Reinstall path works.** A fresh `npx lumina-wiki install` on a new machine reproduces the same workspace shape from a committed `lumina.config.yaml` + `.agents/manifest.json`.
5. **No commercial metrics.** Stars, downloads, external feedback — all ignored for v0.1. Track later if and only if the tool clears the personal-use bar first.

---

## Scope (v0.1.0 — MVP Tier A)

**In:**
- `npx lumina-wiki install` interactive scaffolder (4 prompts: project name, IDE targets, packs, language pair).
- Render `lumina.config.yaml` from prompts.
- Scaffold directory structure: `.agents/`, `wiki/{sources,concepts,people,summary,outputs,graph,index.md,log.md}`, `raw/{sources,notes,assets,tmp}`.
- Copy `core` skills into `.agents/skills/` as `lumi-<name>/` directories. Optionally install `research` and/or `reading` packs (also written as `lumi-<name>/`).
- Render `CLAUDE.md` schema into `.agents/schema/`; create symlinks: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` at project root + `.claude/skills/lumi-*` per installed skill.
- Windows-aware: detect symlink support, fall back to junction (Windows directory symlinks) or copy-with-warning when symlink is unavailable.
- `lumina --version`, `lumina --help`, `lumina install`, `lumina uninstall` commands.
- README, MIT LICENSE, basic CI (lint + smoke test on macOS/Linux/Windows).

**Out (deferred to v0.2+):**
- Runtime CLI commands (`lumina status`, `lumina lint`, `lumina search`, `lumina pack add/remove`).
- Bundled MCP server for skills.
- `qmd` integration; Marp slide rendering; Dataview-style frontmatter generators.
- The `personal` pack (dropped — heterogeneous use cases not packageable; will ship as a `docs/recipes/` doc later if there is demand).
- i18n beyond English (UI strings hardcoded EN; wiki output language is user-configurable).
- GitHub Actions cron skills (e.g. `daily-arxiv`) — present in pack files but not wired to a workflow template in v0.1.
- Browser/UI; collaboration features.

---

## Technical Approach

- **Runtime:** Node ≥20, ESM. Dependencies modeled on BMAD installer: `commander` (CLI), `@clack/prompts` (interactive UX), `glob`, `js-yaml`, `chalk` or `picocolors`.
- **Repo layout:** `bin/lumina.js` → `src/installer/{commands,prompts,fs}.js`; templates under `src/templates/{schema,skills/core,skills/packs/research,skills/packs/reading,workspace,config}/`.
- **Skill source curation:** Fork ΩmegaWiki skills under MIT; trim research-only assumptions; rename `/foo` → `/lumi-foo`; preserve attribution in `NOTICE`. Python helper scripts (e.g. `research_wiki.py`, `lint.py`, `fetch_arxiv.py`) referenced by pack `research` are vendored under that pack's directory; the installer prompts to set up `.venv` only if pack `research` is selected.
- **Symlink strategy:** Use Node's `fs.symlinkSync` with `'junction'` type on Windows for directories. For files (e.g. `CLAUDE.md` → `.agents/schema/CLAUDE.md`), fall back to copy + warning on Windows when Developer Mode is off; record the fallback in `.agents/manifest.json` so upgrades behave correctly.
- **Idempotency:** First install writes everything. Subsequent `lumina install` runs read `.agents/manifest.json` and act as upgrade — replace skill files in `.agents/`, never touch `wiki/` or `raw/`, refresh symlinks.
- **Distribution:** npm publish under name `lumina-wiki` (verified available 2026-05-01); auto-update check via `npm view lumina-wiki@latest version` modeled on BMAD.
- **License:** MIT for all original code; ΩmegaWiki-derived skill content retains its MIT notice in-place.

---

## Vision (12-month horizon)

If v0.1.0 clears the personal-use bar, the natural next moves are runtime CLI commands (Tier B), then a bundled MCP server (Tier C) so any MCP-aware agent can call `lumina_search` / `lumina_lint` / `lumina_ingest_url` natively. Beyond that, the interesting question is whether the pack ecosystem opens up: third-party packs (`pack-team-knowledge`, `pack-trip-planning`, `pack-course-notes`) installable via `lumina pack add @vendor/pack-name`. That is a 2027 problem at the earliest. v0.1.0's only job is to be useful to one person, sustainably, every day.

---

## Open Decisions Carried Forward (for the PRD)

- npm name claim: pending (Cloudflare rate-limited 2026-05-01; retry within 24h).
- GitHub repo creation: `github.com/tronghieu/lumina-wiki` — not yet created.
- Whether the installer should also seed an example `wiki/index.md` with one demo source, or leave the wiki empty. (Lean: leave empty; let `/lumi-init` produce the first content.)
- Pack `research` Python toolchain: include `requirements.txt` install in the installer flow, or defer to first invocation of a Python-needing skill. (Lean: defer.)
- Whether to bundle a `.gitignore` template for the user's project root that ignores `.agents/_state/` and `raw/tmp/`. (Lean: yes.)
