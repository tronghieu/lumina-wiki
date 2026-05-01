---
project_name: 'LuminaWiki'
user_name: 'Lưu Hiếu'
date: '2026-05-02'
sections_completed: ['technology_stack', 'critical_rules', 'module_contracts', 'wiki_schema', 'skill_inventory', 'ci_packaging', 'gotchas', 'local_testing']
existing_patterns_found: 50
---

# Project Context for AI Agents

This file contains critical rules and patterns AI agents MUST follow when implementing code in Lumina-Wiki. Focus is on unobvious details — things you would not infer from reading any single file.

**Read this BEFORE editing any code or skill prompt.**

---

## 1. What this project is

Lumina-Wiki is an **npm-published, multi-IDE wiki scaffolder** that installs an LLM-maintainable knowledge workspace into any project. It is an originally-authored implementation of Karpathy's LLM-Wiki vision. Two layers:

- **Installer** (Node, ESM, ≥20) — `bin/lumina.js` + `src/installer/*.js`. Idempotent, cross-platform, atomic.
- **Wiki engine + skills** — `src/scripts/*.mjs` (Node) + `src/tools/*.py` (Python, research pack only) + `src/skills/**/*.md` (markdown agent prompts).

The installer projects a single source-of-truth template tree onto whichever CLI agent the user picks (Claude Code, AGENTS.md-compatible CLIs — Codex/Amp/Crush/Goose/Auggie/OpenCode/etc., Gemini CLI, Cursor, generic). After install, agents drive the wiki by invoking skills (`/lumi-*` slash commands) which call the Node/Python tools via Bash.

---

## 2. Technology stack & versions

**Runtime:**
- Node ≥20 (ESM-only, no transpile, no native modules)
- Python 3.9+ (research pack only, opt-in, deferred install)

**Direct JS deps (license-audited MIT/ISC/Apache-2.0):**
- `commander@^12.1.0` — CLI parsing
- `@clack/prompts@^0.9.1` — interactive install prompts (lazy-loaded)
- `js-yaml@^4.1.0` — config read on upgrade
- `picocolors@^1.1.1` — TTY-aware color (lazy-loaded, optional)
- `glob@^11.0.0` — template expansion

**Python deps:** `requests>=2.31`, `pypdf>=4.0`, `pytest>=7`, `pytest-cov>=4`. Optional: `pdfminer.six`, `pdfplumber`.

**Test runners:** `node --test` (built-in `node:test` + `node:assert/strict`) for JS/MJS; `pytest -q` for Python. **No Jest, no Vitest, no devDependencies.**

**CI:** Node 20 × Node 22 × {Ubuntu, macOS, Windows} = 6 runners, `fail-fast: false`. Trigger: push to main + all PRs.

---

## 3. Non-negotiable rules (MUST / MUST NOT)

These are absolutes. Every one corresponds to a real failure mode.

### File & filesystem

