# Code review: spec-project-docs-overlay (2026-09-26)

- Target: branch `feat/project-docs-overlay` vs `main` (merge-base `c37bfc9`), HEAD `45793a9`.
- Mode: full, against `docs/specs/spec-project-docs-overlay/SPEC.md`, companions, spine and stories.
- Groups: A engine (`src/project/**`), B installer (`src/installer/**`, `bin/`, `scripts/`, CI), C skills and docs. Vendor, fixtures and spec docs excluded.
- Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor per group. Every claim was re-verified against source; most `high`/`medium` ones reproduced in a scratch sandbox.
- Result: 5 decision-needed (resolved into patches), 83 patch, 2 defer, 37 rejected.

### Review Findings

#### Decision needed (resolved 2026-09-26, all became patches)

- [x] [Review][Decision] ingest `query node` gate — chose: engine resolve/dry-run check sharing facts-write's resolver.
- [x] [Review][Decision] out-of-scope fact file P14 — chose: warning severity, keep P14.
- [x] [Review][Decision] pilot repo names in shipped prompts — chose: synthetic examples, drop "Verified against" lines.
- [x] [Review][Decision] Decision lifecycle `rejected` — chose: add `rejected` to the lifecycle.
- [x] [Review][Decision] non-string YAML ids/relations — chose: emit a warning finding.

#### Patch — from decisions

- [x] [Review][Patch] engine resolve/dry-run check using facts-write's resolver; ingest gate switches to it (high) [src/skills/project/lumi-project-ingest/SKILL.md:218]
- [x] [Review][Patch] out-of-scope-but-on-disk fact file reports P14 as warning, so lint passes (high) [src/project/lib/factfile.mjs:296]
- [x] [Review][Patch] replace Capigo/Seli examples with synthetic ones [src/skills/project/lumi-project-ask/SKILL.md:243]
- [x] [Review][Patch] add `rejected` to the Decision lifecycle [src/project/ontology.mjs:27]
- [x] [Review][Patch] warning finding for non-string YAML id/relation values [src/project/lib/parse.mjs:154]

#### Patch — engine

- [x] [Review][Patch] a never-resolved dangling ref makes its doc stale from the moment it is written, so update-mode ingest re-selects it every run (high) [src/project/project.mjs:144]
- [x] [Review][Patch] envelopes of deleted or out-of-scope docs still feed graph edges into lint and query [src/project/lib/graph.mjs:632]
- [x] [Review][Patch] `query node` `frags` lists only linked fragments; build it from the doc's headings [src/project/lib/query.mjs:85]
- [x] [Review][Patch] case-sensitive FS: the old-case fact file left after a case-only rename gets a permanent P14 that prune skips; fix the header comment too [src/project/lib/factfile.mjs:366]
- [x] [Review][Patch] quote locator returns the wrong line or null after astral characters [src/project/lib/evidence.mjs:54]
- [x] [Review][Patch] heading anchors drop intra-word and code-span underscores (`user_id` becomes `userid`) [src/project/lib/markdown.mjs:49]
- [x] [Review][Patch] status heading and inline status compared without NFC normalization [src/project/lib/parse.mjs:273]
- [x] [Review][Patch] an unreadable directory anywhere in the repo fails every subcommand; skip it and warn [src/project/lib/scope.mjs:173]
- [x] [Review][Patch] `imports.test.mjs` path check fails on Windows CI; the regex misses side-effect imports [src/project/imports.test.mjs:56]
- [x] [Review][Patch] frontmatter relation with a missing `#anchor` silently widens to the whole doc; resolve it dangling (P09) as facts-write does [src/project/lib/graph.mjs:219]
- [x] [Review][Patch] `ontologyVersion` hashes `relatedRules`/`externalIds`/`concepts` un-normalized, so no-op config edits stale every doc [src/project/lib/config.mjs:486]
- [x] [Review][Patch] buildGraph accepts unvalidated `frag:` subjects and non-string status values; also fixes the `frag:` without `#` slice [src/project/lib/graph.mjs:733]
- [x] [Review][Patch] `config-check` skips the case-fold collision check (AD-8) [src/project/project.mjs:83]
- [x] [Review][Patch] `facts-prune` traversal positional exits 1; path safety should exit 2 [src/project/project.mjs:631]
- [x] [Review][Patch] `include: ['.']` selects nothing; map `.`/`./` to `**` [src/project/lib/scope.mjs:54]
- [x] [Review][Patch] reject `idPattern` anchored with `^`/`$` [src/project/lib/config.mjs:105]
- [x] [Review][Patch] `checkSafePattern` message omits `?` [src/project/lib/config.mjs:94]
- [x] [Review][Patch] stale story-history comments; `validatePrefixed` JSDoc on the wrong function [src/project/lib/graph.mjs:11]
- [x] [Review][Patch] JSDoc says `Map|Record` but only a Map works [src/project/lib/graph.mjs:593]

