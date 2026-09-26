---
title: 'lumi-project-setup skill'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
  - '{project-root}/src/templates/project/PROJECT.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Project uninstall leaves empty .claude/skills/, .claude/ and _lumina/ dirs.
    evidence: |-
      Verification Gap reviewer, sandbox install then uninstall; story 7 code, first reachable with a shipped skill.
    location: >-
      src/installer/project-mode.js uninstallProject
    severity: low
---

<intent-contract>

## Intent

**Problem:** A project-mode install ships no skill. Without `_lumina/config/project.yaml` every engine subcommand exits 2, and nothing helps the user write one (CAP-3).

**Approach:** Ship `lumi-project-setup`, a markdown skill for the host agent. It scans the repo with its own tools, proposes a `project.yaml` and frontmatter fixes, writes only what the user approves, then validates through the engine.

## Boundaries & Constraints

**Always:**
- **File:** `src/skills/project/lumi-project-setup/SKILL.md`. The directory name is the canonical id.
- **Frontmatter:** `name: lumi-project-setup`, a folded trigger `description`, and `allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]`.
- **Body:** opens with ``Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.`` (AD-4), then `## Role`, `## Context`, `## Instructions` (numbered steps), `## Output Format`, `## Examples`, `## Guardrails`, `## Definition of Done`.
- **Host-neutral:** the prose names no host-specific tool or slash syntax beyond `allowed-tools`, so the file works unchanged on Claude Code, Codex and Antigravity.
- **Scan:**
  - No engine subcommand works before `project.yaml` exists, so the first scan uses the host's own file tools.
  - It lists candidate doc folders and doc families, grouped by folder and name pattern, frontmatter `type`/`kind` keys and title prefixes. It also collects ID shapes, status carriers (a frontmatter key or a `Status` heading), and recurring terms.
  - It counts per family: docs with no frontmatter, and docs whose frontmatter does not parse.
- **Proposal:** one reviewable block covering every AD-8 key the scan supports: `sources`, `types` (metaType, paths or frontmatter filter, idPattern, status), `relations`, `relatedRules`, `externalIds` and `concepts`.
  - Propose only types the scan found. Map each onto a meta-type from `PROJECT.md` by what the docs do, not what they are called or where they sit.
  - Status: use a heading source where a family carries status under a heading, `{frontmatter: <key>}` where it uses frontmatter, and a list of both where it mixes. Add a `map` only for values whose first word does not already lowercase to the target (for example a non-English word).
  - ID patterns not declared by any in-scope doc go to `externalIds`, not `types`.
  - Each proposed item cites one example `file:line`.
- **Frontmatter report:** list the problem docs per family, each with a proposed minimal fix. Apply a fix only after the user approves that doc or an explicitly named batch. Only the frontmatter block may change; the body stays byte-identical. Recommend a config-side source (heading status, `paths`) before any doc edit.
- **Write:** only after approval, and only `_lumina/config/project.yaml` with `schemaVersion: 1`.
- **Validate:**
  1. `config-check`. On exit 2, show the `errors[]`, fix the YAML and retry.
  2. `scope`. Warn on P16 and on a file count that differs from the scan.
  3. `lint`. Summarise findings by rule and point to the top config-side fixes, such as unmapped types (P12), status problems (P19/P20) or unconfigured ID shapes.
- **Re-run:** when `project.yaml` exists, read it, show the diff between it and the new proposal, and change only approved keys.
- **Glossary:** a concept vocabulary may come with an offer to write a glossary inside the project's own docs. It is written only on approval.

