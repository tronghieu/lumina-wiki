---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
releaseMode: phased
classification:
  projectType: cli-tool-npm-scaffolder
  domain: developer-tooling-llm-agent-infra
  complexity: medium
  projectContext: greenfield
decisions:
  github_repo: github.com/tronghieu/lumina-wiki (created — this repo)
  wiki_index_seed: leave empty (lumi-init produces first content)
  omegawiki_inspiration: read-only local clone at ../OmegaWiki for inspiration only — no fork, no derived code, no attribution dependency
  pack_research_python_install: defer to first invocation (brief lean)
  gitignore_template: bundle (_lumina/_state/, raw/tmp/) (brief lean)
  workspace_layout: BMAD-style sidecar — `_lumina/` holds config/scripts/tools/manifest; `.agents/` is skills-only; `README.md` at project root is canonical schema (NOT a symlink); `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` are tiny rendered stub files pointing to README.md (NOT symlinks)
  v01_skill_set: 14 skills total — core (6) `init/ingest/ask/edit/check/reset`; research pack (4) `discover/survey/prefill/setup`; reading pack (4) `chapter-ingest/character-track/theme-map/plot-recap`. Cross-model review and LaTeX/exp pipelines explicitly dropped (no MCP llm-review, no `novelty/review/refine/research/ideate/rebuttal/paper-*/exp-*/daily-arxiv`).
  v01_node_scripts: 4 files in `_lumina/scripts/` — `wiki.mjs` (engine), `lint.mjs` (9-check linter), `reset.mjs` (scoped destructive reset), `schemas.mjs` (single source of truth for entity dirs/edges/required frontmatter)
  v01_python_tools: 8 files in `_lumina/tools/` (research pack only) — `_env.py`, `discover.py`, `init_discovery.py`, `prepare_source.py`, plus four optional fetcher plugins (`fetch_arxiv.py`, `fetch_wikipedia.py`, `fetch_s2.py`, `fetch_deepxiv.py`)
inputDocuments:
  - docs/planning-artifacts/product-brief.md
  - docs/llm-wiki.md
  - docs/planning-artifacts/lumina-wiki-readme-template.md
  - docs/planning-artifacts/lumina-wiki-config-schema.yaml
  - docs/planning-artifacts/lumina-wiki-package-stub.json
  - docs/planning-artifacts/lumina-wiki-bin-stub.js
documentCounts:
  briefs: 1
  research: 1
  brainstorming: 0
  projectDocs: 4
workflowType: 'prd'
---

# Product Requirements Document - LuminaWiki

**Author:** Lưu Hiếu
**Date:** 2026-05-01
**Status:** Draft v1, derived from `product-brief.md` (2026-05-01)
**Repo:** `github.com/tronghieu/lumina-wiki`
**Package:** `lumina-wiki` (npm)

## How To Read This Document

This PRD is dual-audience: a human (the author) reads it once before starting implementation; an LLM agent reads it repeatedly while drafting epics, stories, and code. Sections progress from **why** (Executive Summary, Project Classification, Success Criteria) through **how it feels** (User Journeys, Innovation, CLI Tool Specifics) to **what gets built** (Functional Requirements, Non-Functional Requirements, Project Scoping). The capability contract lives in §Functional Requirements; everything else is context for those FRs.

## Executive Summary

Lumina-Wiki is a one-command npm scaffolder (`npx lumina-wiki install`) that drops a self-maintaining research wiki into any project, ready for any modern coding agent — Claude Code, Codex, Cursor, Gemini CLI — to read, ingest, cross-reference, and lint over time. It realizes Karpathy's LLM-Wiki pattern (the LLM compiles knowledge into a persistent, structured wiki rather than re-deriving it from raw chunks every query), rebuilt cross-platform, multi-IDE, and pack-based so the user picks only the surface area they need. OmegaWiki is studied as prior art for ideas only — no code, schema, or skill content is copied.

