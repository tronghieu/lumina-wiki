# Contributing to Lumina-Wiki

Thanks for considering a contribution. Lumina-Wiki is MIT-licensed and accepts pull
requests from humans and from AI agents driving humans. This guide is the **entry
point** — it lists the workflow, the checklists, and the rules most likely to bite
you. It is intentionally short. The authoritative detail lives in three files you
must read before touching code:

1. **[`docs/project-context.md`](docs/project-context.md)** — full critical rules,
   module contracts, schema, lint checks, skill conventions. **Read this first.**
2. **[`CLAUDE.md`](CLAUDE.md)** — codebase orientation, idempotency invariant,
   exit-code contract. (Other agent stubs — `AGENTS.md`, `GEMINI.md`,
   `.cursor/rules/lumina.mdc` — point at the same content.)
3. **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)** — local dev/test workflows,
   sandbox helpers, dev-loop pitfalls.

If you are an AI agent, treat those three files as load-bearing context for every
session. If you are a human, skim them once and keep them open.

---

## 1. Project shape

Lumina-Wiki is **two layers in one repo**:

- **Installer** — `bin/lumina.js` + `src/installer/*.js` (Node ESM ≥20). Idempotent,
  cross-platform, atomic, symlink-with-fallback. This is what `npx lumina-wiki
  install` runs.
- **Workspace payload** — `src/scripts/*.mjs` (Node wiki engine), `src/tools/*.py`
  (Python research-pack tools), `src/skills/**/*.md` (markdown agent prompts),
  `src/templates/**/*` (rendered into the user's project on install).

The repo root is **not** itself a usable workspace. **Never run the installer in
this repo** — it will overwrite source files. Use `npm run dev:sandbox` instead
(see §3).

## 2. Before you start

- License: MIT. By submitting a PR you agree your contribution is MIT-licensed.
- Security issues: do not file public issues. Email the maintainer listed in
  `package.json`.
- No CLA. No mandatory issue-before-PR — but for non-trivial changes, opening an
  issue first saves wasted work.
- Be excellent to each other. This project follows the
  [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). By participating you agree
  to abide by it. Report incidents to `tronghieu.luu@gmail.com`.

## 3. Local dev setup

```bash
# Clone and install runtime deps (no devDependencies — that's intentional)
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm install

# Run the installer against a fresh sandbox (NEVER in this repo)
npm run dev:sandbox                          # creates tmp dir, installs, prints tree
npm run dev:sandbox -- --keep                # keep tmp dir for inspection
npm run dev:sandbox -- --reuse               # stable path: $TMPDIR/lumi-sandbox
npm run dev:sandbox -- --packs core,research # forward flags to installer
```

Full test commands and per-module helpers live in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). The short list:

```bash
npm run test:all          # Node + Python + installer
npm run test:catalog      # lumi-help.csv integrity (8 pack combos)
npm run ci:idempotency    # install twice → git diff over watched paths empty
npm run ci:package        # npm pack --dry-run + files allowlist + postinstall ban
```

## 4. Non-negotiable rules (the short version)

Detail lives in [`docs/project-context.md` §3](docs/project-context.md). The rules
most likely to fail review:

| Rule | Why it exists |
|---|---|
| **Never `writeFile` directly — always `atomicWrite`** (Node) or `tempfile + fsync + os.replace` (Python) | Partial writes corrupt the workspace |
| **Never accept user paths without `safePath()`** | Rejects `..`, absolute paths, Windows drive letters, backslash traversals |
| **Cold-start budget < 300 ms** (CI fails at 350 ms median) | `bin/lumina.js` lazy-imports every subcommand; keep it that way |
| **No `postinstall` script. No native modules. No `devDependencies`.** | `ci-package.mjs` blocks publish if any of these creep in |
| **`raw/` is user-owned** — additions only into `raw/tmp/` and `raw/discovered/` | Touching anything else destroys user data |
| **Bidirectional links are mandatory** | Forward link + reverse link in the same operation; exceptions live in `foundations/**`, `outputs/**`, `*://*` |
| **No emoji in shipped files** (READMEs, installer output, skills) unless the user asks | Maintainer preference; respected in every shipped file today |
| **Zero telemetry** | Only outbound network call is the optional `npm view` update check (2 s timeout, suppressible) |
| **OmegaWiki is prior art only — never mention it in user-facing strings** | Lumina is original work, not a port |
| **English-only commits, conventional-commits style** (`feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`) | CHANGELOG generation depends on it |
| **User-facing docs target non-technical readers** | Banned-word list and four-part skill-section structure encoded in [`docs/project-context.md` §3 rule 21] |
| **Trilingual user-facing docs** — EN + VI + ZH in the same PR | See §6 below; this is the rule most frequently missed |

If a rule appears to be wrong for your change, raise it in the PR description.
Don't bypass it silently.

## 5. Workflow checklists

Each checklist below covers what a single PR must touch. Missing items will be
flagged in review.

### 5.1 Adding, renaming, or removing a skill

