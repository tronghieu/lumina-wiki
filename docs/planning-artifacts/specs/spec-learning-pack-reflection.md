---
title: 'Learning Pack — Self-Reflection Infrastructure'
type: 'feature'
created: '2026-05-08'
status: 'done'
baseline_commit: '5ec95392f1f99ec65e47f41fcaaccd1e7964eff3'
context:
  - 'docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Lumina-Wiki captures external knowledge (sources, concepts, people) but has no mechanism for the user to record their own evolving understanding — the personal "so what?" layer. Without it, the wiki remains a passive archive rather than a tool for active cognitive growth.

**Approach:** Add a `learning` expansion pack that installs a `wiki/reflections/` directory with a "living page + evolution log" model. Each reflection page has a rewritable `## Current understanding` section and an append-only `## Evolution` log. The personal layer is an overlay — it reads from the academic layer (sources, concepts) but never writes back to it. A single skill `/lumi-learning-reflect` guides the user through creating and updating reflections. AI acts as a "metacognitive mirror" (quotes past words, asks questions) but never writes reflection content.

## Boundaries & Constraints

**Always:**
- `reflections/**` added to `EXEMPTION_GLOBS` — exempt from reverse-link requirements
- Reflection pages reference concepts/sources via frontmatter `related_concepts[]` and `related_sources[]` only — NO graph edges written to `edges.jsonl`
- Core skills (ask, check, ingest) must be completely unaffected by learning pack presence or absence
- `Pack` type union updated: `'core'|'research'|'reading'|'learning'`
- All CI gates (idempotency, package) must pass with learning pack included and excluded
- Skill follows `lumi-<pack>-<name>` convention: `lumi-learning-reflect`

**Ask First:**
- Whether to add `wiki.mjs reflect-update` subcommand for tool-enforced Evolution append-only invariant (deferred by default — convention-based via SKILL.md first)
- Whether to add a second skill `/lumi-learning-connect` in this PR or defer

**Never:**
- AI auto-generating reflection content — the user must always write their own understanding
- Writing graph edges from reflections to concepts/sources — the personal layer does not pollute the academic graph
- Modifying concept, source, or any non-reflection page as a side-effect of reflection operations
- Adding Python tools or new runtime dependencies for this pack

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh install with learning | `--packs core,learning` | `wiki/reflections/` created, skill linked, config has `learning: true` | N/A |
| Install without learning | `--packs core` | No `wiki/reflections/`, no skill, config has `learning: false` | N/A |
| Upgrade adds learning | Existing workspace, reinstall with `--packs core,learning` | `wiki/reflections/` created, skill added | Existing wiki/ untouched |
| Lint on reflection page | Valid reflection with `related_concepts: [cognitive-offloading]` | L01 pass, L06 skip (exempt), no errors | N/A |
| Lint on reflection missing required field | Reflection page missing `evolution_count` | L01 error with `key: TODO` fix | Standard L01 flow |
| Lint with no reflections dir | Workspace without learning pack, no `wiki/reflections/` | Lint skips reflection checks silently | No crash on missing dir |

</frozen-after-approval>

## Code Map

Schema layer:
- `src/scripts/schemas.mjs` → `ENTITY_DIRS`: add `reflections` entry (pack: 'learning')
- `src/scripts/schemas.mjs` → `EXEMPTION_GLOBS`: add `reflections/**`
- `src/scripts/schemas.mjs` → `Pack` typedef (line 89): extend union with `'learning'`
- `src/scripts/schemas.mjs` → `REQUIRED_FRONTMATTER`: add `reflections` block

Installer layer:
- `src/installer/commands.js` → `VALID_PACKS` (line 127): add `'learning'`
- `src/installer/commands.js` → add `LEARNING_WIKI_DIRS` constant after line 114 (`READING_WIKI_DIRS`)
- `src/installer/commands.js` → add `hasLearning` after line 223 (`hasReading`), add `if (hasLearning)` scaffolding block after line 243
- `src/installer/commands.js` → `templateVars` (lines 251–261): add `pack_learning: hasLearning`
- `src/installer/commands.js` → `renderAndWriteConfig` packs object (lines 763–767): add `learning: answers.packs.includes('learning')` — **missing from original spec, found during investigation**
- `src/installer/commands.js` → `getSkillDefs()` (line 1064): add learning block with `lumi-learning-reflect`

