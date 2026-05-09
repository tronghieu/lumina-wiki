# Lumina-Wiki — Project Overview & PDR

**Version:** 1.1.0 (2026-05-06)  
**Status:** Stable  
**Repository:** [github.com/tronghieu/lumina-wiki](https://github.com/tronghieu/lumina-wiki)  
**Package:** [lumina-wiki on npm](https://www.npmjs.com/package/lumina-wiki)

---

## Vision

Turn every AI agent into a personal knowledge assistant by scaffolding an LLM-maintainable research wiki in seconds. Realize Karpathy's LLM-Wiki vision — the LLM reads a structured, cross-referenced knowledge graph instead of re-deriving insights from raw chunks on every query.

---

## Problem & Solution

**Problem:** Researchers and engineers waste time re-reading the same papers, re-deriving the same concepts, and losing context between sessions because knowledge lives scattered across PDFs, notes, and browser tabs.

**Solution:** Lumina-Wiki installs a one-command knowledge workspace (`npx lumina-wiki install`) that agents maintain over time. You provide raw materials (`raw/` folder); agents build a structured wiki (`wiki/`) with frontmatter, bidirectional links, and a queryable graph. Every query uses the agent's compiled knowledge, not raw chunks.

---

## Target Users

- **Researchers** running multiple literature reviews across papers, topics, and ideas
- **Engineers** building knowledge bases for code, architecture, and system design
- **Students** synthesizing course materials, notes, and external resources
- **LLM-power-users** (Claude Code, Codex, Cursor, Gemini CLI) who want a persistent "second brain"

---

## Core Workflow

```
raw/                       →  /lumi-ingest   →   wiki/
(your inputs)              (agent processes)      (structured KB)
- PDF, .txt, notes         ┌──────────────┐      - concept.md
- research downloads       │ Extract text │      - source.md
                           │ Build links  │      - frontmatter
                           │ Cross-ref    │      - graph/
                           └──────────────┘
     ↓↓↓                                     ↑↑↑
  You manage              /lumi-ask, /lumi-ask
  (append, never edit)    (query against graph)
```

Three-step loop:
1. Place documents in `raw/`.
2. Run `/lumi-ingest` to parse and cross-reference.
3. Query with `/lumi-ask` against the compiled wiki.

---

## Scope: v0.1 / v1.x

### Installed Components

- **Installer** (`bin/lumina.js`): Cross-platform, atomic file writes, symlink fallback ladder (Windows compat).
- **Wiki Engine** (`src/scripts/wiki.mjs`): Graph mutation, frontmatter validation, bidirectional link enforcement.
- **Linter** (`src/scripts/lint.mjs`): 9 checks for schema compliance, slug format, missing reverse links, index freshness.
- **Skills** (14 total; v1.1.0):
  - **Core** (6, always installed): `/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`
  - **Research pack** (4, opt-in): `/lumi-discover`, `/lumi-survey`, `/lumi-prefill`, `/lumi-research-topic`
  - **Reading pack** (4, opt-in): `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`
- **Python Tools**:
  - **Core:** `extract_pdf.py` (text extraction from PDFs; shipped with all installs).
  - **Research pack:** `prepare_source.py` (local source preparation — .pdf, .tex, .html, .md, .txt), `fetch_arxiv.py`, `fetch_s2.py`, `fetch_wikipedia.py`, `fetch_deepxiv.py`.

### Architecture

Two layers:
- **Installer layer** — Node ESM (≥20), no native modules, sub-300ms cold-start, idempotent (install twice → git diff is empty).
- **Workspace payload** — Node scripts + Python tools + Markdown skill prompts (no runtime dependencies on installer).

### Core Invariants

| Invariant | Enforced By |
|-----------|-------------|
| `raw/` is read-only | Installer + schema policy |
| `graph/` is auto-generated | `wiki.mjs rebuild` only |
| Bidirectional links mandatory | `wiki.mjs` + linter L06 |
| `log.md` append-only | `wiki.mjs` contract |
| Atomic file writes | `atomicWrite()` helper |
| Exit codes contractual | `bin/lumina.js` exit guard |

---

## Non-Goals (v0.1)

- MCP `llm-review` bundling (users can wire in second-model review themselves).
- LaTeX, paper-generation, or rebuttal workflows.
- Standalone GUI / desktop app (next phase).
- Telemetry or cloud sync (zero network except optional npm registry check).
- Custom domain-specific packs (pre-designed templates are future work).

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Install time | < 60 s | ✓ |
| Cold-start CLI | < 300 ms | ✓ |
| Idempotent reinstall | `git diff` empty | ✓ |
| Cross-platform (Node 20/22 × macOS/Linux/Windows) | 6-cell CI green | ✓ |
| Zero-tolerance path safety | No `..` / absolute traversal | ✓ |
| User adoption | Open-source usage, GitHub stars | Growing |
| Skill extensibility | 3+ custom-authored packs possible | ✓ (research/reading packs ship; more TBD) |

---

## Release History

- **v1.1.0** (2026-05-06): `/lumi-research-topic` skill, improved READMEs & guides.
- **v1.0.0** (2026-05-06): Scheduled discovery runner, watchlist configuration.
- **v0.9.x** (2026-05-05): `/lumi-verify` cross-check, multi-step `/lumi-ingest` workflow.
- **v0.8.x** (2026-05-03): `raw_paths` field, `fetch_pdf.py`, Mode B URL ingestion.
- **v0.5.0** (2026-05-02): Initial public release.

See [CHANGELOG.md](../CHANGELOG.md) for full release notes.

---

## See Also

- **User-facing intro:** [README.md](../README.md) (or `README.vi.md`, `README.zh.md`)
- **Agent rules & architecture:** [CLAUDE.md](../CLAUDE.md)
- **Critical rules for developers:** [docs/project-context.md](./project-context.md)
- **Local dev & testing:** [docs/DEVELOPMENT.md](./DEVELOPMENT.md)
- **Locked v0.1 architecture:** [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md)
- **Full PRD:** [docs/planning-artifacts/prd.md](./planning-artifacts/prd.md)
- **Feature specs:** [docs/planning-artifacts/specs/](./planning-artifacts/specs/)
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
