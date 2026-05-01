---
type: quick-spec
project_name: LuminaWiki
version: v0.1
date: 2026-05-01
inputs:
  - docs/planning-artifacts/prd.md
  - docs/planning-artifacts/architecture.md
---

# Lumina-Wiki v0.1 — Implementation Plan (Quick Spec)

Single-author, single-package npm CLI. Replaces epics/stories. Each unit below is story-sized: one PR, one DoD checklist, dependency-ordered.

## Build order (locked)

```
P0  schemas.mjs
P1  wiki.mjs
P2  lint.mjs
P3  reset.mjs
P4  Core skills (6)        — edit → init → ingest → ask → check → reset
P5  Research-pack tools    — _env, fetchers, discover, init_discovery, prepare_source
P6  Research-pack skills (4)  — discover → prefill → survey → setup
P7  Reading-pack skills (4)   — chapter-ingest → character-track → theme-map → plot-recap
P8  Installer + templates + manifest + symlink ladder
P9  CI matrix + idempotency byte-diff test + npm publish prep
```

Rationale: every skill consumes `wiki.mjs`; `wiki.mjs` consumes `schemas.mjs`. Installer is last because templates stabilize only after skills exist.

---

## P0 — `_lumina/scripts/schemas.mjs`

**Why first:** every other artifact (wiki engine, linter, skill prompts, templates) consumes the entity/edge vocabulary. Locking it first prevents downstream rewrites.

**Scope:**
- Export entity dirs: core `sources/`, `concepts/`, `people/`, `summary/`, `outputs/`, `graph/`; research-pack `foundations/`, `topics/`; reading-pack `chapters/`, `characters/`, `themes/`, `plot/`. Pack-conditional dirs are tagged with their pack so installer + lint know when to materialize/skip them.
- Export raw dirs: core `sources/`, `notes/`, `assets/`, `tmp/`; research-pack `discovered/`.
- Export edge types (bidirectional `exempt-only` default per FR31).
- Export required frontmatter per entity type.
- Export enum values consumed by lint.
- Export pack manifest shape (`pack.yaml`) so v0.2 third-party packs cannot break v0.1 readers.

**DoD:** Pure data module, no I/O, no deps. Imported by `wiki.mjs` and `lint.mjs` without circular reference. Matches PRD FR29–FR33. ≤300 LoC.

---

## P1 — `_lumina/scripts/wiki.mjs`

**Why second:** universal dependency (≥10 of 14 skills). Blocks all skill authoring beyond `/lumi-edit`.

**Subcommands:** `init`, `slug`, `log`, `read-meta`, `set-meta`, `add-edge`, `add-citation`, `batch-edges`, `dedup-edges`, plus checkpoint helpers (read/write `_lumina/_state/<skill>-<phase>.json`).

**Invariants:**
- Every file write: temp + fsync + rename (NFR-R2).
- Edge writes idempotent — re-running same `add-edge` is no-op (NFR-R1).
- JSON-on-stdout for all read commands. Exit codes: 0 success, 2 user error, 3 internal.

**DoD:** Unit tests cover happy path + idempotency for each subcommand. Round-trip `add-edge` twice → byte-identical `wiki/`. 1,500–2,000 LoC.

---

## P2 — `_lumina/scripts/lint.mjs`

**Scope:** 9 checks (port from OmegaWiki `lint.py`, adapted to Lumina schema). Flags: `--fix`, `--dry-run`, `--suggest`, `--json`.

**DoD:** `--json` output schema documented + consumed by `/lumi-check`. `--fix --dry-run` shows diff without writing. CI consumes JSON mode. 500–700 LoC.

---

## P3 — `_lumina/scripts/reset.mjs`

**Scope:** Scoped destructive reset. `--yes` required. `--dry-run` prints plan tree. Refuses `..` / paths outside project root.

**DoD:** Without `--yes` → exits 2 with reason. `--dry-run --yes` plan matches actual delete set. 150–250 LoC.

---

## P4 — Core skills (6 markdown files)

Order within phase: `edit` (no tool deps, smoke-test markdown harness) → `init` → `ingest` → `ask` → `check` → `reset`.

Each `SKILL.md`:
- ≤300 lines
- Single source of truth: `README.md` at project root (no symlinks for schema)
- Single-model self-check replaces any cross-model verdict
- Calls `wiki.mjs` / `lint.mjs` / `reset.mjs` via Bash + JSON, never imports

**DoD per skill:** Manual smoke run on a throwaway workspace produces expected `wiki/` mutations; idempotency byte-diff passes after second run.

---

## P5 — Research-pack Python tools (`_lumina/tools/`)

Order: `_env.py` → 4 fetchers → `discover.py` → `init_discovery.py` (slim port) → `prepare_source.py`.

