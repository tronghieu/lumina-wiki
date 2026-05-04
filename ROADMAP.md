# Lumina-Wiki Roadmap

Current shipped version: **v0.2.0**.

This document tracks planned upgrades. Scope is non-binding — items move between milestones as priorities shift.

---

## v0.9.0 — `/lumi-verify` + `/lumi-ingest` workflow (implementing — branch `feat/v0.9-lumi-verify`)

**Theme:** ship a check that wiki notes match the sources they cite, plus a multi-step ingest workflow with human-in-the-loop checkpoints, ahead of the broader v1.0 stability lock. Pulled forward from v1.0 because hallucinations introduced at ingest time are the highest-impact failure mode users have reported, and the two skills are most useful when shipped together — verify becomes the conscience inside ingest, ingest becomes the workflow that exercises verify on every new page.

### Shipped surface — `/lumi-verify`

- **New core skill `/lumi-verify`** — opt-in, invoked manually. Three-reviewer adversarial pattern (Blind / Grounding / External) adapted from BMAD's code-review structure. Anti-anchoring is structural: each reviewer is given a deliberately different context slice. Advisory only — never auto-edits wiki body text. Works retroactively on any existing entry (`/lumi-verify <slug>`, `/lumi-verify --all`, `/lumi-verify --since <date>`).
- **Stage flags** — `--grounding | --drift | --external | --all`. Drift collapses into Grounding's preflight (raw-artifact integrity gate); External is gated behind `--external` (token-cost tier). Default offline.
- **Frontmatter contract** — `verify_status` (`passed | findings_pending | drift_detected | skipped | not_applicable`) and `findings: []` added to `sources` entity in `schemas.mjs`. Both optional; existing entries unaffected.
- **Triage schema** — four buckets (`decision_needed | patch | defer | dismiss`), unified across all three reviewers.
- **Output contract** — frontmatter writeback via `wiki.mjs set-meta --json-value` (atomic) + timestamped run report at `_lumina/_state/lumi-verify-<ts>.json`. Runtime state, excluded from `ci-idempotency`.
- **Fallback ladder** — Agent tool (Claude Code) → prompt-files + paste-back (Bash-only IDEs) → `--single` opt-in (single-pass, weakest tier, no anti-anchoring).

### Shipped surface — `/lumi-ingest` multi-step workflow

- **Step-file architecture** — `/lumi-ingest` SKILL.md becomes a thin router (≤80 body lines). Stage prompts live as separate files under `references/step-NN-<name>.md` (draft, lint, verify, finalize). Pattern adapted from BMAD's `bmad-quick-dev` step-file discipline.
- **Four human-in-the-loop gates** — between every stage, the skill HALTs and offers `[A] Accept | [E] Edit | [Q] Quit` (verify gate adds `[W] Accept-with-warning` which downgrades `confidence` to `low`). Gates are the only path to advance state — accept is never silent.
- **Durable gate state** — `ingest_status` enum (`drafted | linted | verified | finalized`) added to `sources` entity. Survives session restart; re-running `/lumi-ingest <slug>` resumes at the right stage. The fine-grained nine-phase checkpoint at `_lumina/_state/ingest-<slug>.json` is unchanged for within-stage resume.
- **Verify gate reuses `/lumi-verify --grounding`** — single source of truth for grounding logic. Ingest stays cheap (one reviewer, no `--external`); users opt into deeper verification post-finalize.
- **Drift is a hard halt** — at the verify gate, `verify_status: drift_detected` forces the user to repair `raw_paths` or explicitly mark `provenance: missing` before advancing.
- **Legacy entries** — pre-v0.9 entries without `ingest_status` are offered a "lint+verify only" path that skips draft.

### Out of scope for v0.9 (parked)

- MCP `llm-review` / second-provider plumbing — still v0.1-scope rule (out of scope, not forbidden).
- Verify on non-`sources` entity types — v0.9 covers `sources` only.
- `--since <date>` batch read-meta path optimization — deferred to v0.10 (see `deferred-work.md` Goal C).

---

## v1.0.0 — First Stable

**Theme:** lock the v0.1 surface as stable and add the smallest set of features that make the research pack genuinely useful day-to-day. No new external sources — that work belongs to v2.0.0. Focus on automation around what we already have.

### Planned features

#### Daily search and fetch

