# Lumina-Wiki — Codebase Summary

**Project:** Multi-IDE, npm-published wiki scaffolder  
**Runtime:** Node ESM ≥20, Python 3.9+ (optional)  
**Current Version:** 1.1.0 (2026-05-06)  
**Total LOC:** ~12,273 (src/installer + src/scripts)

---

## Repository Structure

```
lumina-wiki/
├── bin/
│   └── lumina.js                 # CLI entry point (ESM, lazy-imports subcommands)
├── src/
│   ├── installer/                # Installer modules (Node, ESM)
│   │   ├── commands.js           # 18-step install/upgrade flow [1090 LOC]
│   │   ├── fs.js                 # Atomic writes, symlink ladder, safePath()
│   │   ├── manifest.js           # Manifest read/write (JSON with CSV state)
│   │   ├── template-engine.js    # {{var}} + {{#if}} rendering
│   │   ├── prompts.js            # @clack/prompts UX (lazy-loaded)
│   │   ├── update-check.js       # npm registry version check (2s timeout)
│   │   ├── banner.js             # TTY-aware colorized output
│   │   └── *.test.js             # Unit + integration tests (node --test)
│   ├── scripts/                  # Wiki engine & tools (Node, ESM)
│   │   ├── wiki.mjs              # Graph mutation, frontmatter validation
│   │   ├── lint.mjs              # Schema linter (9 checks: L01–L09)
│   │   ├── reset.mjs             # Scoped destructive reset (--scope all)
│   │   ├── schemas.mjs           # Single source of truth (entities, edges, frontmatter)
│   │   ├── discover-runner.mjs   # Scheduled discovery scheduler
│   │   ├── lib/*.mjs             # Helper modules
│   │   └── *.test.mjs            # Tests (node --test)
│   ├── tools/                    # Python tools (optional, research pack)
│   │   ├── extract_pdf.py        # PDF text extraction [core]
│   │   ├── discover.py           # Research discovery orchestrator
│   │   ├── fetch_arxiv.py        # arXiv API fetcher
│   │   ├── fetch_s2.py           # Semantic Scholar fetcher
│   │   ├── fetch_wikipedia.py    # Wikipedia fetcher
│   │   ├── fetch_deepxiv.py      # DeepXiv (preprint aggregator) fetcher
│   │   ├── fetch_pdf.py          # Generic PDF downloader
│   │   ├── prepare_source.py     # Content prep (.pdf, .tex, .html, .md, .txt)
│   │   ├── init_discovery.py     # Watchlist initialization
│   │   ├── _env.py               # Environment & API key loader
│   │   └── tests/                # pytest suite
│   ├── skills/                   # Agent prompts (Markdown)
│   │   ├── core/                 # 6 core skills (always installed)
│   │   │   ├── init/SKILL.md
│   │   │   ├── ingest/SKILL.md
│   │   │   ├── ask/SKILL.md
│   │   │   ├── edit/SKILL.md
│   │   │   ├── check/SKILL.md
│   │   │   └── reset/SKILL.md
│   │   ├── research/             # 4 research skills (opt-in)
│   │   │   ├── discover/SKILL.md
│   │   │   ├── survey/SKILL.md
│   │   │   ├── prefill/SKILL.md
│   │   │   └── research-topic/SKILL.md
│   │   └── reading/              # 4 reading skills (opt-in)
│   │       ├── chapter-ingest/SKILL.md
│   │       ├── character-track/SKILL.md
│   │       ├── theme-map/SKILL.md
│   │       └── plot-recap/SKILL.md
│   └── templates/                # Workspace payload (rendered at install)
│       ├── _lumina/              # Framework config & state (never edit directly)
│       ├── wiki/                 # Empty seed directory
│       ├── raw/                  # User-provided input
│       ├── README.md             # Canonical agent-context file
│       ├── CLAUDE.md, AGENTS.md, GEMINI.md # IDE stubs
│       └── .env.example          # Optional API key template
├── scripts/                      # CI/dev helpers
│   ├── dev-sandbox.mjs           # Temp-dir install harness
│   ├── ci-idempotency.mjs        # Reinstall + git-diff gate
│   └── ci-package.mjs            # Validate npm pack output
├── docs/                         # Developer documentation
│   ├── project-context.md        # Critical rules for AI agents
│   ├── DEVELOPMENT.md            # Local dev/test workflows
│   ├── deployment.md             # Cloudflare Pages deployment
│   ├── planning-artifacts/       # Architecture decisions, specs
│   ├── implementation-artifacts/ # Deferred work, implementation notes
│   └── user-guide/               # End-user guides (EN, VI, ZH)
├── .github/workflows/            # CI matrix (Node 20/22 × 3 platforms)
├── package.json                  # ESM, no devDependencies, 5 deps
├── package-lock.json
├── CLAUDE.md                     # Agent rules (read first)
├── README.md                     # User-facing intro + schema
├── README.vi.md, README.zh.md    # Localized READMEs
├── CHANGELOG.md
├── ROADMAP.md
└── LICENSE
```