**Never:**
- No engine, installer or config-schema change. Only the skill file and the one test below.
- Never write under `_lumina/facts/`, `_lumina/graph/` or `_lumina/_state/`, or run `facts-write`.
- No doc edits beyond approved frontmatter fixes and an approved glossary file. No edit without approval, and no "fix all" default.
- No software-only framing: no assumed ADR, RFC, PRD, BMAD or `docs/` names in the rules. Software examples appear only next to a non-software one.
- No git operations (commit, stage) and no hooks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Capigo | 94 ADRs; 32 lack frontmatter, with `## Status` then `**Accepted** - <date>` | Reports the 32 by path; proposes `status: {heading: Status}` with no `map`; recommends no doc edits for status | none |
| Non-software repo | KEP-like folders with `kep.yaml` metadata plus a README per KEP | Families mapped onto meta-types (for example KEP to `Decision`), with IDs from the scan | none |
| Seli | FR IDs cited but never declared | `externalIds` entry for the FR shape | none |
| No approval | User declines the proposal | Nothing written; the skill stops | none |
| Invalid proposal | `config-check` exits 2 | `errors[]` shown, YAML corrected, re-checked before reporting done | exit 2 handled |
| Existing config | `project.yaml` present | Diff shown; only approved keys change | none |
| Broken frontmatter | A doc whose `---` block does not parse | Listed with the parse problem and a minimal fix; edited only on approval | none |

</intent-contract>

## Code Map

- `src/templates/project/PROJECT.md` -- the shared context the skill points to: engine commands, meta-types, meta-relations, rules. Do not duplicate it; reference it.
- `src/project/lib/config.mjs:20-440` -- the authoritative `project.yaml` shape.
  - Top-level keys: `schemaVersion`, `sources`, `types`, `relations`, `relatedRules`, `externalIds`, `concepts`.
  - Status shapes: `{heading|frontmatter}` plus an optional `map`, a list of sources, or `{sources, map}`.
  - No `!` negation or `{a,b}` braces in globs.
  - Concept slugs must not collide.
- `src/project/test-fixtures/config-valid/_lumina/config/project.yaml` -- full valid example to crib from. `config-invalid*/` catalogues the rejected shapes.
- `src/project/lib/parse.mjs:310-392` -- heading status takes the first non-blank line under the heading, strips emphasis, then lowercases the first word and trims `.,;:-`. That is why Capigo needs no `map`.
- `src/project/project.mjs` -- `config-check` prints `{ok, schemaVersion, ontologyVersion}`; on failure it prints `{error, code, errors[]}` to stderr. `scope` prints `{files, warnings}`. `lint` prints `{findings, summary}`.
- `src/skills/core/init/SKILL.md` -- section style and size reference, about 200 lines.
- `src/installer/project-mode.js:155` -- `listProjectSkillDefs` installs every `src/skills/project/<id>/SKILL.md` to `.agents/skills/<id>`. No installer edit is needed.
- `src/installer/project-mode.test.js:403` -- the "no skills yet" test asserts 0 skills and no `.agents/skills`. It breaks once this skill ships.
- `package.json` `files` already ships `src/skills/**/*.md`. `ci-package`, `verify-lumi-help` and `ci-agent-host-isolation` do not scan `src/skills/project/`.

## Tasks & Acceptance

**Execution:**
- `src/skills/project/lumi-project-setup/SKILL.md` -- the skill, per Boundaries. Target 150-250 lines, with `<example>` blocks for Capigo and one non-software repo.
- `src/installer/project-mode.test.js` -- replace the "no skills yet" test with "ships every src/skills/project skill". The expected set comes from reading `src/skills/project/*/SKILL.md`. Assert the `Skills: N installed` count, and that each `.agents/skills/<id>/SKILL.md` exists byte-identical to its source. It must stay green when story 9 adds skills.

**Acceptance Criteria:**
- Given a Capigo copy with project mode installed, when a fresh host agent follows the skill with the config approved and no doc fixes, then:
  - the report names the 32 frontmatter-less ADRs;
  - `project.yaml` uses a heading status source for them;
  - `config-check` exits 0;
  - `lint` reports no status findings for the ADR type;
  - `git status` shows only `_lumina/config/project.yaml` added.
- Given a non-software repo copy (kubernetes/enhancements, sparse checkout of `keps/` if available offline, else a synthetic KEP-shaped tree), when the same run happens, then `config-check` exits 0 and every proposed type maps to a meta-type with no Lumina code change.
- Given the installed skill, when `grep -iE "ADR|RFC|PRD|BMAD"` runs over its rules and guardrails, then any hit sits in an example next to a non-software one.

## Verification

**Commands:**
- `npm run test:installer` -- expected: 0 fail.
- `npm run ci:package` -- expected: pass, and the skill appears in the file list.
- `npm run ci:idempotency` -- expected: every scenario `[ok]`.
- Capigo and non-software acceptance, in scratchpad copies with a sonnet agent acting as host -- expected: the criteria above.