A scheduled paper-discovery loop. The user defines watchlist queries; a runner executes them on a cadence and lands new hits in `raw/discovered/`.

- **Storage:** watchlist queries live in `_lumina/config/watchlist.yml`. Each entry has a slug, a source (`arxiv` | `s2`), a query (category, free-text, or author), and an optional schedule hint (`daily`, `weekly`).
- **Runner:** new script `src/scripts/daily-fetch.mjs`. Reads `watchlist.yml`, calls the existing Python fetchers via subprocess, writes new records as markdown stubs into `raw/discovered/<YYYY-MM-DD>/<slug>/`. Atomic writes only — `raw/discovered/` is the one place under `raw/` that already accepts additions.
- **Dedup:** `_lumina/_state/seen-papers.csv` records every external ID (`arxiv_id`, `doi`, `s2_paper_id`) the runner has ever touched, so re-runs only emit new entries. Treated as runtime state — ignored by `ci-idempotency`.
- **Scheduling:** Lumina does not own the scheduler. Document two options in `docs/DEVELOPMENT.md`: a user-installed `cron` / `launchd` entry, or running `node src/scripts/daily-fetch.mjs` manually / from CI.  No daemon, no background process inside the installer.
- **New skill `/lumi-daily`:** invoked manually, it (a) shows what landed since last run, (b) helps the agent triage `raw/discovered/` into wiki entries via the existing `/lumi-ingest` flow, (c) optionally edits `watchlist.yml` based on user intent.
- **Existing fetcher reuse:** `fetch_arxiv.py daily <category>` already exists; no Python changes required for the arXiv path. S2 path uses `fetch_s2.py search` with a date filter.

#### Verify pass — shipped in v0.9

`/lumi-verify` shipped earlier than originally planned (see v0.9.0 section above). v1.0.0 inherits it as part of the stable surface — no further verify work in this milestone.

#### Other v1.0.0 work

- **Stability lock for v0.1 surface:** freeze CLI flags, exit codes, schema field names, skill names. Anything renamed after v1.0.0 needs a deprecation cycle.
- **Manifest schema versioning:** confirm `_lumina/manifest.json` carries a `schemaVersion` field and that the upgrade path tolerates `1 → 1` no-ops cleanly.
- **First-run hardening:** run the installer's idempotency CI on macOS + Linux + Windows (currently only one matrix entry); add Bun and Node 22 LTS to the test matrix.
- **Docs polish:** README post-install section gets a "first 10 minutes" tour; `docs/lumi-research-setup.md` gets a troubleshooting section for missing API keys.

### Out of scope for v1.0.0

- New paper sources — defer entirely to v2.0.0.
- Paper ranking / scoring — v2.0.0.
- Multi-machine sync of `_lumina/_state/` — users handle this via git or whatever they prefer.
- A hosted Lumina daemon / SaaS layer — not on any roadmap.

### Acceptance criteria

- Running `node src/scripts/daily-fetch.mjs` against a sample `watchlist.yml` produces deterministic new entries in `raw/discovered/<date>/`.
- Re-running the same command on the same day with no new upstream papers writes nothing.
- `npm run ci:idempotency` still green; `_lumina/_state/seen-papers.csv` does not appear in the watched-paths diff.
- `/lumi-daily` skill prompt works end-to-end on a sandbox install.

---

## v2.0.0 — Research Pack Source Expansion

**Theme:** broaden the research pack beyond arXiv + Semantic Scholar so `/lumi-discover`, `/lumi-survey`, `/lumi-prefill` can pull from the full open-access ecosystem and reach legal full-text reliably.

### Background

v0.1 ships four fetchers in `src/tools/`:

- `fetch_arxiv.py` — arXiv (no key)
- `fetch_s2.py` — Semantic Scholar (key)
- `fetch_deepxiv.py` — DeepXiv semantic search over arXiv (key)
- `fetch_wikipedia.py` — Wikipedia (no key)

Gaps identified during v0.1 review:

- No dedicated OA discovery graph beyond Semantic Scholar (S2 free-tier rate limits are tight).
- No DOI → legal full-text resolver — agents cannot reliably get a PDF URL for a known paper.
- No full-text endpoint at all — agents can fetch metadata but not body text without scraping.
- No coverage of conference review/rebuttal data, daily curation feeds, or reproducibility links.

### Planned additions

Each fetcher follows the existing pattern in `src/tools/`:

- Python ≥3.9, `requests.Session()`, no async.
- CLI surface: `python fetch_<name>.py <command> <args>` → JSON to stdout, errors to stderr.
- Exit codes: `0` success, `2` user error, `3` internal/network.
- Secrets via `_env.load_env()`; `.env.example` updated.
- Tests under `src/tools/tests/test_fetch_<name>.py` using `pytest` + `responses` for HTTP mocking.

#### Priority 1 — must-have (free, no friction)

| Tool | Source | Auth | Why |
|---|---|---|---|
| `fetch_openalex.py` | OpenAlex API | None (polite-pool email recommended) | 240M+ works, full citation graph, `open_access.oa_url` field gives a PDF link directly. Largest single coverage gap today. |
| `fetch_unpaywall.py` | Unpaywall API | None (email param required) | DOI → legal OA PDF URL. Pairs with OpenAlex/Crossref to turn any DOI into a downloadable file when one legally exists. |
| `fetch_core.py` | CORE API | `CORE_API_KEY` (free) | Real full-text endpoint (text + PDF), not just metadata. Removes the need for ad-hoc PDF scraping in skills. |

#### Priority 2 — high value, AI-specific

| Tool | Source | Auth | Why |
|---|---|---|---|
| `fetch_openreview.py` | OpenReview API v2 | None for public venues | ICLR / NeurIPS / COLM submissions plus the public reviews and rebuttals. Unique signal: structured peer-review discussion that no other source exposes. |
| `fetch_hf_papers.py` | Hugging Face daily papers | None | Curated daily paper feed, ideal for `/lumi-discover` "what's hot this week" prompts. Often links to associated models/datasets. |
| `fetch_paperswithcode.py` | Papers With Code API | None | Paper ↔ code repo ↔ benchmark linking. Lets `/lumi-survey` annotate entries with reproducibility status. |

#### Priority 3 — nice-to-have

| Tool | Source | Auth | Why |
|---|---|---|---|
| `fetch_crossref.py` | Crossref REST API | None (polite-pool email) | DOI metadata gateway covering closed-access publishers too. Good fallback when OpenAlex is missing a record. |
| `fetch_doaj.py` | DOAJ API | None | Authoritative directory of fully-OA journals. Useful for filtering "is this venue open access?" |
| `fetch_research_blogs.py` | RSS feeds (Anthropic, DeepMind, Meta AI, Microsoft Research, OpenAI, Google Research) | None | Many breakthroughs ship as technical reports / blog posts, not papers. One generic RSS fetcher with a curated source list. |

### Explicitly out of scope for v2.0.0

- **Connected Papers** — no public API.
- **Google Scholar** — no official API; scraping violates ToS.
- **IEEE Xplore / ACM DL / Elsevier / Springer** — paywalled, key required, low OA hit rate. Defer to v3+ if a clear use case emerges.
- **Domain-specific archives** (Inspire-HEP, NASA ADS, bioRxiv, medRxiv, PubMed, HAL, Europe PMC) — outside the AI / CS focus of v0.1's research pack. Could land in a future "science pack" rather than expanding the AI-focused research pack.

### Schema and skill changes

Adding sources is not free at the schema level. v2.0.0 will need:

- **`schemas.mjs`** — extend the `paper` entity frontmatter to carry per-source IDs (`openalex_id`, `core_id`, `doi`, `openreview_id`) without breaking v0.1 papers. Add a `sources` array recording every fetcher that has touched a record, for provenance.
- **`/lumi-discover`** — update prompt to describe the broader source menu and when to prefer each (e.g. "use OpenAlex for citation graph traversal; use CORE only when full text is required").
- **`/lumi-prefill`** — chain DOI → Unpaywall → CORE as a fallback ladder when arXiv has no record.
- **`docs/lumi-research-setup.md`** — provider registration table grows from 3 rows to ~9. Document which keys are required vs. optional.
- **`.env.example`** — add `CORE_API_KEY=`, `OPENALEX_EMAIL=`, `UNPAYWALL_EMAIL=`, `CROSSREF_EMAIL=`.

### Migration and back-compat

- v0.1 papers without the new ID fields stay valid; new fields are optional in `schemas.mjs`.
- Existing `fetch_arxiv.py` / `fetch_s2.py` / `fetch_deepxiv.py` / `fetch_wikipedia.py` keep their CLI signatures unchanged.
- `_lumina/manifest.json` schema version bump from `1` to `2` only if frontmatter migration is non-trivial; the installer's existing upgrade path applies the same idempotency rules (atomic writes, no `raw/` mutation).