1. **Never call `writeFile` directly.** Always use `atomicWrite` (temp + `fd.datasync()` + rename). Same in Python: temp + fsync + `os.replace`. This is the entire reliability story of the installer.
2. **Never accept a user-supplied path fragment without `safePath()`.** It rejects `..`, absolute Unix paths, Windows drive letters (`C:\`), and backslash traversals. `RangeError` from `safePath` maps to exit code 2 at `bin/lumina.js`.
3. **Path joins go through `node:path`.** Never string-concatenate paths. Same in Python: `pathlib`.
4. **Never use native modules.** No N-API, no `node-gyp`, no `bcrypt`-style packages. Cross-platform install must work without compilers.
5. **Never add a `postinstall` script** to `package.json`. `ci-package.mjs` blocks publish if one exists.

### Color & output

6. Color output is gated on `process.stdout.isTTY && !process.env.NO_COLOR`. Use `getColorFns()` (or a Python equivalent). **Never call `picocolors` directly.** Never emit ANSI codes unconditionally.
7. Exit codes are contractual:
   - `0` — success
   - `1` — user error (bad args)
   - `2` — filesystem / path safety / unknown slug / missing `--yes`
   - `3` — internal / fs failure / upgrade incompatibility / 5xx network

### Cold-start

8. Keep cold-start under 300 ms. All non-trivial deps (`@clack/prompts`, `js-yaml`, `picocolors`, subcommand modules) **must stay lazy-imported** inside command actions. Do not promote them to top-level `import` statements.

### Wiki invariants (the heart of the project)

9. **`raw/` is read-only by default.** Only `raw/tmp/` and `raw/discovered/` (research pack) accept additions, and only as new files — never overwrite an existing file.
10. **`graph/` is auto-generated.** Only mutate via `wiki.mjs` (rebuild step). Never hand-edit `edges.jsonl` or `citations.jsonl`.
11. **Bidirectional links are mandatory.** Every forward link writes its reverse in the same operation. The linter catches misses (L06) but the agent must do it proactively. Exempt-only mode: `foundations/**`, `outputs/**`, `*://*` are the only forward-link-without-reverse exemptions.
12. **`index.md` updated on every ingest.** Every new page must be cataloged immediately. L09 catches stale.
13. **`log.md` is append-only.** Never rewrite history. Correct mistakes by appending a new entry.
14. **No silent overwrites.** Preserve sections marked `<!-- user-edited -->`. Append changes in a new section.
15. **`wiki.mjs` is the only allowed path for graph/frontmatter mutation.** Skills call it via `Bash` + JSON; never `import` it from skill code. (Skills are markdown, but if you ever build a skill into a JS module — don't.)

### README schema region

16. The `<!-- lumina:schema --> ... <!-- /lumina:schema -->` markers in `README.md` are the **only** region the installer rewrites on upgrade. Markers must be on their own lines (`line.trim() === marker`) — inline backtick mentions are skipped. Never put user content inside this region.

### `wiki/` ↔ `raw/` boundary

17. **Python research-pack tools never write to `wiki/`.** That is exclusively for skills calling `wiki.mjs`. `init_discovery.py` documents this explicitly: "Never writes to `wiki/`. Skills own `wiki/`."
18. **`reset --scope wiki` (and `all`) never touch `raw/`.** `raw/` is destroyed only by `--scope raw` with `--yes`. Conversely, do not write entity files into `raw/`; they will not be indexed.

### OmegaWiki

19. OmegaWiki is read-only at `../OmegaWiki` and informs **patterns only**. **No code, schema, or skill content is copied.** Never mention OmegaWiki in user-facing strings (PRD, README, installer output, skill prompts, error messages). All content is originally authored.
20. No `NOTICE` file, no MIT-attribution chain to OmegaWiki.

### Cross-model review

21. **No cross-model review anywhere.** No "Review LLM", no MCP `llm-review` server, no second-model verdict gate. Wherever OmegaWiki invokes a reviewer, Lumina uses single-model self-check by the running agent. If user later asks for cross-model anything, treat as new scope and confirm.

### Privacy

22. **Zero telemetry.** The only outbound network call from the installer is the optional `npm view lumina-wiki@latest version` update check, with a hard 2-second `AbortController` timeout, suppressible via `LUMINA_NO_UPDATE_CHECK=1` or `--no-update`. Never throws — always swallows errors and returns `null`.

### LoC budget

23. Soft cap: ≤3,000 LoC original JS (NFR-M1). Watch this when adding modules.

### Style

24. **No emoji in shipped files** unless explicitly requested by the user.

---

## 4. Module contracts

### `bin/lumina.js`

ESM entry. Uses `createRequire` for synchronous `package.json` load (must precede dynamic imports). All subcommands lazy-imported inside `.action()` callbacks. `--version` / `-v` handled before commander parses, then `process.exit(0)` immediately. `EACCES` / `EPERM` / `RangeError` all map to exit 2.

### `src/installer/commands.js`

`installCommand`, `uninstallCommand`, `versionCommand`. Install flow has 18 numbered steps in source. Key invariants:
- `core` pack is always force-inserted: `unique(['core', ...rest])`. You cannot exclude it.
- Upgrade reads config from YAML (`_lumina/config/lumina.config.yaml`) first, falls back to manifest. Neither prompts under `--yes`.
- `.gitignore` is write-once — never overwritten on upgrade.
- `wiki/index.md` and `wiki/log.md` seeded only on first install.
- Three state files (manifest.json, skills-manifest.csv, files-manifest.csv) written last, atomically, all at once.
- Uninstall preserves `wiki/` and `raw/`; removes `_lumina/`, `.agents/`, `.claude/skills/lumi-*`.
- `applyInstallOverrides` validates packs against `VALID_PACKS`; unknown values throw `err.code = 2`.

### `src/installer/fs.js`

`atomicWrite`, `safePath`, `ensureDir`, `copyDir`, `fileHash`, `linkDirectory`.

**Symlink fallback ladder** (`linkDirectory`):
1. `fs.symlink(target, linkPath)` — POSIX + Windows w/ Developer Mode
2. `fs.symlink(target, linkPath, 'junction')` — Windows junction
3. `copyDir(target, linkPath)` — copy fallback, returns `{warning: true, strategy: 'copy'}`

Only `EPERM` / `EACCES` / `EINVAL` trigger fallback; other errors propagate. Chosen strategy persisted in `manifest.symlinkStrategies[canonical_id]` for idempotent re-use. `--re-link` clears cache and forces re-detection.

### `src/installer/manifest.js`

Three state files, paths fixed under `_lumina/`:
- `manifest.json` — schema version `1`
- `_lumina/_state/skills-manifest.csv` — `canonical_id,display_name,pack,source,relative_path,target_link_path,version`
- `_lumina/_state/files-manifest.csv` — `relative_path,sha256,source_pack,installed_version`

`readManifest` returns `null` on ENOENT (fresh install signal), throws `SyntaxError` on corrupt JSON. CSV reads return `[]` on ENOENT or header mismatch (never throw). **Never build CSV rows by string concatenation** — always use `escapeCsvField` / `serializeCsv` (display_name can include commas).

### `src/installer/template-engine.js`

`{{variable}}` raw substitution (no HTML escaping — content is Markdown). Unknown vars → empty string silently. Boolean `true` → `"true"`. `{{#if condition}}...{{/if}}` truthy check only — **nested conditionals are not supported** in v0.1. Line endings normalized to LF on input and output. `extractSchemaRegion` / `replaceSchemaRegion` only operate on lines where `line.trim() === marker`.

### `src/installer/prompts.js`

`@clack/prompts` lazy-loaded. Under `--yes`, prompts are never imported — `defaultAnswers(directory)` returns immediately with `projectName = basename(directory) || 'my-wiki'`. In interactive mode, the first prompt asks for the **installation directory** (default = `process.cwd()`, supports `~` expansion via `expandUserPath`); `project_name` is then auto-derived from `basename(directory)` — no separate name prompt. Ctrl-C / `isCancel()` calls `process.exit(0)`. `core` is **never** in the multi-select — prepended after the user picks optional packs.

**Note:** `prompts.js` has no test file; TTY interaction is hard to automate.

### `src/installer/update-check.js`

Hard 2 s `AbortController` timeout + 500 ms belt-and-suspenders `exec` timeout. Suppressed by `LUMINA_NO_UPDATE_CHECK=1` or `--no-update`. **Never throws.** `isNewerVersion` strips leading `v`, handles 1- or 2-part semver. **Pre-release suffixes (`1.0.0-alpha.1`) are not handled** — numeric-only comparison.

### `src/scripts/wiki.mjs`

Subcommands (selected): `init`, `slug`, `log`, `read-meta`, `set-meta`, `add-edge`, `add-citation`, `batch-edges`, `dedup-edges`, `list-entities`, `read-edges`, `read-citations`, `verify-frontmatter`, `checkpoint-read`, `checkpoint-write`. All reads emit JSON to stdout; mutations emit a JSON status object; errors emit `{"error":"…","code":2|3}` to stderr. `findProjectRoot` walks up from `cwd` looking for `wiki/` — must be invoked with cwd inside the workspace.

### `src/scripts/schemas.mjs`

Single source of truth. **Pure data, no I/O, no side effects.** Safe to import anywhere.

**Entity types (per pack):**
- core: `sources`, `concepts`, `people`, `summary`, `outputs`, `graph`
- research: `foundations`, `topics`
- reading: `chapters`, `characters`, `themes`, `plot`

**Edge types:** 28 directed types. Symmetric edges (`same_problem_as`, `related_to`, `appears_with`) stored once with sorted endpoints. Terminal edges (`grounded_in`, `produced`, `see_also_url`) have `reverse: null`. `cites`/`cited_by` go to `citations.jsonl`; everything else to `edges.jsonl`.

**Exemption globs:** `foundations/**`, `outputs/**`, `*://*` — the `exempt-only` bidi mode default.

**Required frontmatter** (always: `id`, `title`, `type`, `created`, `updated` ISO):
- `sources`: + `authors[]`, `year`, `importance` (1–5), optional `url`
- `concepts`: + `key_sources[]`, `related_concepts[]`
- `people`: + `key_sources[]`, optional `affiliations[]`
- `summary`: + `covers[]`
- pack-gated: `chapters` (+ `book`, `number`), `characters` (+ `book`, optional `first_seen`), `themes` (+ `book`), `plot` (+ `book`, `up_to_chapter`)

No edge type currently has `confidenceRequired: true` — L08 always passes on stock schemas.

### `src/scripts/lint.mjs`

`node lint.mjs [path] [--fix] [--dry-run] [--suggest] [--json]`. Nine checks:

| Check | Description | Fixable |
|---|---|---|
| L01 | Missing required frontmatter keys | yes (inserts `key: TODO`) |
| L02 | Wrong frontmatter types | no |
| L03 | Non-kebab slug | yes (renames file + rewrites wikilinks) |
| L04 | Orphan page (warning) | no |
| L05 | Broken wikilink | no |
| L06 | Missing reverse edge | yes |
| L07 | Symmetric edge stored both ways | yes (dedupes) |
| L08 | Missing required confidence field | no |
| L09 | Stale `index.md` (warning) | yes (rewrites `<!-- lumina:index -->` block) |

Exit codes: `0` clean, `1` unresolved violations, `2` user error, `3` internal. `--dry-run` implies fix intent but zero writes; sets `proposed_fix` instead of `fix_applied`.

### `src/scripts/reset.mjs`

`--scope <wiki|raw|state|checkpoints|all>`. Requires `--yes` for destructive ops. `--dry-run` exits 0 without writes and does not require `--yes`. **`all` includes wiki + state but NEVER raw.**

### Python tools (`src/tools/`)

All tools follow these contracts:
- Output JSON to stdout; errors as actionable text to stderr; exit 0/2/3.
- `_env.py` precedence: `~/.env` first, then `<project_root>/.env` overrides. Does **not** mutate `os.environ`. Returns `dict`. Pass `project_root` explicitly.
- `prepare_source.py` is idempotent by SHA256 — same file twice is safe and cheap. PDF extraction tries `pdfminer.six` → `pdfplumber` → empty string with stderr warning. TeX stripping is regex-only (not a real parser).
- `init_discovery.py` writes per-source JSON to `raw/discovered/<slug>/<paper_id>.json`; phase checkpoints at `_lumina/_state/discovery-{1,2,3}.json`. Use `--resume` after transient failure or checkpoints get overwritten.
- `fetch_s2.py` requires `SEMANTIC_SCHOLAR_API_KEY` (`x-api-key` header). `citations`/`references` endpoints are unwrapped (extract `citingPaper`/`citedPaper`) before returning. **S2 absence is silent in `init_discovery.py`** — phases 2/3 just return `[]`, no error.
- `fetch_deepxiv.py` requires `DEEPXIV_TOKEN` (Bearer). 45 s timeout. Provisional API wrapper.
- `discover.py` ranks: `0.4*log1p(citations) + 0.3*recency + 0.3*topic_overlap`. Citation score is unbounded — highly-cited paper dominates even with weak topic match.
- `prepare_source.py` slug: first 16 hex chars of SHA256.

---

## 5. Wiki schema contract

**4 core page types:**

| Type | Directory | Purpose |
|---|---|---|
| Source | `sources/` | Per-document summary: claims, evidence, takeaways |
| Concept | `concepts/` | Cross-source idea or technique |
| Person | `people/` | Profile of referenced person |
| Summary | `summary/` | Area-level synthesis |

**Edge types — authoritative source is `_lumina/scripts/schemas.mjs`** (rendered as `src/scripts/schemas.mjs` in this repo). Sample core types: `related_to`, `builds_on`, `contradicts`, `cites`, `mentions`, `part_of`, `same_problem_as`, `grounded_in`, `produced`, `see_also_url`. Stored in `wiki/graph/edges.jsonl` (or `citations.jsonl` for `cites`/`cited_by`). Each edge: `{source, target, type, confidence: high|medium|low}`. Symmetric edges stored once with sorted endpoints — agents must read both `outbound` and `inbound` to reconstruct.

**Bidirectional `exempt-only` mode** is the default. Only `outputs/**`, `*://*`, and (research pack only) `foundations/**` may have a forward link without a reverse. Anything else without a reverse is a lint error.

---

## 6. Skill inventory (v0.1 = 14 skills total)

**Core (6) — always installed:**

| Skill | Slash command | Purpose |
|---|---|---|
| init | `/lumi-init` | Bootstrap directory tree, seed `wiki/index.md` + `log.md`, idempotent |
| ingest | `/lumi-ingest` | Compile one raw source → source page + concept/person stubs + bidirectional edges + log entry; checkpoint-resumable |
| ask | `/lumi-ask` | Read-only graph traversal → cited answer; optionally file an Output page |
| edit | `/lumi-edit` | Edit one wiki page with schema validation + edge integrity preserved |
| check | `/lumi-check` | Run `lint.mjs`, auto-fix safe checks (L01/L03/L06/L07/L09), surface advisory issues |
| reset | `/lumi-reset` | Dry-run-first destructive reset across 5 scopes |

**Research pack (4) — opt-in, adds Python tools + `topics/`, `foundations/` page types:**

| Skill | Purpose |
|---|---|
| `/lumi-setup` | Check Python deps, populate API-key env files |
| `/lumi-discover` | Find + rank candidate sources; stops at shortlist |
| `/lumi-prefill` | Seed `wiki/foundations/` terminal pages |
| `/lumi-survey` | Narrative synthesis from existing wiki |

**Reading pack (4) — opt-in, no new tools, adds `chapters/`, `characters/`, `themes/`, `plot/` page types:**

| Skill | Purpose |
|---|---|
| `/lumi-chapter-ingest` | Ingest one chapter; extract characters, themes, plot beats |
| `/lumi-character-track` | Maintain character pages + inter-character edges |
| `/lumi-theme-map` | Build theme cluster pages; threshold ≥2 chapters |
| `/lumi-plot-recap` | Spoiler-safe recap up to (not including) cursor chapter |

### Skill file conventions

Located at `src/skills/<subtree>/<name>/SKILL.md`. Frontmatter:

```yaml
---
name: lumi-<name>           # maps 1:1 to slash command
description: >              # multi-line trigger heuristic
  ...
allowed-tools:              # explicit allowlist (Bash, Read, Write, Edit)
  - Bash
  - Read
---
```

Body opens with: "Read `README.md` at the project root before this SKILL.md." then `## Role`, `## Context`, procedural steps.

**Drift to fix:** reading-pack skills omit `allowed-tools`. New pack skills should include it explicitly.

### Entry-point stub pattern (confirmed)

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `QWEN.md`, `IFLOW.md`, `.cursor/rules/lumina.mdc` — all are **rendered stubs** (~5 lines), nearly identical except H1 and (Cursor) frontmatter `globs`/`alwaysApply`. The `AGENTS.md` stub also names the AGENTS.md-compatible CLIs it serves (Codex, Amp, Crush, Goose, Auggie, OpenCode, etc.). **They are NOT symlinks.** All redirect to `README.md` as canonical context. The `generic` IDE target has no stub — README.md is the entry point.

---

## 7. CI & packaging

**Matrix:** Node {20, 22} × {ubuntu, macos, windows} = 6 cells, `fail-fast: false`. Every cell runs all 8 steps; any failure blocks merge.

Steps (in order):
1. `npm ci`
2. `pip install pytest`
3. `npm run test:installer` — `node --test src/installer/*.test.js`
4. `npm run test:scripts` — `node --test src/scripts/*.test.mjs`
5. `npm run test:python` — `pytest src/tools/tests -q`
6. `node bin/lumina.js --version --no-update` — CLI smoke
7. `npm run ci:idempotency`
8. `npm run ci:package`

**Idempotency invariant (`scripts/ci-idempotency.mjs`):**

Two scenarios: `core-default` and `full-pack` (core + research + reading × 6 IDE targets). For each:
1. `git init`, install once, commit baseline
2. Install again with same args
3. `git diff --exit-code` over: `README.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `QWEN.md`, `IFLOW.md`, `.cursor`, `.claude`, `.agents`, `_lumina/config`, `_lumina/schema`, `_lumina/scripts`, `_lumina/tools`, `.env.example`, `wiki`, `raw`

**Any byte-level drift fails CI.** Runtime state outside watched paths is intentionally ignored.

**Packaging check (`scripts/ci-package.mjs`):**

`npm pack --dry-run --json` in sanitized env (all `npm_config_*` stripped). Enforces:
- **Prohibited:** `*.test.[cm]?js`, `src/tools/tests/`, `__pycache__/`, `*.pyc`, `_lumina/_state/`, `docs/planning-artifacts/`, `.github/`, `scripts/ci-*`
- **Required present:** `bin/lumina.js`, `src/installer/commands.js`, three main scripts, two SKILL.md samples (core/init + 2 packs), `src/templates/README.md`, `src/tools/prepare_source.py` + `requirements.txt`, `README.md`, `LICENSE`
- **Hard rule:** any `pack.scripts.postinstall` → immediate fail

**`skills-lock.json`:** hash-pin lockfile. Each entry: `source` (`owner/repo`), `sourceType: "github"`, `skillPath`, `computedHash` (SHA-256 hex). Vendored skills must have hash recomputed when content changes — never edit hash without re-fetching.

---

## 8. Testing patterns

- **Runner:** `node --test` for JS/MJS; `pytest -q` for Python. **No Jest, no Vitest, no devDependencies.**
- **JS test files:** `*.test.js` (installer) or `*.test.mjs` (scripts), colocated with source.
- **Python tests:** `src/tools/tests/` with `conftest.py` providing `tmp_project`, `mock_env`, `env_file` fixtures. Network mocked via `unittest.mock.patch` on `requests.Session` at module level — no `responses` or `httpretty`.
- **Fixture discipline:** each test creates its own `os.tmpdir()` subtree via `mkdtemp`; no shared state.
- **`commands.test.js` runs the real CLI** via `spawnSync(process.execPath, [CLI, ...])`. 30 s timeout per test. Slow but high-confidence.
- **`prompts.js` has no tests** (TTY automation is hard) — keep prompt logic minimal.
- **`update-check.test.js` does not mock `exec`** — guarded by 3 s wall-clock assertion.
- **Idempotency in `wiki.test.mjs`:** SHA-256 hash compare files before/after second invocation.

---

## 9. Top gotchas (high-frequency mistakes)

1. **`set-meta` scalar coercion:** without `--json-value`, `"3"` becomes `3` (number). Pass `--json-value` for strings that look numeric/boolean, or for arrays.
2. **Symmetric edges sort endpoints:** `add-edge source-z same_problem_as source-a` stores `from: source-a, to: source-z`. Reading `source-z` returns the edge under `inbound`, not `outbound`.
3. **`cites`/`cited_by` are split:** `add-citation` writes to `citations.jsonl`; `add-edge … cites …` writes to `edges.jsonl`. `read-citations` reads only the former; `read-edges` reads only the latter. Wrong command = silent empty result.
4. **`batch-edges` is all-or-nothing:** one bad record fails the whole batch with no writes. Don't mix known-good and unknown edge types.
5. **`findProjectRoot` walks up from cwd:** scripts must be invoked with cwd inside the workspace, not arbitrary directory.
6. **`lint --fix L01` inserts `key: TODO`** — not real values. L02 violations follow on next run until you replace `TODO`.
7. **Path safety on slugs:** a slug like `concepts/my-concept` is valid, but any `..` in any position exits 2.
8. **`--re-link` is the only way to clear cached symlink strategy.** Once `manifest.symlinkStrategies` records `'copy'`, future installs reuse it until you re-link.
9. **Adding any test file under `src/installer/` or `src/tools/` is auto-excluded from npm tarball** by the `files` allowlist + `ci-package.mjs` regex. Both guards must stay aligned.
10. **`postinstall` ban is absolute** — `ci-package.mjs` blocks publish regardless of script content.
11. **Slug uniqueness is not lint-enforced.** Linter catches broken links but not duplicate slugs. Ingest skills must check existence before creating.
12. **Bidirectional invariant.** Most common ingest mistake. Forward link without reverse = L06 fail.
13. **README schema fence.** Edits inside `<!-- lumina:schema -->` markers are wiped on upgrade. User content must go outside.
14. **Adding a new pack** requires threaded `{{#if pack_X}}` guards in `lumina.config.yaml`, page templates, and these regions of `src/templates/README.md`: Repository Layout (`wiki/`, `raw/`, `_lumina/tools/` lines), the `raw/` rule sentence (named exception paths), Page Types table rows, Cross-Reference Rules table rows, Exemptions list, Skills section, Tooling Conventions. Forgetting any one = orphaned or leaking content.
15. **Reading-pack skills missing `allowed-tools`** — known drift, fix when touching them.
16. **`/lumi-discover` writes to `raw/discovered/`** — crosses the "raw is read-only" headline. The exception is implicit; document it explicitly when adding any new skill that touches `raw/`.
17. **Stale planning artifact:** `docs/planning-artifacts/lumina-wiki-readme-template.md` lines 179–181 list dropped research skills. The shipped `README.md` at project root is authoritative.
18. **Pre-release semver not handled** — `isNewerVersion('1.0.0-alpha.1', '1.0.0')` returns nonsense. Don't use for pre-release tags.
19. **DeepXiv:** `read` is GET with `?section=`; `search` is POST with JSON body. Don't mix.
20. **S2 silence:** when `SEMANTIC_SCHOLAR_API_KEY` is missing, `init_discovery.py` phases 2/3 return `[]` quietly. Zero results doesn't mean "no data" — check the key.

---

## 10. Local testing & dev loop

The user-facing `README.md` describes the **post-install workspace** (`raw/`, `wiki/`, `/lumi-*`). To develop the **installer itself**, never test against the public registry — use one of the local mechanisms below. Full guide: `docs/DEVELOPMENT.md`.

### Quickest paths

| Goal | Command |
|---|---|
| One-shot install into temp dir, see tree, auto-clean | `npm run dev:sandbox` |
| Same, but keep tmp dir for inspection | `npm run dev:sandbox -- --keep` |
| Same, with stable path `$TMPDIR/lumi-sandbox` | `npm run dev:sandbox -- --reuse` |
| Forward flags to `lumina install` | `npm run dev:sandbox -- --packs core,research --ide claude_code` |
| Direct invocation (no helper) | `node bin/lumina.js install --yes` (with cwd in a sandbox) |
| Global symlink for `lumina-wiki` command | `npm link` (in repo) → `lumina-wiki install` (in sandbox) |
| Simulate published tarball | `npm pack` → `npx ./lumina-wiki-0.1.0.tgz install` |

### CI gates (run before push)

```bash
npm run test:all           # node --test (installer + scripts) + pytest (tools)
npm run ci:idempotency     # install twice → git diff over watched paths must be empty
npm run ci:package         # npm pack --dry-run, validate files allowlist + postinstall ban
```

These three commands are exactly what CI runs across Node {20, 22} × {ubuntu, macos, windows}. If they pass locally, CI will pass.

### Per-module quick tests

```bash
npm run test:fs            # filesystem helpers (atomic write, safePath, symlink ladder)
npm run test:manifest      # manifest read/write + CSV escaping
npm run test:template      # {{var}} + {{#if}} + schema region
npm run test:update        # update-check timeouts
npm run test:installer     # all installer tests
npm run test:scripts       # wiki.mjs / lint.mjs / reset.mjs tests
npm run test:python        # src/tools/tests/ via pytest
```

### Idempotency invariant — what's actually watched

`scripts/ci-idempotency.mjs` runs `git diff --exit-code` only over these paths after the second install:

```
README.md, CLAUDE.md, AGENTS.md, GEMINI.md, QWEN.md, IFLOW.md,
.cursor/, .claude/, .agents/,
_lumina/config/, _lumina/schema/, _lumina/scripts/, _lumina/tools/,
.env.example, wiki/, raw/
```

**Intentionally ignored** (so they don't break the gate): `_lumina/manifest.json`, `_lumina/_state/*` — runtime state with timestamps. Do not rely on these being byte-stable across installs.

### Testing rules an AI agent must follow

1. **Never run `lumina install` inside the repo root.** It will scaffold a workspace on top of the source code. Always use a sandbox dir.
2. **Sandbox needs `git init`** before testing idempotency — `dev-sandbox.mjs` does this for you; manual paths must do it explicitly.
3. **`commands.test.js` is slow** (real `spawnSync` of the CLI, 30 s timeout per test). Don't add more integration tests there unless absolutely necessary.
4. **Don't add `devDependencies`** to make test setup easier. The current invariant (`devDependencies: {}`) is a feature — Node and pytest are enough.
5. **Don't mock `exec` in `update-check.test.js`** — the test deliberately hits real `npm` if available, guarded by a 3 s wall-clock assertion.
6. **Python test fixtures live in `src/tools/tests/conftest.py`**: `tmp_project` (full directory tree), `mock_env` (dummy keys), `env_file` (writes `.env`). Reuse these instead of building new fixtures.
7. **`prompts.js` has no tests** — keep prompt logic minimal so the untested surface stays small.

### Common dev-loop mistakes

- Forgetting `npm install` after a fresh clone — `bin/lumina.js` will fail with `Cannot find package 'commander'`.
- Stale `npm link` after switching clones — `npm unlink -g lumina-wiki` and re-link from the current repo.
- Editing `wiki.mjs` and forgetting `schemas.mjs` — `schemas.mjs` is the single source of truth; update it first, then `wiki.mjs`/`lint.mjs` consume the change.
- Confusing `--packs core` with "core only" — `core` is always force-inserted; `--packs research` means "core + research". You cannot exclude `core`.
- Running `dev:sandbox` and expecting state to persist between runs without `--keep` or `--reuse` — default cleans up.

---

## 11. References

- **PRD:** `docs/planning-artifacts/prd.md`
- **Architecture:** `docs/planning-artifacts/architecture.md`
- **Implementation plan:** `docs/planning-artifacts/implementation-plan.md`
- **Product brief:** `docs/planning-artifacts/product-brief.md` (oldest — PRD wins on conflicts)
- **Karpathy LLM-Wiki gist:** linked from `README.md` line 9