## Spec Change Log

- 2026-09-26: Capigo acceptance approved "every proposal", which would edit docs through frontmatter fixes and contradict "only `project.yaml` added". It now reads "config approved and no doc fixes". KEEP: doc fixes are approved separately from the config.

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: about 70 raw findings merged into 40 rows — high 5, medium 16, low 12, false 7, maybe-false 0
- live acceptance, run before patching:
  - Capigo: config-check 0, scope 424 = scan, lint P20 0, P19 1 (real doc drift, adr-058), only `_lumina/config/` added.
  - KEPs: config-check 0, KEP mapped to `Decision`, only `_lumina/config/` added.
  - Both host agents had to read engine source to get there.
- findings:
  - `[high]` `patch` `docs/` default scope and `sources` never proposed (Blind, Intent, VerifGap, KEP run) — discover roots; always propose `sources`
  - `[high]` `patch` PROJECT.md claimed to hold the yaml shape; 4 of 7 keys undocumented (Edge, Intent) — add an Engine facts section with the full skeleton
  - `[high]` `patch` decline or frontmatter-only approval still runs validation; DoD (a) unmeetable (Blind, Edge, Intent) — nothing approved means stop; DoD made conditional
  - `[high]` `patch` "retry until 0" is unbounded and rewrites approved content silently (Blind, Edge) — re-approve changed content; stop after 3 attempts
  - `[high]` `patch` paths+frontmatter ANDed; frontmatter-less docs fall to `Document` (Edge) — state it in Engine facts
  - `[medium]` `patch` first-match type order, P12 semantics, declared-ID source, inverse relations, sidecar metadata, symlinks and md-only scope undocumented (Edge, Capigo and KEP runs) — Engine facts items
  - `[medium]` `patch` stacking a status source on a different axis manufactures P19 (Capigo run) — Engine facts
  - `[medium]` `patch` Decision lifecycle values never listed for `map` targets (Blind) — listed
  - `[medium]` `patch` wrapped status form needed for a list plus a map (Edge) — skeleton
  - `[medium]` `patch` over-broad `idPattern`; H1 ID shape inconsistencies (Edge, Capigo run) — Engine facts
  - `[medium]` `patch` P11 described wrongly; P09 cross-check for missing externalIds (Intent, VerifGap, Capigo run) — corrected
  - `[medium]` `patch` unclosed `---` and thematic breaks miscounted as broken; unclear block boundary (Edge, Blind) — Engine facts item 8
  - `[medium]` `patch` re-run rewrites the whole file with Write (Blind, Edge) — Edit only the approved keys
  - `[medium]` `patch` relations never recorded by the scan (Blind) — scan records relation keys
  - `[medium]` `patch` glossary never offered and no path given (Blind, Intent) — explicit offer
  - `[medium]` `patch` example 1 idPattern unevidenced; emphasis stripping unstated (Blind) — example fixed
  - `[medium]` `patch` non-software example drops IDs and sidecar case; every example uses `docs/` (Intent) — example fixed
  - `[medium]` `patch` uninstall of the shipped skill unasserted (VerifGap) — two asserts added
  - `[medium]` `patch` "no git operations" blocks DoD (d) (Blind) — read-only `git status` allowed
  - `[medium]` `patch` DoD (e) unverifiable in-run (Blind, Intent) — dropped
  - `[medium]` `patch` Capigo acceptance "every proposal approved" contradicts "only project.yaml" (Edge) — spec amended (Change Log)
  - `[low]` `patch` citations only for types, and as keys versus comments (Intent, Blind) — `#` comment on every item
  - `[low]` `patch` per-doc problem not required in the report (Intent) — required
  - `[low]` `patch` exit 3, missing-root exit 2 and lint exit 1 unhandled (Edge) — Engine facts item 10
  - `[low]` `patch` glob limits and single-quoted regex (Edge) — Engine facts item 3
  - `[low]` `patch` `.` as repo root matches nothing (Edge) — `**`
  - `[low]` `patch` meta-type list duplicated from PROJECT.md (Intent) — removed
  - `[low]` `patch` test counts dirs without SKILL.md; planning text in message (Blind, Edge, Intent) — filtered; message removed
  - `[low]` `patch` P16 misses type-path typos (Edge) — per-type count cross-check
  - `[low]` `reject` "only the engine reads project.yaml" contradicts step 1 — superseded by the Engine facts rewrite
  - `[low]` `reject` scope exit 2 on case-fold collision — rare; the exit-code rule covers stopping
  - `[low]` `reject` UserGuide minimal-shape frontmatter bucket (Capigo run) — not a problem the engine sees; no rule
  - `[low]` `defer` uninstall leaves empty `.claude/skills/`, `.claude/` and `_lumina/` dirs (VerifGap) — story 7 code
  - `[false]` `reject` missing `readdir`/`readFile` imports — the suite passes 357/357
  - `[false]` `reject` test fails on a clean checkout because the dir is untracked — it is committed with this story
  - `[false]` `reject` absent-dir case lost — the fixture tests with a tmp `skillsSrcDir` cover empty sources
  - `[false]` `reject` unbounded scan effort — host judgment; the P09 cross-check bounds misses
  - `[false]` `reject` software examples in rules — grep hits sit only in example 1, next to a non-software one
  - `[false]` `reject` config-check P16 loop on an empty scan — nothing approved means no write
  - `[false]` `reject` KEP P09 x8 — a partial-copy artifact

