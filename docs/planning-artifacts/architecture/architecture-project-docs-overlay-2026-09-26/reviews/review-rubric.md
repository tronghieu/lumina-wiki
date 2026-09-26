# Rubric Review — project-docs-overlay spine

Reviewed: `ARCHITECTURE-SPINE.md` (draft, 2026-09-26) against `SPEC-project-docs-overlay` + companions and the brownfield code at HEAD `ea44bf2`.

## Verdict

Not ready for epics. The paradigm, the fact contract (AD-10), reference resolution (AD-11), and the read-only source layer are sound, and all 12 capabilities are mapped. But two rules break a binding SPEC constraint or success criterion by construction (C1, C2). Eleven high findings are real divergence points the spine leaves open. They sit mostly in the operational envelope: upgrade, commit matrix, concurrency, testing, and IDE targets.

## Rubric scorecard

| Criterion | Result |
| --- | --- |
| Fixes the real divergence points, misses none | Partial: see H1, H4, H5, H6, H8, H9 |
| Every AD Rule enforceable and prevents its divergence | Partial: AD-2 (H1), AD-3 (H3), AD-8 (M6), AD-14 (H6) |
| Nothing Deferred lets two units diverge | Mostly: concept matching needs a provisional default (M10) |
| Ratifies, not contradicts, brownfield | Partial: C1, H3, M8; claims otherwise check out (below) |
| Covers all 12 capabilities | Yes, all mapped |
| Every feature-altitude dimension decided/deferred/open | No: manifest schemaVersion, commit matrix, concurrency, testing, root resolution, IDE matrix missing |
| Mermaid diagrams valid and meaningful | Valid; meaning gaps (L2) |

## Brownfield spot-checks

| Claim | Finding |
| --- | --- |
| `replaceOrAppendSchemaRegion` in `src/installer/commands.js` | Exists (line 2029). It hardcodes `<!-- lumina:schema -->` markers and delegates to `replaceSchemaRegion` in `template-engine.js:176`, which also hardcodes them and normalizes the whole file to LF. It cannot serve `lumina:project` unchanged. See H3. |
| `matchGlob` in `src/scripts/lib/globs.mjs` | Exists; `*`/`**` only, as `source-scope.md` requires. The module imports `../schemas.mjs` (line 15), so any copy of `globs.mjs` needs `schemas.mjs` next to it. See M8. |
| `atomicWrite` in `src/scripts/lib/fsx.mjs` | Exists. It uses a fixed `<file>.tmp` sibling, so it is unsafe for concurrent writers of the same file. See H4. |
| `VALID_IDE_TARGETS` | `commands.js:115`: `claude_code, codex, cursor, gemini_cli, qwen, iflow, generic`. No `antigravity` today, as the spine says. |
| `lint.mjs --json` shape | Real shape: `{schema_version, scanned_files, checks_run, findings[{id,severity,fixable,file,line,message,fix_applied}], summary{errors,warnings,info,fixes_applied}}`. The spine's "mirrors" names only a subset. Exit 1 fires on warnings as well as errors (`lint.mjs:3470`). See M9. |
| Zero-dependency workspace scripts | True for the classic scripts, except `lib/watchlist-config.mjs`, which dynamically imports `js-yaml` with a fallback. That module would be swept into project installs by the lib directory copy (C1). |
| `--agents` early branch | `installCommand` returns early at lines 201–216, so `--mode project` can branch the same way. Confirmed. |
| `writeGitignore` | Writes only when `.gitignore` is absent (line 2194); no block logic exists. The AD-3 block is new code, not reuse (`brownfield.md` says "reused"). |

---

## Critical

### C1 — New `lib/*.mjs` files leak into every classic install

- **Evidence:** `copyScripts` (`commands.js:1447–1476`) copies every `.mjs` file in `src/scripts/lib/` by directory listing. The Structural Seed puts `scope`, `frontmatter`, `markdown`, and `hash` there. After the change, every classic install gets four extra files in `_lumina/scripts/lib/` and extra `files-manifest.csv` rows.
- **Breaks:** the SPEC constraint "Classic IDE installs and AI-agent installs stay byte-identical to today", which the spine itself inherits. No gate catches it: `ci:idempotency` compares install N with install N+1, not with the previous release.
- **Fix:** put project-mode code under its own tree, for example `src/scripts/project/{project.mjs,ontology.mjs,lib/*.mjs}` installed to `_lumina/scripts/`. Give project mode an explicit copy list that also includes `lib/globs.mjs`, `lib/fsx.mjs`, and `schemas.mjs` (globs imports it). Add a CI check that a classic install's file set matches a committed golden list.

