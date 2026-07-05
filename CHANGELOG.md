# Changelog

All notable changes to Lumina-Wiki are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.7.2] - 2026-07-05

### Fixed

- `/lumi-ingest` step-03-verify referenced `src/skills/core/verify/` — the
  repo source tree — instead of the installed workspace path. On any
  non-Claude-Code IDE target (Codex, Gemini, Cursor, generic), the file
  never existed post-install, so grounding verification silently had
  nothing to follow. Fixed all three references to
  `.agents/skills/lumi-verify/`, which the installer copies unconditionally
  for every IDE target.
- Added an `ingest_status` handler for the `not_applicable` verify verdict,
  which was previously unhandled during ingest.

### Added

- `/lumi-ingest` now checks external identifiers (DOI/arxiv/S2) for an
  existing source page before generating a slug, so the same paper
  ingested under a different title no longer creates a duplicate page.
- Concept stub creation now scans existing concepts for acronym/expansion
  and singular/plural variants before creating a new one.
- Key Claims in drafted source pages now require a source locator
  (section/page/heading), so the grounding reviewer in step-03 no longer
  has to re-scan the whole raw file to check a claim.
- A concept-count rubric (roughly 3-7 per source) to keep the graph from
  being diluted by over-extracted keyword stubs.
- PDF preprocessing now runs before type detection in step-01, so runtimes
  without native PDF reading don't fail attempting to read the raw binary.

## [1.7.1] - 2026-07-02

### Added

- `wiki.mjs init --pack learning` now creates `wiki/reflections/`, matching the
  learning pack's entity schema. Valid `--pack` values are derived from the
  schema instead of hardcoded, so future packs stay in sync automatically.

### Fixed

- `/lumi-research-topic` previously failed every `add-edge` call with "Unknown
  edge type" because the topic-organization edges it relies on
  (`includes_source`/`included_in_topic`, `covers_concept`/`covered_by_topic`)
  were missing from the schema. Added all four to `EDGE_TYPES`.
- Corrected skill-prompt and documentation drift: the reset skill's dry-run
  output format, the internal lint-check reference table (was missing
  L10-L12), and the documented behavior of ingest phase checkpoints (keyed
  by file basename, not slug, since the checkpoint exists before slug
  generation; the checkpoint JSON's `slug` field, written once the slug
  phase completes, is now documented as the way other skills match a
  checkpoint to its wiki entry).

## [1.7.0] - 2026-06-16

### Added

- **Advanced paper ranking** via the new research-pack skill
  `/lumi-research-rank`. It scores an already-ingested paper and records the
  results on its source page, both as a machine-readable `ranking:` frontmatter
  block and a human-readable `## Ranking` scorecard. Re-running refreshes the
  ranking and preserves any notes inside `<!-- user-edited -->` markers.
- **Citation influence signal**: surfaces Semantic Scholar's influential-citation
  count alongside the raw citation count (reuses the existing `fetch_s2.py`; no
  new key required).
- **4C qualitative rubric** (Correctness, Clarity, Contribution, Context, each
  scored 1-5) produced with a three-pass reading method to keep the assessment
  efficient. Scores are explicitly recorded as LLM-assessed with a timestamp.
- **Venue prestige** recorded from the agent's own knowledge and explicitly
  flagged as an estimate (`venue_source: llm-estimated`) — no live API or
  bundled dataset.
- **Optional, key-gated influence fetchers** `fetch_scite.py` (Scite.ai Smart
  Citation tallies) and `fetch_altmetric.py` (Altmetric attention score). Both
  degrade gracefully: with no key set they exit with a clear message and the
  skill simply skips that signal. New `.env` keys `SCITE_API_KEY` and
  `ALTMETRIC_API_KEY`.

### Changed

- Source page schema gains an optional `ranking` frontmatter object (no change
  required for existing un-ranked pages).

## [1.6.2] - 2026-06-15

### Fixed

- Repaired stale Claude skill links during upgrades by validating their real
  targets instead of trusting the previously recorded link strategy.