The build artifact (the npm package) and the workspace artifact (the user's wiki) are strictly separated. The package ships an installer, a README.md schema template, and curated skills. The workspace it produces uses a BMAD-style split:

- **`README.md`** at the project root is the canonical agent-context file — schema, conventions, skill list, project overview — rendered once at install time and freely editable thereafter. This is the single source of truth for "what is this wiki and how do I maintain it". It is a normal markdown file, not a symlink.
- **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`** at the project root are **tiny rendered stub files** (~5–10 lines), one per IDE target, each instructing its agent to read `README.md` first. They are independent files, not symlinks. `.cursor/rules/lumina.mdc` follows the same stub pattern.
- **`_lumina/`** holds installer-managed framework state: `config/lumina.config.yaml`, `schema/` (deeper reference docs: `page-templates.md`, `cross-reference-packs.md`, `graph-packs.md` — opened on demand by the agent when README.md instructs), `scripts/` (Node engine: `wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`), `tools/` (opt-in Python tools for the research pack), `manifest.json`, `_state/` (gitignored checkpoints). The canonical entry-point CLAUDE.md content lives at `README.md` (project root), NOT inside `_lumina/schema/`.
- **`.agents/`** contains **only** `skills/` (`skills/core/`, `skills/packs/research/`, `skills/packs/reading/`). Per-skill symlinks `.claude/skills/lumi-*` point into `.agents/skills/<pack>/<skill>/`; this is the only place where the cross-platform symlink/junction/copy ladder still applies.
- **`wiki/`** is LLM-maintained; **`raw/`** is user-owned and immutable.

The "single source of truth" wedge is preserved as a content convention (every agent reads `README.md`) rather than a filesystem trick. Removing schema-file symlinks eliminates Windows symlink fragility for the load-bearing entry points.

This is a personal tool first. The author is the primary user; alignment with their research workflow is the only success criterion that matters in v0.1. If others find it useful, that is a free externality.

### What Makes This Special

Four wedges, all live simultaneously:

- **Cross-platform installer.** Pure Node ≥20 — one command (`npx lumina-wiki install`), Windows works without WSL.
- **Multi-IDE via README hub.** A single `README.md` at the project root carries the canonical schema. `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules/lumina.mdc` are tiny stub files that point each agent to read `README.md` first. The user is never locked to one runtime, and there is no symlink fragility for the load-bearing entry points.
- **Pack system.** A small `core` skill set is always installed (`/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`). Optional packs — `research` and `reading` — extend the wiki for specific domains. Surface area matches actual use; nobody pays the cognitive tax of skills they will not use.
- **Domain-agnostic core.** Four core page types (Source, Concept, Person, Summary) work for papers, books, articles, podcasts, and beyond. Specialization comes from packs, not from the core.

The core insight: separating the build artifact from the workspace artifact, exposing a single source of truth via symlinks, and making bidirectional-link discipline the wiki's load-bearing invariant — these together turn a personal-prompt pattern into a tool a single user can actually maintain across years and across agents.

## Project Classification

- **Project Type:** CLI tool / npm scaffolder (interactive installer, no runtime daemon in v0.1).
- **Domain:** Developer tooling — LLM agent infrastructure and local knowledge management.
- **Complexity:** Medium. Cross-platform symlinks (Windows junction fallback, Developer-Mode detection), template rendering, multi-IDE integration, pack system with idempotent upgrade, and a manifest-driven reinstall path. No regulatory, distributed, or novel-research surface area.
- **Project Context:** Greenfield. Repo `github.com/tronghieu/lumina-wiki` exists; no code committed yet. OmegaWiki is read locally at `../OmegaWiki` purely as **prior art / inspiration** — Lumina-Wiki authors its own schema, skills, and tools from scratch and ships no code derived from OmegaWiki.

## Success Criteria

This is a personal tool. Success is measured by sustained personal use and workspace integrity, not by external adoption. Business metrics are explicitly out of scope for v0.1.

### User Success

The product succeeds for its primary user (the author) when, four weeks after install:

- The author runs at least one of `/lumi-ingest`, `/lumi-ask`, `/lumi-check` on **≥3 days per week for 4 consecutive weeks** without abandoning the tool.
- The wiki actually compounds: **≥30 source pages and ≥50 concept pages** accumulated, with **≥80% of pages reachable via bidirectional links** as verified by `/lumi-check`.
- The author uses Lumina-Wiki under **Claude Code plus at least one other agent** (Codex, Cursor, or Gemini CLI) without schema drift or symlink breakage during a one-month window.

### Business Success

Not applicable in v0.1. The package is MIT, free, and built for one user. Stars, downloads, and external feedback are explicitly **not tracked** as success signals. They will only be reconsidered after the personal-use bar is cleared.

### Technical Success

The installer is correct, idempotent, and cross-platform:

- `npx lumina-wiki install` completes in **under 60 seconds** on macOS, Linux, and Windows (with Developer Mode on, or with the documented junction/copy fallback otherwise).
- Re-running `lumina install` on an existing workspace is **idempotent**: skill files in `.agents/` are replaced, `wiki/` and `raw/` are never touched, symlinks are refreshed, and the manifest is updated.
- A fresh `npx lumina-wiki install` on a different machine, given a committed `lumina.config.yaml` and `.agents/manifest.json`, **reproduces the same workspace shape** (same packs, same symlink layout, same skill set).
- CI passes lint and smoke-install on macOS, Linux, and Windows for every PR.

### Measurable Outcomes

| Metric | Target | When | How verified |
|---|---|---|---|
| Daily-use cadence | ≥3 days/week, 4 consecutive weeks | First 30 days post-launch | Author self-report from `wiki/log.md` grep |
| Wiki compounding | ≥30 sources, ≥50 concepts, ≥80% bidirectional reachability | Day 30 | `/lumi-check` lint output |
| Multi-IDE parity | Claude Code + 1 other agent, no schema drift | Within first 30 days | Manual run on second agent; symlink integrity check |
| Install time | < 60s | Every install | CI smoke test wall-clock |
| Idempotent reinstall | No changes to `wiki/` or `raw/`; `.agents/` refreshed | Every reinstall | CI: snapshot, reinstall, diff |
| Cross-platform CI | Pass on macOS / Linux / Windows | Every PR | GitHub Actions matrix |

## Product Scope

### MVP — Minimum Viable Product (v0.1.0, Tier A)

**Installer (interactive, four prompts: project name, IDE targets, packs, language pair)**
- Render `_lumina/config/lumina.config.yaml` from prompts.
- Scaffold directories: `_lumina/{config,schema,scripts,tools,_state}`, `.agents/skills/`, `wiki/{sources,concepts,people,summary,outputs,graph,index.md,log.md}`, `raw/{sources,notes,assets,tmp}`.
- Copy `core` skills into `.agents/skills/core/`. Optionally install `research` and `reading` packs into `.agents/skills/packs/`.
- Copy Node engine scripts (`wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`) into `_lumina/scripts/`. Render deeper reference docs (`page-templates.md`, `cross-reference-packs.md`, `graph-packs.md`) into `_lumina/schema/`. When `research` pack is selected, copy Python tools into `_lumina/tools/`.
- Render `README.md` at project root from the schema template. If `README.md` already exists, prompt the user to merge between `<!-- lumina:schema -->` markers, back up + replace, or abort.
- Render tiny stub files for each selected IDE target: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` at project root, plus `.cursor/rules/lumina.mdc`. Each stub contains a one-line instruction for its agent to read `README.md` first. None are symlinks.
- Create per-skill symlinks `.claude/skills/lumi-*` → `.agents/skills/<pack>/<skill>/` when Claude Code is a selected target. This is the only place the symlink/junction/copy ladder applies.
- Windows-aware: detect symlink support for the per-skill symlinks; fall back to junction (directories) or copy-with-warning when unavailable. Record per-target strategy in `_lumina/manifest.json`. Schema-level entry points are plain files, never symlinks, so they have no fallback concern.

**CLI surface**
- `lumina --version`, `lumina --help`, `lumina install`, `lumina uninstall`. Alias: `lumi`.

**Project hygiene**
- README, MIT LICENSE.
- Bundled `.gitignore` template ignoring `.agents/_state/` and `raw/tmp/`.
- CI: lint + smoke install on macOS / Linux / Windows.

**Open decisions resolved**
- `wiki/index.md` seeded **empty**; first content produced by `/lumi-init`.
- Pack `research` Python toolchain installation **deferred to first invocation** of a Python-needing skill.

### Growth Features (Post-MVP, v0.2+)

- Runtime CLI commands: `lumina status`, `lumina lint`, `lumina search`, `lumina pack add/remove`.
- Bundled MCP server (`lumina_search`, `lumina_lint`, `lumina_ingest_url`) so any MCP-aware agent can call wiki operations natively. Note: v0.1 explicitly does **not** ship a cross-model `llm-review` MCP server (decision: single-model self-check is sufficient for personal use).
- `/lumi-refine` skill — single-model iterative self-critique loop (max-rounds, target-score, focus filter, history log). Re-evaluated after v0.1 dogfooding to judge whether structural value justifies the surface area.
- GitHub Actions cron workflow template wiring scheduled-fetch skills (generalize beyond arxiv).
- `qmd` integration; Marp slide rendering; Dataview-style frontmatter generators.
- i18n beyond English for installer UI strings (wiki output language is already user-configurable).
- Skills explicitly **out of scope** in v0.1 and **out of scope** in v0.2 unless evidence forces a reconsideration: `/ideate`, `/novelty`, `/review`, `/research` orchestrator, `/rebuttal`, `/paper-plan`, `/paper-draft`, `/paper-compile`, `/daily-arxiv`, and the `/exp-*` cluster (`exp-design`, `exp-run`, `exp-status`, `exp-eval`). These belong to AI/ML conference workflow patterns the author does not run as a daily loop and can be re-added as a separate optional pack if the use case re-emerges.

### Vision (12-month horizon)

- Third-party pack ecosystem: `lumina pack add @vendor/pack-name` for community packs (`pack-team-knowledge`, `pack-trip-planning`, `pack-course-notes`, etc.).
- Optional collaborative mode (multi-user, conflict-aware merge of `wiki/`).
- Browser/UI surface for non-coding-agent consumption.

Explicitly **out of scope across all horizons** unless evidence forces a reconsideration: enterprise deployment, mobile-only flows, paid tiers.

## User Journeys

In v0.1, Lumina-Wiki has exactly one human persona — **Hieu, the solo technical operator** (the author). He works in a terminal, drives Claude Code as his daily agent, occasionally tries Codex / Cursor / Gemini CLI, reads ML/CS papers and long-form articles, and wants the act of reading to leave behind a structured artifact rather than a pile of PDFs. There are no admins, no support staff, no API consumers, and no second human at this stage. Coverage is therefore not "different user types" but **different moments in one user's relationship with the wiki**: bringing it into existence, using it daily, upgrading it, and recovering when something goes wrong.

### Journey 1 — First Install (Greenfield)

**Opening scene.** Hieu has just cloned a new project repo (e.g., `lumina-wiki` itself, or a side-project where he is collecting source material). The repo has a few PDFs in `raw/` he dragged in from email and Obsidian Web Clipper, but no structure. He opens the terminal at the repo root.

**Rising action.** He runs `npx lumina-wiki install`. An interactive prompt appears (Clack-style) and asks four questions:

1. Project name (defaults to the directory name).
2. IDE targets — multi-select: Claude Code, Codex, Cursor, Gemini CLI, Generic.
3. Packs — multi-select: `core` (locked on), `research`, `reading`.
4. Language pair — communication language (e.g., Vietnamese) and document output language (e.g., English).

**Climax.** The installer prints a tree of what it created: `.agents/`, `wiki/`, `raw/`, `lumina.config.yaml`, plus a list of symlinks created at the project root (`CLAUDE.md → .agents/schema/CLAUDE.md`, `AGENTS.md → ...`, `GEMINI.md → ...`) and inside `.claude/skills/lumi-*`. On Windows without Developer Mode, it prints a clearly-labelled fallback notice: which symlinks became junctions, which became copies, and how to fix it. Total wall-clock under 60 seconds.

**Resolution.** Hieu opens his IDE; the agent reads `CLAUDE.md` and instantly understands the schema. He invokes `/lumi-init` and the agent produces a first wave of `wiki/sources/*.md` from the existing `raw/` content. The wiki exists.

**Capabilities revealed.** Interactive prompt UX, four-question install flow, template engine (`lumina.config.yaml`, `CLAUDE.md`, scaffolded directories), pack-aware skill copy, cross-platform symlink/junction/copy strategy, manifest writer.

### Journey 2 — Daily Use

**Opening scene.** Hieu has read a paper this morning and saved the PDF to `raw/sources/`. The wiki already has ~15 sources and ~20 concepts from the past two weeks.

**Rising action.** In Claude Code he runs `/lumi-ingest raw/sources/2026-attention-revisited.pdf`. The agent reads the PDF, drafts `wiki/sources/attention-revisited.md`, identifies three new concepts and one existing concept, writes forward links from the source page to those concept pages, writes back-links from each concept page to the new source, updates `wiki/index.md`, and appends a single line to `wiki/log.md`. Later in the day he runs `/lumi-ask "Compare flash-attention variants across the last five sources"`. The agent reads existing concept pages and the relevant sources, drafts a synthesis, files it as `wiki/outputs/flash-attention-comparison.md`, and links the comparison from each source touched.

**Climax.** Friday afternoon he runs `/lumi-check`. The linter reports: 0 broken wikilinks, 2 orphans (pages with no inbound links — both legitimate `foundations/` pages, exempt), 1 missing reverse link in `concepts/positional-encoding`. He invokes `/lumi-edit` to fix the missing reverse link.

**Resolution.** The wiki visibly compounds — it has more pages, denser links, and answers Hieu can re-read next month without re-reading every source.

**Capabilities revealed.** Skill files conform to a contract the agent understands without instruction; bidirectional-link discipline is enforceable by lint; `wiki/index.md` is updated atomically with each ingest; `wiki/log.md` is append-only; `/lumi-check` produces actionable output classified by exemption rules from `lumina.config.yaml`.

### Journey 3 — Upgrade & Reinstall

**Opening scene.** Two weeks later, Lumina-Wiki releases v0.1.1: minor schema tweak in `CLAUDE.md` template, two skills updated, one new skill in pack `research`. Hieu sees the auto-update check on his next `lumina --version` run.

**Rising action.** He runs `npx lumina-wiki@latest install` in the same project directory. The installer reads `.agents/manifest.json`, recognizes this is an upgrade (not first install), and acts accordingly: it replaces files in `.agents/skills/` and `.agents/schema/`, refreshes any symlink that has gone stale, leaves `wiki/` and `raw/` untouched, and rewrites `manifest.json` with the new version and skill set.

**Climax.** Concurrent edge case: Hieu has a separate machine where he previously ran the install. He pulls the repo on that second machine, runs `npx lumina-wiki install`, and the installer reproduces the exact workspace shape from the committed `lumina.config.yaml` and `manifest.json` — same packs, same symlinks, same skill versions. No second interactive prompt.

**Resolution.** Upgrades are mechanical; multi-machine workflows work.

**Capabilities revealed.** Manifest-driven idempotent install / upgrade path; `.agents/` is replaced atomically while `wiki/` and `raw/` are protected; non-interactive reinstall mode that reads existing config; auto-update check via `npm view lumina-wiki@latest version`.

### Journey Requirements Summary

The three journeys collectively reveal the v0.1 capability set:

| Capability area | Driven by | Notes |
|---|---|---|
| Interactive installer (4 prompts) | J1 | Clack-based; defaults derived from cwd. |
| Template rendering (config + schema + scaffold) | J1 | Handlebars-style placeholders for project name, language pair, pack flags. |
| Pack-aware skill copy | J1, J3 | `core` locked; `research` + `reading` opt-in. |
| Cross-platform symlink with fallback | J1, J3 | Symlink → junction → copy ladder; logged to manifest. |
| Manifest writer / reader | J1, J3 | Source of truth for upgrade behavior and reproducibility. |
| Idempotent reinstall / upgrade | J3 | Replace `.agents/` only; never touch `wiki/` or `raw/`; refresh symlinks. |
| Reproducible reinstall from committed config | J3 | Non-interactive when `lumina.config.yaml` + `manifest.json` exist. |
| Skill contract recognized by agents | J2 | Skills conform to `.claude/skills/lumi-*` shape; SKILL.md + references/. |
| Bidirectional-link lint | J2 | `/lumi-check`; exemptions from `lumina.config.yaml`. |
| Atomic `wiki/index.md` and append-only `wiki/log.md` | J2 | Skills must always update both; lint surfaces violations. |
| Auto-update check | J3 | Modeled on BMAD `npm view ... version` pattern. |
| `lumina --version`, `--help`, `install`, `uninstall`; alias `lumi` | All | CLI surface for v0.1. |

No admin / support / API journey applies in v0.1: there are no remote services, no shared state, no second user. Those journeys re-enter consideration only if and when v0.2's MCP server or pack ecosystem ships.

## Domain-Specific Requirements

The domain is developer tooling — specifically, an npm-distributed CLI scaffolder that integrates with multiple LLM coding agents and writes into the user's project tree. There are no regulatory frameworks (no HIPAA / PCI / GDPR — the package collects no user data, makes no network calls beyond the npm registry's auto-update check, and runs entirely on the user's machine). Domain complexity is **medium**, driven by cross-platform packaging concerns rather than compliance.

### Compliance & Licensing

- **MIT license** for the entire Lumina-Wiki package. All code, schema, skills, and templates are original work authored for Lumina-Wiki.
- **No third-party code dependencies beyond declared npm packages.** Lumina-Wiki does not fork, vendor, or re-distribute code from OmegaWiki or any other project. OmegaWiki is studied as inspiration only; no skill files, schema fragments, or templates are copied.
- **No telemetry, no analytics, no remote logging** in v0.1. The only outbound network call permitted is the optional `npm view lumina-wiki@latest version` auto-update check, and it must be skippable via flag and environment variable.
- **No bundled binaries.** All dependencies resolve through the user's npm install; the package itself contains only JavaScript, templates, and the original skill content authored by Lumina-Wiki.

### Technical Constraints

- **Node ≥20, ESM-only.** No CommonJS interop layer; targets the runtime versions Claude Code, Codex, and Cursor users already have.
- **Cross-platform symlink support.** macOS / Linux: native symlinks. Windows: junction for directories; copy-with-warning for files when Developer Mode is off. Strategy applied per-target is recorded in `.agents/manifest.json` so upgrades behave consistently.
- **Idempotency invariants.** Re-running `lumina install` MUST: (a) replace `.agents/skills/` and `.agents/schema/` exactly to the new pack set, (b) refresh symlinks but preserve any user-edited files marked with the `<!-- user-edited -->` comment, (c) never read or write `wiki/` or `raw/`, (d) update `.agents/manifest.json` atomically (write to temp, fsync, rename).
- **Filesystem path safety.** All path joins go through Node's `path` module; no string concatenation. Workspace paths must reject any input containing `..` or absolute paths after normalization. The installer refuses to operate outside the user's chosen project root.
- **Encoding discipline.** All template output is UTF-8 with LF line endings, regardless of host OS, to avoid round-trip corruption when the user opens the wiki on a second machine.

### Integration Requirements

- **Claude Code** — entry points: `CLAUDE.md` at project root (rendered stub pointing to `README.md`), skill files at `.claude/skills/lumi-*/SKILL.md` (per-skill symlinks → `.agents/skills/<pack>/<skill>/`). Skills follow the SKILL.md + `references/` convention so the agent loads them on demand.
- **Codex** — entry point: `AGENTS.md` at project root (rendered stub pointing to `README.md`).
- **Cursor** — entry point: `.cursor/rules/lumina.mdc` (rendered stub pointing to `README.md`; refreshed on every install).
- **Gemini CLI** — entry point: `GEMINI.md` at project root (rendered stub pointing to `README.md`).
- **Generic agent** — entry point: `README.md` at project root; user wires their own agent's loader to it.
- **OmegaWiki** — inspiration only. A local read-only clone at `../OmegaWiki` informs design decisions; no runtime, build, or attribution dependency.

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Windows symlink fallback corrupts on later upgrade because the installer forgets a file became a copy | Manifest records per-target strategy (`symlink` / `junction` / `copy`); upgrade reads manifest and uses the same strategy unless user passes `--re-link`. |
| User edits a symlinked file and edits propagate everywhere unexpectedly | Schema files are documented as a single source of truth; `<!-- user-edited -->` markers preserve user customization across upgrades; `lumina --help` explains the symlink mental model. |
| OmegaWiki upstream changes direction | Irrelevant. Lumina-Wiki has no dependency on OmegaWiki — schema and skills are authored independently. |
| npm typo-squat or supply-chain attack surfaces a malicious `lumina-wiki` lookalike | We claim `lumina-wiki` early (already verified available), publish under `luutronghieu` npm account, and document the official package name + repo URL prominently in the README. No post-install scripts. |
| User's `wiki/` is silently overwritten by a botched upgrade | Idempotency tests in CI assert that `git diff` over `wiki/` and `raw/` is empty after every reinstall. |
| Auto-update check leaks usage data to npm registry | Auto-update is opt-out via `LUMINA_NO_UPDATE_CHECK=1` and a `--no-update` flag; documented in README. |

## Innovation & Novel Patterns

Lumina-Wiki is largely an excellent execution of existing concepts (Karpathy's LLM-Wiki pattern, BMAD's installer ergonomics, plus general bidirectional-link practice from the wider knowledge-base community as exemplified by OmegaWiki). One pattern is genuinely novel enough to call out, because it is the load-bearing design choice that makes everything else possible.

### Detected Innovation Areas

- **Single-source-of-truth schema and skills exposed under multiple agent conventions via symlink.** Existing tools that target multiple coding agents either ship duplicated config files (one for Claude, one for Cursor, etc., manually kept in sync) or pick a single agent and abandon the others. Lumina-Wiki keeps `.agents/schema/CLAUDE.md` as the only authored file, then projects it under each agent's expected entry point (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc`, `.claude/skills/lumi-*`). Edits propagate to all agents in a single write. Upgrades touch one location.
- **Bidirectional-link discipline elevated from convention to lint invariant**, with exemption globs declared in `lumina.config.yaml` instead of hardcoded into the linter. Most knowledge-base tools either don't enforce reverse links at all (Obsidian default) or hardcode the policy (Logseq). Treating bidirectionality as a contract with explicit exemption lists turns a soft norm into a verifiable build artifact.
- **Build artifact ↔ workspace artifact strict separation for an LLM-maintained wiki.** Comparable LLM-wiki tooling (e.g., OmegaWiki) treats the repo as the workspace, so upgrades require rebasing user content on upstream changes. Lumina ships `.agents/` (replaceable on every install), and treats `wiki/` and `raw/` as user data the installer is forbidden to read or modify. This pattern is standard in package managers but unusual in LLM-tooling-meets-personal-knowledge-base.

### Market Context & Competitive Landscape

- **OmegaWiki** (skyllwt/OmegaWiki, MIT) — closest comparable in the public landscape, studied as prior art only. Same Karpathy-inspired pattern; academic-paper bias; Claude-Code-only; repo-as-workspace. Lumina-Wiki authors its own schema and skills independently; no code or content is copied.
- **BMAD-METHOD** (bmad-code-org/BMAD-METHOD) — installer pattern reference. BMAD scaffolds methodology + agents into projects via `npx bmad-method install`; it does not target the knowledge-wiki use case. Lumina-Wiki adopts BMAD's installer ergonomics (Clack prompts, manifest-driven idempotency, `npm view` auto-update).
- **Obsidian / Logseq / Roam** — note-taking tools the user is familiar with. They are not LLM-maintained; the user does the writing. Lumina inverts that: the LLM writes, the user curates and asks.
- **RAG-over-folder tools** (Cursor's docs index, Claude Projects, etc.) — the dominant alternative pattern. They re-derive answers per query. Lumina compounds knowledge into a persistent artifact that survives across queries, sessions, and agents.

No directly comparable product ships the four-wedges combination (cross-platform installer + multi-IDE symlink + pack system + domain-agnostic core).

### Validation Approach

Innovation here is structural, not user-facing. Validation is correspondingly structural:

- **Symlink-projection works in practice.** CI smoke test: install on macOS / Linux / Windows, open the workspace in Claude Code, Codex, Cursor, and Gemini CLI in sequence, assert each agent reads the schema correctly via its native entry point. This is the only test that proves the multi-IDE wedge.
- **Bidirectional invariant is enforceable.** CI fixture: a known-broken wiki tree with seeded missing reverse links and orphans; assert `/lumi-check` flags exactly the seeded violations.
- **Build/workspace separation holds across upgrades.** CI test: install v0.1.0, manually edit `wiki/` and `raw/`, run `lumina install` for a hypothetical v0.1.1 against the same workspace, assert `git diff` over `wiki/` and `raw/` is empty.
- **Personal-use bar.** The author dogfoods the tool daily. Failure to clear the success criteria from §Success Criteria is the canonical failure signal. No external validation is sought in v0.1.

### Risk Mitigation

- **Symlink fallback on Windows might silently degrade the multi-IDE story** — mitigated by recording strategy in `manifest.json`, surfacing the fallback in installer output, and documenting Developer Mode prominently in the README.
- **Cursor `.mdc` format diverges from the schema** — mitigated by keeping Cursor's entry point as a generated file (not a symlink) and refreshing it on every install; if the format breaks, only that target degrades, not the rest.
- **Future agent (e.g., a new IDE) ships with a different entry-point convention** — mitigated by manifest extensibility: add a new IDE target via a config field, not a code change.
- **Bidirectional lint rules become unmaintainable as packs grow** — mitigated by keeping pack-specific rules in `.agents/schema/cross-reference-packs.md` (data, not code) and by capping `core` exemptions at three.

## CLI Tool Specific Requirements

The project type is best matched as `cli_tool` distributed via npm, with some `developer_tool` traits. This section captures the CLI-shaped concerns that the journey, domain, and innovation sections did not yet cover. Visual design, store compliance, and touch UX are explicitly skipped (not applicable).

### Project-Type Overview

Lumina-Wiki is an **interactive CLI scaffolder**: the primary command is `npx lumina-wiki install`, run once per project. There is no daemon, no background process, no long-running server. After the install command completes, the package's only further role is responding to `lumina --version` (auto-update check) and `lumina install` again (upgrade). Other planned commands (`status`, `lint`, `search`, `pack add/remove`) are deferred to v0.2.

### Command Structure (v0.1)

```
lumina <command> [options]
lumi <command> [options]    # alias
```

| Command | Purpose | Interactive? |
|---|---|---|
| `lumina install` | First-time scaffold or upgrade | Yes (4 prompts on first run; non-interactive on upgrade if config + manifest exist) |
| `lumina uninstall` | Remove `.agents/`, symlinks, and config; preserve `wiki/` and `raw/` | Yes (confirmation prompt; warns about `wiki/` retention) |
| `lumina --version`, `-v` | Print installed version; perform auto-update check (skippable) | No |
| `lumina --help`, `-h` | Print usage and command list | No |

**Flags applicable across commands**:
- `--no-update` — skip the npm registry version check.
- `--yes`, `-y` — accept all defaults; non-interactive install (CI use).
- `--cwd <path>` — operate against a different project root than current directory.
- `--re-link` — force-recompute symlink/junction/copy strategy from current platform capabilities (ignores manifest's prior choice).

### Output Formats

- **Human-readable stdout** is the default. Renders with `picocolors` (no ANSI when stdout is not a TTY). Conventions: status lines prefixed `✔`, warnings `⚠`, errors `✖`. Tree output for created files; tabular output for symlink/manifest summaries.
- **Manifest JSON** — `.agents/manifest.json` is the machine-readable output. Schema: package version installed, ISO timestamp, list of installed packs, per-target symlink strategy (`symlink` / `junction` / `copy`), checksums of schema and skill files for integrity check on next upgrade.
- **No JSON-on-stdout mode in v0.1.** If scripting consumers ask for it later, add `--json` flag in v0.2.

### Config Schema

The user-facing config is `lumina.config.yaml`, written by the installer from the four interactive prompts and editable by hand thereafter. Schema (already drafted in `docs/planning-artifacts/lumina-wiki-config-schema.yaml`) covers:

- `identity` — project_name, repo URL.
- `languages` — communication_language, document_output_language.
- `ide_targets` — list of: `claude_code`, `codex`, `cursor`, `gemini_cli`, `generic`.
- `packs` — installed pack list (`core` always present; `research`, `reading` optional; no `personal`).
- `paths` — overrides for `.agents/`, `wiki/`, `raw/` locations (defaults at project root).
- `wiki.link_syntax` — `obsidian` (only supported value in v0.1).
- `wiki.slug_style` — `kebab-case`.
- `wiki.bidirectional_links.mode` — `strict` / `exempt-only` (default) / `off`.
- `wiki.bidirectional_links.exemptions` — glob list (default: `foundations/**`, `outputs/**`, `*://*`).
- `wiki.graph.edge_types_core` — fixed list, packs may extend.

The installer never re-prompts for fields already present in `lumina.config.yaml`; it only fills missing ones. This makes upgrade flows non-interactive when the config is committed.

### Scripting Support

- `--yes` / non-interactive install for CI and reproducible environments.
- Exit codes: `0` success, `1` user error (bad flag, missing prereq), `2` filesystem error (permission denied, target outside cwd), `3` upgrade incompatibility (manifest references a pack no longer shipped). Documented in `lumina --help`.
- No shell completion in v0.1.

### Package Layout & Distribution

```
lumina-wiki/
├── bin/
│   └── lumina.js              # entrypoint shared by `lumina` and `lumi` aliases
├── src/
│   ├── installer/
│   │   ├── commands/          # install.js, uninstall.js, version.js
│   │   ├── prompts.js         # @clack/prompts wrapper
│   │   ├── fs.js              # symlink / junction / copy ladder
│   │   └── manifest.js        # read/write .agents/manifest.json
│   └── templates/
│       ├── schema/            # CLAUDE.md template (Handlebars-style)
│       ├── skills/
│       │   ├── core/          # always installed
│       │   └── packs/
│       │       ├── research/  # original Lumina-Wiki research skills
│       │       └── reading/
│       ├── workspace/         # wiki/ and raw/ scaffolds
│       └── config/            # lumina.config.yaml template, .gitignore
├── package.json
├── README.md
├── LICENSE                    # MIT
└── .github/workflows/ci.yml   # macOS / Linux / Windows matrix
```

Package contents shipped to npm registry (per `package.json` `files` field): `bin/`, `src/`, `README.md`, `LICENSE`. Test files, fixtures, and CI config are excluded.

### Language & Runtime Matrix

- **Runtime:** Node ≥20.0.0 (declared in `engines`). ESM only.
- **Tested on:** Node 20 LTS and Node 22 LTS, on macOS 13+, Ubuntu 22.04+, Windows 11. CI matrix covers all six combinations.
- **No transpile step** in v0.1 — the package ships JS source directly. This keeps install fast (`npx` cold-start under a second) and the diff-on-publish small.

### Dependencies

Direct runtime dependencies, modeled on BMAD's installer:

- `commander` — CLI argument parsing.
- `@clack/prompts` — interactive prompt UX (multi-select, text, confirm).
- `js-yaml` — read/write `lumina.config.yaml`.
- `picocolors` — TTY-aware coloring (smaller than `chalk`).
- `glob` — template file discovery.

No dev-time-only postinstall scripts. No native modules. No optional dependencies. Total dependency tree audited for license compatibility (MIT / ISC / Apache-2.0 only).

### Documentation & Examples (v0.1)

- `README.md` — installation, the four prompts, what gets created, multi-IDE notes, Windows fallback notes. May credit Karpathy's LLM-Wiki post and mention OmegaWiki as inspiration, but makes no derivation claim.
- `LICENSE` — MIT.
- No separate docs site in v0.1. The schema file (`CLAUDE.md`) is itself the main reference for end users; once installed, `cat CLAUDE.md` answers most usage questions.
- Example workspace: a hidden `__example__` flag (`lumina install --example`) is **out of scope for v0.1** but noted for v0.2.

### Implementation Considerations

- **First user is the author.** Skill content correctness and schema clarity matter more than installer ergonomics for users-who-aren't-the-author. If install UX has rough edges that the author can live with, ship anyway.
- **Idempotency is tested every CI run** — see Technical Constraints. This is the single most important non-negotiable.
- **Skill curation discipline.** Authoring `research` and `reading` skills means choosing what each pack actually needs. The pack should fit on one screen of `ls`. If it grows past 12 skills, split it.
- **Schema is API.** `CLAUDE.md` is the contract between the user's wiki and any LLM agent. Breaking changes to it are major-version events. Additive changes (new optional sections, new skill types) are minor.

## Project Scoping & Phased Development

The product brief already commits to phased delivery (v0.1 MVP Tier A → v0.2 Growth → 12-month Vision). The §Product Scope section above enumerates the feature lists per phase. This section adds the strategy, prioritization rationale, and risk-based reasoning that justify those boundaries.

### MVP Strategy & Philosophy

**Approach: problem-solving MVP, optimized for one user.** The minimum that makes Lumina-Wiki "useful" is the ability to scaffold a working wiki workspace into a project and have any of four LLM agents read it correctly via that agent's expected entry-point convention. Everything else — runtime CLI commands, MCP server, third-party packs — is post-MVP because it can be added without changing the workspace shape v0.1 produces.

**Validated learning loop**: ship → author dogfoods daily for four weeks → author reviews `wiki/log.md` and the §Success Criteria metrics → decide whether to commit to v0.2 or rework v0.1. There is no external feedback loop; the author is the entire jury.

**Resource requirements (MVP):** one person (the author), part-time, with Claude Code as the primary build agent. No external contributors planned for v0.1. Rough estimate: 30–50 focused hours from greenfield to MIT publish-ready npm package.

### MVP Feature Boundaries (v0.1.0, Tier A)

Re-stating the §Product Scope MVP set as a strategic capability inventory, in priority order. Each item is justified against the question *"without this, does v0.1 fail to clear the personal-use bar?"*

1. **Interactive `npx lumina-wiki install` with four prompts** — without it, there is no install path. **Must.**
2. **Workspace scaffold** (`.agents/`, `wiki/`, `raw/`, `lumina.config.yaml`, `.gitignore`) — without it, the wiki has no place to live. **Must.**
3. **`core` skill copy + `CLAUDE.md` schema render** — without it, the LLM has no contract. **Must.**
4. **Symlink ladder for multi-IDE entry points** (symlink → junction → copy fallback, recorded in manifest) — without it, the multi-IDE wedge collapses to "Claude Code only", erasing a primary differentiator. **Must.**
5. **`research` and `reading` opt-in pack install** — without `research`, the author cannot dogfood paper-reading workflows. **Must (research); should (reading).**
6. **Idempotent `lumina install` on second run** (replace `.agents/`; never touch `wiki/` or `raw/`) — without it, upgrades destroy user data. **Must.**
7. **`lumina --version` / `--help` / `uninstall`** — minimum well-behaved CLI surface. **Must.**
8. **Cross-platform CI matrix (macOS / Linux / Windows)** — without it, claims that Windows works are unverifiable. **Must.**
9. **README, LICENSE (MIT)** — npm publish basics. **Must.**

**Explicitly NOT in v0.1, with rationale**:

- Runtime CLI commands (`status`, `lint`, `search`, `pack add/remove`) — these belong to a daemon-shaped tool, not a scaffolder. Defer to v0.2.
- MCP server — adds a network protocol surface; v0.1 stays installer-only to keep the security and surface-area story simple.
- `qmd` integration / Marp / Dataview shims — nice-to-have polish; user has not yet hit the friction these solve.
- `daily-arxiv` GitHub Actions workflow template — pack files reference it but no template ships in v0.1.
- Browser/UI; collaboration; mobile.

### Post-MVP Phases (Confirmation of Brief)

- **v0.2 (Growth):** runtime CLI commands, bundled MCP server, GHA cron template, `qmd` / Marp / Dataview integrations, installer UI i18n. Triggered only after the §Success Criteria personal-use bar is met.
- **12-month Vision:** third-party pack ecosystem (`lumina pack add @vendor/pack-name`), optional collaboration mode, browser surface. Strictly speculative until v0.2 ships and proves the core compounds.

### Risk-Based Scoping Decisions

**Technical risks**

- *Cross-platform symlink correctness on Windows.* Riskiest assumption: that the symlink/junction/copy fallback ladder works for every entry point. Mitigation: CI matrix from day one; manifest records strategy per-target; explicit Developer Mode guidance in README. If the fallback path proves unreliable in practice, the v0.1 scope contracts to "Claude Code only on Windows" with a documented warning, rather than shipping a broken multi-IDE story.
- *Skill design correctness for the `research` and `reading` packs.* Riskiest assumption: that originally-authored skills behave well under real-world inputs (papers of varied formats, books with varied chapter structures). Mitigation: each skill is run end-to-end against a representative source during install validation; skills that fail are dropped from v0.1 rather than shipped half-working.
- *Schema design lock-in.* `CLAUDE.md` is the API; getting it wrong forces a 1.0-major bump later. Mitigation: schema is a versioned file (`schemaVersion: 1`); `lumina --version` cross-checks workspace schema vs package schema and refuses dangerous upgrades.

**Adoption / "market" risks** (treating "market" as the author's own habits)

- *Author abandons the tool after week two.* Mitigation: friction-reduce ingest path (single-command, no setup overhead). If `/lumi-ingest` requires more than one command per source, the loop won't compound.
- *Wiki produces low-signal pages, eroding trust.* Mitigation: the §Constraints in `CLAUDE.md` template forbid silent overwrites and require citation for low-confidence claims; `/lumi-check` surfaces orphan and stale pages.

**Resource risks**

- *Build effort blows past 50 hours.* Mitigation: ruthless v0.1 cuts. The ten-step §Open Questions list (next step) is explicitly a deferral instrument — anything not blocking install ships in v0.2.
- *Author's other projects compete for time.* Mitigation: small enough that a one-week sprint clears it; if it doesn't, the scope is wrong, not the schedule.

### Scope Confirmation

All items in v0.1 are explicitly user-affirmed (author confirmed during brief and PRD discovery). No requirement from the brief has been silently dropped. The two open decisions resolved during PRD Step 2 (`wiki/index.md` empty-seed; pack-research Python install deferred) are documented in §Project Classification and §Product Scope.

## Functional Requirements

This is the binding capability contract for v0.1. Any capability not listed here will not exist in v0.1. Each FR is testable, implementation-agnostic, and traces back to discovery. Actors: **User** (the person at the terminal), **Installer** (the `lumina` CLI process), **Agent** (the LLM coding tool consuming the wiki — Claude Code, Codex, Cursor, Gemini CLI, or generic).

### Installation & Bootstrapping

- **FR1:** User can run `npx lumina-wiki install` from any directory and have the Installer treat that directory as the project root.
- **FR2:** User can override the project root with `--cwd <path>`.
- **FR3:** Installer can collect four pieces of configuration from the User interactively: project name, IDE targets (multi-select), packs (multi-select; `core` always selected), language pair (communication + document output).
- **FR4:** Installer can render `_lumina/config/lumina.config.yaml` from the four collected inputs.
- **FR5:** Installer can scaffold the directory tree `_lumina/{config,schema,scripts,tools,_state}`, `.agents/skills/`, `wiki/{sources,concepts,people,summary,outputs,graph,index.md,log.md}`, `raw/{sources,notes,assets,tmp}` at the project root.
- **FR6:** Installer can copy the `core` skill set into `.agents/skills/core/` on every install.
- **FR7:** Installer can optionally copy the `research` and `reading` packs into `.agents/skills/packs/` based on the User's pack selection.
- **FR8:** Installer can render `README.md` at the project root from the schema template with project- and language-specific values substituted. If `README.md` already exists, the Installer prompts the User to (a) merge the schema content between `<!-- lumina:schema -->` ... `<!-- /lumina:schema -->` markers, (b) back up the existing file to `README.md.bak` and replace, or (c) abort. The schema content within markers is the only region the Installer touches on subsequent upgrades.
- **FR8a:** Installer can copy Node engine scripts (`wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`) into `_lumina/scripts/` and deeper schema reference docs (`page-templates.md`, `cross-reference-packs.md`, `graph-packs.md`) into `_lumina/schema/` on every install. When the `research` pack is selected, Installer can additionally copy Python tools into `_lumina/tools/`. Pack-specific reference doc fragments are appended to `cross-reference-packs.md` and `graph-packs.md` only when the corresponding pack is installed.
- **FR9:** Installer can render small stub files (~5–10 lines each) at each User-selected IDE target's expected entry point: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex), `GEMINI.md` (Gemini CLI), `.cursor/rules/lumina.mdc` (Cursor). Each stub instructs its agent to read `README.md` for project context and wiki schema. **Stubs are independent rendered files, never symlinks.**
- **FR10:** Installer can create per-skill symlinks under `.claude/skills/lumi-*` pointing into `.agents/skills/<pack>/<skill>/` for each installed skill when Claude Code is a selected IDE target. These per-skill symlinks are the only filesystem-link surface.
- **FR11:** Installer can detect symlink capability on the host platform for the per-skill symlinks under `.claude/skills/`, and fall back to junction (Windows directory link) or copy (Windows when Developer Mode is off) per skill. The fallback choice is recorded in `_lumina/manifest.json`. Schema entry-point files (`README.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc`) are plain rendered files and have no fallback concern.
- **FR12:** Installer can write `_lumina/manifest.json` capturing package version, ISO timestamp, installed packs, per-skill link strategy, and per-file checksums for stubs and schema regions.
- **FR13:** Installer can bundle a `.gitignore` template at the project root that ignores `_lumina/_state/` and `raw/tmp/` when no `.gitignore` already exists; otherwise leave the existing file alone.
- **FR14:** User can run install non-interactively with `--yes` / `-y`, accepting all defaults.

### Upgrade & Reinstallation

- **FR15:** Installer can detect on second run that `_lumina/manifest.json` exists and treat the run as an upgrade, reading the manifest for prior decisions.
- **FR16:** Installer can replace files in `.agents/skills/`, `_lumina/schema/`, `_lumina/scripts/`, and `_lumina/tools/` (when research pack is installed) exactly to the current pack set without prompting the User. The Installer rewrites only the schema region of `README.md` (between `<!-- lumina:schema -->` markers), preserving any User content outside the markers byte-for-byte. Stub files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc`) are regenerated from template on every upgrade.
- **FR17:** Installer can refresh per-skill symlinks under `.claude/skills/lumi-*` on every upgrade and rewrite stub files in place when their template content has changed.
- **FR18:** Installer must not read or modify any file under `wiki/`, `raw/`, or `_lumina/_state/` during install or upgrade. Verifiable by `git diff` over `wiki/` and `raw/` being empty.
- **FR19:** Installer can preserve User customizations to schema files marked with the `<!-- user-edited -->` comment by appending updates to a new section rather than overwriting.
- **FR20:** Installer can run with `--re-link` to recompute the symlink/junction/copy strategy from current platform capabilities, ignoring the manifest's prior choice.
- **FR21:** Installer can produce a fresh workspace with the same shape (same packs, same symlinks, same skill versions) on a second machine when `_lumina/config/lumina.config.yaml` and `_lumina/manifest.json` are committed and present, without re-prompting.

### CLI Surface

- **FR22:** User can invoke the CLI as either `lumina` or `lumi` (alias) with identical behavior.
- **FR23:** User can run `lumina --version` (or `-v`) and receive the installed package version on stdout.
- **FR24:** User can run `lumina --help` (or `-h`) and receive usage and command list on stdout.
- **FR25:** User can run `lumina uninstall` to remove `_lumina/`, `.agents/`, the rendered stub files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), and `.cursor/rules/lumina.mdc`. The Installer offers two `README.md` paths: (a) keep `README.md` intact (default; Lumina-managed schema region remains as plain markdown), or (b) strip the `<!-- lumina:schema -->` region and leave the User's surrounding content. The Installer must prompt for confirmation and must preserve `wiki/`, `raw/`, and any User-authored content.
- **FR26:** Installer can perform an auto-update check via `npm view lumina-wiki@latest version` on `--version` invocation and surface a single-line notice when a newer version exists.
- **FR27:** User can suppress the auto-update check via `LUMINA_NO_UPDATE_CHECK=1` environment variable or `--no-update` flag.
- **FR28:** Installer can exit with documented exit codes: `0` success, `1` user error, `2` filesystem error, `3` upgrade incompatibility.

### Wiki Schema Contract

- **FR29:** Installer can produce a `CLAUDE.md` schema that defines four core page types — Source, Concept, Person, Summary — with directory mappings and section structure documented inline.
- **FR30:** Installer can include pack-specific page-type sections in `CLAUDE.md` (research: topics, foundations, ideas, claims, experiments; reading: chapters, characters, themes) only when the corresponding pack is installed.
- **FR31:** Installer can render `lumina.config.yaml` with bidirectional-link mode set to `exempt-only` by default and exemption globs `foundations/**`, `outputs/**`, `*://*` documented and editable.
- **FR32:** Installer can record `wiki.link_syntax: obsidian` and `wiki.slug_style: kebab-case` in the rendered config.
- **FR33:** Installer can produce an empty `wiki/index.md` (catalog placeholder) and empty `wiki/log.md` (append-only activity log placeholder) on first install.

### Skill Surface (Authored Content Shipped)

The Installer ships skill content; the Agent executes it. These FRs describe what skill files must exist, not what the LLM does with them.

- **FR34:** Installer can ship six `core` skills: `/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`. Each skill is a directory with a `SKILL.md` and optional `references/`.
- **FR35:** Installer can ship the `research` pack containing **four** originally-authored skills covering the research-assistant workflow: `/lumi-discover` (ranked candidate shortlist), `/lumi-survey` (narrative synthesis from claim graph), `/lumi-prefill` (seed `foundations/` to prevent concept duplication on ingest), `/lumi-setup` (interactive API-key configuration). Skill names are inspired by prior art; contents are written for Lumina-Wiki. v0.1 explicitly does **not** ship cross-model review skills (`/novelty`, `/review`, `/refine`), the LaTeX paper pipeline (`/paper-plan`, `/paper-draft`, `/paper-compile`, `/rebuttal`), the experiment cluster (`/exp-design`, `/exp-run`, `/exp-status`, `/exp-eval`), the orchestrator (`/research`), `/ideate`, or `/daily-arxiv`. None of these depend on infrastructure (cross-model review LLM, remote GPU runner, LaTeX toolchain) that v0.1 commits to ship.
- **FR36:** Installer can ship the `reading` pack containing four skills: `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`.
- **FR37:** Installer can ship Python helper scripts into `_lumina/tools/` when the `research` pack is selected. The v0.1 set is: `_env.py` (dotenv loader), `discover.py` (candidate ranking), `init_discovery.py` (multi-phase fetch with checkpoint manifest), `prepare_source.py` (normalize local PDF/tex into ingest-ready package), and four optional fetcher plugins (`fetch_arxiv.py`, `fetch_wikipedia.py`, `fetch_s2.py`, `fetch_deepxiv.py`) — each fetcher activates only when the user provides its API key via `/lumi-setup`. The Installer does not create a Python virtual environment in v0.1; pip-install of `requirements.txt` is deferred to the first invocation of a Python-needing skill. v0.1 does not ship `remote.py` (no remote experiment runner) or output-side LaTeX preparation tools.

### Multi-IDE Integration

- **FR38:** Agent can find the canonical project schema by following its native expected entry point (`CLAUDE.md` for Claude Code; `AGENTS.md` for Codex; `GEMINI.md` for Gemini CLI; `.cursor/rules/lumina.mdc` for Cursor; `README.md` directly for `generic`). Each IDE-specific stub redirects to `README.md` in its first lines, where the canonical schema lives.
- **FR39:** All schema content lives in a single file (`README.md` at project root). A User edit between `<!-- lumina:schema -->` markers persists across upgrades only if the User adds a `<!-- user-edited -->` marker on the changed line; otherwise the schema region is rewritten on upgrade. Edits outside the markers are always preserved.
- **FR40:** User can re-run `lumina install` to add a new IDE target to an existing workspace; the Installer creates the new entry point without disturbing existing ones.

### Reporting & User Feedback

- **FR41:** Installer can print a tree summary on stdout listing every directory created and every entry point linked, with TTY-aware coloring (none when stdout is not a TTY).
- **FR42:** Installer can clearly label each per-target link strategy in its output (`symlink` / `junction` / `copy`), and surface a prominent warning when fallback to copy occurs on Windows, with a one-line pointer to enable Developer Mode.
- **FR43:** Installer can produce `picocolors`-styled status lines using the conventions `✔` (success), `⚠` (warning), `✖` (error).

### Project Hygiene

- **FR44:** The package can be installed from npm under the name `lumina-wiki` and exposes both `lumina` and `lumi` bin entries.
- **FR45:** The package ships `README.md` and `LICENSE` (MIT) at its root, included in the npm tarball.
- **FR46:** A CI matrix can run lint and a smoke install on macOS, Linux, and Windows for every pull request.
- **FR47:** A CI test can verify that re-running `lumina install` against an existing workspace leaves `wiki/` and `raw/` byte-identical (idempotency guarantee).

## Non-Functional Requirements

Only categories that meaningfully apply to a single-user CLI scaffolder run on the User's local machine are listed. Scalability and accessibility are explicitly out of scope (no server, no UI). Classic auth/security is out of scope (no credentials, no networking beyond the optional npm registry version check).

### Performance

- **NFR-P1:** `npx lumina-wiki install` completes a fresh install (with `core` + `research` + `reading` packs and four IDE targets) in **under 60 seconds** on a typical laptop (≥8 GB RAM, SSD), measured wall-clock from npm cold cache. CI verifies on macOS, Linux, and Windows runners.
- **NFR-P2:** `lumina --version` (without `--no-update`) returns in **under 2 seconds** under normal network conditions, including the npm registry version check. The check is bounded by a 2-second hard timeout; on timeout the version prints without the update notice and exits 0.
- **NFR-P3:** `lumina install` upgrade path (re-run with existing manifest) completes in **under 10 seconds** when no schema or skill content has changed (no-op upgrade).
- **NFR-P4:** CLI cold start (parse args + dispatch) is under **300 ms** measured from process spawn to first user-visible output.

### Reliability & Data Safety

- **NFR-R1:** Re-running `lumina install` against any prior version's workspace must leave `wiki/` and `raw/` **byte-identical** (asserted by `git diff` in CI). This invariant has zero tolerance.
- **NFR-R2:** `.agents/manifest.json` writes use the temp-file + fsync + rename pattern. A crash mid-install must leave either the prior manifest intact or the new manifest fully written, never a torn JSON.
- **NFR-R3:** Symlink/junction/copy operations are transactional per-target: a failure on one target reverses any partial state for that target before exiting with code 2. Already-completed targets stand.
- **NFR-R4:** `lumina uninstall` must require an explicit confirmation prompt (suppressed only by `--yes`) and must never remove `wiki/`, `raw/`, or any User-authored content.
- **NFR-R5:** All template renders are atomic per-file: write to `<file>.tmp`, fsync, rename. No partially-rendered files visible to a concurrent reader.

### Compatibility

- **NFR-C1:** Supported runtimes: Node 20 LTS, Node 22 LTS. CI tests both.
- **NFR-C2:** Supported host OS: macOS 13+, Ubuntu 22.04+, Windows 11. CI matrix runs on all three.
- **NFR-C3:** On Windows without Developer Mode, the Installer must complete successfully via the junction/copy fallback ladder, with no manual intervention required from the User. The fallback degradation is logged in the manifest and surfaced once in stdout.
- **NFR-C4:** Output is encoded UTF-8 with LF line endings on every platform. Files round-trip through `git` with `core.autocrlf=false` without modification.
- **NFR-C5:** No native modules in the dependency tree. The package installs without invoking `node-gyp` or compiling C/C++.

### Maintainability

- **NFR-M1:** The package's source tree is under **3,000 lines of original JavaScript** in v0.1, excluding template content and skill files. (Soft cap; intent is to keep the installer auditable in one sitting.)
- **NFR-M2:** All shipped content (schema, skills, templates, scripts) is original work authored for Lumina-Wiki. No third-party content is bundled, fork-vendored, or re-distributed.
- **NFR-M3:** Schema files carry a `schemaVersion` field. The Installer cross-checks workspace `schemaVersion` against the package's expected version and refuses upgrades across major-version gaps without a `--force` flag.
- **NFR-M4:** Pack-specific lint rules and edge-type vocabularies live in data files (`.agents/schema/cross-reference-packs.md`, `.agents/schema/graph-packs.md`), not in code. Adding a pack requires no installer code changes.

### Privacy

- **NFR-Pr1:** The package emits **zero telemetry**. No metrics endpoint, no analytics SDK, no remote logging, no install-time phone-home.
- **NFR-Pr2:** The only outbound network call is the optional `npm view lumina-wiki@latest version` check, performed only on `lumina --version`, suppressible by `--no-update` flag or `LUMINA_NO_UPDATE_CHECK=1` environment variable, and bounded by a 2-second timeout (NFR-P2).
- **NFR-Pr3:** No post-install npm scripts. No automatic execution of any User-authored content during install.
- **NFR-Pr4:** No data leaves the User's machine outside the version check. The `wiki/` content is purely local; any future cloud sync is a v0.2+ concern documented as out of scope.

### Usability

- **NFR-U1:** The four-prompt install flow has typed defaults derived from the project directory and host platform. Pressing Enter on every prompt completes a working install.
- **NFR-U2:** Error messages on filesystem failures (permission denied, target outside cwd, conflicting existing file) name the offending path and the corrective action in plain text. No raw stack traces in normal operation.
- **NFR-U3:** Color output respects `NO_COLOR` environment variable and detects non-TTY stdout (e.g., piped output) automatically.
- **NFR-U4:** `lumina --help` fits in **under 50 lines** of stdout and lists every command, flag, and exit code.