Template layer:
- `src/templates/README.md` -- add `{{#if pack_learning}}` guards (layout, page types, skills)
- `src/templates/README.vi.md` -- same guards, Vietnamese
- `src/templates/README.zh.md` -- same guards, Chinese
- `src/templates/_lumina/schema/page-templates.md` -- add `{{#if pack_learning}}` Reflection template
- `src/templates/_lumina/schema/cross-reference-packs.md` -- add `{{#if pack_learning}}` block documenting reflections exemption
- `src/templates/_lumina/schema/lumi-help.csv` -- add `{{#if pack_learning}}` guard block with `lumi-learning-reflect` row

Skill layer:
- `src/skills/packs/learning/reflect/SKILL.md` -- new skill file
- `src/skills/core/help/SKILL.md` → Mode B pack labels: add `learning → "Learning pack"` (after `reading`)
- `src/templates/_lumina/schema/lumi-help-runbook.md` → Mode B pack labels: add `learning → "Learning pack"`
- `src/templates/_lumina/schema/lumi-help-runbook.md` → Router § Mode C nouns: add `reflections`, `reflect`, `phản tư`, `反思`

CI & test layer:
- `scripts/ci-idempotency.mjs` → `full-pack` scenario (line 34): add `learning` to `--packs`
- `scripts/ci-package.mjs` → `requiredFiles` array: add `src/skills/packs/learning/reflect/SKILL.md`
- `scripts/verify-lumi-help.test.mjs` → `KNOWN_PACKS` (line 33): add `'learning'`; expand test combo matrix to 8 cases
- `src/scripts/schemas.test.mjs` -- **create new file**: reflections entity, EXEMPTION_GLOBS, frontmatter tests

## Tasks & Acceptance