- Made POSIX skill links relative so copied, moved, or renamed workspaces can
  be upgraded without retaining links to their old absolute location.
- Reconciled removed packs and IDE targets by deleting obsolete
  installer-managed skills, tools, links, and unchanged generated stubs while
  preserving modified or user-owned files.
- Made `npx lumina-wiki install` detect and upgrade an enclosing workspace when
  invoked from a nested directory, while explicit `--directory` and `--cwd`
  targets remain exact.
- Fixed interactive locale switching for existing and legacy workspaces,
  including default-language cascading and confirmation binding to the final
  resolved locale.
- Made installation fail clearly when required Claude skill links cannot be
  created instead of writing successful state for a partial install.

## [1.6.1] - 2026-05-18

### Fixed

- Restored v1.6 research tool scripts to the npm package allowlist so
  upgrades include OpenAlex, Unpaywall, CORE, RSS, and PDF resolution tools
  (fixes #20).
- Expanded the package-readiness check (`scripts/ci-package.mjs`) to require
  every Python tool copied by the installer, preventing future research-pack
  tarball omissions.

### Changed

- OpenAlex research tooling now authenticates via `OPENALEX_API_KEY` /
  `api_key` query parameter instead of the deprecated `OPENALEX_MAILTO`
  polite-pool flow. The new key enables OpenAlex's free daily API budget and
  usage tracking. Existing users should rename `OPENALEX_MAILTO` to
  `OPENALEX_API_KEY` in their local `.env` — the old variable is ignored.
- `fetch_openalex.py` search `per_page` is now clamped to 100 (the OpenAlex
  documented maximum) and explicit 401/403 handling surfaces a clear error
  message when the key is rejected.

### CI

- Dropped Node 22 from the test matrix across all OSes due to an upstream
  `node:test` IPC bug (`ERR_TEST_FAILURE` / structured-clone deserialization)
  that surfaced intermittently on Windows, macOS, and Linux runners.
- Cold-start budget gate now runs only on `ubuntu-latest`; Windows and macOS
  hosted runners have filesystem latency that makes the 350 ms threshold
  infeasible regardless of code changes.
- `Node 20 / windows-latest` marked `continue-on-error: true` to surface a
  remaining Windows-only `node:test` flake as a warning instead of blocking
  the build (tracked in #23).

## [1.6.0] - 2026-05-15

### Added — Multi-provider PDF resolution + RSS / Atom feeds (research pack)

- **OpenAlex fetcher** activated as the metadata anchor across the new ladder
  (Phase 1–2). `external_ids.openalex` namespace now persists Work IDs
  (`^W\d+$`).
- **`fetch_unpaywall.py`** — DOI → best OA PDF URL. Requires
  `UNPAYWALL_EMAIL` (free email-of-record).
- **`fetch_core.py`** — CORE search + download-url. Optional
  `CORE_API_KEY`; ladder skips CORE on 429 and warns once.
- **`resolve_pdf.py`** — 2-layer orchestrator. Layer A always runs OpenAlex
  (cross-walks DOI ↔ arXiv ↔ OpenAlex). Layer B is a stop-on-first-200 PDF
  ladder: `oa_url → unpaywall → core → arxiv`. Each provider attempt is
  logged to stderr; the final shape carries `external_ids`, `sources[]`,
  `pdf_path`, and `status` (`ok` | `metadata_only` | `failed`).
- **`fetch_rss.py`** — RSS / Atom poller with etag caching, defusedxml-based
  XXE rejection, per-feed state files under `_lumina/_state/feeds/<id>.json`,
  spill-aware `max_new` cap, and 5000-entry / 90-day `last_seen_guids`
  eviction.
- **Watchlist `type: feed`** items extend `_lumina/config/watchlist.yml`
  additively. v1 files without `type` keep validating (defaults to
  `topic`). Feed URLs are gated to `^https://` and rejected if they start
  with `--` (flag-injection defense-in-depth).
- **`/lumi-research-watch-run`** skill orchestrates a single pass over the
  consolidated watchlist (topics + feeds). User owns scheduling — three
  patterns documented (cron, launchd, Task Scheduler).
- **`cron-daily.sh` wrapper** ships under
  `_lumina/scripts/scheduler-samples/`. Inert until the user wires it into
  their scheduler. Sets `umask 077`, `chmod 600` on the log,
  rotates at 1 MB.
- **`extract_ids_from_text()`** in `id_utils.py` — reusable free-text
  identifier harvester for feed entry titles / summaries / link hrefs.

### Added — Project governance

- `CONTRIBUTING.md` at the repo root: workflow checklists for adding skills,
  fetchers, schema changes, installer changes, and entry-point stubs; the
  trilingual user-docs convention; CI gates; exit-code contract; and a section
  specifically scoped to AI-agent contributors that points at
  `docs/project-context.md`, `CLAUDE.md`, and `docs/DEVELOPMENT.md` as
  load-bearing context.
- `CODE_OF_CONDUCT.md` at the repo root: Contributor Covenant v2.1, contact
  `tronghieu.luu@gmail.com`. Linked from `CONTRIBUTING.md` §2.
- `SECURITY.md` at the repo root: supported-versions table, private
  reporting channels (GitHub Private Vulnerability Reporting + email),
  in-scope / out-of-scope surfaces, severity bands, and coordinated
  disclosure expectations.
- `.github/PULL_REQUEST_TEMPLATE.md`: per-change-type checklists that
  mirror `CONTRIBUTING.md` §5 (skill / fetcher / schema / installer),
  trilingual docs checkpoint, and a rule-deviation prompt.

### Security

- **SSRF guard** (`_safe_url`) on every PDF candidate URL: rejects RFC1918,
  loopback, link-local, multicast, cloud-metadata (169.254.169.254).
  Re-validated post-redirect.
- **`fetch_pdf.py` mid-stream size cap** (`MAX_PDF_BYTES = 100 MiB`) — a
  malicious endpoint that lies about Content-Length now aborts mid-download
  and cleans up `.tmp`.
- **DOI filename hashing** — DOIs are hashed to a 16-char SHA-256 prefix on
  disk to neutralize Windows-reserved-name collisions (CON, PRN, AUX, NUL).
- **XXE pre-parse** — every RSS / Atom body is run through
  `defusedxml.ElementTree.fromstring` before feedparser sees it; DOCTYPE /
  billion-laughs payloads are rejected without state mutation.

### Requirements

- New optional env vars: `UNPAYWALL_EMAIL`, `CORE_API_KEY`. Both gracefully
  skip (ladder continues) when unset.
- `requirements.txt` adds `feedparser>=6.0` (research pack only).

### Backwards compatibility

- `external_ids.openalex` is additive — existing pages continue to validate.
- `sources[]` is additive — entries without an entry stay valid.
  `ns/value` fields drop silently if either is missing or invalid (same
  forgiveness model as the existing `url` field).
- Watchlist v1 (no `type` field) still validates and runs unchanged.
- `fetch_pdf.py` CLI is stable; new helpers (`_safe_url`, `head_check`,
  `MAX_PDF_BYTES`) are additions only.

## [1.5.0] - 2026-05-10

### Added — Learning Pack: `/lumi-learning-reflect` self-reflection skill (PRs #16, #17)

- New optional **learning** pack installable via `npx lumina-wiki install --packs core,learning`.
- New skill `/lumi-learning-reflect`: guides metacognitive self-reflection sessions on any concept or source in the wiki.
  - Creates or updates `wiki/reflections/<slug>.md` — a personal reflection page with a rewritable **"Current understanding"** section and an append-only **"Evolution"** log.
  - AI acts as a metacognitive mirror: reads past entries, quotes the user's own words, and asks prompting questions — but **never writes reflection content**. The user always authors their own understanding.
  - Reflection pages are a personal overlay exempt from bidirectional-link requirements (`reflections/**` added to exempt globs in `schemas.mjs`).
- `schemas.mjs` gains the `reflections` entity type (7 required frontmatter fields: `id`, `title`, `type`, `created`, `updated`, `related_concepts`, `related_sources`, `evolution_count`) scoped to the learning pack.
- `commands.js` registers the learning pack as a valid selectable option (`VALID_PACKS`), creates `wiki/reflections/` on install, and wires up the `/lumi-learning-reflect` skill symlink.
- Template READMEs (EN/VI/ZH) and `lumi-help.csv` catalog updated to include the new skill and Learning Pack install option.
- `cross-reference-packs.md` and `page-templates.md` schema docs extended with reflection page format.
- PR #17 follow-up: locale strings (EN/VI/ZH) for the new pack prompt, `prompts.js` pack description, and `assert.rejects` CI fix.

## [1.4.0] - 2026-05-09

### Added — `/lumi-help` orientation skill (PR #9)

- New core skill `/lumi-help` with three modes:
  - **Mode A — Orientation** (default): reads live workspace state
    (`manifest.json`, `wiki/index.md`, `wiki/log.md`, `raw/`) and recommends
    a single next action. Stale-log surfaces as a 30-day idle hint after
    the primary recommendation, not as the primary action itself.
  - **Mode B — Catalog** (`/lumi-help skills` or `/lumi-help catalog`): parses
    `_lumina/schema/lumi-help.csv` and renders the full skill list grouped by
    pack. Only sections matching installed packs are rendered at install time.
  - **Mode C — Framework Q&A** (`/lumi-help explain <question>`): answers
    how-it-works questions by citing shipped schema docs (`README.md` schema
    block, `page-templates.md`, `cross-reference-packs.md`, `graph-packs.md`,
    and the relevant `SKILL.md`).
- `src/templates/_lumina/schema/lumi-help.csv` — pack-conditional skill
  catalog (CSV, `{{#if pack_*}}` gates rendered at install time). Single
  source of truth for skill names, menu strings, and prerequisite ordering.
- `src/templates/_lumina/schema/lumi-help-runbook.md` — procedural detail
  (bash probes, decision ladder, output formats) separated from the SKILL.md
  contract; loaded on demand.
- `cleanupObsoleteCatalog()` in `manifest.js` removes the pre-v1.4
  `skills-catalog.md` and `_state/skills-manifest.json` on re-install —
  best-effort, `ENOENT` is not an error.
- `scripts/verify-lumi-help.test.mjs` — integrity test: validates CSV header
  contract, column counts, id/menu uniqueness, valid enum values, pack gating,
  and cross-references for all four pack combinations.
- `test:catalog` script wired into `package.json` (`node --test scripts/verify-lumi-help.test.mjs`).
- User guides (EN/VI/ZH) gain a `/lumi-help` section and a "Meet /lumi-help"
  opener in Quick Start.

### Fixed

- `--cwd` / `--directory` flag propagation regression: dropping the
  program-level `process.cwd()` default unmasks user-supplied `--cwd` values
  that were being short-circuited by commander's `??` chain. Pinned by new
  tests in `bin/lumina.deprecations.test.js`.

## [1.3.0] - 2026-05-09

### Added — Local text-document ingestion (research pack)

- `prepare_source.py` (research pack tool) now supports `.docx`, `.rtf`, and
  `.epub` in addition to the existing PDF / TeX / HTML / Markdown formats.
- Hardened against zip-bomb (raw size cap + decompressed total cap) and XXE
  / XML billion-laughs (`defusedxml.defuse_stdlib()`) for ZIP-of-XML formats
  (`.docx`, `.epub`).
- DRM-protected EPUB detection: explicit error with hint instead of an
  opaque parse crash. Lumina does not strip DRM.

### Requirements

- The new format support requires the **research pack**:
  `lumina install --packs core,research`. After install run
  `pip install -r _lumina/tools/requirements.txt` to fetch
  `python-docx`, `striprtf`, `ebooklib`, `beautifulsoup4`, and `defusedxml`.
- Missing libs raise an actionable `ValueError` (CLI exit 2) with the
  `pip install …` hint — no silent empty-text writes.

### Known Limitations

- `.docx`: shapes, text boxes, headers/footers, table cells not extracted.
- `.rtf`: table layout and embedded images discarded.
- `.epub`: images, CSS, footnotes, and cross-references discarded; chapter-
  level segmentation is **not** emitted in v1 — it will land alongside
  `/lumi-chapter-ingest` EPUB support in a future release.
- `.odt`, image (`.png`, `.jpg`) and scanned-PDF ingestion remain out of
  scope. See the roadmap entry "Vision/OCR ingestion" for the follow-up.

## [1.2.0] - 2026-05-07

### Added

- **Multilingual installer (PR #7).** Interactive installer prompts and
  rendered banners now ship in English, Vietnamese, and Simplified Chinese.
  Language is selected at install time and persisted; upgrades read the
  prior choice from manifest config. Localization covers prompts, summary
  output, and post-install banner — workspace template content is unchanged.
- **Persistent HTTP GET cache for fetchers (PR #5).** New
  `_lumina/tools/http_cache.py` provides a content-addressed, file-backed
  cache layer for arxiv / DOI / Semantic Scholar / web GET requests, shared
  across `discover` and `ingest` runs. TTL is configurable via env
  (validated at load time) and a cache schema version pins the on-disk
  format so future shape changes self-invalidate. List-of-tuples query
  params bypass caching by design.
- **Bun smoke job in CI (PR #3).** GitHub Actions now runs a Bun
  compatibility job alongside Node, catching runtime divergences early
  (path resolution, module loading, child-process spawn) without making
  Bun a supported runtime contract.
- **Claude Code GitHub Actions workflows (PR #8).** Two opt-in workflows —
  Claude PR Assistant (mention-triggered) and Claude Code Review (auto on
  PR open/sync) — are shipped under `.github/workflows/`. Both are
  restricted to repository maintainers on this public repo to prevent
  unsolicited token usage from forks.
- Source pages gain an optional `external_ids` frontmatter object holding
  validated cross-source identifiers across four namespaces: `doi`, `arxiv`,
  `s2`, and `url` (canonical form). The namespace registry is locked to
  these four — `openalex`, `isbn`, and `s2_corpus` are reserved but not yet
  implemented.
- New module `_lumina/scripts/external-ids.mjs` and its Python mirror
  `_lumina/tools/id_utils.py` provide pure helpers (`normalizeExternalId`,
  `parseUrlToExternalIds`, `canonicalizeUrl`, `externalIdMatchKey`,
  `expandExternalIds`, `safeIdToken`, `sanitizeExternalIdsObject`). Parity is
  gated by a shared JSON fixture.
- New CLI wrapper `_lumina/scripts/parse-ids.mjs` reads a URL from `argv` and
  emits a validated `external_ids` JSON map. Skill prompts call this instead
  of inline `node -e` interpolation, eliminating shell-injection risk.
- Producers (`/lumi-ingest`, `/lumi-discover`, all fetchers) populate
  `external_ids` automatically. `init_discovery.py --exclude-keys` filters
  candidates by expanded external_ids set so a DOI excludes its arxiv form.
- Three new lint checks on source pages: **L13** (warn — namespace coverage
  derivable from `urls[]`), **L14** (error — invalid identifier value),
  **L16** (warn — `urls[]` ↔ `external_ids` mismatch). L13's remediation
  message points users at `/lumi-migrate-legacy --backfill-ids`.
- Opt-in `/lumi-migrate-legacy --backfill-ids` flag populates `external_ids`
  on legacy source pages from existing `urls[]`. Non-destructive (existing
  keys win) and idempotent. No `--dry-run` — review with `git diff`.
- Source pages gain an optional `sources` frontmatter array recording fetch
  provenance: `[{provider, fetched_at, url?}]`. Each ingest run appends one
  entry — multi-fetch keeps history rather than replacing.
- New CLI wrapper `_lumina/scripts/build-source.mjs` (and the underlying
  `buildSourceEntry` / `build_source_entry` helpers in `external-ids.mjs` /
  `id_utils.py`) constructs one validated entry per fetcher run. Provider
  must be a kebab/snake slug (max 32 chars). `/lumi-ingest` Phase 3 calls
  it after writing `external_ids`.

### Changed

- `init_discovery.py` flag renamed in place: `--exclude-ids` →
  `--exclude-keys`. No deprecation alias (LLM-driven, no human contract).
- `wiki.mjs` `parseFrontmatter` / `stringifyFrontmatter` now round-trip
  top-level YAML object values (block-mapping form). `set-meta external_ids`
  runs `sanitizeExternalIdsObject` automatically — `__proto__` and unknown
  namespaces are stripped before persisting.
- `EXTERNAL_ID_NAMESPACES` source of truth moved from `external-ids.mjs` to
  `schemas.mjs` (where pure-data lives). `external-ids.mjs` now imports and
  re-exports it for back-compat with downstream consumers.

### Migration

- Legacy wikis with no `external_ids` populated will see L13 warnings on
  source pages whose `urls[]` contain an arxiv/doi/s2 URL. Run
  `/lumi-migrate-legacy --backfill-ids` to populate them. The standard
  migration flow (`/lumi-migrate-legacy` without the flag) is unchanged.

## [1.1.0] - 2026-05-06

### Added

- `/lumi-research-topic` skill (research pack) — cluster existing concepts and sources into a thematic topic page under `wiki/topics/`. AI proposes the cluster from the graph; you confirm before anything is written.

### Changed

- READMEs (en/vi/zh) and section titles drop the `(v0.1)` qualifier; skill count badge is now `Skills-Many` so it does not need bumping per release.
- User guides (en/vi/zh) align the `/lumi-ingest` "What you get back" section across languages.

## [1.0.0] - 2026-05-06

### Added

- `lumina discover run` command for one-shot scheduled discovery runs from a workspace watchlist.
- Research-pack watchlist configuration template at install time, with upgrade behavior that preserves user edits.
- Scheduled discovery runner output under `raw/discovered/`, including scoring metadata, duplicate tracking, and run summaries.
- `/lumi-research-watchlist` skill to help users configure research watchlists with an agent.
- Advanced scheduled discovery guides in English, Vietnamese, and Simplified Chinese, covering GitHub Actions, macOS/Linux cron, and Windows Task Scheduler.

### Changed

- User guides now link to the advanced scheduled discovery guide from their guide menu.
- Scheduled discovery documentation now explains what to do after new research is found, including reviewing candidates and ingesting useful sources.
- GitHub Actions guidance now includes auto-commit behavior for discovered research output when a run finds changes.

### Fixed

- Scheduled discovery now exits non-zero when hard source fetch errors occur, so CI and cron jobs do not silently pass failed runs.
- Scheduled discovery now deduplicates the same paper across arXiv and Semantic Scholar before falling back to source-specific IDs.

### Migration

- Existing workspaces can re-run `npx lumina-wiki@latest install --yes` to receive the scheduled discovery runner, watchlist template, and watchlist skill. Existing `wiki/`, `raw/`, and user-edited watchlists are preserved.

## [0.9.1] - 2026-05-05

### Changed

- `/lumi-ingest` now uses selective human review: after the user accepts the draft, link cleanup and source checking continue automatically when clean. The skill asks again only when user judgment is needed, such as unresolved page issues, source-check findings, missing source files, overwrite/restart decisions, or saving with lower confidence.
- Installed agent context now emphasizes plain, everyday communication for non-technical users. Agents should sound like helpful knowledge assistants, use the configured communication language consistently, translate workflow terms, and avoid coding-agent language in user-facing replies.
- README-generated IDE stubs now explicitly point agents to the README's user communication rules while staying thin and regenerated.
- `/lumi-research-prefill` prompts now follow the same language rule and avoid exposing internal tool terms in user-facing choices.
- README and user guide docs in English, Vietnamese, and Simplified Chinese now describe the quieter ingest flow instead of four mandatory checkpoints.

### Fixed

- `package-lock.json` root package version is now aligned with `package.json`.

## [0.9.0] - 2026-05-05

### Added

- `/lumi-verify` — new core skill that cross-checks wiki notes against the raw sources they cite. Runs three independent reviewers (Blind structural, Grounding raw↔wiki, External web confirmation) over a single source entry or the whole wiki. Findings are written back to entry frontmatter (`verify_status`, `findings:`) and to a timestamped run report in `_lumina/_state/`. Advisory only — never edits body text. Works retroactively on any existing entry. Degrades cleanly on Bash-only runtimes (Codex, Gemini, Cursor) by writing per-reviewer prompt files and HALTing for user paste-back.
- `/lumi-ingest` rewritten as a **multi-step workflow** with four human-in-the-loop checkpoints — write the draft, check structure, cross-check claims, save. Each checkpoint pauses for review before the next phase begins. Cross-session resume: the skill reads `ingest_status` from the entry's frontmatter on entry and routes directly to the interrupted step, so a session restart never loses progress.
- Schema: `ingest_status` field (optional enum: `drafted|linted|verified|finalized`) on `sources` — coarse gate-level checkpoint state for cross-session resume. Written by `/lumi-ingest` at each gate; read on entry to route back to the interrupted step.
- Schema: `verify_status` field (optional enum: `passed|findings_pending|drift_detected|skipped|not_applicable`) on `sources` — written by `/lumi-verify` (and by `/lumi-ingest` step 3 which reuses the verify pipeline).
- Schema: `findings` field (optional array) on `sources` — structured finding records with fields `id`, `reviewer`, `class`, `claim`, `evidence`, `action`. Shape validated by `verify-frontmatter`; malformed items fail lint.
- Step files `src/skills/core/ingest/references/step-0{1-4}-*.md` — each gate lives in its own file loaded on demand; main `SKILL.md` is a thin router (≤80 lines) that reads `ingest_status` and loads the right step file.

### Changed

- `/lumi-ingest` description updated across all READMEs and user guides (EN, VI, ZH) to reflect the four-checkpoint workflow in plain language.
- `ROADMAP.md`: v0.9 section marked shipping-complete; "deferred to v0.10" placeholder removed.
- Skills table count updated to 15 (was 14) in installer and README badges to reflect the new `/lumi-verify` addition.

### Migration

- Existing source pages without `ingest_status` or `verify_status`: no action required. Both fields are optional; lint stays green.
- Entries currently mid-ingest (session interrupted before v0.9): treated as legacy on next `/lumi-ingest` call — offered lint+verify-only pass or full re-ingest.
- Custom tooling reading `schemas.mjs`: three new fields added (`ingest_status`, `verify_status`, `findings`). All additive; no removals or renames.

## [0.8.1] - 2026-05-03

### Fixed
- L02 now warns when a source page still carries the legacy `url:` (string) frontmatter field that was renamed to `urls:` (array) in v0.8. Without this, upgrades from v0.7 → v0.8 produced a clean lint result and the post-upgrade installer banner stayed silent — even though the wiki needed `/lumi-migrate-legacy` to convert the field. The legacy field is ignored at runtime, not invalid; the warning is purely a migration nudge.

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

[Unreleased]: https://github.com/tronghieu/lumina-wiki/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/tronghieu/lumina-wiki/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/tronghieu/lumina-wiki/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/tronghieu/lumina-wiki/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/tronghieu/lumina-wiki/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/tronghieu/lumina-wiki/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.9.1...v1.0.0
[0.9.1]: https://github.com/tronghieu/lumina-wiki/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/tronghieu/lumina-wiki/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tronghieu/lumina-wiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tronghieu/lumina-wiki/releases/tag/v0.1.0
