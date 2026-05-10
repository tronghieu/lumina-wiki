---
title: 'Learning Pack — Self-Reflection Infrastructure'
type: 'feature'
created: '2026-05-08'
status: 'draft'
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

- `src/scripts/schemas.mjs` L88-117 -- ENTITY_DIRS: add `reflections` entry
- `src/scripts/schemas.mjs` L35-39 -- EXEMPTION_GLOBS: add `reflections/**`
- `src/scripts/schemas.mjs` L89 -- Pack typedef: extend union with `'learning'`
- `src/scripts/schemas.mjs` L251-377 -- REQUIRED_FRONTMATTER: add `reflections` block
- `src/installer/commands.js` L126 -- VALID_PACKS: add `'learning'`
- `src/installer/commands.js` L112-113 -- add `LEARNING_WIKI_DIRS`
- `src/installer/commands.js` L238-243 -- directory scaffolding: add learning condition
- `src/installer/commands.js` L250-260 -- templateVars: add `pack_learning`
- `src/installer/commands.js` L1015-1061 -- getSkillDefs: add learning block
- `src/templates/README.md` -- add `{{#if pack_learning}}` guards (layout, page types, skills)
- `src/templates/README.vi.md` -- same guards, Vietnamese
- `src/templates/README.zh.md` -- same guards, Chinese
- `src/templates/_lumina/schema/page-templates.md` -- add Reflection template
- `src/skills/packs/learning/reflect/SKILL.md` -- new skill file
- `src/templates/_lumina/schema/lumi-help.csv` -- add `{{#if pack_learning}}` guard block with `lumi-learning-reflect` row
- `src/skills/core/help/SKILL.md` L84 -- add `learning → "Learning pack"` to Mode B pack labels list
- `src/templates/_lumina/schema/lumi-help-runbook.md` L157-162 -- add `learning → "Learning pack"` to hardcoded pack labels
- `scripts/ci-idempotency.mjs` L28-38 -- full-pack scenario: add `learning` to `--packs`
- `scripts/ci-package.mjs` -- required files: add learning SKILL.md sample

## Tasks & Acceptance

**Execution:**
- [ ] `src/scripts/schemas.mjs` -- Add `reflections` to ENTITY_DIRS (pack: 'learning'), add `reflections/**` to EXEMPTION_GLOBS, add REQUIRED_FRONTMATTER block for reflections (id, title, type, created, updated, related_concepts[], related_sources[], evolution_count), update Pack typedef
- [ ] `src/installer/commands.js` -- Add 'learning' to VALID_PACKS, add LEARNING_WIKI_DIRS, add directory scaffolding condition, add pack_learning to templateVars, add learning block to getSkillDefs with lumi-learning-reflect
- [ ] `src/templates/README.md` + `.vi.md` + `.zh.md` -- Add {{#if pack_learning}} guards for: Repository Layout (wiki/reflections/), Page Types table (Reflection row), Cross-Reference Rules (reflection exemption note), Skills section (learning pack table)
- [ ] `src/templates/_lumina/schema/page-templates.md` -- Add Reflection page template with ## Current understanding and ## Evolution sections
- [ ] `src/skills/packs/learning/reflect/SKILL.md` -- Create skill with name: lumi-learning-reflect, allowed-tools: [Bash, Read, Write, Edit], workflow: read existing reflections → match related concepts → quote past user text → prompt user → write file with Current understanding rewrite + Evolution append
- [ ] `src/templates/_lumina/schema/lumi-help.csv` -- Add guard block after reading pack block: `{{#if pack_learning}}\nlumi-learning-reflect,LR,learning,anytime,,,false,[concept-id],,guide a self-reflection session; create or update a reflection page\n{{/if}}`
- [ ] `src/skills/core/help/SKILL.md` L84 -- Add `- learning → "Learning pack"` to the Mode B pack labels list (after `reading`)
- [ ] `src/templates/_lumina/schema/lumi-help-runbook.md` L157-162 -- Add `- \`learning\` → "Learning pack"` to the hardcoded pack labels list in Mode B section
- [ ] `scripts/ci-idempotency.mjs` -- Add 'learning' to full-pack scenario --packs flag
- [ ] `scripts/ci-package.mjs` -- Add learning SKILL.md to required files check
- [ ] `src/scripts/schemas.test.mjs` -- Add tests: reflections entity exists, pack is 'learning', reflections in EXEMPTION_GLOBS, required frontmatter keys present

**Acceptance Criteria:**
- Given a fresh install with `--packs core,learning`, when checking the filesystem, then `wiki/reflections/` exists and `.agents/skills/lumi-learning-reflect/` is linked
- Given a fresh install without learning pack, when checking the filesystem, then `wiki/reflections/` does not exist and no learning skill is linked
- Given two consecutive installs with `--packs core,research,reading,learning`, when diffing managed paths, then zero byte drift (idempotency)
- Given a valid reflection page in `wiki/reflections/`, when running `node lint.mjs`, then L06 (missing reverse edge) is NOT raised for reflection→concept links
- Given `npm run ci:package`, when checking required files, then `src/skills/packs/learning/reflect/SKILL.md` is present
- Given a workspace with `--packs core,learning` and invoking `/lumi-help skills`, when Mode B renders the catalog, then a "Learning pack" section appears containing `[LR] /lumi-learning-reflect`
- Given a workspace without learning pack, when invoking `/lumi-help skills`, then no "Learning pack" section appears in the catalog output
- Given `npm run test:all`, when all tests complete, then zero failures including new schema tests

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
- `npm run test:all` -- expected: zero failures
- `npm run ci:idempotency` -- expected: zero drift across all scenarios including learning
- `npm run ci:package` -- expected: learning SKILL.md in required files, no prohibited files
- `npm run dev:sandbox -- --packs core,learning --keep` -- expected: wiki/reflections/ exists, skill linked

**Manual checks:**
- Inspect rendered README.md in sandbox: learning pack section appears with correct page type and skill table
- Inspect `.agents/skills/lumi-learning-reflect/SKILL.md`: frontmatter name matches canonicalId, allowed-tools present
- Inspect `_lumina/schema/lumi-help.csv` in sandbox: with learning pack, row `lumi-learning-reflect,LR,learning,...` present; without learning pack, row absent
- Run `/lumi-help skills` in sandbox: "Learning pack" section appears with LR entry