#### Patch — installer

- [x] [Review][Patch] uninstall on a project repo with a corrupt manifest, or in the conflict state, falls through to classic `rm -rf _lumina`, deleting facts and config (high); corrupt manifest goes to the project path, conflict refuses with exit 3; add the reproduced test [src/installer/commands.js:655]
- [x] [Review][Patch] marker upsert/strip swallow non-ENOENT read errors; an unreadable `AGENTS.md` is replaced by the block alone (high) [src/installer/project-mode.js:185]
- [x] [Review][Patch] target drop and uninstall remove classic `lumi-*` skills (missing `{prefix: SKILL_PREFIX}`) [src/installer/project-mode.js:355]
- [x] [Review][Patch] a `CLAUDE.md -> AGENTS.md` symlink is turned into a regular file [src/installer/project-mode.js:185]
- [x] [Review][Patch] local gitignored manifest targets override the committed `install.json` [src/installer/project-mode.js:507]
- [x] [Review][Patch] Ctrl-C at the facts/config uninstall prompt continues the uninstall; must exit 4 [src/installer/project-mode.js:583]
- [x] [Review][Patch] a classic directory typed at the prompt is never mode-checked; classic can install into a project repo [src/installer/commands.js:363]
- [x] [Review][Patch] classic TTY install asks the locale twice [src/installer/commands.js:348]
- [x] [Review][Patch] `isProjectModeRepo` treats MODE_CONFLICT as classic; hub `doctor --fix` recreates `raw/` [src/installer/manifest.js:500]
- [x] [Review][Patch] a corrupt committed `install.json` skips the skew check and is overwritten; exit 3 instead [src/installer/project-mode.js:137]
- [x] [Review][Patch] `dominantEol` counts the unterminated last line; a CRLF file gains LF lines [src/installer/template-engine.js:244]
- [x] [Review][Patch] uninstall leaves empty `.claude/skills`, `.claude`, `_lumina` [src/installer/project-mode.js:415]
- [x] [Review][Patch] `ci-package` `requiredFiles` misses project skills and `PROJECT.md`; `listProjectSkillDefs` should rethrow non-ENOENT [scripts/ci-package.mjs:74]
- [x] [Review][Patch] MODE_CONFLICT message gives the classic-switch advice in both directions [src/installer/commands.js:257]
- [x] [Review][Patch] classic-flag refusal blames `--mode project` on an auto-detected repo [src/installer/commands.js:1048]
- [x] [Review][Patch] hub doctor reports `hasManifest: true` for a manifest-less project clone [src/installer/wikis-command.js:666]
- [x] [Review][Patch] dead `project.warn.foreign_skill` key and unused `t` param; wrong EN fallback marker text [src/installer/locales/en.mjs:83]
- [x] [Review][Patch] ci-idempotency comment claims first-install CRLF survival it does not check [scripts/ci-idempotency.mjs:62]
- [x] [Review][Patch] test files keep their own `pathExists` copies [src/installer/project-mode.test.js:1]

#### Patch — skills and docs

