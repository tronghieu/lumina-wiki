# Lumina-Wiki Roadmap

Lumina-Wiki has reached **v1.7.0** stable.
This roadmap tracks intentions and planned upgrades, categorized by timeframe and impact.

**Shipped in v1.2 (2026-05-07):** Multilingual installer (EN/VI/ZH) · Bun smoke + Node 22 LTS in CI · Schema parity for cross-source IDs (`external_ids` namespace) · Persistent HTTP GET cache for fetchers.

**Shipped in v1.4 (2026-05-09):** `/lumi-help` RAG-based orientation skill · Learning Pack (`/lumi-learning-reflect` self-reflection infrastructure).

**Shipped in v1.6 (pending release):** Research & Discovery Expansion — multi-provider PDF resolution ladder (OpenAlex → Unpaywall → CORE → arXiv) · RSS / Atom feed monitoring (`type: feed` watchlist items, etag caching, XXE rejection) · `/lumi-research-watch-run` skill · `cron-daily.sh` wrapper.

**Shipped in v1.7 (2026-06-16):** Advanced Paper Ranking — `/lumi-research-rank` skill · Semantic Scholar influential-citation signal · 4C qualitative rubric (Correctness / Clarity / Contribution / Context) via three-pass reading · LLM-estimated venue prestige (flagged) · optional key-gated `fetch_scite.py` + `fetch_altmetric.py` fetchers · optional `ranking` source frontmatter block.

---

## Near-term
*Focus: Stability, Polish, and v1.x maintenance.*

- ~~**`/lumi-help` Skill:** Implement a RAG-based internal assistant (inspired by `bmad-help`) to provide instant usage guidance and replace static onboarding.~~ **Shipped in v1.4.**
  - *Spec:* [Lumina Help Skill](./docs/planning-artifacts/specs/spec-lumi-help.md)
- ~~**Learning Pack:** Self-reflection infrastructure (`/lumi-learning-reflect`) — guided metacognitive sessions that track how the user's understanding of a concept evolves over time.~~ **Shipped in v1.4.**
  - *Spec:* [Learning Pack Self-Reflection](./docs/planning-artifacts/specs/spec-learning-pack-reflection.md)
- ~~**Multilingual Installer:** Support English, Vietnamese, and Chinese during the installation process, including localized CLI prompts and documentation seeding.~~ **Shipped in v1.2.**
  - *Spec:* [Multilingual Installer](./docs/planning-artifacts/specs/spec-multilingual-installer.md)
- ~~**Local Text-Document Ingestion:** Expand `/lumi-ingest` to support local `.docx`, `.rtf`, and `.epub` (research pack).~~ **Shipped in v1.x** (research pack only; `pip install -r _lumina/tools/requirements.txt`).
- ~~**CI/CD Hardening:** Expand the test matrix to include Bun and Node 22 LTS environments.~~ **Shipped in v1.2.**
- **Stability Lock:** Finalize CLI flags and exit code contracts to ensure long-term tool compatibility.
- ~~**Schema Parity:** Standardize cross-source ID handling across all core and research skills.~~ **Shipped in v1.2** (`external_ids` namespace, `sources[]` provenance, lint L13/L14/L16).
- ~~**Research & Discovery Expansion:** Broaden coverage to OpenAlex, CORE, Unpaywall, and RSS feeds.~~ **Shipped in v1.6 (pending release).** Multi-provider PDF resolution ladder (OpenAlex → Unpaywall → CORE → arXiv) with always-on OpenAlex metadata anchor; RSS / Atom feed monitoring as first-class watchlist items; `/lumi-research-watch-run` skill for on-demand polling; `cron-daily.sh` wrapper for scheduled invocation.
  - *Spec:* [Research Source & Discovery Expansion](./docs/planning-artifacts/specs/spec-research-expansion.md)
- ~~**Advanced Ranking:** Integrate influential citation counts and altmetrics into the core discovery flow.~~ **Shipped in v1.7 (2026-06-16).** `/lumi-research-rank` records a Semantic Scholar influential-citation signal, optional key-gated Scite/Altmetric signals, an LLM-estimated (flagged) venue tier, and a 4C qualitative scorecard onto each source page.
  - *Outcome:* Surface quality and influence signals to prioritize research reading.
  - *Spec:* [Paper Ranking & Quality](./docs/planning-artifacts/specs/spec-paper-ranking.md)

## Long-term
*Focus: Deep capabilities and structural integrity.*

- **Image OCR & Scanned PDF Ingestion:** Bring screenshots, scanned receipts, and image-only PDFs into the wiki via OCR.
- **Paper Version Tracking:** Detect when an already-ingested paper has received an update (new preprint revision or official published version) and surface the delta to the user for re-ingestion or annotation.
- **Google Workspace Integration:** Seamless ingestion of Google Docs and Sheets into the wiki graph.
  - *Outcome:* Users can treat their Google Drive as a primary research source library.
  - *Spec:* [Universal & Multimodal Ingestion](./docs/planning-artifacts/specs/spec-universal-ingestion.md)
- **Multimedia Intelligence:** Ingest Audio and YouTube content via transcripts.
  - *Outcome:* Knowledge synthesis from podcasts, lectures, and webinars with timestamp-linked references.
  - *Spec:* [Universal & Multimodal Ingestion](./docs/planning-artifacts/specs/spec-universal-ingestion.md)
- **Knowledge Graph Auditing:** Implement wiki-wide semantic consistency checks.
  - *Outcome:* Automated detection of contradictions and structural drift.
  - *Spec:* [KG Consistency Audit](./docs/planning-artifacts/specs/spec-kg-audit.md)

## Proposed
*Focus: Future explorations and specialized extensions.*

- **Domain Packs:** Create specialized "Science Packs" for bio-medical or physics domains.
- ~~**Local Cache Layer:** Implement session-level caching for fetcher responses to optimize rate limits.~~ **Shipped in v1.2** (persistent HTTP GET cache via `_lumina/tools/http_cache.py`).
- **Intelligence Layer:** Graph-walking algorithms for proactive "missing link" or "relevant paper" recommendations.
- **Desktop Application:** Explore a standalone desktop environment (Electron/Tauri) for a richer GUI-driven experience and native OS integration.

---
*Note: This roadmap is non-binding and evolved based on research needs and technical feasibility.*
