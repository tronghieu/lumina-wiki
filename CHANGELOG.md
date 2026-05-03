# Changelog

All notable changes to Lumina-Wiki are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.8.0] - 2026-05-03

### Added
- Schema: `raw_paths` field (array, optional) on `sources` — relative paths to permanent raw artifacts backing the source page (`raw/sources/*`, `raw/notes/*`, `raw/download/<resource>/*`, `raw/discovered/<topic>/*.json`). Replaces implicit "URL is the anchor" semantic with an explicit pointer set; verify Stage A (planned v1.0) reads this directly instead of re-deriving from heuristics.
- `raw/download/<resource>/` — permanent agent-writable zone for auto-fetched full-text artifacts, partitioned by source (`arxiv`, `doi`, `s2`, `web`). Distinct from `raw/tmp/` (transient) and `raw/sources/` (human-curated).
- `_lumina/tools/fetch_pdf.py` — CLI tool: download URL to `raw/download/<resource>/<filename>`, idempotent (skip on existing, `--force` to overwrite). Resource detection from URL pattern (arxiv/doi/s2/web). Atomic write (tempfile + fsync + rename). Used by `/lumi-ingest` Mode B.
- Lint check L12: warning when `raw_paths` entries point to a missing file, escape the project root, or live in `raw/tmp/*` (transient — should be moved to `raw/sources/` or `raw/download/`).
- `/lumi-ingest` Mode B: input may be a URL, arxiv ID, DOI, or paper title from discover shortlist. Skill resolves to URL, calls `fetch_pdf.py`, ingests from the resulting `raw/download/` path. Mode A (local file path) unchanged.

### Changed
- Source frontmatter field `url: <string>` renamed to `urls: <array>` for symmetry with `raw_paths: array`. Multiple URLs supported per source (arxiv abs, DOI, repo, slides). Lint type validation expects `urls` to be an array; legacy `url` string entries flagged as unknown field. Migration handled by `/lumi-migrate-legacy` (detects and rewrites `url: <str>` → `urls: [<str>]`).
- Provenance semantic reframed raw-centric (enum unchanged, 3 values):
  - `replayable` now requires `raw_paths` non-empty with at least one entry resolving to disk (URL is no longer a precondition — file-only sources qualify).
  - `partial` requires `url` present and no resolvable `raw_paths`.
  - `missing` unchanged.
  Rubric updated in `/lumi-ingest`, `/lumi-research-discover`, `/lumi-migrate-legacy`.
- `/lumi-migrate-legacy` rubric: tier 1 reads ingest checkpoint (`_lumina/_state/ingest-<slug>.json`) for authoritative `source_path`; tier 2 falls back to slug-prefix and URL-derived-ID heuristics across `raw/sources/`, `raw/notes/`, `raw/download/**`, `raw/discovered/**`. Pages whose checkpoint points into `raw/tmp/*` are flagged for the user to relocate before backfill — skill does not auto-move human files.
- Manifest schema: `MANIFEST_SCHEMA_VERSION` 2 → 3. Migration is metadata-only (no manifest field shape change); workspace schema additions (`raw_paths`, `raw/download/`) are additive and backward-compatible — old wikis continue to lint clean (L12 warnings advisory only).
- `/lumi-migrate-legacy`: raised the work-list confirmation gate from 10 to 30 entries. Real wikis commonly have dozens of entries, and the original threshold made every migration a multi-turn chore. Lists ≤30 now proceed after the plan is reported; lists >30 still pause for explicit confirmation, since a large batch usually signals a long-dormant wiki or major schema bump worth spot-checking.

### Fixed
- `/lumi-migrate-legacy`: Step 1.2 and Step 4.1 now use `lint.mjs --summary` for counts and write `--json` to `/tmp/lumi-lint.json` before projecting findings. Avoids the Bash-tool ~30KB stdout cap which truncated full `--json` mid-string on wikis with many findings, breaking inline `JSON.parse`.

### Migration
- Existing source pages without `raw_paths`: no immediate action required. Lint stays green (`raw_paths` is optional, L12 only fires when present-but-broken).
- To backfill `raw_paths` on legacy entries, run `/lumi-migrate-legacy` after upgrading. The skill reads ingest checkpoints and applies the new tier-1/tier-2 rubric.
- If you have wiki sources currently pointing at `raw/tmp/arxiv-ingest/` or similar transient locations (a known artefact of pre-v0.8 agent improvisation): move those PDFs to `raw/download/arxiv/` (matching arxiv ID) or `raw/sources/` (custom-named), then re-run `/lumi-migrate-legacy`. Lint L12 will identify the affected pages.
- Custom tooling reading manifest: bump expected `schemaVersion` to 3 (or accept 2|3 transitionally — the manifest shape is unchanged).

## [0.7.0] - 2026-05-03

### Added
- `/lumi-migrate-legacy` core skill — LLM-driven backfill of provenance/confidence
- `CHANGELOG.md` shipped to `_lumina/CHANGELOG.md` for skill consumption
- Post-upgrade installer banner with lint summary (errors/warnings) when version bumps
- Manifest `schemaVersion` bump 1 → 2 with `legacyMigrationNeeded` flag

### Migration
- Upgrades from <0.6 set `legacyMigrationNeeded: true` in manifest. Run `/lumi-migrate-legacy` or `wiki.mjs migrate --add-defaults` to backfill `provenance` and `confidence` fields on existing sources/concepts.

---

## [0.6.0] - 2026-05-03