### C2 — Committed `_lumina/manifest.json` makes every re-install a diff

- **Evidence:** the manifest writes `updatedAt: now`, absolute `resolvedPaths.projectRoot`, and per-machine `symlinkStrategies` (`commands.js:480–497`). AD-3's `.gitignore` block ignores only `_lumina/graph/` and `_lumina/_state/`, so the manifest is committed.
- **Breaks:** CAP-1 success ("a second install produces no diff"). It also commits one developer's absolute home path into the team repo.
- **Fix:** add `_lumina/manifest.json` to the AD-3 block, and state in AD-3 that no committed Lumina file contains a timestamp or an absolute path. If CI or teammates need to see the mode, commit a separate stable `_lumina/config/install.json` holding `{mode, packageVersion}` only.

---

## High

### H1 — AD-2 makes a plain upgrade fail

- **Evidence:** "default `classic`" plus "an upgrade whose mode differs from the recorded one exits 3". Taken literally, `lumina install --yes` with no `--mode`, run in a project-mode repo, exits 3.
- **Fix:** on upgrade, mode defaults to the recorded mode. Only an explicit `--mode` that conflicts with it exits 3. A missing `mode` in an existing manifest means `classic`.

### H2 — Manifest schemaVersion, migration, and older-installer protection are undecided

- **Evidence:** `MANIFEST_SCHEMA_VERSION = 4` (`manifest.js:29`), and `migrateManifest` refuses only newer versions. If `mode` is added without a bump, a teammate on lumina-wiki ≤1.14 runs a classic upgrade in a project repo. That scaffolds `raw/` and `wiki/`, rewrites `README.md` through the schema merge, and overwrites `CLAUDE.md`/`AGENTS.md` via `renderIdeStubs`.
- **Fix:** add an AD: bump to schemaVersion 5 with a `'4->5': m => ({...m, mode: m.mode ?? 'classic'})` migration. Older installers then refuse with exit 3 through the existing downgrade guard. Also state the fact-file and `project.json` schemaVersion policy: read older and migrate on write; newer means exit 3.

### H3 — AD-3's helper cannot do what the rule says

- **Evidence:** `replaceOrAppendSchemaRegion` and `replaceSchemaRegion` hardcode the schema markers. `replaceSchemaRegion` also rejoins the whole file with `\n`, so a CRLF `AGENTS.md` (common on Windows) is converted to LF outside the region on the second install. The append path does not normalize, so the first and second installs differ.
- **Breaks:** CAP-1 "changes pre-existing files only inside the marker region" and "second install produces no diff".
- **Fix:** rule, to be ratified: generalize to `replaceOrAppendRegion(content, open, close, body)`, with schema markers as the default so classic output is unchanged. It must detect the file's EOL and write the block and the rest of the file byte-for-byte in that EOL. Add a CRLF fixture test that checks bytes outside the region are identical after two installs. The `.gitignore` block needs the same EOL rule.

### H4 — No concurrency rule for writers of `_lumina/graph` and `_lumina/_state`

- **Evidence:** AD-12 has the hook and every read subcommand rebuild the parsed part. A PostToolUse hook fires on every edit, including parallel agent edits, while `query` or `lint` may run in the same moment. `atomicWrite` uses a fixed `<file>.tmp`, so two processes share one temp inode, which can leave interleaved content or an ENOENT on rename. On Windows, renaming over a file another process has open fails with EPERM.
- **Fix:** add an AD. Temp names are unique (`<file>.<pid>.<rand>.tmp`), as a project-mode wrapper or an opt-in `fsx` parameter so the classic path stays unchanged. The rebuild takes a lock file in `_lumina/_state/` (`open(..., 'wx')` with a stale-lock timeout). A reader that cannot get the lock reads the last complete graph and adds a warning. `facts-write` locks per fact file. Windows EPERM on rename is retried a few times, then exits 3.

### H5 — Stale-fact policy is left to each consumer

