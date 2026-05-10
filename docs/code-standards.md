# Lumina-Wiki — Code Standards & Checklist

**Status:** Locked for v0.1+  
**Applies to:** All code in `src/`, `scripts/`, `bin/`

---

## Core Non-Negotiables

These are absolutes. Violations map to real failure modes. For the full rationale, see [docs/project-context.md](./project-context.md) §3.

### File & Filesystem (4 rules)

| Rule | Applies To | Violation Impact |
|------|-----------|------------------|
| **Atomic writes always** — use `atomicWrite()` (temp + fsync + rename); never `fs.writeFile` | All file writes (JS/Python) | Silent data loss on crash |
| **`safePath()` for all user input** — rejects `..`, absolute paths, Windows drive letters | All path fragments from users/configs | Directory traversal vulnerability |
| **Path joins via `node:path` or `pathlib`** — never string-concatenate | All path construction | Cross-platform breakage on Windows |
| **Never use native modules** — no `node-gyp`, `bcrypt`, or compiled binaries | Dependencies, bin/* | Breaks on sandboxed installs; CI failure |

### Release & Deployment (2 rules)

| Rule | Applies To | Violation Impact |
|------|-----------|------------------|
| **No `postinstall` script** in `package.json` | Root `package.json` | npm publish blocks; CI gate fails |
| **`devDependencies: {}` is intentional** — never add Jest, Vitest, or test frameworks | Dependencies | Cold-start bloat; breaks publishing |

### Performance (1 rule)

| Rule | Applies To | Violation Impact |
|------|-----------|------------------|
| **Cold-start < 300 ms** — lazy-import heavy deps inside `.action()` callbacks | `bin/lumina.js`, subcommand modules | CLI feels sluggish; UX regresses |

### Wiki Invariants (4 rules)

| Rule | Applies To | Violation Impact |
|------|-----------|------------------|
| **Bidirectional links mandatory** — every forward link writes its reverse in one operation | `wiki.mjs`, skill prompts | Graph becomes inconsistent; linter fails |
| **`graph/` is auto-generated** — never hand-edit `edges.jsonl` or `citations.jsonl` | `src/scripts/`, skills | Graph corruption on next rebuild |
| **`raw/` is read-only** — only `raw/tmp/` and `raw/discovered/` accept new files (append, no overwrites) | Skills, tools | User data loss risk |
| **Exit codes are contractual** — always use: `0` success, `1` user error, `2` fs/path-safety, `3` internal, `4` user cancellation | `bin/lumina.js`, tools | Tools depending on exit codes fail silently |

---

## Naming Conventions

### Files & Directories

- **Kebab-case** for filenames: `extract-pdf.py`, `template-engine.js`, `schema-validator.mjs`
- **Descriptive names** — filename itself should hint at purpose when listed by `ls` or grep
- **Module types:**
  - `.js` — Node CommonJS (legacy; rare in this codebase)
  - `.mjs` — Node ESM (standard for src/scripts/)
  - `.py` — Python 3.9+ (tools only)
  - `.md` — Markdown (docs, skills, templates)

### Code Identifiers

- **camelCase** for variables, functions, parameters (JS/Python)
- **PascalCase** for classes, types, exported named exports
- **UPPER_SNAKE_CASE** for constants (both JS and Python)
- **Abbreviations:** Avoid unless universally known (e.g., `fs`, `API` OK; `cfg`, `proc` not OK)

---

## When Editing Module X, Also Update Y

**Schema changes propagate:**

| You edit | You must also update | Why |
|----------|----------------------|-----|
| `src/scripts/schemas.mjs` | `src/scripts/wiki.mjs` + `src/scripts/lint.mjs` | SSOT definition; other modules consume |
| `src/scripts/wiki.mjs` (graph mutations) | Tests in `src/scripts/wiki.test.mjs`; verify `/lumi-ingest` skill still works | Public API change risk |
| `src/installer/commands.js` (install flow) | `ci-idempotency.mjs` test if watched paths change | Idempotency contract must hold |
| Any skill prompt | User-facing README.md references (if skill description changes) | Docs drift risk |
| `bin/lumina.js` (CLI surface) | Test in `src/installer/commands.test.js` + CLAUDE.md (if exit codes change) | Agent scripts depend on behavior |
| Python tool args/output | Corresponding skill prompt (`src/skills/**/SKILL.md`) | Skills invoke tools; JSON contract must align |

---

## File Size Guideline

**Target:** ≤ 200 LOC per file (soft cap)

**When to split:**
- Source file exceeds 200 LOC → extract helper functions to `lib/` subdir
- Test file exceeds 150 LOC → split by test category or module under test
- Skill prompt exceeds 80 LOC → move step details to reference files (`step-01-*.md`) + thin router in `SKILL.md`

**Exceptions (OK to exceed):**
- `src/installer/commands.js` (1090 LOC) — 18-step install flow; justified by complexity; every step numbered for grep
- Config files, Markdown docs, test fixtures (no split needed)

---

## API Contracts

### `wiki.mjs` (Only Mutation Path)

Skills invoke via Bash + JSON, never import. Contract:

```bash
# Read
node _lumina/scripts/wiki.mjs read --entity-type source --slug my-paper
# Output: JSON to stdout

