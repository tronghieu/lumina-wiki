---
stepsCompleted: [1, 2]
inputDocuments:
  - docs/planning-artifacts/prd.md
  - docs/planning-artifacts/product-brief.md
  - docs/planning-artifacts/lumina-wiki-readme-template.md
  - docs/planning-artifacts/lumina-wiki-config-schema.yaml
  - docs/planning-artifacts/lumina-wiki-package-stub.json
  - docs/planning-artifacts/lumina-wiki-bin-stub.js
workflowType: 'architecture'
project_name: 'LuminaWiki'
user_name: 'Lưu Hiếu'
date: '2026-05-01'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (47 total, 8 groups):**
- Installation & Bootstrapping (FR1–FR14): interactive prompt UX, template rendering, workspace scaffold, pack-aware skill copy, manifest writer, symlink/junction/copy ladder, `--yes` non-interactive mode.
- Upgrade & Reinstallation (FR15–FR21): manifest-driven idempotent upgrade; `wiki/` + `raw/` immutable; `<!-- user-edited -->` preservation; reproducible reinstall on a second machine from committed config.
- CLI Surface (FR22–FR28): `lumina` + `lumi` alias; `--version` with bounded auto-update check; `--help`; `uninstall` with confirmation; documented exit codes.
- Wiki Schema Contract (FR29–FR33): 4 core page types (Source/Concept/Person/Summary); pack-specific page types; bidirectional `exempt-only` mode default; empty `wiki/index.md` + `wiki/log.md` seed.
- Skill Surface (FR34–FR37): 6 core skills, originally-authored research pack, 4-skill reading pack, opt-in Python helpers (setup deferred to first invocation).
- Multi-IDE Integration (FR38–FR40): per-IDE entry-point projection; single source-of-truth schema.
- Reporting (FR41–FR43): tree summary, per-target strategy labels, `picocolors` ✔/⚠/✖ conventions.
- Project Hygiene (FR44–FR47): npm publish basics + cross-platform CI matrix + idempotency byte-diff test.

**Non-Functional Requirements (21 total, 6 groups):**
- **Performance:** install < 60s; cold-start < 300ms; `--version` < 2s with 2s hard timeout; no-op upgrade < 10s.
- **Reliability:** zero-tolerance idempotency invariant (`git diff` empty over `wiki/`/`raw/`); atomic temp+fsync+rename for every file write; transactional per-target rollback on link failure.
- **Compatibility:** Node 20/22 LTS × {macOS, Linux, Windows} = 6-cell CI matrix; UTF-8/LF; no native modules in dependency tree.
- **Maintainability:** ≤3,000 LoC original JS (soft cap); schemaVersion guard for breaking-change refusal; pack rules in data files, not code; **all shipped content originally authored**.
- **Privacy:** zero telemetry; sole network call is opt-out npm registry version check, 2s timeout; no postinstall scripts.
- **Usability:** Enter-through default install; plain-text errors naming the offending path; `NO_COLOR` honored; `--help` ≤ 50 lines.

**Scale & Complexity:**
- Project complexity: **Medium**. Driven by cross-platform packaging concerns (Windows symlink fallback ladder, Developer-Mode detection), not by compliance or scale.
- Primary domain: **CLI tool / npm scaffolder for LLM-agent infrastructure**.
- Architectural component count (rough): ~6 installer modules (commands, prompts, fs ladder, manifest, template engine, update-check) plus a template tree and a Node-side wiki engine consumed by skills.

### Technical Constraints & Dependencies

- **Runtime:** Node ≥20, ESM-only. No transpile step.
- **Direct deps (BMAD-modeled):** `commander`, `@clack/prompts`, `js-yaml`, `picocolors`, `glob`. License audit: MIT/ISC/Apache-2.0 only. No native modules.
- **Filesystem safety:** path joins via `node:path`; reject `..` and absolute traversal; refuse to operate outside the chosen project root.
- **Atomicity discipline:** every file write is temp + fsync + rename; manifest writes resist torn JSON under crash.
- **OmegaWiki:** read-only local clone at `../OmegaWiki` for design study only — no runtime, build, or attribution dependency. All schema, skills, and templates are originally authored.