- **Evidence:** AD-12 defines how staleness is detected but not what `build`, `lint`, `query`, `view`, and `verify-evidence` do with a stale fact. CAP-9 needs CI and local lint to agree, and CI will routinely see docs edited without re-ingest. Whether a stale fact counts as a violation, and whether it fails CI, decides how teams can adopt the tool.
- **Fix:** add a rule to AD-12. Build includes stale facts with `stale: true` and never drops them. Lint emits one `P-stale` finding per stale doc at severity `warning`, and evaluates relation rules on stale facts at their original severity. `query` returns them flagged, with the stale-doc count in a top-level `warnings[]`. Also decide whether warnings fail CI (see M9).

### H6 — AD-14 "each rule owned by one meta-relation" leaves some rules without an owner

- **Evidence:** AD-11 produces dangling-reference findings. `ontology.md` requires an external-ID pattern check. The SPEC's Why cites ID collisions. None of these belongs to a meta-relation, so AD-7/AD-14 as written give them no home, and two stories will each invent one.
- **Fix:** split the id space. `P0x` for graph-structural rules owned by the engine (dangling reference, ID collision, external-ID pattern, stale, broken evidence). `P1x+` for relation rules owned by `META_RELATIONS`. List every rule id with its owner and severity in `ontology.mjs`, so lint and viewer highlighting read one table.

### H7 — Evidence quotes are neither normalized nor checked at write time

- **Evidence:** AD-10 rejects facts that lack a quote but never checks that the quote exists. The convention says "verbatim + 1-based line" but does not cover multi-line quotes, table-cell pipes, Markdown emphasis, or whitespace. The ingest skill and `verify-evidence` will each pick a normalization, so CAP-11 reports false breaks on day one, and an agent's hallucinated quote gets committed.
- **Fix:** one function, `lib/evidence.mjs locateQuote(source, quote, line)`: NFC, whitespace collapsed, match anywhere in the file, with the stored line used only as a hint. `facts-write` rejects (exit 2) any quote that `locateQuote` cannot find in the current source, and `verify-evidence` uses the same function. Cap quote length, for example at 300 characters.

### H8 — IDE target matrix for project mode is undecided

- **Evidence:** AD-2 never calls `renderIdeStubs`, and AD-3 covers only `AGENTS.md` and `CLAUDE.md`. Nothing says whether `cursor`, `gemini_cli`, `qwen`, `iflow`, or `generic` are accepted in project mode, or which entry file or skills directory each gets. Adding `antigravity` to `VALID_IDE_TARGETS` also exposes it to classic installs, which then need a stub and must resolve the `AGENTS.md` collision with `codex`.
- **Fix:** add a table to AD-4 with one row per target: accepted in project mode (y/n), entry file that gets the marker block, and skills dir. Decide whether `antigravity` is project-only, for example through a separate `VALID_PROJECT_IDE_TARGETS`. A rejected target exits 1.

### H9 — Engine root resolution and the hook command path are unspecified

- **Evidence:** the hook runs `node _lumina/scripts/project.mjs refresh` as a relative path. If the host session's cwd is a subdirectory, `node` fails with "Cannot find module" and exits 1, so AD-12's "always exits 0" cannot hold. Separately, each subcommand could resolve the repo root differently (cwd, walk-up, or git), which breaks AD-9's single-scope guarantee.
- **Fix:** add a rule. `project.mjs` resolves root by walking up to `_lumina/config/project.json`, in one function every subcommand uses. The hook command uses the host's project-dir variable where one exists (`$CLAUDE_PROJECT_DIR` for Claude Code), and the rule lists the command string for each host. The script wraps `main` so that `refresh` exits 0 on any error, including a missing config.

### H10 — No testing strategy

- **Evidence:** the capability success criteria depend on Seli and Capigo at `../seli` and `../capigo`, which are not in CI. The spine names no fixtures, no project-mode `ci:idempotency` scenario, and no classic byte-identity gate (C1). It has no gate for the 1-second parse (CAP-5), and no rule that new test files get added to the explicit lists in `package.json` `test:scripts`/`test:installer`.
- **Fix:** add a Testing section:
  - Small committed fixtures under `src/scripts/project/fixtures/`: a BMAD-like repo, a frontmatter-less ADR repo, a KEP-like repo, and a CRLF repo.
  - A `--mode project` scenario in `ci-idempotency.mjs`, with pre-seeded user `AGENTS.md`, `CLAUDE.md`, and `.gitignore` files.
  - The classic golden file-set check from C1.
  - A parse-determinism test that runs the parse twice and compares bytes.
  - A synthetic 250-doc timing test.
  - An engine test that hashes in-scope files before and after every subcommand (enforces AD-1).
  - Seli, Capigo, and KEP stay manual pilot gates, recorded in `pilot-evidence.md`.