---

## Key Modules by Size & Purpose

| Module | LOC | Purpose |
|--------|-----|---------|
| `src/installer/commands.js` | 1090 | Core 18-step install/upgrade flow |
| `src/scripts/wiki.mjs` | 800+ | Graph mutation, page creation, frontmatter handling |
| `src/scripts/lint.mjs` | 400+ | Schema validation (9 checks) |
| `src/installer/fs.js` | 300+ | Atomic writes, symlink ladder, safePath() |
| `src/scripts/schemas.mjs` | 250+ | Single source of truth (entities, edges, exemptions) |
| `src/installer/manifest.js` | 250+ | Manifest versioning & state file I/O |
| `src/installer/template-engine.js` | 200+ | Handlebars-style template rendering |
| `src/tools/extract_pdf.py` | 150+ | PDF text extraction (pypdf-based) |
| `src/tools/discover.py` | 200+ | Discovery orchestrator (research pack) |

---

## Single Source of Truth

**`src/scripts/schemas.mjs`** defines the entire wiki contract:

- **Entity types:** `source`, `concept`, `person`, `summary`, `topic` (+ pack-specific).
- **Edge types:** 28 directed relationships (e.g., `cites`, `defines`, `relates_to`).
- **Frontmatter requirements:** Mandatory fields per entity type.
- **Exemption globs:** Paths that don't require bidirectional reverse links (foundations/\*\*, outputs/\*\*, external URLs).

Changes to `schemas.mjs` propagate to:
- `wiki.mjs` — enforces on create/mutate.
- `lint.mjs` — validates on read.
- Installer templates — reflected in entry-point context (README.md).

---

## Write Paths (Atomic Discipline)

| Path | Tool | Operation |
|------|------|-----------|
| `wiki/`, `graph/`, `log.md` | `wiki.mjs` | Only allowed mutation path; always atomic. Skills invoke via Bash + JSON. |
| `wiki/`, `graph/`, `log.md` (repair) | `lint.mjs --fix` | Lints (9 checks), repairs L01–L07 issues atomically. |
| `wiki/`, `_lumina/` (destructive) | `reset.mjs` | Scoped deletion; respects `--scope` flag. |
| All installer outputs | `fs.js:atomicWrite()` | Temp + fsync + rename; manifest written last. |
| All Python writes | `os.replace()` | Temp file + fsync + atomic rename. |

---

## Test Coverage

| Suite | Command | Coverage |
|-------|---------|----------|
| **Installer** | `npm run test:installer` | `fs.js`, `manifest.js`, `template-engine.js`, `update-check.js`, `commands.js` (node --test) |
| **Scripts** | `npm run test:scripts` | `wiki.mjs`, `lint.mjs`, `reset.mjs`, `discover-runner.mjs` (node --test) |
| **Python** | `npm run test:python` | Fetcher contracts, env loading, prepare_source (pytest) |
| **Idempotency** | `npm run ci:idempotency` | Install twice → git diff over watched paths must be empty |
| **Packaging** | `npm run ci:package` | npm pack validation; no postinstall script; files allowlist |

---

## Dependencies

**Direct (5 total):**
- `commander@^12.1.0` — CLI parsing
- `@clack/prompts@^0.9.1` — Interactive install prompts (lazy-loaded)
- `js-yaml@^4.1.0` — Config read on upgrade
- `picocolors@^1.1.1` — TTY-aware color (lazy-loaded)
- `glob@^11.0.0` — Template expansion

**Python (research pack, optional):**
- `requests>=2.31` — HTTP fetching
- `pypdf>=4.0` — PDF extraction (core dependency, always available)
- `pytest>=7` — Testing

**Zero Native Modules:** No `bcrypt`, `node-gyp`, or C++ binding complexity.

---

## Cold-Start Budget

**Target:** < 300 ms  
**Mechanism:** All subcommands, heavy deps lazy-imported inside `.action()` callbacks.
- `bin/lumina.js` itself: ~50 ms (Commander + minimal setup).
- `install` subcommand (first import): ~200 ms (loads prompts, yaml, colorize, template-engine).

---

## See Also

- **Project vision & scope:** [docs/project-overview-pdr.md](./project-overview-pdr.md)
- **Code standards & non-negotiables:** [docs/code-standards.md](./code-standards.md)
- **System architecture & flow:** [docs/system-architecture.md](./system-architecture.md)
- **Locked v0.1 decisions:** [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md)
- **Development workflows:** [docs/DEVELOPMENT.md](./DEVELOPMENT.md)
- **Critical agent rules:** [docs/project-context.md](./project-context.md)