- [x] [Review][Patch] ingest example 2 says a partial resend goes `changed`; it goes `fresh` and the edges vanish silently [src/skills/project/lumi-project-ingest/SKILL.md:341]
- [x] [Review][Patch] ask says a bad `--status` exits 1; it returns `[]` with exit 0 [src/skills/project/lumi-project-ask/SKILL.md:57]
- [x] [Review][Patch] ask doc-search recipe pipes JSON into `xargs`, is case-sensitive, and breaks on spaces [src/skills/project/lumi-project-ask/SKILL.md:188]
- [x] [Review][Patch] setup DoD (d) cannot pass right after install; compare with a pre-write `git status` snapshot [src/skills/project/lumi-project-setup/SKILL.md:300]
- [x] [Review][Patch] ingest skips a named folder; expand it to the `status` paths under it [src/skills/project/lumi-project-ingest/SKILL.md:50]
- [x] [Review][Patch] PROJECT.md exit-code rules: `lint` exit 1 keeps stdout; `verify-evidence` can exit 3; synopsis should use a heredoc [src/templates/project/PROJECT.md:26]
- [x] [Review][Patch] PROJECT.md says the engine writes `manifest.json` [src/templates/project/PROJECT.md:35]
- [x] [Review][Patch] check and verify tell the agent to run `status` while their guardrails forbid it [src/skills/project/lumi-project-check/SKILL.md:257]
- [x] [Review][Patch] ask's mandatory freshness caveat has no source on the doc-search-only path [src/skills/project/lumi-project-ask/SKILL.md:204]
- [x] [Review][Patch] ask's `query node` shapes omit `frags` [src/skills/project/lumi-project-ask/SKILL.md:40]
- [x] [Review][Patch] ingest guardrail "in or out of scope" contradicts fact 3 [src/skills/project/lumi-project-ingest/SKILL.md:411]
- [x] [Review][Patch] guide, README and PROJECT.md omit the approved glossary file as a write exception (en, vi, zh) [docs/user-guide/project-mode.en.md:4]
- [x] [Review][Patch] PROJECT.md and the installer entry block use `/lumi-project-setup` slash syntax [src/templates/project/PROJECT.md:145]
- [x] [Review][Patch] CHANGELOG describes changes to an unreleased feature; fold into the project-mode entry [CHANGELOG.md:21]
- [x] [Review][Patch] README calls the commands page "every available command"; it lists classic only [README.md:152]
- [x] [Review][Patch] guide Uninstall does not say `_lumina/` goes except `facts/` and `config/` [docs/user-guide/project-mode.en.md:104]
- [x] [Review][Patch] READMEs link the project guide twice [README.md:162]
- [x] [Review][Patch] ask read guardrail does not allow `_lumina/project/PROJECT.md`, which it must read first [src/skills/project/lumi-project-ask/SKILL.md:358]
- [x] [Review][Patch] ingest reports the never-ingested count only when non-zero; should be always [src/skills/project/lumi-project-ingest/SKILL.md:276]
- [x] [Review][Patch] setup rules skeleton uses `docs/` paths and FR/NFR ids (story 8 Never) [src/skills/project/lumi-project-setup/SKILL.md:37]
- [x] [Review][Patch] ingest DoD "exactly one call" ignores the retry and the declined >20 gate [src/skills/project/lumi-project-ingest/SKILL.md:425]
- [x] [Review][Patch] ingest has no branch for `query node <target>` exit 2 [src/skills/project/lumi-project-ingest/SKILL.md:243]
- [x] [Review][Patch] ingest stops the batch on a doc-specific newer-schema exit 3 [src/skills/project/lumi-project-ingest/SKILL.md:185]
- [x] [Review][Patch] check and verify restate the prune flow PROJECT.md owns; cut to a pointer [src/skills/project/lumi-project-check/SKILL.md:130]

#### Patch — verification gaps (tests)

- [x] [Review][Patch] no test reads the rendered PROJECT.md version line [src/installer/project-mode.test.js:106]
- [x] [Review][Patch] resolved-mode classic-flag refusal (no `--mode`, project signal) untested [src/installer/project-mode.test.js:345]
- [x] [Review][Patch] "minimal never prompts" test cannot fail in non-TTY CI; force `isTTY` [src/installer/commands.test.js:541]
- [x] [Review][Patch] newer-schema `computeDocStatus` test is masked by a missing `source` [src/project/lib/graph.test.mjs:1]
- [x] [Review][Patch] facts-write re-hash under the lock untested [src/project/project.test.mjs:849]
- [x] [Review][Patch] `makeEnvelopeLookup` case-insensitive fallback untested [src/project/project.test.mjs:1]
- [x] [Review][Patch] a doc with an attr fact staying `fresh` untested [src/project/project.test.mjs:257]
- [x] [Review][Patch] `query neighbors --relation` filter untested [src/project/lib/query.test.mjs:374]
- [x] [Review][Patch] `factId` scope dependence untested [src/project/lib/fact.test.mjs:73]
- [x] [Review][Patch] root-absolute link test decoy can never be a candidate [src/project/lib/graph.test.mjs:325]
- [x] [Review][Patch] status-map longest-prefix test is order-dependent [src/project/lib/parse.test.mjs:421]
- [x] [Review][Patch] code-fence closing rules untested [src/project/lib/markdown.test.mjs:1]
- [x] [Review][Patch] heading-section end untested [src/project/lib/parse.test.mjs:409]
- [x] [Review][Patch] `.markdown`/`.mdx`/uppercase extensions untested [src/project/lib/scope.test.mjs:1]
- [x] [Review][Patch] viewer label XSS escaping tested only by source regex [src/project/view/view.test.mjs:1]
- [x] [Review][Patch] config wrong-type guards untested (exit 3 instead of 2 on regression) [src/project/lib/config.test.mjs:1]