- [ ] `src/skills/<pack>/<name>/SKILL.md` — frontmatter (`name`, `description`,
      `allowed-tools`), body opens with "Read `README.md` at the project root
      before this SKILL.md."
- [ ] Register in `src/installer/commands.js` `getSkillDefs()`
- [ ] **Add a row to `src/templates/_lumina/schema/lumi-help.csv`** wrapped in the
      matching `{{#if pack_*}}` guard. Without this, `/lumi-help skills` will not
      list the skill even though it installs and runs.
- [ ] Update the skill table in `README.md`
- [ ] Update the skill tables in `README.vi.md` and `README.zh.md`
- [ ] Update post-install template README mirrors:
      `src/templates/README.md`, `src/templates/README.vi.md`,
      `src/templates/README.zh.md`
- [ ] Update `docs/user-guide/{en,vi,zh}.md` if the skill changes any user
      workflow
- [ ] Add a `[Unreleased]` entry to `CHANGELOG.md` (will be assigned a version at
      release time)
- [ ] `npm run test:catalog` and `npm run test:all` pass
- [ ] `npm run ci:idempotency` passes (install twice → no diff)

### 5.2 Adding a provider / fetcher (research pack)

- [ ] Python module under `src/tools/` with a stable CLI (`--help` works)
- [ ] If it makes outbound HTTP, route through `_safe_url()` / `_safe_get()` for
      SSRF protection; re-validate after every redirect hop
- [ ] If it parses XML/HTML, use `defusedxml` and catch
      `defusedxml.DefusedXmlException` (the base class)
- [ ] Mid-stream size cap on any binary download (see `fetch_pdf.py` for the
      pattern)
- [ ] Filename hashing on user-supplied identifiers that may collide with Windows
      reserved names (CON, PRN, AUX, NUL)
- [ ] Add the provider to `VALID_SOURCES` in both
      `src/scripts/lib/watchlist-config.mjs` and `src/scripts/discover-runner.mjs`
- [ ] Provenance contract: every provider that returns a candidate must emit one
      or more `sources[]` entries through `buildSourceEntry()` (Node) or
      `build_source_entry()` (Python). Shape documented in
      [`docs/project-context.md`](docs/project-context.md) §5
- [ ] Wire the new tool into `src/installer/commands.js` research-pack copy step
- [ ] Test parity between Node and Python via the shared
      `src/tools/tests/fixtures/id-cases.json` fixture
- [ ] `pytest src/tools/tests -q` passes

### 5.3 Changing schema or frontmatter

- [ ] Modify `src/scripts/schemas.mjs` — it is the **single source of truth** for
      entity types, edge types, required frontmatter, exemption globs. Pure data,
      no I/O, no side effects.
- [ ] Mirror in `src/tools/id_utils.py` if the Python tools consume the namespace
- [ ] Be additive: new optional fields are fine; renaming or removing a field
      requires a `migrate` path in `src/installer/manifest.js`
- [ ] Document the new shape in `docs/project-context.md` §5 with a version stamp
      ("added 2026-MM")
- [ ] Lint check added in `src/scripts/lint.mjs` if the new field has invariants
- [ ] Migration note in CHANGELOG under `[Unreleased]`
- [ ] Existing wikis must still lint clean (additive change) or have a documented
      `/lumi-migrate-legacy` flow

### 5.4 Modifying the installer

- [ ] `src/installer/commands.js` is 18 numbered steps — keep the numbering when
      inserting
- [ ] All file writes through `atomicWrite` from `src/installer/fs.js`
- [ ] Symlink creation goes through the
      `symlink → junction → copy` ladder (`src/installer/fs.js`). Chosen strategy
      must be persisted in `manifest.symlinkStrategies`
- [ ] Lazy-imports stay lazy — never promote an `import` inside an `.action()`
      callback to the top of `bin/lumina.js`
- [ ] Three state files always written last, atomically: `manifest.json`,
      `_lumina/_state/skills-manifest.csv`, `_lumina/_state/files-manifest.csv`
- [ ] `npm run ci:idempotency` passes — install twice, the diff over watched
      paths must be empty
- [ ] Cold-start: `node scripts/measure-cold-start.mjs` median < 350 ms (budget is
      300 ms; CI fails at 350 ms)

### 5.5 Editing entry-point stubs (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules/lumina.mdc)

- [ ] These are **rendered stubs**, not symlinks. Repo-level files and template
      files exist separately.
- [ ] Only the region between `<!-- lumina:schema -->` and `<!-- /lumina:schema -->`
      markers is rewritten on upgrade. Markers must be on their own lines.
- [ ] `README.md` is the canonical hub; stubs redirect to it. Keep stubs ~5 lines.

## 6. Trilingual docs convention

User-facing documentation ships in **English (EN)**, **Vietnamese (VI)**, and
**Simplified Chinese (ZH)**. Every PR that touches a user-facing surface must
update all three languages in the same PR.

User-facing surfaces:

- `README.md` / `README.vi.md` / `README.zh.md` (repo root, npm landing page)
- `src/templates/README.md` / `README.vi.md` / `README.zh.md` (post-install user
  workspace)
