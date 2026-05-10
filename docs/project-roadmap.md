# Lumina-Wiki — Roadmap Snapshot

**Current Version:** 1.1.0 (2026-05-06)  
**Canonical source:** [ROADMAP.md](../ROADMAP.md) at project root  
**Updated:** 2026-05-06

---

## Current Release Highlights

**v1.1.0** adds `/lumi-research-topic` skill (research pack) — cluster existing concepts and sources into a thematic topic page under `wiki/topics/`. AI proposes the cluster from the graph; you confirm before anything is written.

**v1.0.0** brings scheduled discovery runner and watchlist configuration for background research monitoring.

See [CHANGELOG.md](../CHANGELOG.md) for full release history.

---

## Near-term (v1.x Maintenance & Polish)

Focus: Stability, local capabilities, and v1.x feature expansion.

| Feature | Status | Spec |
|---------|--------|------|
| **`/lumi-help` RAG-based assistant** | Planned | [spec-lumi-help.md](./planning-artifacts/specs/spec-lumi-help.md) |
| **Multilingual installer** (EN/VI/ZH prompts) | Planned | [spec-multilingual-installer.md](./planning-artifacts/specs/spec-multilingual-installer.md) |
| **Local text-document ingestion** (.docx, .rtf, .epub) | Planned | — |
| **Vision/OCR ingestion** (.png, .jpg, scanned PDF) | Design pending | — |
| **Paper ranking & influence** (citation counts, altmetrics) | Planned | [spec-paper-ranking.md](./planning-artifacts/specs/spec-paper-ranking.md) |
| **CI/CD hardening** (Bun, Node 22 LTS) | Planned | — |
| **Stability lock** (CLI contract published; --cwd deprecation; exit-4 cancellation) | Shipped v1.x | — |
| **Schema parity** (cross-source ID handling) | In progress | — |

---

## Long-term (Deep Capabilities & Integrity)

Focus: Structural expansion, multi-source synthesis, and rich ingestion.

| Feature | Status | Spec |
|---------|--------|------|
| **Research expansion** (OpenAlex, CORE, Unpaywall, RSS) | Proposed | [spec-research-expansion.md](./planning-artifacts/specs/spec-research-expansion.md) |
| **Google Workspace integration** (Docs, Sheets) | Proposed | [spec-universal-ingestion.md](./planning-artifacts/specs/spec-universal-ingestion.md) |
| **Multimedia ingestion** (Audio, YouTube, podcasts via transcripts) | Proposed | [spec-universal-ingestion.md](./planning-artifacts/specs/spec-universal-ingestion.md) |
| **Knowledge graph auditing** (semantic consistency checks, contradiction detection) | Proposed | [spec-kg-audit.md](./planning-artifacts/specs/spec-kg-audit.md) |

---

## Proposed (Future Explorations)

Lower priority; research, community feedback, or alignment with external needs may accelerate:

- **Domain packs** — Specialized biomedical / physics / ML-specific templates and skills
- **Local cache layer** — Session-level caching for fetcher responses to optimize rate limits
- **Intelligence layer** — Graph-walking algorithms for "missing link" or "relevant paper" recommendations
- **Desktop app** — Electron/Tauri standalone UI for richer GUI and native OS integration

---

## Recently Completed (v0.9–v1.1)

| Release | Date | Highlights |
|---------|------|-----------|
| **v1.1.0** | 2026-05-06 | `/lumi-research-topic` skill; improved READMEs; CLI contract published; --cwd deprecation; exit-4 cancellation |
| **v1.0.0** | 2026-05-06 | Scheduled discovery runner; watchlist config; multi-IDE support finalized |
| **v0.9.x** | 2026-05-05 | `/lumi-verify` cross-check skill; multi-step `/lumi-ingest` workflow with checkpoints |
| **v0.8.x** | 2026-05-03 | `raw_paths` field; `fetch_pdf.py` tool; Mode B URL ingestion |
| **v0.5.0** | 2026-05-02 | Initial public release on npm |

---

## Success Criteria (v0.1+)

All locked:

- ✅ **Install time:** < 60 s (baseline)
- ✅ **Cold-start CLI:** < 300 ms (baseline)
- ✅ **Idempotent reinstall:** `git diff` empty over watched paths
- ✅ **Cross-platform:** Node 20/22 × {macOS, Linux, Windows}
- ✅ **Zero path safety issues:** `safePath()` enforced everywhere
- ✅ **Skills installed correctly:** Symlink ladder works; fallback to copy on Windows
- ✅ **Zero telemetry:** Only optional npm registry version check (2s timeout)

---

## Backlog & Deferred Work

See [docs/implementation-artifacts/deferred-work.md](./implementation-artifacts/deferred-work.md) for items explicitly deferred:

- v0.10+ feature specs
- MCP server for /llm-review (users can wire in themselves)
- LaTeX/paper-generation pipelines
- Custom domain packs

---

## How to Track Progress

1. **Detailed specs:** Browse [docs/planning-artifacts/specs/](./planning-artifacts/specs/) for near-term and long-term features
2. **Implementation notes:** [docs/implementation-artifacts/](./implementation-artifacts/) tracks completed & deferred work
3. **Release notes:** [CHANGELOG.md](../CHANGELOG.md) documents what shipped in each version
4. **GitHub issues:** Open tickets reflect community needs and maintenance priorities

---

## For Contributors

- **Starting a feature?** Check [docs/project-context.md](./project-context.md) for critical rules, then [docs/DEVELOPMENT.md](./DEVELOPMENT.md) for dev setup.
- **Architecture questions?** Read [docs/system-architecture.md](./system-architecture.md) for two-layer design, then [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md) for locked decisions.
- **Code standards?** See [docs/code-standards.md](./code-standards.md) for checklist and non-negotiables.

---

## See Also

- **Canonical roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Changelog:** [CHANGELOG.md](../CHANGELOG.md)
- **Full PRD:** [docs/planning-artifacts/prd.md](./planning-artifacts/prd.md)
- **Feature specs:** [docs/planning-artifacts/specs/](./planning-artifacts/specs/)
- **Project overview:** [docs/project-overview-pdr.md](./project-overview-pdr.md)