# Mutate (all changes atomic)
node _lumina/scripts/wiki.mjs create --entity-type source --slug my-paper --frontmatter '{...}'
# Output: JSON to stdout; errors to stderr with code 2 or 3

# Exit codes
# 0 — success
# 1 — validation error (bad input from caller)
# 2 — filesystem / path safety / unknown slug
# 3 — internal error (log corruption, race, etc.)
```

### Skill JSON Protocol

Skills receive JSON from tools, always validate schema:

```bash
node _lumina/tools/extract_pdf.py "raw/my.pdf" > /tmp/out.json
# Output: {"pages": [{"text": "...", "images": [...]}], "metadata": {...}}
# On error: exit 2 with stderr message
```

Skill re-formats for agent (`/lumi-ingest` constructs page frontmatter from JSON).

---

## Testing Standards

**No external test framework.** Use built-in tools:
- **JS/MJS:** `node --test` + `node:assert/strict`
- **Python:** `pytest -q` + standard `unittest` assertions

**Coverage targets:**
- Installer: All path safety, manifest versioning, template rendering
- Scripts: Schema invariants, idempotency, graph consistency
- Tools: Fetcher contract validation, error handling

**Run before push:**
```bash
npm run test:all && npm run ci:idempotency && npm run ci:package
```

---

## Output & Formatting

### Color & TTY

- **Always check** `process.stdout.isTTY && !process.env.NO_COLOR` before emitting ANSI codes
- **Use helper** `getColorFns()` (don't call `picocolors` directly)
- **CLI output:** UTF-8, LF line endings (cross-platform)

### Error Messages

- **User error (exit 1):** Name the offending input, suggest fix if obvious
- **FS/path error (exit 2):** Print full path, explain safety violation
- **Internal error (exit 3):** Include stack trace in debug mode only; log to stderr

### Markdown (Skills, Docs)

- **Headings:** `#` H1 (title), `##` H2 (sections), `###` H3 (subsections)
- **Lists:** Bullet for unordered, numbered for steps
- **Code blocks:** Specify language (`bash`, `js`, `python`, `json`)
- **Links:** Relative paths within `docs/`, absolute for external URLs

---

## Security & Privacy

| Concern | Standard | Check |
|---------|----------|-------|
| **Path traversal** | `safePath()` rejects `..` and absolutes | Every file I/O path |
| **Secrets in git** | No `.env` (template only), no keys in code | Pre-commit check: `git diff --cached | grep -i "password\|api_key"` |
| **Telemetry** | Zero; only optional npm registry check (2s timeout, suppressible) | Audit all outbound network calls |
| **Data isolation** | User workspace never leaves filesystem unless explicitly fetched (tools) | Skills read only `wiki/`, `raw/`, `_lumina/` |

---

## Changelog & Versioning

- **SemVer:** `major.minor.patch` (major only on breaking schema changes)
- **Changelog format:** [Keep a Changelog](https://keepachangelog.com)
- **Commit messages:** Conventional commits (feat:, fix:, docs:, refactor:, test:, chore:)

---

## Pre-Push Checklist

Before `git push`:

- [ ] No `devDependencies` added
- [ ] No `postinstall` script in `package.json`
- [ ] All tests pass: `npm run test:all` (includes Python tests)
- [ ] Idempotency holds: `npm run ci:idempotency`
- [ ] Package validates: `npm run ci:package`
- [ ] Cold-start measured (< 300 ms)
- [ ] All file writes use `atomicWrite()` or `os.replace()`
- [ ] All user paths validated with `safePath()`
- [ ] Exit codes correct (0, 1, 2, 3, 4 only)
- [ ] No emoji in shipped files
- [ ] Docs updated if API/behavior changed

---

## See Also

- **Full critical rules:** [docs/project-context.md](./project-context.md) — read before editing code
- **Codebase map:** [docs/codebase-summary.md](./codebase-summary.md)
- **System architecture:** [docs/system-architecture.md](./system-architecture.md)
- **Development workflows:** [docs/DEVELOPMENT.md](./DEVELOPMENT.md)
- **Locked design decisions:** [docs/planning-artifacts/architecture.md](./planning-artifacts/architecture.md)