**Pattern:** one fetcher per API, JSON-on-stdout, documented exit codes (0/2/3). Skills compose via Bash; never import Python modules.

**DoD:** Each fetcher returns valid JSON for a known input; missing API key → exit 2 with actionable message. `prepare_source.py` turns one local PDF into a `raw/<slug>/` package whose subsequent ingest is byte-stable.

---

## P6 — Research-pack skills (4)

Order: `discover` → `prefill` (seeds `wiki/foundations/` — must run before bulk ingest to prevent concept duplication) → `survey` → `setup`.

**DoD per skill:** Same as P4 + integration test against at least one fetcher.

---

## P7 — Reading-pack skills (4)

Order: `chapter-ingest` → `character-track` → `theme-map` → `plot-recap`.

No new tools. Consume `wiki.mjs` only. Spoiler-aware progressive recap is the most novel — verify on a multi-chapter test book.

---

## P8 — Installer + templates + manifest

**Components:** `bin/lumina.js`, `src/installer/{commands, prompts, fs, manifest, template-engine, update-check}.js`.

**Risk-concentrated module:** `src/installer/fs.js` — symlink ladder (symlink → junction → directory copy), atomic writes, idempotency. Heaviest test surface.

**Templates rendered by installer:**
- `README.md` — three regions top-to-bottom: title (project name H1), purpose (verbatim from prompt 2, outside any markers, fully User-owned), schema region between `<!-- lumina:schema -->` markers (only region rewritten on upgrade).
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules/lumina.mdc` (~5–10-line stubs pointing to `README.md`)
- `_lumina/config/lumina.config.yaml`
- `_lumina/schema/{page-templates, cross-reference-packs, graph-packs}.md`
- `.env.example` (only when `research` pack selected)
- `.gitignore` covering `_lumina/_state/`, `raw/tmp/`, `.env`

**State (three files, single concern each, atomic write per file):**
- `_lumina/manifest.json` — install state: package version, timestamps, packs (with version + source), IDE targets, per-target symlink strategy, resolved absolute paths, `schemaVersion`.
- `_lumina/_state/skills-manifest.csv` — verbatim skill inventory: `canonical_id, display_name, pack, source, relative_path, target_link_path, version`. Drives uninstall + per-skill symlink refresh.
- `_lumina/_state/files-manifest.csv` — hash tracking for installer-managed files: `relative_path, sha256, source_pack, installed_version`. Drives upgrade drift detection (`<file>.bak` on hash mismatch).

`--re-link`, upgrade, and uninstall read all three. A missing artifact is a hard failure that triggers `--re-link` semantics.

**Prompts (5):** project name → research purpose (multi-line free-form, optional) → IDE targets → packs → language pair.

**DoD:**
- Install < 60s (NFR-Pe1), cold-start < 300ms (NFR-Pe2), `--version` < 2s with 2s hard-timeout npm check (NFR-Pe3, NFR-Pr2).
- Reinstall on second machine from committed config produces byte-identical workspace (FR21, NFR-R1).
- All three state files survive `kill -9` mid-write (atomic temp+fsync+rename per file).

---

## P9 — CI + publish prep

- 6-cell matrix: Node {20, 22} × OS {macOS, Linux, Windows} (NFR-C1).
- Canonical assertion: `install → reinstall → git diff` must be empty over `wiki/` and `raw/` (FR47, NFR-R1).
- Unit tests for symlink ladder dispatcher + manifest reader/writer.
- npm publish dry-run; license audit (MIT/ISC/Apache-2.0 only); `files` allowlist excludes `_state/` and dev artifacts; no postinstall scripts.

---

## Cross-cutting checklists (apply to every PR)

- [ ] No emoji in shipped files unless explicitly requested
- [ ] No mention of OmegaWiki in user-facing strings (PRD, README template, installer output)
- [ ] No `NOTICE` file, no MIT-attribution chain
- [ ] No cross-model review code paths; single-model self-check only
- [ ] All file writes go through atomic temp+fsync+rename helper
- [ ] Path joins via `node:path`; reject `..` and absolute traversal
- [ ] `NO_COLOR` honored, TTY-aware output
- [ ] No native modules added to dep tree
- [ ] LoC budget watched: ≤3,000 original JS soft cap (NFR-M1)

## Out of scope (do not build, do not stub)

MCP `llm-review` server · `/novelty` · `/review` · `/research` orchestrator · `/ideate` · `/rebuttal` · `/daily-arxiv` · `/paper-plan|draft|compile` · `/exp-design|run|eval|status` · `remote.py`. `/refine` is **deferred to v0.2**, not in this plan.

## Implementation-readiness gate

Before starting P0, run `bmad-check-implementation-readiness` to verify PRD ↔ architecture ↔ this plan trace fully. Any gap → fix here, not in code.