### Acceptance criteria

- All Priority 1 fetchers shipped with tests, documented in `docs/lumi-research-setup.md`.
- `npm run test:python` passes including new test files.
- `npm run ci:idempotency` still green — adding fetchers must not destabilize the second-install diff.
- Skill prompts for `/lumi-discover`, `/lumi-survey`, `/lumi-prefill` updated to mention the new fetchers (and only them — no inventing of unsupported sources).
- A worked example in `docs/DEVELOPMENT.md` showing the OpenAlex → Unpaywall → CORE fallback chain end-to-end.

### Paper ranking and quality scoring

A second axis of v2.0.0 work: enable `/lumi-survey` and a new `/lumi-rank` skill to score papers by influence, reliability, and methodological quality — not just collect them.

#### Ranking signals to surface

| Signal | Source | Notes |
|---|---|---|
| Raw citation count | OpenAlex `cited_by_count`, S2 `citationCount` | Already implicit in v0.1 via `fetch_s2.py`; v2 surfaces it as a first-class score field. |
| Influential citation count | Semantic Scholar `influentialCitationCount` | S2's AI-filtered citation signal — drops boilerplate / courtesy citations. Cheap, already covered by `fetch_s2.py` (just need to expose the field). |
| Field-normalized citation rank | OpenAlex concepts + percentile within concept | Lets `/lumi-rank` say "top 5% in Prompt Engineering 2025" rather than absolute counts. |
| Support vs. contrast citations | **Scite.ai API** | New fetcher `fetch_scite.py`. Scores how many follow-up papers *agree* vs. *contradict* the result. Strongest signal for reliability. Paid API — gate behind `SCITE_API_KEY`. |
| Public attention | **Altmetric API** | New fetcher `fetch_altmetric.py`. Social/news/policy reach — useful for `/lumi-discover` "what's resonating outside academia". Free tier limited. |
| Venue prestige | OpenAlex `host_venue` + SJR/CORE rankings | Optional join against a static SJR/CORE-ranking table shipped in `src/tools/data/`. Avoids a runtime dependency on a paid SJR API. |

#### Out of scope for v2.0.0 ranking work

