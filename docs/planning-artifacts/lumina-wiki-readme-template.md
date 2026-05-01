# {{project_name}}

> The canonical agent-context file for this Lumina-Wiki research workspace.
>
> A research wiki built with [lumina-wiki](https://github.com/tronghieu/lumina-wiki), realizing Andrej Karpathy's [LLM-Wiki](https://karpathy.bearblog.dev/llm-wiki/) vision.
> This file (`README.md`) is the canonical agent-context file at the project root: it defines page structure, link conventions, and workflow constraints. CLAUDE.md, AGENTS.md, GEMINI.md, and `.cursor/rules/lumina.mdc` are tiny stubs that point each agent to read this file first.
>
> **Maintenance note:** This is `README.md` at the project root — the canonical agent-context file for this workspace. It is rendered from a Lumina-Wiki template at install time. The schema region between `<!-- lumina:schema -->` and `<!-- /lumina:schema -->` markers is rewritten on `lumina install` upgrades; content outside the markers is preserved byte-for-byte. CLAUDE.md, AGENTS.md, GEMINI.md, and `.cursor/rules/lumina.mdc` are independent rendered stub files that simply instruct each agent to read this file first — none of them are symlinks.

---

## Roles

You are the wiki maintainer. The user curates sources, asks questions, and directs analysis. You do everything else: read, summarize, cross-reference, file, lint, and keep the wiki coherent. You write the wiki; the user reads it.

Always communicate with the user in **{{communication_language}}**. Always write wiki pages in **{{document_output_language}}**.

---

## Repository Layout

Keep this mental map in immediate context:

### `wiki/` is the main product surface

- `wiki/index.md` is the catalog of all wiki pages — updated on every ingest
- `wiki/log.md` is the append-only activity log
- `wiki/concepts/` holds reusable knowledge structure
- `wiki/sources/` holds per-source summaries (papers, articles, books, podcasts, notes — anything ingested)
- `wiki/people/` holds people referenced across sources
- `wiki/summary/` holds area-level syntheses
- `wiki/outputs/` holds generated artifacts (slide decks, comparisons, exports)
- `wiki/graph/` is derived state — never edit manually
{{#if pack_research}}
- `wiki/topics/`, `wiki/foundations/`, `wiki/ideas/`, `wiki/claims/`, `wiki/experiments/` (pack: research)
{{/if}}
{{#if pack_reading}}
- `wiki/chapters/`, `wiki/characters/`, `wiki/themes/` (pack: reading)
{{/if}}

### `raw/` is user-owned and immutable

- `raw/sources/` — `.pdf`, `.tex`, `.html`, `.md`, transcripts, anything the user feeds in
- `raw/notes/` — user's own markdown notes
- `raw/web/` — Obsidian Web Clipper output
- `raw/assets/` — images and binary attachments
- `raw/tmp/` — generated sidecars produced by skills (additions only, never overwrite)

**You may read `raw/` but never modify it without explicit user instruction.**

### `.agents/` is the skill source of truth

- `.agents/skills/core/` — always-installed skills
- `.agents/skills/packs/<pack>/` — opt-in skill bundles (research, reading)

### `_lumina/` is the installer-managed sidecar

- `_lumina/config/lumina.config.yaml` — workspace config; editable
- `_lumina/schema/` — deeper reference docs (`page-templates.md`, `cross-reference-packs.md`, `graph-packs.md`); read on demand when this README points there
- `_lumina/scripts/` — Node engine (`wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`); core skills shell out to these
- `_lumina/tools/` — Python tools for the research pack (opt-in)
- `_lumina/_state/` — installer/skill checkpoint state; gitignored
- `_lumina/manifest.json` — installer-managed; never edit by hand

---

## Page Types

Every wiki page has a defined type, frontmatter, and section structure. See `_lumina/schema/page-templates.md` for full templates.

**Core types** (always available):

| Type | Directory | Purpose |
|------|-----------|---------|
| Source | `sources/` | Per-document summary: key claims, evidence, takeaways, open questions |
| Concept | `concepts/` | Cross-source idea or technique with variants and comparisons |
| Person | `people/` | Profile of a referenced person with key sources and relationships |
| Summary | `summary/` | Area-level synthesis spanning multiple sources and concepts |

{{#if pack_research}}**Pack: research** — adds `topics/`, `foundations/`, `ideas/`, `claims/`, `experiments/`{{/if}}
{{#if pack_reading}}**Pack: reading** — adds `chapters/`, `characters/`, `themes/`{{/if}}

---

## Link Syntax

All internal links use Obsidian wikilinks:

```markdown
[[slug]]                     ← link to any page in this wiki
[[chain-of-thought]]         ← links to concepts/chain-of-thought.md
[[1984-orwell]]              ← links to sources/1984-orwell.md
```

**Slug rule**: lowercase, hyphen-separated, no spaces, no diacritics.

---

## Cross-Reference Rules (Bidirectional Links)

When you write a forward link, **always write the reverse link in the same operation**. This is the heart of why the wiki compounds. Skipping it leaves the graph half-built.

| Forward action | Required reverse action |
|----------------|------------------------|
| `sources/A` writes `Related: [[concept-B]]` | `concepts/B` appends A to `Key sources` |
| `sources/A` writes `[[person-C]]` | `people/C` appends A to `Key sources` |
| `concepts/K` writes `key_sources: [[source-E]]` | `sources/E` appends K to `Related concepts` |
| `summary/S` writes `[[concept-K]]` | `concepts/K` appends S to `Mentioned in` |

### Exemptions (mode: `exempt-only`, default)

Some links are intentionally one-way. The lint config in `lumina.config.yaml → wiki.bidirectional_links.exemptions` declares them; the defaults are:

- **`foundations/**`** — terminal pages. Background knowledge that receives inward links from many sources but never writes back-references (would otherwise balloon).
- **`outputs/**`** — ephemeral artifacts (comparisons, slide decks, exports). Output → source is fine; back-linking from sources to every output that mentions them creates noise.
- **External URLs** (`*://*`) — out of wiki scope; nothing to update on the other end.

Anything outside an exemption glob must be bidirectional. Pack-specific rules live in `_lumina/schema/cross-reference-packs.md` and only apply when the pack is installed.

---

## Log Format

Append-only. One line per skill invocation. Format:

```markdown
## [YYYY-MM-DD] skill | details
```

Example:
```markdown
## [2026-05-01] ingest | Added "Attention is All You Need" → 12 pages touched
## [2026-05-02] ask | "Compare flash-attention variants" → outputs/flash-attention-comparison.md
## [2026-05-03] check | 0 broken links, 2 orphans, 1 missing reverse link
```

`grep "^## \[" wiki/log.md | tail -10` gives you recent activity.

---

## Graph

`wiki/graph/edges.jsonl` is auto-generated. Never edit it manually. It is rebuilt by the `check` skill or whenever a skill explicitly calls the graph builder.

Core edge types: `related_to`, `builds_on`, `contradicts`, `cites`, `mentions`, `part_of`. Each edge: `{source, target, type, confidence: high|medium|low}`. Symmetric edges are stored once with sorted endpoints and `symmetric: true`.

Packs may extend the edge type vocabulary — see `_lumina/schema/graph-packs.md`.

---

## Constraints (Non-Negotiable)

- **`raw/` is read-only by default**: only modify when the user explicitly asks. `raw/tmp/` and `raw/discovered/` (if pack-research) accept additions only — never overwrite an existing file.
- **`graph/` is auto-generated**: only modify via the graph rebuild step.
- **Bidirectional links are mandatory**: forward link → reverse link in the same operation, no exceptions.
- **`index.md` updated on every ingest**: every new page must be cataloged immediately.
- **`log.md` is append-only**: never rewrite history; correct mistakes by appending a new entry.
- **Slug rule**: title keywords, hyphen-joined, all lowercase, no diacritics.
- **No silent overwrites**: when revising a page, preserve sections the user has hand-edited (marked with `<!-- user-edited -->` comment) and append your changes in a new section instead.
- **Cite when uncertain**: if a claim's confidence is below `medium`, link the source explicitly rather than asserting.

---

## Skills

Skills live in `.agents/skills/` and are invoked via slash commands. The active install is recorded in `_lumina/manifest.json`.

### Core skills (always present)

| Skill | Trigger | What it does |
|-------|---------|-------------|
| `/lumi-init` | manual, first-time | Bootstrap the wiki from existing `raw/` content |
| `/lumi-ingest` | manual | Read a source → write source page + update affected pages + log |
| `/lumi-ask` | manual | Query the wiki, synthesize an answer, optionally file as new page |
| `/lumi-edit` | manual | Add/remove/revise wiki content per user request |
| `/lumi-check` | manual / weekly | Lint: broken links, orphans, missing reverse links, stale claims |
| `/lumi-reset` | manual | Scoped destructive cleanup (`--scope wiki\|raw\|log\|all`) |

{{#if pack_research}}### Pack: research
Adds `/lumi-discover`, `/lumi-ideate`, `/lumi-novelty`, `/lumi-survey`, `/lumi-paper-plan`, `/lumi-paper-draft`, `/lumi-rebuttal`, `/lumi-daily-arxiv`, `/lumi-exp-design`, `/lumi-exp-run`, `/lumi-exp-eval`.
{{/if}}
{{#if pack_reading}}### Pack: reading
Adds `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`.
{{/if}}

---

## Tooling Conventions

- **`_lumina/scripts/lint.mjs`** — pure-Node markdown linter, runs offline.
- **`_lumina/scripts/wiki.mjs`** — wiki engine (frontmatter read/write, graph mutation, slug, log).
- **`_lumina/scripts/reset.mjs`** — scoped destructive reset.
- **Optional `qmd` integration** — if the user has installed [qmd](https://github.com/tobi/qmd), prefer it for full-text search over `wiki/`.
- **Python tooling is opt-in** — only required by some packs (research's arxiv/S2 fetchers). Core skills are Node-only.

---

## How To Use This Wiki (For New LLM Sessions)

1. Read this file (you are doing it now).
2. Read `wiki/index.md` to learn what already exists.
3. Read `wiki/log.md`'s last 20 entries to learn what happened recently.
4. When the user invokes a skill, read the skill's `SKILL.md` first; only open `references/` files when needed.
5. When in doubt about page structure, open `_lumina/schema/page-templates.md`.
6. When in doubt about scope, ask the user — never silently expand it.

The wiki is a long-running collaboration. Maintain it patiently.