### Added
- Schema: `provenance` field (required enum: `replayable|partial|missing`) on source nodes
- Schema: `confidence` field (optional float 0–1) on source and concept nodes
- Lint check L11: warns when `confidence` is missing on sources/concepts
- Lint `--summary` flag outputs stable JSON shape `{ by_check: { L01..L11 } }` for machine consumption
- `wiki.mjs`: 8-hex `session_id` segment in log entries; `LUMINA_SESSION_ID` env override for multi-write correlation
- Installer `migrateManifest` helper for forward-compatible `schemaVersion` upgrades (1→1 no-op today, ready for 1→2)
- Skills: provenance/confidence rubric added to `/lumi-ingest`, `/lumi-discover`, `/lumi-prefill`
- ROADMAP: v1.0 `/lumi-verify` pass planned (3 stages: grounding A wiki↔raw, drift B raw↔URL, external C wiki↔web)

### Fixed
- CI: enumerate test files explicitly; use `fileURLToPath` for CLI path resolution
- CI: quote test globs for Windows; install `requests` for Python tests
- CI: spawn `npm.cmd` via shell on Windows
- Scripts: resolve `reset.mjs` and `wiki.mjs` paths with `fileURLToPath`
- Tools: strip Windows-illegal characters from discovery source IDs
- Docs: recommend `qmd` skill for local search across all README language files

### Migration
- Sources need `provenance` (required) added; concepts and sources may add `confidence` (optional).
- Run `wiki.mjs migrate --add-defaults` for deterministic backfill (sets `provenance: missing`, omits `confidence`), or `/lumi-migrate-legacy` (v0.7+) for LLM-driven backfill.
- `log.md` entries now include `session:<8hex>` segment — backward-compatible parser; no migration needed for existing log entries.
- `lint --summary` JSON shape is stable from this version forward; scripts consuming raw lint output should migrate to `--summary`.

---

## [0.5.0] - 2026-05-03

### Added
- Foundation aliases in wiki: named aliases for foundation nodes enable cross-skill deduplication
- `wiki.mjs resolve-alias` command for alias lookup
- Research: `/lumi-prefill` handles Wikipedia disambiguation pages and title collisions gracefully
- Research: `/lumi-discover` surfaces entry purpose field and deduplicates ingested papers; logs discovery phases

### Fixed
- `wiki.mjs resolve-alias` no-match error now unwrapped to correct stderr format

### Changed
- Policy: cross-model review framed around bundled infra, not bias — second-model review is user choice, not blocked

### Migration
- No schema changes. No migration needed.

---

## [0.4.0] - 2026-05-02

### Added
- GEMINI.md agent entry-point stub for Gemini IDE targets
- README restructured into multi-language files; skill names updated throughout
- Obsidian vault setup documented across all language READMEs; agent entry-point stubs excluded from vault
- Contributor guide added (`docs/`)

### Changed
- Skill `canonicalId` values namespaced with pack prefix (e.g. `research:lumi-discover`)
- Installer: BMAD-style directory prompt; `project_name` auto-derived from directory
- Installer: broadened Codex target; added `qwen` and `iflow` CLI targets
- Installer: yellow LUMINA WIKI banner shown on install

### Migration
- If referencing skill `canonicalId` values in custom tooling, update to pack-prefixed form (e.g. `lumi-discover` → `research:lumi-discover`). Skill filenames and slash-command names are unchanged.

---

## [0.3.0] - 2026-05-02

### Added
- `extract_pdf.py` shipped as core PDF extractor for all installs (no opt-in required)

### Migration
- No schema or API changes. No migration needed.

---

## [0.2.0] - 2026-05-02

### Added
- Full installer with pack system (`core`, `research`, `reading`)
- CI matrix and package readiness checks (`ci:idempotency`, `ci:package`)
- Agent context files: `CLAUDE.md`, `AGENTS.md`, dev guide, sandbox helper
- `.gitignore` for `node_modules`, `__pycache__`, `.env`, editor files
- Skills output flattened to `.agents/skills/lumi-*` layout
- Installer: yellow LUMINA WIKI banner, 5-prompt flow, 3-file manifest
- README: badges, language links, end-user docs
- Tagline: "Where Knowledge Starts to Glow"
- ROADMAP: v1 daily-fetch and v2 source/ranking expansion plans

### Changed
- `.agents/skills/` output renamed from nested layout to flat `lumi-*` prefix

### Migration
- Fresh install from v0.1: re-run `npx lumina-wiki install --yes`. Existing `raw/` and `wiki/` content is preserved.

---

## [0.1.0] - 2026-05-01

### Added
- Initial npm package scaffold
- Core scripts: `wiki.mjs` (graph/frontmatter engine), `lint.mjs` (9 checks), `reset.mjs`, `schemas.mjs`
- 14 skills locked: 6 core (`/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`), 4 research, 4 reading
- Installer entry point `bin/lumina.js` (ESM, lazy imports, <300 ms cold start)
- Atomic write discipline (`atomicWrite` with `fd.datasync()` + rename) throughout
- `safePath()` path validation rejecting `..`, absolute paths, Windows drive letters
- Bidirectional link enforcement; `raw/` read-only except `raw/tmp/` and `raw/discovered/`
- PRD, architecture docs, and v0.1 quick-spec

### Migration
- First release. No prior version to migrate from.

---

[Unreleased]: https://github.com/tronghieu/lumina-wiki/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tronghieu/lumina-wiki/releases/tag/v0.1.0
