# Lumina-Wiki — System Architecture

**Document Type:** Locked v0.1 Architecture  
**Last Updated:** 2026-05-06  
**Status:** Stable; breaking changes require SemVer major bump

---

## Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   NPM INSTALLER LAYER                   │
│              (bin/lumina.js + src/installer/)            │
│                                                          │
│  • Entry: bin/lumina.js (lazy-imports subcommands)       │
│  • Commands: install, upgrade, uninstall, --version      │
│  • Core modules:                                         │
│    - commands.js (18-step orchestration)                 │
│    - fs.js (atomic writes, symlink ladder)               │
│    - manifest.js (version tracking)                      │
│    - template-engine.js (render {{var}} + {{#if}})       │
│    - prompts.js (@clack/prompts interactive UX)          │
│  • Output: Workspace directory structure + config files  │
│  • Runs once per project (install/upgrade)               │
└─────────────────────────────────────────────────────────┘
                           ↓
                  (projects workspace)
                           ↓
┌─────────────────────────────────────────────────────────┐
│              WORKSPACE PAYLOAD LAYER                     │
│     (src/scripts/*.mjs + src/tools/*.py + skills)        │
│                                                          │
│  Consumed by agent skills invoked via Bash + JSON:       │
│                                                          │
│  • wiki.mjs — graph/frontmatter mutations [only path]    │
│  • lint.mjs — schema validation (9 checks)               │
│  • reset.mjs — scoped destructive operations             │
│  • discover-runner.mjs — scheduled research automation   │
│  • tools/*.py — PDF extraction, research fetchers        │
│  • skills/*.md — agent prompts (14 total)                │
│                                                          │
│  • Workspace directories:                                │
│    - wiki/ (LLM-maintained knowledge graph)              │
│    - raw/ (user inputs, read-only by default)            │
│    - _lumina/ (framework config, scripts, state)         │
│    - .agents/ or .claude/ (skill symlinks)                │
│                                                          │
│  • Single source of truth: schemas.mjs                   │
│    (entity types, 42 edge types, frontmatter spec,       │
│     exemption globs; consumed by wiki.mjs + lint.mjs)    │
└─────────────────────────────────────────────────────────┘
```

---

## Installer Flow (18 Steps, `src/installer/commands.js`)

Top-level shape (detailed rationale in [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md)):

1. **Read manifest** — Fresh install or upgrade? Check `_lumina/manifest.json`
2. **Interactive prompts** (fresh only) — IDE choice, pack selection (core forced-in)
3. **Apply CLI overrides** — Merge `--yes`, `--packs`, `--ide` flags
4. **Validate pack set** — Ensure `core` is included, fetch spec for each
5. **Render README** — Generate canonical agent-context file (only region between markers updated on upgrade)
6. **Render IDE stubs** — Create CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules/lumina.mdc (~5 lines each)
7. **Render config files** — `_lumina/config/lumina.config.yaml`, `.env.example`
8. **Expand template tree** — waltz over `src/templates/` with pack-aware conditions
9. **Write workspace files** — All via `atomicWrite()` to prevent torn writes
10. **Create skill directories** — One per skill under `.claude/skills/lumi-<name>/` or `.agents/skills/`
11. **Symlink skills** — Per-target (Claude Code vs Codex vs Cursor vs Gemini): symlink ladder
    - Try: `symlink`
    - Fall back: `junction` (Windows)
    - Fall back: `copy` (Windows w/o Dev Mode, network drives)
12. **Persist symlink strategy** — Record chosen ladder in `manifest.symlinkStrategies` for idempotent re-use
13. **Write manifest** — `_lumina/manifest.json` (atomic, last write)
14. **Write state files** — `_lumina/_state/skills-manifest.csv`, `files-manifest.csv` (atomic)
15. **Git init** (if needed) — Ensure `.gitignore` references `_lumina/_state/`, `raw/tmp/`
16. **Tree summary** — TTY-aware colorized directory tree
17. **Upgrade migration** (if applicable) — Run `/lumi-migrate-legacy` or prompt user
18. **Exit 0** — Success

**Idempotency:** Install twice → `git diff` over watched paths (`README.md`, `CLAUDE.md`, `_lumina/config/`, `wiki/`, `raw/`, etc.) must be empty.

---

## Workspace Contract: Single Source of Truth

**`src/scripts/schemas.mjs`** (pure data, no I/O):

```javascript
export const entityTypes = {
  source: {
    dirs: ['wiki/sources/'],
    frontmatterRequired: ['title', 'urls', 'summary', 'tags'],
    frontmatterOptional: ['authors', 'date', 'ingest_status', ...]
  },
  concept: {
    dirs: ['wiki/concepts/'],
    frontmatterRequired: ['title', 'definition', 'tags'],
    ...
  },
  // ... person, summary, topic, plus pack-specific types
}

export const edgeTypes = [
  { name: 'cites', reverse: 'cited_by', directed: true },
  { name: 'defines', reverse: 'defined_by', directed: true },
  { name: 'relates_to', reverse: 'relates_to', directed: false },
  // ... 28 total edge definitions
]

export const exemptionGlobs = [
  'foundations/**',     // Forward-only (no reverse required)
  'outputs/**',
  '*://*'               // External URLs
]
```

**Both downstream modules import from `schemas.mjs`:**

- **`wiki.mjs`:** Enforces schema on page create/mutate. Validates frontmatter, link types, bidirectional reverse writes.
- **`lint.mjs`:** Validates pages against schema. 9 checks (L01–L09) include slug format, missing reverses, required fields, exemption compliance.

**Change propagation:** If you add an edge type, both `wiki.mjs` and `lint.mjs` immediately recognize it (no separate updates needed).

---

## Write Paths (Atomicity Discipline)

```
┌─────────────────────────────┐
│   Graph Mutations (SSOT)    │
├─────────────────────────────┤
│                             │
│  wiki.mjs (only path)       │
│  • Create page              │
│  • Mutate frontmatter       │
│  • Write bidirectional link │
│  • Append to log.md         │
│  • Rebuild graph/           │
│                             │
│  Skills → Bash + JSON       │
│  (never import wiki.mjs)    │
│                             │
└─────────────────────────────┘
                ↓
       All writes atomic:
       temp + fsync + rename
                ↓
    ┌─────────────────────┐
    │   lint.mjs --fix    │
    │ (repair 6 checks)   │
    └─────────────────────┘
                ↓
    ┌─────────────────────┐
    │  reset.mjs (delete) │
    │ --scope {all|wiki}  │
    └─────────────────────┘
```

**Contract:**
- `wiki.mjs read` — JSON to stdout (never mutates)
- `wiki.mjs create/mutate` — Atomic, JSON status to stdout, errors to stderr (exit 2/3)
- `lint.mjs --fix` — Repairs L01–L07 atomically; L08/L09 advisory only
- `reset.mjs --scope all` — Deletes `wiki/` and `_lumina/_state/` (never `raw/`)

---

## Symlink Ladder (Cross-Platform Strategy)

**Problem:** Windows symlinks require Developer Mode; some network drives don't support symlinks.

**Solution:** Per-skill, per-target, try three strategies in order:

```javascript
// src/installer/fs.js → symlinkWithFallback()

async function symlinkWithFallback(sourceDir, linkPath, targetLabel) {
  try {
    // 1. Try native symlink
    await symlink(sourceDir, linkPath, 'dir')
    return 'symlink'
  } catch (e) {
    if (isWindows) {
      try {
        // 2. Try junction (Windows-only; no Dev Mode needed)
        await symlink(sourceDir, linkPath, 'junction')
        return 'junction'
      } catch {
        // 3. Fall back: copy entire directory
        await copyDirRecursive(sourceDir, linkPath)
        return 'copy'
      }
    }
    throw e
  }
}
```

**Recorded in manifest:** `manifest.symlinkStrategies` maps each skill to its chosen strategy. On upgrade, re-use same strategy (idempotent).

```json
{
  "symlinkStrategies": {
    ".claude/skills/lumi-init": "symlink",
    ".claude/skills/lumi-ingest": "junction",
    ".agents/skills/lumi-discover": "copy"
  }
}
```

---

## Entry-Point Stub Pattern

**Principle:** Single source of truth (`README.md`) rather than filesystem tricks.

```
┌───────────────────────────┐
│    README.md (root)       │
│  [Canonical agent context]│
│  • Schema overview        │
│  • Skill directory        │
│  • Workflow description   │
│  • Links to _lumina/ docs │
│                           │
│  {{var}} placeholders:    │
│  {{configured_ides}},     │
│  {{installed_packs}},     │
│  {{installed_skill_count}}│
└───────────────────────────┘
        ↑         ↑
        │         │
   (rendered once at install time)
        │         │
        ↓         ↓
┌─────────────────────┐
│  CLAUDE.md (stub)   │ ← Agent reads this → redirects to README.md
│  AGENTS.md (stub)   │
│  GEMINI.md (stub)   │
│  .cursor/lumina.mdc │
└─────────────────────┘
```

**Why not symlinks for README?** Because:
- Symlinks to Markdown would require rendering on the agent side (complexity).
- Users often edit README (e.g., add org notes); symlink would break in upstream updates.
- One copy is more intuitive than "read the symlink target."

**On upgrade:** Only the region between `<!-- lumina:schema -->` ... `<!-- /lumina:schema -->` markers is rewritten. User notes outside this region are preserved.

**Stub files:** Always regenerated; ~5 lines each. Safe because they're not user-edited.

---

## Pack System

**Core pack (always installed):**
- 6 skills: `/lumi-init`, `/lumi-ingest`, `/lumi-ask`, `/lumi-edit`, `/lumi-check`, `/lumi-reset`
- No Python deps

**Research pack (opt-in):**
- 4 skills: `/lumi-discover`, `/lumi-survey`, `/lumi-prefill`, `/lumi-research-topic`
- Python tools: `prepare_source.py` (local source prep: .pdf, .tex, .html, .md, .txt), `discover.py`, `fetch_arxiv.py`, `fetch_s2.py`, `fetch_wikipedia.py`, `fetch_deepxiv.py`
- Requires `requests>=2.31`, `pypdf>=4.0`

**Reading pack (opt-in):**
- 4 skills: `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`
- No additional Python deps

**Pack selection logic** (in `commands.js` step 3):
```javascript
// core is always force-inserted
const uniquePacks = ['core', ...userPacks]
const dedupedPacks = [...new Set(uniquePacks)]
// Result: core + research + reading = 14 skills total
```

---

## Exit Code Contract

All tools & installer honor:

| Code | Meaning | Usage |
|------|---------|-------|
| `0` | Success | All operations completed successfully |
| `1` | User error | Bad arguments, missing required flags, invalid slug |
| `2` | Path safety / filesystem / unknown resource | `safePath()` rejection, file not found, `--scope` mismatch |
| `3` | Internal / unexpected error | Corrupted manifest, JSON parse failure, race condition, network timeout (5xx) |
| `4` | User cancellation | Ctrl-C in interactive prompt or declined confirm |

**Example:** `safePath('../../etc/passwd')` raises `RangeError` → caught at `bin/lumina.js` → exit 2.

---

## See Also

- **Project vision & scope:** [docs/project-overview-pdr.md](./project-overview-pdr.md)
- **Codebase map:** [docs/codebase-summary.md](./codebase-summary.md)
- **Code standards & rules:** [docs/code-standards.md](./code-standards.md)
- **Locked v0.1 decisions:** [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md)
- **Full PRD:** [docs/planning-artifacts/prd.md](./planning-artifacts/prd.md)
- **Development guide:** [docs/DEVELOPMENT.md](./DEVELOPMENT.md)
- **Critical agent rules:** [docs/project-context.md](./project-context.md)