### 2026-09-26 — Re-acceptance and skill-creator pass
- Host agents were barred from reading engine source.
  - Capigo: the 32 frontmatter-less ADRs listed by path; `status: {heading: Status}`; config-check 0; scope 423 = scan; no P19/P20 on the ADR type; only `_lumina/config/` added.
  - KEPs: `sources: **`; KEP mapped to `Decision`; the sidecar `kep.yaml` reported as a gap; config-check 0; scope 75 = scan; only `_lumina/config/` added.
- `[low]` `patch` user direction: the description only says what the skill does and when it triggers
- `[low]` `patch` the example suggested copying sidecar status into docs, contradicting Engine facts §6 — reworded; example renamed to a neutral `meta.yaml`
- `[low]` `patch` symlinks look like duplicate docs; members with no declared ID raise no lint (KEP run) — added to §2 and §5
- `[low]` `patch` inline `Status:` source key, idPattern prefix of a frontmatter id, generic shared `type:` values, and scope stopping rule (Capigo run) — added to §4, §5, §6 and step 2

## Auto Run Result

- **Change:** `lumi-project-setup`, a host-neutral skill. It discovers doc roots, scans families, and proposes a full `project.yaml` and a per-doc frontmatter report. It writes only what the user approves, then validates with `config-check`, `scope` and `lint`. An Engine facts section carries the config shape and the parser behaviour, so no engine source is needed.
- **Files:**
  - `src/skills/project/lumi-project-setup/SKILL.md` (new, 305 lines).
  - `src/installer/project-mode.test.js`: the ships-every-project-skill test, and uninstall asserts.
- **Review:** about 70 raw findings merged into 40 rows. 33 patched (5 high); 1 deferred (empty dirs left after uninstall, story 7); 6 rejected plus 7 false. A second pass after re-acceptance patched 4 more low items.
- **Follow-up review:** recommended. 5 high and 16 medium entries were patched, and the skill was largely rewritten after the first review.
- **Verification:**
  - `npm run test:installer`: 357 pass, 0 fail.
  - `ci:package`: ok, 141 files.
  - `ci:idempotency`: 6 `[ok]`.
  - Capigo and KEPs acceptance, re-run without engine source: every criterion met.
  - Domain-neutrality grep: hits only in example 1.
- **Residual risks:**
  - The runs used Sonnet as the host on Claude Code. Codex and Antigravity hosts have not been run.
  - Scan quality on very large repos is still a judgment call. Capigo's run left `_bmad-output/` out by judgment.

## Design Notes

The scan belongs to the skill, not the engine. The engine refuses to run without a config (AD-8: the engine validates and never writes config), and a pre-config scan subcommand would be a second config-less code path to maintain. Revisit only if the pilots show agents mis-scanning.
