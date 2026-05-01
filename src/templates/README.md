# {{project_name}}

> A research wiki built with [lumina-wiki](https://github.com/tronghieu/lumina-wiki), realizing Andrej Karpathy's [LLM-Wiki](https://karpathy.bearblog.dev/llm-wiki/) vision.
>
> This file (`README.md`) is the canonical agent-context file at the project root. It defines page structure, link conventions, and workflow constraints. `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and `.cursor/rules/lumina.mdc` are tiny stub files that point each agent to read this file first.
>
> **Maintenance note:** The schema region between `<!-- lumina:schema -->` and `<!-- /lumina:schema -->` markers is rewritten on `lumina install` upgrades. Content outside the markers is preserved byte-for-byte.

---

<!-- lumina:schema -->

## Roles

You are the wiki maintainer. The user curates sources, asks questions, and directs analysis. You do everything else: read, summarize, cross-reference, file, lint, and keep the wiki coherent. You write the wiki; the user reads it.

Always communicate with the user in **{{communication_language}}**. Always write wiki pages in **{{document_output_language}}**.

---

## Repository Layout

Keep this mental map in immediate context:

### `wiki/` is the main product surface

- `wiki/index.md` — catalog of all wiki pages, updated on every ingest
- `wiki/log.md` — append-only activity log
- `wiki/concepts/` — reusable knowledge structure
- `wiki/sources/` — per-source summaries (papers, articles, books, podcasts, notes)
- `wiki/people/` — people referenced across sources
- `wiki/summary/` — area-level syntheses
- `wiki/outputs/` — generated artifacts (comparisons, exports)
- `wiki/graph/` — derived state; never edit manually
{{#if pack_research}}
- `wiki/topics/`, `wiki/foundations/` (pack: research)
{{/if}}
{{#if pack_reading}}
- `wiki/chapters/`, `wiki/characters/`, `wiki/themes/`, `wiki/plot/` (pack: reading)
{{/if}}

### `raw/` is user-owned and immutable

- `raw/sources/` — `.pdf`, `.tex`, `.html`, `.md`, transcripts, anything ingested
- `raw/notes/` — user's own markdown notes
- `raw/assets/` — images and binary attachments
- `raw/tmp/` — generated sidecars produced by skills (additions only, never overwrite)
{{#if pack_research}}
- `raw/discovered/` — sources fetched by research pack tools (pack: research)
{{/if}}

**You may read `raw/` but never modify it without explicit user instruction.**

### `.agents/` is the skill source of truth

- `.agents/skills/lumi-*/` — installed skills (flat, one directory per skill)

### `_lumina/` is the installer-managed sidecar

- `_lumina/config/lumina.config.yaml` — workspace config; editable
- `_lumina/schema/` — deeper reference docs; read on demand when README points there
- `_lumina/scripts/` — Node engine (`wiki.mjs`, `lint.mjs`, `reset.mjs`, `schemas.mjs`)
- `_lumina/tools/` — Python tools for the research pack (opt-in)
- `_lumina/_state/` — installer/skill checkpoint state; gitignored
- `_lumina/manifest.json` — installer state; never edit by hand

---

## Page Types

Every wiki page has a defined type, frontmatter, and section structure. See `_lumina/schema/page-templates.md` for full templates.

**Core types** (always available):

| Type    | Directory    | Purpose                                                           |
|---------|-------------|-------------------------------------------------------------------|
| Source  | `sources/`  | Per-document summary: key claims, evidence, takeaways, questions  |
| Concept | `concepts/` | Cross-source idea or technique with variants and comparisons      |
| Person  | `people/`   | Profile of a referenced person with key sources and relationships |
| Summary | `summary/`  | Area-level synthesis spanning multiple sources and concepts       |

{{#if pack_research}}**Pack: research** — adds `topics/`, `foundations/` page types{{/if}}
{{#if pack_reading}}**Pack: reading** — adds `chapters/`, `characters/`, `themes/`, `plot/` page types{{/if}}

---

## Link Syntax

All internal links use Obsidian wikilinks:

```markdown
[[slug]]                     — link to any page in this wiki
[[chain-of-thought]]         — links to concepts/chain-of-thought.md
[[1984-orwell]]              — links to sources/1984-orwell.md
```

**Slug rule**: lowercase, hyphen-separated, no spaces, no diacritics.

---

## Cross-Reference Rules (Bidirectional Links)

When you write a forward link, **always write the reverse link in the same operation**. This is the heart of why the wiki compounds. Skipping it leaves the graph half-built.

| Forward action                              | Required reverse action                    |
|---------------------------------------------|---------------------------------------------|
| `sources/A` writes `Related: [[concept-B]]` | `concepts/B` appends A to `Key sources`    |
| `sources/A` writes `[[person-C]]`           | `people/C` appends A to `Key sources`      |
| `concepts/K` writes `[[source-E]]`          | `sources/E` appends K to `Related concepts`|
| `summary/S` writes `[[concept-K]]`          | `concepts/K` appends S to `Mentioned in`   |

### Exemptions (mode: `exempt-only`, default)

Some links are intentionally one-way. Defaults:

- **`foundations/**`** — terminal pages (research pack only)
- **`outputs/**`** — ephemeral artifacts
- **External URLs** (`*://*`) — out of wiki scope

Anything outside an exemption glob must be bidirectional.

---

## Log Format

Append-only. One line per skill invocation. Format:

```markdown
## [YYYY-MM-DD] skill | details
```

`grep "^## \[" wiki/log.md | tail -10` gives you recent activity.

---

## Graph

`wiki/graph/edges.jsonl` is auto-generated. Never edit manually. Core edge types: `related_to`, `builds_on`, `contradicts`, `cites`, `mentions`, `part_of`.

---

## Constraints (Non-Negotiable)

- **`raw/` is read-only by default**: only modify when the user explicitly asks.
- **`graph/` is auto-generated**: only modify via the graph rebuild step.
- **Bidirectional links are mandatory**: forward link and reverse link in the same operation.
- **`index.md` updated on every ingest**: every new page must be cataloged immediately.
- **`log.md` is append-only**: never rewrite history.
- **Slug rule**: title keywords, hyphen-joined, all lowercase, no diacritics.
- **No silent overwrites**: preserve sections marked with `<!-- user-edited -->` comment.
- **Cite when uncertain**: link the source explicitly for low-confidence claims.

---

## Skills

Skills live in `.agents/skills/` and are invoked via slash commands. Active install recorded in `_lumina/manifest.json`.

### Core skills (always present)

| Skill         | Trigger        | What it does                                          |
|---------------|---------------|-------------------------------------------------------|
| `/lumi-init`  | manual, first  | Bootstrap wiki from existing `raw/` content          |
| `/lumi-ingest`| manual         | Read a source, write page, update affected pages, log |
| `/lumi-ask`   | manual         | Query wiki, synthesize answer, optionally file page   |
| `/lumi-edit`  | manual         | Add/remove/revise wiki content per user request       |
| `/lumi-check` | manual/weekly  | Lint: broken links, orphans, missing reverse links    |
| `/lumi-reset` | manual         | Scoped destructive cleanup                            |

{{#if pack_research}}### Pack: research

Adds `/lumi-discover` (ranked candidate shortlist), `/lumi-survey` (narrative synthesis), `/lumi-prefill` (seed foundations/ to prevent concept duplication), `/lumi-setup` (interactive API key configuration).
{{/if}}
{{#if pack_reading}}### Pack: reading

Adds `/lumi-chapter-ingest`, `/lumi-character-track`, `/lumi-theme-map`, `/lumi-plot-recap`.
{{/if}}

---

## Tooling Conventions

- **`_lumina/scripts/lint.mjs`** — pure-Node markdown linter, runs offline.
- **`_lumina/scripts/wiki.mjs`** — wiki engine (frontmatter, graph mutation, slug, log).
- **`_lumina/scripts/reset.mjs`** — scoped destructive reset.
- **Python tooling is opt-in** — only required by the research pack.

---

## How To Use This Wiki (For New LLM Sessions)

1. Read this file (you are doing it now).
2. Read `wiki/index.md` to learn what already exists.
3. Read `wiki/log.md`'s last 20 entries to learn what happened recently.
4. When the user invokes a skill, read the skill's `SKILL.md` first.
5. When in doubt about page structure, open `_lumina/schema/page-templates.md`.
6. When in doubt about scope, ask the user — never silently expand it.

The wiki is a long-running collaboration. Maintain it patiently.

<!-- /lumina:schema -->