### H11 — Commit matrix and version skew across teammates are undecided

- **Evidence:** the spine commits `_lumina/scripts`, `config`, and `facts`. It says nothing about `.agents/skills/lumi-project-*`, `.claude/skills` symlinks (Windows checkouts turn them into text files without symlink privilege), or `_lumina/schema`. Nor does it say what happens when teammates on different Lumina versions reinstall and churn the committed `_lumina/scripts`.
- **Fix:** add a commit-matrix table covering every path the installer writes, marked committed or ignored. Recommended:
  - Commit the skill copies (the `copy` strategy, not symlinks, in project mode).
  - Ignore the `.claude/skills` links, or use copies there too.
  - Stamp `_lumina/scripts/VERSION`. The installer warns when downgrading committed scripts, and `project.mjs` prints a warning when a fact's `schemaVersion` is newer than it supports.

---

## Medium

- **M1 — Anchor slug algorithm.** AD-11 creates "the single slug function in `lib/markdown.mjs`", but `lib/slug.mjs` (`slugify`) already exists. It strips diacritics and drops `đ`, which differs from how people write `#anchor` links (GitHub-style, Unicode kept). Vietnamese headings on Seli will not resolve. **Fix:** state that the anchor slug is GitHub-compatible (lowercase, Unicode letters kept, spaces to `-`, punctuation dropped, `-1` suffix for duplicates) and deliberately not `slugify`, and test it on Vietnamese headings.
- **M2 — Merging parsed and agent facts.** Build "merges both" with no dedupe key or precedence. When parse types `related:` as `references` and the agent says `governs` for the same pair, lint double-counts or contradicts itself. **Fix:** dedupe on (subject, object, anchor) after resolution. A more specific relation beats `references`. Keep both provenances on the merged edge.
- **M3 — `ontologyVersion` is hand-bumped.** When the setup agent forgets to bump it, AD-10's re-ingest marking never fires. **Fix:** `ontologyVersion` is computed by the engine as sha256 of the canonical type map, relation map, and typing rules in `project.json`. It is never written by hand.
- **M4 — Parse output determinism.** CAP-5 needs byte-identical output, but the Data convention says only "fixed key order". **Fix:** files in `_lumina/graph/` contain no timestamps or absolute paths, arrays are sorted by id, and timestamps live only in `_lumina/_state/`.
- **M5 — AD-1 conflicts with `ontology.md`.** `ontology.md` lets setup propose writing a glossary into the project's `docs/`. AD-1 allows frontmatter fixes only. **Fix:** extend AD-1's exception to "a new file the user approved, written by the host agent", and restate that no engine code writes docs.
- **M6 — AD-8 "must run config-check" cannot be enforced.** It is a prompt instruction. **Fix:** every subcommand validates `project.json` on load (globs through `safePath`, every type mapped to a known meta-type) and exits 2 with the error list. `config-check` becomes the same validation with no other work.
- **M7 — Uninstall ordering.** The classic `uninstallCommand` runs `rm -rf _lumina` first (`commands.js:603`) and deletes `AGENTS.md`/`CLAUDE.md` when their hash matches `files-manifest.csv`. If project mode records the user's pre-existing `AGENTS.md` there, uninstall deletes the whole file. **Fix:** AD-17 states that uninstall branches on `manifest.mode` before any classic step, never records user entry files in `files-manifest.csv`, and also strips the `.gitignore` block.
- **M8 — Distribution list.** `package.json` `files` lists scripts explicitly. The Structural Seed adds `project.mjs`, `ontology.mjs`, and `src/vendor/**`, but only the vendor file appears in AD-16. The `copyScripts` try/catch swallows missing files, so a missing engine file ships silently. **Fix:** add all new paths to `files` and to `ci-package` `requiredFiles`. The project-mode copy fails loudly (exit 3) on any missing file. Include `schemas.mjs` because `globs.mjs` imports it.
- **M9 — Exit codes and CI gating.** AD-14 makes 2 the code for user error, while the inherited contract makes 1 the code for bad args, and the other subcommands are unmapped. Mirroring `lint.mjs` means warnings exit 1 and fail CI. **Fix:** add a per-subcommand exit table. Give lint a `--fail-on error|warning` flag, default `error`, so stale warnings do not break adoption, and specify the exact JSON keys, dropping `fixable`/`fix_applied`.
- **M10 — Concept matching deferral.** CAP-5 and CAP-7 need a matcher now. **Fix:** a provisional default in the spine: NFC, case-insensitive, word-boundary match on name and aliases, no diacritic folding, code blocks skipped. The Seli false-positive measurement can then revise it.
- **M11 — Viewer needs absolute paths, and inline data must be escaped.** A `vscode://file/<abs>:line` link needs an absolute path, which contradicts the repo-relative Paths convention. Evidence quotes inlined into `<script>` can contain `</script>` or `<!--` and break or inject into the page. **Fix:** keep data repo-relative and derive the absolute root at view time from `location.pathname` (`view.html` sits at a known depth). Serialize inlined JSON with `<`, `>`, `&`, U+2028, and U+2029 escaped as `\uXXXX`.
- **M12 — Project repos look like wikis.** `wikis add`, `wikis doctor`, `findEnclosingWorkspace`, and the registry treat any `_lumina/manifest.json` as a wiki. **Fix:** these paths read `mode` and refuse or skip project-mode repos (the SPEC non-goal excludes lumi-hub registration).
- **M13 — Flag conflicts.** Behavior of `--mode project` combined with `--packs`, `--agents` (the fast path wins silently today), or `--profile minimal` is unstated. **Fix:** any of these with `--mode project` exits 1 with a message.
- **M14 — Shared skill context.** Every classic `SKILL.md` opens with "Read `README.md` at the project root", but in project mode that README belongs to the project. Without a stated location for shared context (engine commands, ontology, rules), six skill stories will each restate it differently. **Fix:** name one file, for example `_lumina/PROJECT.md` rendered by the installer, that the `lumina:project` block and every `lumi-project-*` skill point to. The anchor tests (`ci-agent-host-isolation.mjs`, `verify-lumi-help.test.mjs`) keep excluding `src/skills/project/`.

