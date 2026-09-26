---
title: 'Installer project mode'
type: 'feature'
created: '2026-09-26'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/brownfield.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The engine exists only in the source tree. No install puts it into a project repo, and nothing keeps classic installs free of it.

**Approach:** `lumina install --mode project` installs the engine, `lumi-project-*` skills, and `PROJECT.md`, and edits user files only inside Lumina marker blocks. The mode is detected and fixed per repo. Uninstall keeps committed knowledge. CI gains project tests and isolation gates (SPEC CAP-1; spine AD-2, AD-3, AD-4, AD-5, AD-17, AD-24, AD-26).

## Boundaries & Constraints

**Always:**
- Classic and `--agents` installs stay byte-identical over the `ci-idempotency` watched paths. Their only change is the manifest (v5, `mode: classic`).
- `CLAUDE.md`, `AGENTS.md`, and `.gitignore` change only between their markers. Every byte outside the markers stays as it was, including line endings and BOM. These files never go in `files-manifest.csv`.
- The engine is copied from one explicit list. A missing source file exits 3 and names the file.
- Decided: project mode records no communication language (agents follow the user's language); `antigravity` is a project-mode target only (classic prompts and flags unchanged); `--yes` with no `--ide-targets` defaults to `claude_code`.
- Use atomicWrite for every write. The project branch is lazily imported. Installer text goes through locale keys in en, vi, and zh. No emoji.

**Never:**
- In project mode, never create `raw/`, `wiki/`, `README.md`, `_lumina/schema|scripts|tools/`, `lumina.config.yaml`, or IDE stubs.
- Never write `project.yaml`, `_lumina/facts/`, hook files, or in-scope docs.
- No edits to `src/project/**`. No SKILL.md authoring (stories 8, 9) and no user docs (story 10). `replaceSchemaRegion` stays unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fresh | `--mode project --yes --ide-targets claude_code,codex`; `AGENTS.md` uses CRLF; `.gitignore` exists; no `CLAUDE.md` | engine, `PROJECT.md`, `install.json` in `_lumina/project/`; `CLAUDE.md` created holding only the block; block appended to `AGENTS.md` in CRLF; `.gitignore` block; manifest v5 `mode: project` | N/A |
| Re-run | same command | no byte change outside `_lumina/manifest.json` and `_lumina/_state/` | N/A |
| Teammate clone | no manifest; `_lumina/project/install.json` or `_lumina/config/project.yaml` present; plain `install` | project upgrade using the targets in `install.json`; no prompts | N/A |
| Mode conflict | `--mode classic` in a project repo, or `--mode project` over a classic manifest | nothing written | exit 3 |
| Bad flags | `--mode project` with `--packs`, `--agents`, or `profile`; target outside `claude_code,codex,antigravity`; `--mode foo` | nothing written | exit 1 |
| Default mode | fresh install, no `--mode` | TTY: first question is classic or project. `--yes`: classic | N/A |
| Version skew | committed `install.json` `packageVersion` is newer than the installer | nothing written | exit 3 |
| No skills yet | `src/skills/project/` absent or empty | success, 0 skills | N/A |
| Target dropped | upgrade without `claude_code` | block stripped from `CLAUDE.md`; `.claude/skills/lumi-project-*` links removed | N/A |
| Uninstall | project repo | blocks stripped; a file holding only whitespace afterwards is deleted; owned `lumi-project-*` skills and links removed; `_lumina/` emptied except `facts/` and `config/`; a second prompt (default No) can delete those two; `--yes` keeps them | N/A |
| Hub | `wikis add`, `add --provision`, or `inspect` on a project repo | refused, nothing written | exit 2 |
| Hub doctor | registered entry is now a project repo | skipped with one issue line | N/A |

</frozen-after-approval>

## Code Map

- `src/installer/commands.js:188` `installCommand`: resolve the mode after the `--agents` fast path (201-216) and return early into the project branch. The same pattern applies at `:569` `uninstallCommand` before any classic step, and at `:127` `findEnclosingWorkspace`, which must also stop at a project root.
- `commands.js:1446` `copyScripts` hides missing files, so do not use it for the engine.
- Reuse these, exporting where needed: `copySkills` (`:1697`, which takes `getSkillDefs`, so project mode needs its own def list), `createSkillSymlinks` (`:2233`), `removeOwnedAgentsSkills` (`:1961`), `removeOwnedClaudeSkillLinks` (`:1998`), and `isLuminaOwnedSkillEntry` (`:1579`).
- `commands.js:1831` `copySkillsToAgentPlatform` uses an explicit `getSkillDefs` list, so project skills never reach agent installs. Do not change it.
- `src/installer/manifest.js:29` `MANIFEST_SCHEMA_VERSION` and `MIGRATIONS` at `:309`.
- `src/installer/template-engine.js:176` `replaceSchemaRegion` rewrites content to LF. Put the new helpers next to it.
- `src/installer/prompts.js:163` and `:410`: patterns for the mode prompt. The multiselect is at `:290`.
- `src/installer/locales/{en,vi,zh}.mjs`.
- `bin/lumina.js:192-246` holds the install options. `exitCodeFor` at `:89` maps codes 1, 2, and 3. `profile` is programmatic only.
- Hub commands: `src/installer/registry.js:332` `addWiki`; `src/installer/wikis-command.js` `buildInspectReport` (`:257`), `runAddWithProvision` (`:400`), which would install a classic minimal wiki into a repo that has no manifest, and `doctorOne` (`:633`).
- `src/installer/update-check.js:129` `isNewerVersion` handles the skew check. It does not handle pre-release versions (project-context gotcha 18).
- CI and packaging: `scripts/ci-idempotency.mjs` (scenarios at `:21`, `managedDiffPaths` at `:55`), `scripts/ci-package.mjs` (`:61`, `:72`), `package.json` `files` and `scripts`, `.github/workflows/ci.yml`.
- The engine files today are `project.mjs`, `ontology.mjs`, `lib/{config,evidence,fact,frontmatter,fsx,graph,hash,markdown,parse,scope}.mjs`, `vendor/js-yaml.mjs`, and `vendor/THIRD-PARTY-NOTICES.md`. `ontology.mjs` exports `META_TYPES` and `META_RELATIONS`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/installer/manifest.js` + test: set v5 with migration `4->5` (`mode: m.mode ?? 'classic'`). Add `detectInstallMode(root)`, which returns `'project'`, `'classic'`, or `null`, as described in Design Notes.
- [ ] `src/installer/template-engine.js` + test: add `upsertMarkerBlock(content, open, close, body)` and `stripMarkerBlock(content, open, close)`. Markers must be alone on their lines. The helpers keep the file's EOL and every byte outside the block.
- [ ] `src/installer/project-mode.js` (new) + `project-mode.test.js` (new, spawns the real CLI): exports `PROJECT_ENGINE_FILES`, `PROJECT_IDE_TARGETS`, `installProject`, and `uninstallProject`. Each matrix row gets a test. Other tests check that:
  - bytes outside the block equal the original;
  - every file under `src/project/` except `*.test.mjs` and `test-fixtures/` is in `PROJECT_ENGINE_FILES`, and every listed file is in `package.json` `files`;
  - `PROJECT.md` names every meta-type and meta-relation.
  This file placement is a prescription. Push back if the circular import with `commands.js` gets awkward.
- [ ] `src/templates/project/PROJECT.md` (new): lists the engine commands (`node _lumina/project/project.mjs scope|config-check|build|status`) and a meta-type and meta-relation summary. It also states these rules:
  - docs are read-only;
  - only the engine writes `_lumina/facts|graph|_state`;
  - skills call the engine through Bash and never import it;
  - the exit codes.
- [ ] `commands.js`: add the mode gate, the lazy project branch, the uninstall branch, and `findEnclosingWorkspace`.
- [ ] `prompts.js` and all three locales: add the mode select, the project target multiselect, the uninstall prompt for facts and config, and the project install and uninstall messages.
- [ ] `bin/lumina.js`: add `--mode <classic|project>` to `install`.
- [ ] `registry.js` and `wikis-command.js` + tests: refuse project repos in add, provision, and inspect; skip them in doctor.
- [ ] `package.json`:
  - add each engine path and `src/installer/project-mode.js` to `files`;
  - add `project-mode.test.js` to `test:installer`;
  - add `"test:project": "node --test src/project/"`, chained into `test:all`.
- [ ] `scripts/ci-package.mjs`: require `src/project/<f>` for each entry of the imported `PROJECT_ENGINE_FILES`, plus `src/installer/project-mode.js`. Prohibit `^src/project/test-fixtures/`.
- [ ] `scripts/ci-idempotency.mjs`: add a `project` scenario. It seeds a CRLF `AGENTS.md` and a `.gitignore`, and diffs those two files plus `CLAUDE.md`, `.agents`, `.claude`, and `_lumina/project`. Classic scenarios must fail if `_lumina/project/` exists.
- [ ] `.github/workflows/ci.yml`: add a `Project engine tests` step (`npm run test:project`).

**Acceptance Criteria:**
- Given a git copy of `../seli`, when `install --mode project --yes` runs, then `git status` shows pre-existing files changed only inside the marker regions and `.gitignore`. A second install leaves `git diff` empty.
- Given a classic install from this branch and one from `main` with the same flags, then the watched paths are byte-identical.
- Given the `--version` probe, then `ci:cold-start` still passes.

## Design Notes

Mode resolution runs in this order:
1. `detectInstallMode` returns `'project'` when `manifest.mode === 'project'`, `_lumina/config/project.yaml` exists, or `_lumina/project/install.json` exists. It returns `'classic'` for any other manifest, and `null` otherwise.
2. `--mode` must agree with that result.
3. When the result is `null`, use `--mode`, then the TTY prompt, then `classic`.
4. A classic manifest together with a project signal exits 3.

`install.json` is needed because the manifest is gitignored. Without it, the repo has no committed record of the version and targets (AD-24 skew, AD-2 teammate re-install), and `project.yaml` does not exist until setup runs:

```json
{ "ideTargets": ["claude_code", "codex"], "packageVersion": "1.15.0", "schemaVersion": 1 }
```

Targets map to files as follows:
- `claude_code`: `CLAUDE.md`, plus links in `.claude/skills/`.
- `codex` and `antigravity`: `AGENTS.md`.
- All targets: `.agents/skills/lumi-project-*`, taken from `src/skills/project/<id>/SKILL.md`. The directory name is the canonical id. An absent directory means no skills.
- On upgrade, remove any owned `lumi-project-*` that no longer ships.

The two marker blocks:

```text
<!-- lumina:project -->
This repo uses Lumina project mode (lumina-wiki >= 1.15.0). Read `_lumina/project/PROJECT.md`.
If `_lumina/config/project.yaml` is missing, run `/lumi-project-setup`.
<!-- /lumina:project -->

# >>> lumina
_lumina/graph/
_lumina/_state/
_lumina/manifest.json
# <<< lumina
```

How later stories extend this:
- A new engine file gets one entry in `PROJECT_ENGINE_FILES` and one in `package.json` `files`. The completeness test names any file that is missing, and ci-package reads the list.
- A new skill directory needs no installer edit.
- A new subcommand gets one line in `PROJECT.md`.

## Verification

**Commands:**
- `npm run test:all`: all pass, including `test:project`.
- `npm run ci:idempotency && npm run ci:package && npm run ci:agent-isolation && npm run ci:cold-start`: all pass.

**Manual checks:**
- Run the Seli acceptance above in a temp directory, never the repo root (project-context §3 rule 0).

## Implementation Notes

## Spec Change Log

## Review Triage Log