#### Defer

- [x] [Review][Defer] project skills missing from repo `CLAUDE.md` skills list and `docs/project-context.md` §6 [CLAUDE.md:1] — deferred: agent-context files.
- [x] [Review][Defer] `facts-prune` realpath guard before unlink untested [src/project/project.mjs:741] — deferred: only a race reaches it; needs a seam between classify and unlink.

#### Rejected

- `false` C19 view error example: the live error names the missing config, so rule and example agree.
- `false` B25 nested classic install climbing to a project root: story 7 requires the climb; `--directory` avoids it.
- `false` resolvePath mailto/trailing-slash guards: they matter for frontmatter and agent refs.
- `spec` lint exit 1 for findings: story 4 and AD-14 mandate it.
- `spec` viewer rings off by default: deliberate (163a747); spec not amended.
- `spec` viewer dark-only: deliberate (f3e39f2); story 6 not amended.
- `spec` `view` stdout `url` key: deliberate; story 6 not amended.
- `spec` spine `status --json`: no skill uses it; spine not amended.
- `spec` ingest default includes `changed`: user's story 11 choice; CAP-6/AD-12 not amended.
- `spec` guide section order: deliberate how-to restructure; story 10 not amended.
- `spec` locale asked before mode: the mode prompt needs a UI locale; story 7 matrix not amended.
- `low` CR-only line endings in evidence lines: rare; rejected in story 2.
- `low` stale-lock takeover race: needs a crash-left lock plus two simultaneous writers; rejected in story 3.
- `low` lock release without ownership check: only when `fn` exceeds 30 s.
- `low` dangling-symlink lock loop: only if something plants a symlink at the lock path.
- `low` lock leak on write failure: disk-full only; self-heals at 30 s.
- `low` newer-schema fact file loop: needs a future schema bump; fails loudly.
- `low` unmapped multi-word status keeps the first word: spec'd rule; setup maps such values.
- `low` setext headings: pilots use ATX; rejected in story 2.
- `low` P04 on retired Requirements: no Requirement lifecycle in the ontology.
- `low` recursive Tarjan: overflows only past ~5000-deep chains.
- `low` fragment status inheritance differs between lint and query: the doc itself is still returned.
- `low` `# C#` and `#######` heading parsing: anchor unchanged.
- `low` badge links, quoted titles, `<dest>`: rare in doc trees; the regex grows.
- `low` unclosed lumina marker in a doc: hand-edited only; rejected in story 2.
- `low` walk-then-read race: rerun succeeds.
- `low` `frontmatter: {}` type claims every doc: hand-written config only.
- `low` inline `Status:` fallback: spec'd behavior.
- `low` concept nodes lack name/aliases: adds output surface; CAP-7 success still passes.
- `low` out-of-scope items carry an empty quote: adds file I/O.
- `low` classic-only locale flags ignored in project mode: harmless.
- `low` no-trailing-newline round trip: impossible without stored state.
- `low` BOM on a Lumina-created open marker line: user must add the BOM.
- `low` half-done uninstall on unbalanced markers: loud; rerun completes.
- `low` partial install on invalid markers: loud; rerun completes.
- `low` stale engine files after upgrade: inert.
- `low` non-array `ideTargets` crash: hand edit only; nothing written.

### Outcome

- All 83 patches applied (5 agents, disjoint files). Deviations: `query resolve` emits `inScope` only for `doc:`/`frag:` targets; an unreadable directory is reported as a P16 scope warning; the mode-conflict flag message now reads "Project mode (detected or --mode project) cannot be combined with --packs, --agents, or a profile."; Ctrl-C, typed-directory and locale-prompt fixes are TTY-only and untested.
- Gates: `npm run test:all` 0 fail (installer 369, project 604 pass / 2 skipped), `ci:idempotency` 6 ok, `ci:package` 146 files.
- Spec drift left for `bmad-spec`: SPEC/spine/stories still describe ingest default `stale`-only, light+dark viewer, rings on by default, `view` stdout without `url`, `status --json`, the old guide order, mode-before-locale, and AD-10 prune of every out-of-scope file.