## Low

- **L1 — Wrong cross-reference.** AD-6 says "the viewer library is inlined as text, AD-13"; that is AD-16.
- **L2 — Diagrams.** Both parse as valid Mermaid flowcharts (read by hand; no `mmdc` available). Diagram 1 omits the hook → `refresh` path (CAP-8), `_state`, and `cfg → build/lint`, even though build and lint need the type map. Diagram 2's `lib -.->|no imports of| npm` draws an absence as an edge, and it omits the installer copying scripts and vendor into `_lumina/`. **Fix:** add the missing nodes and edges, replace the negative edge with a note, and quote `installer["installer --mode project"]` so `--` is never parsed as an edge.
- **L3 — Third-party notices.** The force-graph UMD bundles its d3 dependencies (ISC/BSD). **Fix:** vendor a combined third-party notice, not only force-graph's MIT license.
- **L4 — Hook coverage.** The Claude Code matcher `Edit|Write` misses `MultiEdit` and `NotebookEdit`. Read-time freshness covers the gap, but `Edit|Write|MultiEdit` is free.
- **L5 — Fact paths on case-insensitive filesystems.** Mirroring source paths can collide on macOS and Windows (`Docs/X.md` vs `docs/x.md`) and approach Windows MAX_PATH. **Fix:** facts-write detects a case-fold collision and exits 2.
- **L6 — Consumer CI Node version.** Engine scripts need Node ≥ 24 in the project's CI, which may not be a Node repo. **Fix:** `project.mjs` checks `process.versions.node` and exits 3 with a clear message. Document the CI snippet.
- **L7 — Citation precision.** The Inherited Invariants table cites "§3.4–5" for empty devDependencies. That rule is in the root `CLAUDE.md`, not project-context §3.4–5. The LoC soft cap (§3.23) is not acknowledged.
- **L8 — Hash normalization.** AD-12 normalizes CRLF only. A BOM or a lone CR changes the hash across editors. **Fix:** strip a leading BOM as well, or state that it is deliberately kept.