**Execution:**
- [ ] `src/scripts/schemas.mjs` -- Add `reflections` to ENTITY_DIRS (pack: 'learning'), add `reflections/**` to EXEMPTION_GLOBS, add REQUIRED_FRONTMATTER block for reflections (id, title, type, created, updated, related_concepts[], related_sources[], evolution_count), extend Pack typedef to include 'learning'
- [ ] `src/installer/commands.js` -- Add 'learning' to VALID_PACKS; add `const LEARNING_WIKI_DIRS = ['wiki/reflections']` after READING_WIKI_DIRS; add `const hasLearning = packs.includes('learning')` after hasReading; add `if (hasLearning) { dirsToCreate.push(...LEARNING_WIKI_DIRS); }` in scaffolding block; add `pack_learning: hasLearning` to templateVars; add `learning: answers.packs.includes('learning')` to the `packs:` block in `renderAndWriteConfig`; add learning block to getSkillDefs with lumi-learning-reflect (pack: 'learning', srcPackPath: 'packs/learning')
- [ ] `src/templates/README.md` + `.vi.md` + `.zh.md` -- Add `{{#if pack_learning}}` guards for: Repository Layout (wiki/reflections/), Page Types table (Reflection row), Cross-Reference Rules (reflection exemption note), Skills section (learning pack table)
- [ ] `src/templates/_lumina/schema/page-templates.md` -- Add `{{#if pack_learning}}` Reflection page template with frontmatter (id, title, type, created, updated, related_concepts, related_sources, evolution_count) and sections `## Current understanding` + `## Evolution`
- [ ] `src/templates/_lumina/schema/cross-reference-packs.md` -- Add `{{#if pack_learning}}` block after reading pack section: "Learning pack has no cross-reference rules — reflections are exempt from bidirectional linking (listed in EXEMPTION_GLOBS)"
- [ ] `src/skills/packs/learning/reflect/SKILL.md` -- Create skill with name: lumi-learning-reflect, allowed-tools: [Bash, Read, Write, Edit], workflow: read existing reflections → match related concepts → quote past user text → prompt user → write file with Current understanding rewrite + Evolution append
- [ ] `src/templates/_lumina/schema/lumi-help.csv` -- Add guard block after reading pack block: `{{#if pack_learning}}\nlumi-learning-reflect,LR,learning,anytime,,,false,[concept-id],,guide a self-reflection session; create or update a reflection page\n{{/if}}`
- [ ] `src/skills/core/help/SKILL.md` → Mode B pack labels list -- Add `- learning → "Learning pack"` after `reading` entry
- [ ] `src/templates/_lumina/schema/lumi-help-runbook.md` -- (a) Mode B pack labels: add `` - `learning` → "Learning pack" `` to hardcoded list; (b) Router § Mode C Lumina nouns list: add `reflections`, `reflect`, `phản tư`, `反思`
- [ ] `scripts/ci-idempotency.mjs` -- Add 'learning' to full-pack scenario --packs flag: `'core,research,reading,learning'`
- [ ] `scripts/ci-package.mjs` -- Add `'src/skills/packs/learning/reflect/SKILL.md'` to requiredFiles array
- [ ] `scripts/verify-lumi-help.test.mjs` -- Add `'learning'` to `KNOWN_PACKS` set; add 4 new test cases (existing 4 × 2 for pack_learning: true/false) covering all 8 pack permutations
- [ ] `src/scripts/schemas.test.mjs` -- **Create new file** using node:test + node:assert/strict: test reflections in ENTITY_DIRS with pack 'learning', test `reflections/**` in EXEMPTION_GLOBS, test REQUIRED_FRONTMATTER.reflections has required keys (id, title, type, created, updated, related_concepts, related_sources, evolution_count)

**Acceptance Criteria:**
- Given a fresh install with `--packs core,learning`, when checking the filesystem, then `wiki/reflections/` exists and `.agents/skills/lumi-learning-reflect/` is linked
- Given a fresh install without learning pack, when checking the filesystem, then `wiki/reflections/` does not exist and no learning skill is linked
- Given two consecutive installs with `--packs core,research,reading,learning`, when diffing managed paths, then zero byte drift (idempotency)
- Given a valid reflection page in `wiki/reflections/`, when running `node lint.mjs`, then L06 (missing reverse edge) is NOT raised for reflection→concept links
- Given `npm run ci:package`, when checking required files, then `src/skills/packs/learning/reflect/SKILL.md` is present
- Given a workspace with `--packs core,learning` and invoking `/lumi-help skills`, when Mode B renders the catalog, then a "Learning pack" section appears containing `[LR] /lumi-learning-reflect`
- Given a workspace without learning pack, when invoking `/lumi-help skills`, then no "Learning pack" section appears in the catalog output
- Given `npm run test:catalog`, when lumi-help.csv renders with `pack_learning=true`, then row `lumi-learning-reflect` appears with pack=`learning`, valid column count, and unique menu code `LR`
- Given `npm run test:all`, when all tests complete, then zero failures including new schema tests and updated catalog tests

### Review Findings