### Cross-Cutting Concerns Identified

1. **Cross-platform symlink semantics** (NFR-C2/C3, FR11) — touches install, upgrade, reporting, manifest, uninstall. Single most-pervasive concern.
2. **Idempotency invariant** (NFR-R1, FR18, FR47) — install, upgrade, manifest, uninstall, CI. Zero-tolerance contract.
3. **Atomic file writes** (NFR-R2/R5) — every template render path. Common helper required.
4. **Manifest as state-of-truth** (FR12/15/20) — read by upgrade, written by install, consulted by `--re-link`, validated by `--version` upgrade-incompat check.
5. **Schema/skill template projection** (FR8/9/29/30/38/39) — single-rooted source projects to multi-IDE entry points.
6. **TTY-aware output** (FR41/43, NFR-U3) — every command's stdout respects TTY + `NO_COLOR`.
7. **Graceful degradation on Windows** (FR11/42, NFR-C3) — fallback ladder visible, recorded, reversible with `--re-link`.
8. **Auto-update polite-call** (FR26/27, NFR-Pr2) — opt-out, timeout-bounded, never blocks the `--version` UX.

### Architectural Implications

- **Daemonless** — no server, no long-running process. State lives entirely on disk (manifest + config + workspace).
- **Two-layer skill-tool split** — skills are markdown agent prompts; tools are Node/Python scripts the agent invokes via Bash + JSON. Graph-mutation logic does not live in skill prompts.
- **Template engine** — Handlebars-style placeholders + conditional pack blocks suffice; no full DSL needed.
- **Filesystem layer is the riskiest module** — symlink ladder, atomic writes, idempotency tests all converge on `src/installer/fs.js`.
- **Schema is API** — `CLAUDE.md` template breaking changes are major-version events. SemVer discipline matters.
- **Test surface is dominated by CI integration tests** — install → reinstall → diff is the canonical assertion. Unit tests cover the symlink ladder dispatcher and the manifest reader/writer.

### Workspace Layout (BMAD-style sidecar)

This is the canonical workspace layout the installer produces. Two top-level framework directories carry distinct ownership:

- **`README.md`** at project root — canonical agent-context file. Schema, conventions, skill list, project overview, all in one rendered markdown file. NOT a symlink. Freely editable by the user; installer touches only the region between `<!-- lumina:schema -->` ... `<!-- /lumina:schema -->` markers on upgrade.
- **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`** at project root — small rendered stub files (~5–10 lines each), one per IDE target, each instructing its agent to read `README.md` first. NOT symlinks. Plain copies.
- **`.cursor/rules/lumina.mdc`** — same stub pattern, rendered into the user's `.cursor/`.
- **`_lumina/`** — installer-managed sidecar. Holds `config/`, `schema/` (deeper reference docs: `page-templates.md`, `cross-reference-packs.md`, `graph-packs.md` — agent reads them on demand when README.md tells it to), `scripts/` (Node engine: `wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`), `tools/` (Python research-pack utilities), `_state/` (gitignored checkpoints), `manifest.json`. **`_lumina/schema/` does NOT contain `CLAUDE.md`** — the canonical entry point is `README.md` at the project root.
- **`.agents/`** — agent-invokable surface. Contains **only** `skills/` (`skills/core/`, `skills/packs/research/`, `skills/packs/reading/`). No engine code, no schema, no manifest.

```
<project-root>/
├── README.md                      ← canonical schema (rendered, freely editable)
├── CLAUDE.md / AGENTS.md / GEMINI.md  ← rendered stubs pointing to README.md (NOT symlinks)
├── .cursor/rules/lumina.mdc       ← rendered stub pointing to README.md
├── _lumina/                       ← installer-managed sidecar
│   ├── config/lumina.config.yaml
│   ├── schema/                    ← deeper reference docs (page-templates, packs)
│   │   ├── page-templates.md
│   │   ├── cross-reference-packs.md
│   │   └── graph-packs.md
│   ├── scripts/                   ← Node engine (core)
│   ├── tools/                     ← Python tools (research pack only)
│   ├── _state/                    ← gitignored
│   └── manifest.json
├── .agents/skills/                ← skills only (core + opt-in packs)
├── .claude/skills/lumi-*          ← per-skill symlinks → .agents/skills/<pack>/<skill>/
├── wiki/                          ← LLM-maintained
└── raw/                           ← user-owned, immutable
```

This split mirrors BMAD-METHOD's `_bmad/` sidecar pattern with one important variation: schema is NOT a symlinked file. Conceptual cleanliness: `.agents/` answers "what does the LLM invoke"; `_lumina/` answers "what does the installer manage"; `README.md` answers "what is this project about and how does the wiki work" — all three are independent surfaces. The Windows symlink/junction/copy fallback ladder applies only to per-skill symlinks under `.claude/skills/lumi-*`; schema entry-point files (`README.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/lumina.mdc`) are plain rendered files with no link semantics.

## Prior Art Study — OmegaWiki

OmegaWiki is read-only at `../OmegaWiki` and informs **patterns only**. No code, schema, or skill content is copied. Survey below maps observed patterns to Lumina-Wiki implementation choices.

### Tools layer inventory (`tools/`, 13 Python files, ~9,000 LoC)

| Tool | LoC | Role | Pattern Lumina inherits |
|---|---:|---|---|
| `_env.py` | 49 | `.env` loader (`~/.env` → `./.env` → process env) | Research-pack only; Node has dotenv equivalent |
| `_schemas.py` | 321 | Single source of truth for entity dirs, edge types, required frontmatter, enum values | ⭐ **High value.** Lumina equivalent: `_lumina/scripts/schemas.mjs` consumed by lint + writer |
| `research_wiki.py` | 2,843 | **Wiki Knowledge Engine** — subcommands: `init`, `slug`, `log`, `read-meta`, `set-meta`, `add-edge`, `add-citation`, `batch-edges`, `dedup-edges` | ⭐⭐ **Most important non-installer artifact.** Lumina equivalent: `_lumina/scripts/wiki.mjs` |
| `lint.py` | 865 | 9-check linter + `--fix`, `--dry-run`, `--suggest`, `--json` | ⭐ Match `/lumi-check` surface; JSON mode for CI consumption |
| `reset_wiki.py` | 180 | Scoped destructive reset; `--yes` required, `--dry-run` plan | Plan-then-execute discipline |
| `discover.py` | 621 | Ranked candidate shortlist; 3 seed modes; dedupe vs `wiki/`; JSON out | research-pack |
| `init_discovery.py` | 1,713 | Largest tool. Prepare/plan/fetch/download; `.checkpoints/*.json` manifests | research-pack; checkpoint pattern worth inheriting |
| `prepare_paper_source.py` | 758 | Turn one local PDF/tex into ingest-ready package | research-pack |
| `fetch_arxiv.py` / `fetch_s2.py` / `fetch_deepxiv.py` / `fetch_wikipedia.py` | 152 / 239 / 355 / 129 | API wrappers; JSON-on-stdout; documented exit codes (0/2/3) | ⭐ One-fetcher-per-API pattern |
| `remote.py` | 832 | SSH + GPU + screen-session orchestration | **Out of scope v0.1** — Lumina does not ship `exp-*` |

### MCP server (`mcp-servers/llm-review/`)

OpenAI-compatible cross-model review server bundled in the OmegaWiki repo. Exposes `chat`, `chat-reply`, `web_search`. Configuration via `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` env vars (DeepSeek / Qwen / OpenRouter / OpenAI…). Used by skills that need a **second LLM** to independently judge an artifact produced by the primary agent — reducing primary-model bias.

**Decision for Lumina:** ship MCP server in **v0.2**, not v0.1. Primary user dogfoods with single model (Claude Code); single-model self-review is acceptable for personal use. Cross-model verdict becomes load-bearing only at conference-submission scale, which is out of scope for v0.1.

### Skills inventory (`i18n/en/skills/`, 24 skills)

Mapped against Lumina's planned skill set:

| OmegaWiki skill | Maps to | Notes |
|---|---|---|
| init, ingest, ask, edit, check, reset | Lumina **core** (6 skills) | 1-1 correspondence; same names without `lumi-` prefix |
| discover, ideate, novelty, survey, paper-plan, paper-draft, rebuttal, daily-arxiv | Lumina **research** (8 skills) | Already in research pack scope |
| **prefill** | Lumina research (add) | ⭐ Seeds `wiki/foundations/` to prevent duplicate concepts on ingest |
| **refine** | Lumina research (add) | ⭐ Iterative `/review` loop — depends on MCP llm-review (v0.2 capability) |
| **setup** | Lumina research (add) | ⭐ Interactive `.env` walkthrough for API keys |
| exp-design, exp-run, exp-status, exp-eval | **Out of scope v0.1** | Require `remote.py` (SSH+GPU); author does not run remote experiments daily |
| paper-compile | **Out of scope v0.1** | LaTeX submission concern; not in author's daily loop |
| review | **v0.2** with MCP | Single-pass cross-model review |
| research (orchestrator) | **v0.2** | End-to-end chain with human gates + resumable state; needs checkpoint infra |
| (none) | Lumina **reading** pack (4 skills) | OmegaWiki has no equivalent; Lumina-original |

### Skill → Tool dependency matrix

| Skill | wiki | lint | reset | discover | init_disc | prep_paper | fetch_arxiv | fetch_s2 | fetch_deepxiv | fetch_wiki | remote | _env | mcp:llm-review |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| init | ● | ● | | | ● | ● | | ● | | | | | |
| ingest | ● | ● | | ● | ● | ● | ● | ● | ● | | | | |
| ask | ● | | | | | | | | | | | | |
| edit | _markdown-only — no tool calls_ |
| check | ● | ● | | | | | | | | | | | |
| reset | ● | | ● | | | | | | | | | | |
| discover | ● | | | ● | ● | | | ● | ● | | | | |
| prefill | ● | | | | | | | | | ● | | | |
| ideate | ● | ● | | | | | | ● | ● | | | | ● |
| novelty | | | | | | | | ● | ● | | | | ● |
| paper-plan | ● | | | | | | | ● | | | | | ● |
| paper-draft | ● | | | | | | | ● | | | | | ● |
| paper-compile | ● | | | | | | | | | | | | |
| survey | ● | | | | | | | ● | | | | | |
| rebuttal | ● | | | | | | | | | | | | ● |
| daily-arxiv | ● | | | | ● | | ● | | ● | | | | |
| exp-design | ● | | | | | | | | | | | | ● |
| exp-run | ● | | | | | | | | | | ● | | ● |
| exp-status | ● | | | | | | | | | | ● | | |
| exp-eval | ● | | | | | | | | | | | | ● |
| review | | | | | | | | | | | | | ● |
| refine | ● | | | | | | | | | | | | |
| research (orch) | ● | | | | | | ● | ● | ● | | | | |
| setup | | | | | | | | | | | | ● | |

### Tool usage frequency

| Tool | Skills | When |
|---|:-:|---|
| **`research_wiki.py`** (engine) | **20 / 24** | ⭐⭐ Universal. Frontmatter + graph mutation. Every wiki-writing skill needs it |
| `mcp:llm-review` | 9 | Cross-model verdict for ideate, novelty, paper-plan/draft, rebuttal, exp-design/run/eval, review |
| `fetch_s2.py` | 9 | Semantic Scholar — citations, recommendations |
| `fetch_deepxiv.py` | 6 | Paper full-text + trending |
| `lint.py` | 4 | check, ingest (post-validation), init, ideate |
| `init_discovery.py` | 4 | init, ingest, discover, daily-arxiv |
| `fetch_arxiv.py` | 3 | RSS feed: daily-arxiv, ingest, research |
| `discover.py` | 3 | discover, ingest (`--discover`), |
| `prepare_paper_source.py` | 2 | init, ingest |
| `remote.py` | 2 | exp-run, exp-status |
| `fetch_wikipedia.py` | 1 | prefill only |
| `reset_wiki.py` | 1 | reset only |
| `_env.py` | 1 | setup only (others import as side-effect) |

### Implementation lessons inherited

1. **Two-layer architecture is non-negotiable.** Skills are markdown agent prompts (≤300 lines). Tools are Node/Python scripts that mutate state. Graph logic does not live in skill prompts. Skill calls tool via Bash + JSON.
2. **Wiki engine tool is the largest non-installer artifact.** 20/24 skills depend on it. Lumina cannot defer this — `_lumina/scripts/wiki.mjs` ships in v0.1. Sized down: ~1,500–2,000 LoC for 4 core types vs OmegaWiki's 2,843 for 9.
3. **`/edit` is markdown-only — not every skill needs a tool.** Guidance skills are cheap and valuable; Lumina core can keep `/lumi-edit` markdown-only.
4. **Lumina core needs exactly 3 Node tools:** `wiki.mjs` + `lint.mjs` + `reset.mjs`, plus `schemas.mjs` as shared data. Zero Python in core; matches PRD claim.
5. **Schemas-as-code-data file pattern.** `_lumina/scripts/schemas.mjs` exports entity dirs / edge types / required fields. Lint and writer consume the same source.
6. **Linter has JSON mode + `--fix --dry-run`.** OmegaWiki 865 LoC; Lumina equivalent ~500–700 LoC due to lighter schema. JSON mode lets CI and `/lumi-check` UI consume identical output.
7. **One fetcher per API; JSON-on-stdout; documented exit codes.** Skills compose via Bash, never import Python modules. Skill markdown only needs to know command line + JSON shape.
8. **`.checkpoints/` for multi-phase batch state** → Lumina convention: `_lumina/_state/<skill>-<phase>.json`. Long-running workflow resumability.
9. **MCP llm-review is a 9-skill enabler.** Without it, 9 research-pack skills must either fall back to single-model self-review or be stubbed out. Defer to v0.2 acceptable; document fallback explicitly.
10. **Three skills to add to research pack from OmegaWiki pattern:**
    - `/lumi-prefill` — seeds `foundations/` to prevent concept duplication on ingest. Cheap (uses `fetch_wikipedia.py` only).
    - `/lumi-refine` — iterative review-fix loop. Defer the multi-model dependency to v0.2 by allowing a single-model variant.
    - `/lumi-setup` — interactive `.env` walkthrough for API keys when research pack is installed.
11. **`/research` orchestrator and `exp-*` cluster → v0.2 or later.** Orchestrator needs checkpoint infra mature; `exp-*` needs SSH/GPU infra not in author's daily loop.

### Component sizing estimate (informed by OmegaWiki)

| Lumina component | Sized against | Estimated LoC (v0.1) |
|---|---|---|
| Installer (`bin/lumina.js` + `src/installer/`) | BMAD installer pattern | 1,200–2,000 |
| `_lumina/scripts/wiki.mjs` (engine) | research_wiki.py (2,843, 9 types) | 1,500–2,000 (4 types) |
| `_lumina/scripts/lint.mjs` | lint.py (865, 9 checks) | 500–700 (4–5 checks) |
| `_lumina/scripts/reset.mjs` | reset_wiki.py (180) | 150–250 |
| `_lumina/scripts/schemas.mjs` | _schemas.py (321) | 200–300 |
| Templates (CLAUDE.md, page-templates, config, .gitignore) | OmegaWiki template tree | 400–600 markdown |
| Core skills (6 markdown SKILL.md) | OmegaWiki init/ingest/ask/edit/check/reset | 600–1,200 markdown |
| Research pack skills (~12 markdown) | OmegaWiki research-related | 1,500–2,500 markdown |
| Reading pack skills (4 markdown) | original | 400–600 markdown |
| Research pack Python tools | OmegaWiki research-relevant subset | 2,000–3,500 |
| **Total v0.1 (excluding research Python)** | | **~5,000–7,500 LoC + ~3,000 markdown** |

NFR-M1 sets a 3,000-LoC soft cap for original JS in the installer + Node scripts; the estimate sits within that envelope when research-pack Python is excluded from the count.

### v0.1 Final Scope Lock

Locked 2026-05-01 after a second pass over OmegaWiki's tools and skills, with explicit reasoning for each include/defer/drop.

**Skills shipped in v0.1 (14 total):**

| Pack | Skill | Source | Notes |
|---|---|---|---|
| core | `/lumi-init` | port (generalize) | bootstrap workspace + first ingest wave |
| core | `/lumi-ingest` | port | universal — adds source, concept, person, summary pages with cross-refs |
| core | `/lumi-ask` | port | retrieve + synthesize + crystallize back into wiki |
| core | `/lumi-edit` | port (markdown-only) | add/remove sources, update content; no tool dependencies |
| core | `/lumi-check` | port | 9-check linter with exemption rules |
| core | `/lumi-reset` | port | scoped destructive reset; `--dry-run` plan |
| research | `/lumi-discover` | port (generalize) | ranked candidate shortlist, plug-in fetchers |
| research | `/lumi-survey` | port | narrative synthesis from claim graph |
| research | `/lumi-prefill` | port | seeds `wiki/foundations/` to prevent concept duplication on ingest |
| research | `/lumi-setup` | port | interactive `.env` walkthrough for fetcher API keys |
| reading | `/lumi-chapter-ingest` | original | ingest a book chapter |
| reading | `/lumi-character-track` | original | maintain character pages and inter-character edges |
| reading | `/lumi-theme-map` | original | thematic clustering |
| reading | `/lumi-plot-recap` | original | spoiler-aware progressive recap |

**Skills explicitly NOT shipped in v0.1:**

| Skill | Disposition | Reason |
|---|---|---|
| `/novelty`, `/review` | drop | Depend on cross-model verdict (a second LLM independently judging primary output). Decision: no `llm-review` MCP server, no second model. |
| `/refine` | defer v0.2 | Core mechanism is `loop { /review → fix } until score`. With cross-model review dropped, can be repurposed as single-model self-critique loop, but value diminished. Re-evaluate after v0.1 dogfooding. |
| `/research` orchestrator | drop | Composes 8 sub-skills; 6 of those are dropped (ideate, exp-* ×3, paper-* ×3). Pattern (pipeline-progress.md checkpoint, human gates) is studied but any future Lumina orchestrator is a NEW skill, not a port. |
| `/ideate`, `/rebuttal`, `/daily-arxiv` | drop | AI/ML conference workflow specific. Re-add as a separate optional pack if author's use case re-emerges. |
| `/paper-plan`, `/paper-draft`, `/paper-compile` | drop | Output-side LaTeX submission pipeline. Author does not write conference papers as a daily loop in v0.1's horizon. |
| `/exp-design`, `/exp-run`, `/exp-status`, `/exp-eval` | drop | Require `remote.py` (SSH+GPU+screen orchestration); not in author's daily loop. |

**Node scripts in `_lumina/scripts/` (4 files, v0.1):**

| File | Port of | Role | Sized estimate |
|---|---|---|---|
| `schemas.mjs` | `_schemas.py` (321) | Single source of truth — entity dirs, edge types, required frontmatter, enum values. Lint and writer both consume. | 200–300 LoC |
| `wiki.mjs` | `research_wiki.py` (2,843) | Wiki engine — `init`, `slug`, `log`, `read-meta`, `set-meta`, `add-edge`, `add-citation`, `batch-edges`, `dedup-edges`, checkpoint helpers. **Universal dependency** (≥10 of 14 skills). | 1,500–2,000 LoC |
| `lint.mjs` | `lint.py` (865) | 9-check linter, `--fix --dry-run --suggest --json`. JSON mode for CI + `/lumi-check` UI. | 500–700 LoC |
| `reset.mjs` | `reset_wiki.py` (180) | Scoped destructive reset; `--yes` required; `--dry-run` prints plan. | 150–250 LoC |

**Python tools in `_lumina/tools/` (8 files, research pack only):**

| File | Port of | Role | Notes |
|---|---|---|---|
| `_env.py` | identical (49) | dotenv loader (`~/.env` → `./.env` → process env) | imported as side-effect by every Python tool |
| `discover.py` | identical (621) | ranked candidate shortlist; 3 seed modes; dedupe vs `wiki/`; JSON-on-stdout | research-pack only |
| `init_discovery.py` | slim port (1,713 → ~1,200) | multi-phase prepare/plan/fetch/download with `_lumina/_state/<skill>-<phase>.json` checkpoints | drop arxiv-tarball-only paths if generalizable |
| `prepare_source.py` | rename of `prepare_paper_source.py` (758) | input-side normalizer — turn one local PDF/tex into `raw/<slug>/` ingest-ready package | rename for neutrality (works on non-paper PDFs too) |
| `fetch_arxiv.py` | identical (152) | API wrapper, JSON-on-stdout, exit codes 0/2/3 | optional plugin |
| `fetch_wikipedia.py` | identical (129) | Wikipedia API | optional plugin |
| `fetch_s2.py` | identical (239) | Semantic Scholar — citations, references, recommendations. Covers all academic fields, not AI/ML-only. | optional plugin |
| `fetch_deepxiv.py` | identical (355) | DeepXiv SDK — semantic search + progressive reading over arxiv-hosted papers | optional plugin |

**Python tools NOT shipped:** `prepare_paper_source.py` is RENAMED to `prepare_source.py` and IS shipped (input-side normalizer; differs from output-side LaTeX pipeline). `remote.py` (SSH+GPU+screen) is dropped — no `/exp-*` cluster.

**v0.1 explicitly does not ship:**
- MCP `llm-review` server. No cross-model review anywhere. Wherever a skill ported from OmegaWiki invokes a Review LLM (e.g., `/check` verdict gate, `/discover` ranking review), Lumina substitutes single-model self-check by the running agent.
- Output-side LaTeX paper pipeline (`paper-*` skills + `prepare_paper_source.py` LaTeX paths).
- Remote experiment runner (`remote.py`, `exp-*` skills).
- A pipeline orchestrator (`/research`).

**Dependency-matrix-derived implementation order:**

1. `schemas.mjs` — no dependencies; defines vocabulary every other artifact consumes.
2. `wiki.mjs` — depends on `schemas.mjs`. Universal dependency for ≥10 skills, so blocks all skill authoring beyond `/lumi-edit` (markdown-only).
3. `lint.mjs` — depends on `schemas.mjs` + `wiki.mjs`. Blocks `/lumi-check` and CI idempotency assertions.
4. `reset.mjs` — depends on `schemas.mjs`. Blocks `/lumi-reset`.
5. Core skills (6 SKILL.md files) — `/lumi-edit` first (no tool deps), then `/lumi-init` + `/lumi-ingest` + `/lumi-ask` + `/lumi-check` + `/lumi-reset`.
6. Research pack — Python tools first (`_env.py`, `discover.py`, fetchers), then four research skills (`/lumi-discover`, `/lumi-survey`, `/lumi-prefill`, `/lumi-setup`).
7. Reading pack — original four skills, no new tools required (consume `wiki.mjs`).
8. Installer — wires everything together; depends on stable templates so authored last among the engine artifacts.