- `docs/user-guide/{en,vi,zh}.md`
- `docs/user-guide/advanced-*.{en,vi,zh}.md`
- Skill `SKILL.md` files (English source; the rendered post-install banner is
  localized via installer locale strings, not per-skill translation)

Plain-language rule: user-facing text targets non-technical readers. Avoid
tool-internal vocabulary (lint, schema, frontmatter, checkpoint, JSON, verify in
the noun sense). The banned-word list and the four-part skill-section structure
are encoded in [`docs/project-context.md`](docs/project-context.md) §3 rule 21.

If you only speak one of the three languages: prefer one of these in order of
preference — (a) ask in the PR description for a translator, (b) use the bundled
`qmd` skill in an LLM session to draft VI/ZH, (c) ship EN-only and call it out
explicitly so a follow-up can translate before release.

## 7. CI gates

Every PR runs:

- **Node 20 / Node 22 × ubuntu / macOS / windows** (6 matrix cells)
- **Bun smoke** (ubuntu) — Bun is not a supported runtime but divergences are
  caught early
- **`npm run test:all`** — installer, scripts, Python
- **`npm run test:catalog`** — `lumi-help.csv` integrity across 8 pack
  combinations
- **`npm run ci:idempotency`** — install twice, diff is empty over watched paths
  (intentionally ignores `_lumina/manifest.json` and `_lumina/_state/*`)
- **`npm run ci:package`** — `npm pack --dry-run`, validates `files` allowlist
  and the postinstall ban
- **Cold-start measurement** — median across N runs must be < 350 ms (budget 300
  ms)

Run them locally before pushing. Windows tests in particular are easy to break
from macOS/Linux — see [`docs/project-context.md` §9 gotchas].

## 8. Exit code contract

When writing CLI tools or wrappers, follow:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | user error (bad args) |
| `2` | filesystem / path safety / unknown slug / missing `--yes` |
| `3` | internal / fs failure / upgrade incompatibility / 5xx network |
| `4` | user cancelled (Ctrl-C in interactive prompt, declined confirm) |

`EACCES`, `EPERM`, and `safePath` `RangeError` all map to exit 2 at
`bin/lumina.js`.

## 9. PR workflow

1. **Branch off `main`.** Branch naming: `feat/<topic>`, `fix/<topic>`,
   `chore/<topic>`, `docs/<topic>`.
2. **Commits**: Conventional Commits (`feat(installer): ...`, `fix(research):
   ...`). The CHANGELOG follows [Keep a Changelog](https://keepachangelog.com).
3. **PR description**: include a **Summary** section and a **Test plan**
   checklist. Reference any related issues. Note any rule deviation explicitly.
4. **PR size**: prefer small, focused PRs. A 4500-line PR is hard to review even
   if every line is justified.
5. **CI must be green** before review. If a check is flaky, say so in the PR; do
   not just re-run.
6. **Review**: maintainer reviews for rule compliance, scope, and risk.
   Security-sensitive code (anything touching network, files outside the
   workspace, or user-supplied paths) gets an extra pass.
7. **Merge**: squash-merge by default; large multi-commit PRs may be
   rebase-merged when each commit is independently meaningful and tested.

## 10. Notes specifically for AI agents

You are a first-class contributor here. Lumina-Wiki is designed to be maintained
by LLMs. A few things specific to you:

- **Always read the three context files first**: `docs/project-context.md`,
  `CLAUDE.md`, `docs/DEVELOPMENT.md`. They are the closest thing to a system
  prompt this project has.
- **`docs/project-context.md` is load-bearing**. Every rule there has a story
  behind it. Do not skip the rules section "to save context" — citing a rule
  number in your PR description is a strong signal you read it.
- **Never run the installer inside this repo**. Use `npm run dev:sandbox`.
  Running `node bin/lumina.js install` at the repo root will overwrite the
  source tree. This has burned past sessions.
- **Memory across sessions**: if your harness supports persistent memory, save
  invariants and conventions that surprised you. Do not save fix recipes (the
  fix is in the code) or repo state (read it fresh).
- **When you spawn subagents**: brief them on the project shape, point them at
  `docs/project-context.md`, and prefer Sonnet for inspection tasks.
- **Trilingual docs**: if you write EN, draft VI and ZH in the same turn
  alongside it. Do not defer "I'll do it later" — later does not happen.
- **`lumi-help.csv` is easy to forget**. If you added a skill and `/lumi-help
  skills` does not show it, you forgot the CSV row. There is no test catching
  this today (test gap; see issue tracker).
- **Cold-start**. Every top-level `import` in `bin/lumina.js` costs everyone a
  few milliseconds forever. If you find yourself needing a module in one of 12
  subcommands, lazy-load it inside that subcommand's `.action()`.
- **Confirm before destructive actions**. The harness rule applies here too: no
  force-push, no branch deletion, no schema removal without an explicit ask.

## 11. Questions

Open a discussion on GitHub or comment on an existing issue. For anything
involving private security, email the maintainer (`package.json` `author`).

Welcome aboard.