- **Elicit API** — interesting but young (announced 2026); revisit in v2.1 once the API surface stabilizes.
- **Scholarcy API** — overlaps with what the host LLM (Claude/GPT/Gemini in the user's IDE) can already do at ingest time. Adding a paid third-party summarizer is poor ROI.
- **LLM-based scoring with a separate model** — not bundled in v0.1 (no MCP llm-review server shipped). Any rubric-based scoring (`/lumi-rank` Novelty/Rigor/Impact) runs in the user's host session. Users who want a second-model scorer can wire it in themselves.

#### New skill: `/lumi-rank`

- Inputs: a `paper` entity (or a list) already in the wiki.
- Pipeline: pull all available signals (citations, influential citations, scite tally, altmetric) → write them into the paper's frontmatter under a `ranking:` block → optionally produce a single-model rubric scorecard (Novelty / Methodological Rigor / Reproducibility / Impact) appended to the paper note as a `<!-- user-edited -->`-respecting section.
- Pure read-from-graph + write-back via `wiki.mjs` — no new write paths.
- Rubric scoring runs in the user's host session like all other skills — no special exemption needed.

#### Dedup with existing tools

- Citation counts: handled inside `fetch_s2.py` and `fetch_openalex.py` — no new fetcher needed, just expose `influentialCitationCount` and `cited_by_count` cleanly in their JSON output.
- Only **Scite** and **Altmetric** require net-new fetcher files.

---

## v3.0.0 — KG Consistency & Contradiction Audit

**Theme:** wiki-wide structural and semantic audit of the knowledge graph itself, deliberately **separate from `/lumi-verify`**. Scheduled for v3.0.0 because the audit's value scales with graph density — cross-entry contradiction detection and topology sanity only become meaningful failure modes once the wiki holds enough entries that no single human can hold the whole graph in their head. Shipping it earlier would optimise for a problem users do not yet have.

### Scope and rationale

`/lumi-verify` gates **ingest** — it checks that a single entry's claims are grounded in the sources that entry cites. It is per-entity, source-anchored, and runs at write time.

This audit is a different axis: it inspects the **whole wiki as a graph** and asks questions that no per-entry check can answer:

- Do two entries make claims that directly contradict each other, even when each is individually grounded in its own source?
- Are edges in `graph/edges.jsonl` semantically appropriate (e.g. `contradicts` vs `extends` vs `refutes_on_subset`), or has the agent picked a label that is structurally valid but semantically wrong?
- Do citation triples narrated in body text match the recorded edges in `graph/`, or has the agent described a relation that was never written to the graph?
- Are there orphan entities, dangling reverse edges, or citation cycles that escaped `/lumi-check`'s structural lint?

Folding this into `/lumi-verify` would conflate two operations with different cadences (per-ingest vs periodic full-graph), different inputs (one entry + its cited raw vs the whole wiki), and different failure modes. They share techniques (triple extraction, NLI) but not lifecycle.

### Planned shape

- **New skill `/lumi-audit`** — opt-in, manually invoked, runs across the entire wiki. Produces an advisory report; never edits content directly. Distinct from `/lumi-check` (structural lint, fast, deterministic) and `/lumi-verify` (per-entry source grounding).
- **Triple extraction pass over `wiki/`** — one LLM pass per entry to extract `(subject, predicate, object)` triples from body prose, normalised against the 28 edge types declared in `schemas.mjs`.
- **Three audit passes, all offline:**
  - **Pass 1 — Edge-graph reconciliation.** For every triple extracted from body text, check that a corresponding edge exists in `graph/edges.jsonl` and that its type is semantically consistent. Flags narrated-but-unrecorded relations and edge-type misuse (e.g. `contradicts` written as `extends`).
  - **Pass 2 — Cross-entry contradiction.** Index all triples across the wiki; flag pairs `(s, p, o)` and `(s, ¬p, o)` — or semantically opposed predicates — appearing in different entries. Catches the "wiki disagrees with itself" failure mode that per-entry verify cannot see.
  - **Pass 3 — Graph topology sanity.** Orphan entities (no inbound edges from a non-foundation entry), citation cycles, asymmetric edges where symmetry is required by `schemas.mjs`. Fully deterministic, no LLM needed.
- **Output contract:** `_lumina/_state/audit-report-<timestamp>.json` plus a human summary appended to `wiki/log.md`. Runtime-only state, excluded from `ci-idempotency`. No automatic edits — suggestions only.

### Explicitly out of scope

- Source-level fact-checking (claim ↔ raw) — belongs to `/lumi-verify`.
- Upstream drift (raw ↔ web) — belongs to `/lumi-verify`.
- World-truth checking (claim ↔ open web) — belongs to `/lumi-verify`.
- Structural lint (kebab slugs, missing reverse edges, dedupe symmetric edges) — stays in `/lumi-check`.

### Acceptance criteria

- `/lumi-audit` runs fully offline against a fixture wiki containing both consistent and contradictory entry pairs; the report classifies them correctly with no false positives on entries that discuss the same entity from different angles without actually contradicting.
- Edge-graph reconciliation correctly flags a body triple that has no matching edge in `graph/edges.jsonl`, and correctly flags an edge whose type is semantically inappropriate for the narrated relation.
- Topology pass detects an injected orphan entity and an injected citation cycle on a fixture wiki, deterministically.
- `npm run ci:idempotency` stays green — no audit-report files in the watched-paths diff.
- Skill name `/lumi-audit` is reserved in `src/skills/`; no overlap, aliasing, or behaviour collision with `/lumi-check` or `/lumi-verify`.

---

## Future (unscheduled)

Ideas captured but not yet committed to a milestone:

- Domain-specific science pack (bio/physics/medicine) layered on top of the research pack.
- Local caching layer for fetcher responses keyed on `_lumina/_state/` so repeated `/lumi-discover` calls within a session don't burn rate budget.
- Cross-source dedup heuristic (same paper across arXiv + OpenAlex + S2) to avoid duplicate `paper` entities in the graph.
- Citation-recommendation skill that walks the OpenAlex citation graph N hops and surfaces under-cited but topically central papers.
- Elicit API integration (deferred from v2.0.0) once its 2026 API stabilizes — structured extraction of sample size, controls, statistical significance per paper.
- A bundled SJR / CORE venue-ranking table under `src/tools/data/` so venue prestige can be looked up offline without a paid API.