- [x] [Review][Decision] `id` field format convention — resolved: flat slug with `reflection-` prefix (`reflection-<slug>`). Fixed in `page-templates.md` and `SKILL.md`.
- [x] [Review][Patch] Edit tool section boundary ambiguity in SKILL.md Step 5 — added explicit section-boundary guidance. [`src/skills/packs/learning/reflect/SKILL.md`]
- [x] [Review][Patch] `lumina.config.yaml` exemptions list missing `reflections/**` — added `answers.packs.includes('learning')` guard. [`src/installer/commands.js`]
- [x] [Review][Patch] `commands.test.js` zero coverage for learning pack — added two tests (with/without learning pack). [`src/installer/commands.test.js`]
- [x] [Review][Patch] L09 false-positives for reflection pages — filter reflections/ from entityFiles before L09. [`src/scripts/lint.mjs`]
- [x] [Review][Patch] `lumi-help-runbook.md` learning entries unguarded — added `{{#if pack_learning}}` guards for Mode B label and Mode C nouns. [`src/templates/_lumina/schema/lumi-help-runbook.md`]
- [x] [Review][Patch] `schemas.test.mjs` excluded from `test:scripts` — added to hardcoded file list in `package.json`.
- [x] [Review][Defer] `answers.packs.includes('learning')` null-guard on upgrade path [`src/installer/commands.js`] — deferred, pre-existing pattern for research/reading carries same risk
- [x] [Review][Defer] Upgrade pack-addition path not covered in commands.test.js — deferred, pre-existing gap in installer test suite
- [x] [Review][Defer] L06 exemption only on `edge.to` not `edge.from` — latent gap; convention-enforced by SKILL.md, not code [`src/scripts/lint.mjs`] — deferred, pre-existing
- [x] [Review][Defer] `related_concepts` slug validation — AI infers slugs without checking against `wiki/concepts/`; a wrong slug silently breaks future `/lumi-learning-connect` — deferred, future improvement

## Spec Change Log

- **2026-05-10**: Investigation found missing task — `renderAndWriteConfig` packs object (lines 763–767) also needs `learning: answers.packs.includes('learning')` so that `lumina.config.yaml` persists the learning pack flag on upgrade reads. Added to commands.js task description and Code Map.

## Design Notes

**Personal layer boundary principle:** Reflection pages read from the academic layer (sources, concepts, topics) but never write back to it. No graph edges, no reverse links, no text insertions into academic pages. The personal layer is an overlay, not an integration. This ensures:
1. Core skills are completely unaware of learning pack
2. Removing learning pack requires zero cleanup of academic pages
3. Graph (edges.jsonl) stays purely academic — no subjective content pollution

**Reflection page structure:**
```yaml
---
id: reflection-cognitive-offloading
title: "My understanding of Cognitive Offloading"
type: reflection
created: 2026-05-08
updated: 2026-05-08
related_concepts: [cognitive-offloading, metacognitive-laziness]
related_sources: [the-memory-paradox]
evolution_count: 1
---

## Current understanding

[User's latest thinking — rewritable by user]

## Evolution

### 2026-05-08 — Initial reflection
[First entry — append-only, never edited]
```

**Future `/lumi-learning-connect` compatibility:** Because `related_concepts[]` is in frontmatter, a future `connect` skill can scan `wiki/reflections/` frontmatter to find concept pairs that have been reflected on independently. No graph edge infrastructure needed — frontmatter scan of a few dozen files is cheap.

## Verification

**Commands:**
- `npm run test:all` -- expected: zero failures (includes schemas.test.mjs + verify-lumi-help.test.mjs)
- `npm run test:catalog` -- expected: all 8 pack combos pass including learning variants
- `npm run ci:idempotency` -- expected: zero drift across all scenarios including learning
- `npm run ci:package` -- expected: learning SKILL.md in required files, no prohibited files
- `npm run dev:sandbox -- --packs core,learning --keep` -- expected: wiki/reflections/ exists, skill linked

**Manual checks:**
- Inspect rendered README.md in sandbox: learning pack section appears with correct page type and skill table
- Inspect `.agents/skills/lumi-learning-reflect/SKILL.md`: frontmatter name matches canonicalId, allowed-tools present
- Inspect `_lumina/schema/lumi-help.csv` in sandbox: with learning pack, row `lumi-learning-reflect,LR,learning,...` present; without learning pack, row absent
- Inspect `_lumina/schema/cross-reference-packs.md` in sandbox: with learning pack, exemption section appears
- Inspect `_lumina/config/lumina.config.yaml` in sandbox: `packs.learning: true` when installed with learning, `false` without
- Run `/lumi-help skills` in sandbox: "Learning pack" section appears with LR entry
