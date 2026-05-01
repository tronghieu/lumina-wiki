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

## Path convention — repo source vs workspace

This plan distinguishes the two artifact surfaces (BMAD-style):

- **Repo source paths** (this build artifact) live under `src/`: `src/scripts/`, `src/tools/`, `src/skills/`, `src/installer/`, `src/templates/`.
- **Workspace paths** (rendered/copied by the installer into the user's project) live under `_lumina/` and `.agents/`: `_lumina/scripts/`, `_lumina/tools/`, `.agents/skills/...`.

Phases P0–P3, P5 author files at **repo source paths**. The installer (P8) copies them verbatim to workspace paths during `lumina install`. References below use repo source paths; equivalent workspace paths are noted parenthetically where the distinction matters.

## Build order (locked)

```
P0  schemas.mjs                                     [DONE 2026-05-01]
P1  wiki.mjs                                        [DONE 2026-05-01]
P2  lint.mjs                                        [DONE 2026-05-01]
P3  reset.mjs                                       [DONE 2026-05-01]
P4  Core skills (6)        — edit → init → ingest → ask → check → reset     [DONE 2026-05-01]
P5  Research-pack tools    — _env, fetchers, discover, init_discovery, prepare_source [DONE 2026-05-01]
P6  Research-pack skills (4)  — discover → prefill → survey → setup         [DONE 2026-05-01]
P7  Reading-pack skills (4)   — chapter-ingest → character-track → theme-map → plot-recap [DONE 2026-05-01]
P8  Installer + templates + manifest + symlink ladder                       [DONE 2026-05-01]
P9  CI matrix + idempotency byte-diff test + package readiness checks
```

**Progress (2026-05-01):** P0–P8 complete in repo source. Post-review fixes applied for CLI `--version`, missing research skills, skill/wiki API drift, typed path slugs, non-interactive upgrade preservation, README schema merge, npm package allowlist, and streamed `prepare_source.py` source copies. Verified: installer tests 82 passed, scripts tests 147 passed, Python tools tests 135 passed, `node bin/lumina.js --version --no-update` outputs `0.1.0`, `npm pack --dry-run --json` contains runtime files only, and `git diff --check` passes.

Rationale: every skill consumes `wiki.mjs`; `wiki.mjs` consumes `schemas.mjs`. Installer is last because templates stabilize only after skills exist.

---

## P0 — `src/scripts/schemas.mjs` (workspace: `_lumina/scripts/schemas.mjs`) — ✅ DONE

**Status:** Shipped 2026-05-01. 411 raw / 196 logic LoC (within 300 budget). 8 named exports: `SCHEMA_VERSION`, `EXEMPTION_GLOBS`, `ENUMS`, `ENTITY_DIRS`, `RAW_DIRS`, `EDGE_TYPES`, `REQUIRED_FRONTMATTER`, `PACK_MANIFEST_SHAPE`. Two scope deviations accepted: (a) `EDGE_TYPES` lists forward and reverse as separate entries (vs single-entry-with-`reverse`-field) for direct lookup convenience; (b) added `pack` field on each edge type so lint/wiki can gate edge validation by installed pack.

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

## P1 — `src/scripts/wiki.mjs` (workspace: `_lumina/scripts/wiki.mjs`) — ✅ DONE

**Status:** Shipped 2026-05-01. 1,555 LoC (within 1,500–2,000 budget). 59 tests passing. All required subcommands plus 4 read-only bonus subcommands (`list-entities`, `read-edges`, `read-citations`, `verify-frontmatter`). In-house YAML frontmatter parser handles bounded subset (no `js-yaml` dep added). Edge-key canonical format: `from|type|to`. Atomic write uses `fd.datasync` + rename; on error, orphan `.tmp` is cleaned via `unlink`.

**Why second:** universal dependency (≥10 of 14 skills). Blocks all skill authoring beyond `/lumi-edit`.

**Subcommands:** `init`, `slug`, `log`, `read-meta`, `set-meta`, `add-edge`, `add-citation`, `batch-edges`, `dedup-edges`, plus checkpoint helpers (read/write `_lumina/_state/<skill>-<phase>.json`).

**Invariants:**
- Every file write: temp + fsync + rename (NFR-R2).
- Edge writes idempotent — re-running same `add-edge` is no-op (NFR-R1).
- JSON-on-stdout for all read commands. Exit codes: 0 success, 2 user error, 3 internal.

**DoD:** Unit tests cover happy path + idempotency for each subcommand. Round-trip `add-edge` twice → byte-identical `wiki/`. 1,500–2,000 LoC.

---

## P2 — `src/scripts/lint.mjs` (workspace: `_lumina/scripts/lint.mjs`) — ✅ DONE

**Status:** Shipped 2026-05-01. 1,122 raw / ~720 logic LoC (logic slightly above 500–700 target; accepted — comment + JSON-schema doc block account for the difference). 74 tests passing. All 9 checks (L01–L09) implemented; fixers for L03/L06/L07/L09. JSON output schema documented at top of file. L07 fixer idempotency proven by regression test.

**Scope:** 9 schema-validation checks against `schemas.mjs`. Flags: `--fix`, `--dry-run`, `--suggest`, `--json`.

**DoD:** `--json` output schema documented + consumed by `/lumi-check`. `--fix --dry-run` shows diff without writing. CI consumes JSON mode. 500–700 LoC.

---

## P3 — `src/scripts/reset.mjs` (workspace: `_lumina/scripts/reset.mjs`) — ✅ DONE

**Status:** Shipped 2026-05-01. 232 LoC (within 150–250 budget). 11 tests passing. All 5 scopes implemented: `wiki`, `raw`, `state`, `checkpoints`, `all`. `safePath` handles both `/` and `\` separators for Windows compatibility.

**Scope:** Scoped destructive reset. `--yes` required. `--dry-run` prints plan tree. Refuses `..` / paths outside project root.

**DoD:** Without `--yes` → exits 2 with reason. `--dry-run --yes` plan matches actual delete set. 150–250 LoC.

---

## P4 — Core skills (6 markdown files) — ✅ DONE

**Status:** Shipped 2026-05-01. Six core skills authored under `src/skills/core/`: `init`, `ingest`, `ask`, `edit`, `check`, `reset`. Skills point agents to project-root `README.md` as the canonical context, call workspace `_lumina/scripts/{wiki,lint,reset}.mjs` through Bash, and avoid cross-model workflows.

Order within phase: `edit` (no tool deps, smoke-test markdown harness) → `init` → `ingest` → `ask` → `check` → `reset`.

Each `SKILL.md`:
- ≤300 lines
- Single source of truth: `README.md` at project root (no symlinks for schema)
- Single-model self-check replaces any cross-model verdict
- Calls workspace `_lumina/scripts/{wiki,lint,reset}.mjs` via Bash + JSON, never imports

**DoD per skill:** Manual smoke run on a throwaway workspace produces expected `wiki/` mutations; idempotency byte-diff passes after second run.

---

## P5 — Research-pack Python tools (`src/tools/`, workspace: `_lumina/tools/`) — ✅ DONE

**Status:** Shipped 2026-05-01. Implemented `_env.py`, fetchers (`fetch_arxiv.py`, `fetch_s2.py`, `fetch_wikipedia.py`, `fetch_deepxiv.py`), `discover.py`, `init_discovery.py`, and `prepare_source.py`. Post-review fix: `prepare_source.py` now copies the original source into `raw/tmp/<slug>/source<ext>` with streamed atomic copy instead of `read_bytes()` to avoid large-file memory spikes.

Order: `_env.py` → 4 fetchers → `discover.py` → `init_discovery.py` (slim port) → `prepare_source.py`.

**Pattern:** one fetcher per API, JSON-on-stdout, documented exit codes (0/2/3). Skills compose via Bash; never import Python modules.

**DoD:** Each fetcher returns valid JSON for a known input; missing API key → exit 2 with actionable message. `prepare_source.py` turns one local file into a `raw/tmp/<slug>/` package whose subsequent ingest is byte-stable.

---

## P6 — Research-pack skills (4) — ✅ DONE

**Status:** Shipped 2026-05-01. Added all four research-pack skills under `src/skills/packs/research/`: `discover`, `prefill`, `survey`, `setup`. Scope remains locked to FR35: source discovery shortlist, foundation prefill, wiki-grounded survey synthesis, and research runtime setup. No `/ideate`, LaTeX authoring, orchestrator, daily arXiv, or cross-model flows.

Order: `discover` → `prefill` (seeds `wiki/foundations/` — must run before bulk ingest to prevent concept duplication) → `survey` → `setup`.

**DoD per skill:** Same as P4 + integration test against at least one fetcher.

---

## P7 — Reading-pack skills (4) — ✅ DONE

**Status:** Shipped 2026-05-01. Added reading skills under `src/skills/packs/reading/`: `chapter-ingest`, `character-track`, `theme-map`, `plot-recap`. Post-review fix: command snippets now match `wiki.mjs`; typed/namespaced slugs such as `chapters/<book>/<chapter>` are supported; reading edges use `features`, `appears_in`, `tagged_with`, `associated_with`, `expresses_theme`, and `appears_with`; the obsolete `--book` flag is not used.

Order: `chapter-ingest` → `character-track` → `theme-map` → `plot-recap`.

No new tools. Consume `wiki.mjs` only. Spoiler-aware progressive recap is the most novel — verify on a multi-chapter test book.

---

## P8 — Installer + templates + manifest — ✅ DONE

**Status:** Shipped 2026-05-01. Implemented npm CLI entrypoint, installer commands/prompts, filesystem helpers, manifest readers/writers, template renderer, update check, templates, schema docs, IDE stubs, and pack copying. Post-review fixes applied:
- `node bin/lumina.js --version --no-update` prints package version and exits 0 before Commander is loaded.
- Built-in skill sources are fail-fast: missing `SKILL.md` no longer creates empty advertised skills.
- `install --yes` on an existing Lumina workspace reads existing config/manifest instead of resetting to defaults.
- README merge appends a Lumina schema region when an existing README has no markers.
- `package.json#files` is a precise runtime allowlist; tests, `__pycache__`, `.pyc`, and planning artifacts are excluded from `npm pack`.

**Components:** `bin/lumina.js`, `src/installer/{commands, prompts, fs, manifest, template-engine, update-check}.js`. Installer copies `src/scripts/` → workspace `_lumina/scripts/`, `src/tools/` → workspace `_lumina/tools/` (research pack only), `src/skills/` → workspace `.agents/skills/`.

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

## P9 — CI + installability/package readiness checks

**Status:** Implemented 2026-05-01. CI verifies Lumina as an installable npm package, not as a deployable service. It creates disposable workspaces only for tests and never publishes to npm.

- 6-cell matrix: Node {20, 22} × OS {macOS, Linux, Windows} (NFR-C1).
- Canonical assertion: `install → reinstall → git diff` must be empty over installer-managed runtime/user-facing workspace surfaces, excluding runtime timestamp state such as `_lumina/manifest.json` (FR47, NFR-R1).
- Unit tests for installer, scripts, Python tools, symlink ladder dispatcher, and manifest reader/writer.
- npm pack dry-run; `files` allowlist excludes `_state/`, tests, bytecode, planning artifacts, CI helper scripts, and dev artifacts; no postinstall scripts.
- No deploy, no `npm publish`, and no live network/API fetcher calls in CI.

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
