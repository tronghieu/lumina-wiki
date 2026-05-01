---
name: lumi-ingest
description: >
  Turn a raw source file into structured wiki pages: source page, concept and
  person stubs, bidirectional edges, citation edges, and a log entry.
  Checkpoint-resumable so interrupted runs pick up where they left off.
  Use this whenever the user says "ingest", "add", "file", "process", "summarize
  into the wiki", "create a wiki page for", or drops a filename from raw/sources/.
  Also fires for: "I added a PDF to raw/sources/", "add this paper to the wiki",
  "parse this article", "what should I do with raw/sources/X?", or any request
  to bring a new source into the wiki graph. This is the most-used skill — when
  in doubt about whether something is an ingest vs an edit, ask the user.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /lumi-ingest

## Role

You are the wiki's primary knowledge compiler. You read one raw source, extract
its key claims, concepts, and people, write structured wiki pages, build the
cross-reference graph, and leave the wiki lint-clean. Every ingest compounds the
wiki's value — a well-linked ingest is worth ten half-linked ones.

## Context

Read `README.md` at the project root before this SKILL.md. Pay special attention
to the Cross-Reference Rules and Constraints sections. This skill's entire value
depends on bidirectional-link discipline.

Key workspace paths:
- `raw/sources/` — immutable user-provided sources; you read but never modify
- `wiki/sources/` — one page per ingested source (you write this)
- `wiki/concepts/`, `wiki/people/` — you create or update stubs here
- `wiki/index.md` — updated on every ingest
- `wiki/log.md` — one append-only line per ingest
- `_lumina/scripts/wiki.mjs` — all graph mutations go through this engine
- `_lumina/scripts/lint.mjs` — final validation
- `_lumina/_state/ingest-<slug>.json` — phase checkpoint per source (gitignored)

## Checkpoint Format

Checkpoints live at `_lumina/_state/ingest-<slug>.json`. Minimum shape:

```json
{
  "slug": "attention-revisited-2026",
  "source_path": "raw/sources/attention-revisited.pdf",
  "type": "paper",
  "phase": "edges",
  "completed_phases": ["detect", "slug", "source-page", "stubs"],
  "concept_slugs": ["concepts/softmax-temperature"],
  "person_slugs": ["people/vaswani-ashish"]
}
```

To resume: skip phases listed in `completed_phases` and continue from the last
incomplete one.

## Instructions

### Phase 0 — Resume check

```bash
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename>
```

If a checkpoint exists and `phase` is not `"done"`, ask the user whether to resume
or restart. Resuming skips completed phases. Restarting deletes the checkpoint and
starts from Phase 1.

### Phase 1 — Detect type

Read the file header (first ~200 lines). Classify as one of:
`paper`, `book`, `article`, `podcast`, `note`

Detection heuristics:
- Contains "Abstract", "Introduction", "References" → `paper`
- Has chapter structure → `book`
- Web article format (byline, publication) → `article`
- Speaker turns or transcript cues → `podcast`
- Everything else → `note`

Write checkpoint: `phase: "detect"`.

### Phase 2 — Generate slug

```bash
node _lumina/scripts/wiki.mjs slug "<Title of the source>"
```

Returns `{ slug: "title-of-source" }`. The source wiki page will be at
`wiki/sources/<slug>.md`. If a page already exists at that path, this is a
re-ingest — confirm with the user before overwriting.

Write checkpoint: `phase: "slug"`.

### Phase 3 — Write source page

Read the full source content. Draft `wiki/sources/<slug>.md` using the Source
template from `_lumina/schema/page-templates.md` (open it when in doubt about
required fields). Required frontmatter fields: `id`, `title`, `type`, `created`,
`updated`, `authors`, `year`, `importance` (1-5), `url` (optional).

Required body sections: `## Summary` (2-4 sentences), `## Key Claims` (bulleted
with confidence level), `## Concepts` (all `[[concept-slug]]` links), `## People`
(all `[[person-slug]]` links), `## Open Questions`.

Low-confidence claims get an explicit note: "(confidence: low — link the source
rather than asserting)".

Write checkpoint: `phase: "source-page"`.

### Phase 4 — Write concept and person stubs

Check before writing — exit 2 from `read-meta` means safe to create:
```bash
node _lumina/scripts/wiki.mjs read-meta concepts/<slug>
```
If it exists, append to its `## Key sources` list instead of overwriting.

New concept stub: required frontmatter `id`, `title`, `type`, `created`,
`updated`, `key_sources: [sources/<slug>]`, `related_concepts: []`.
Body sections: `## Definition`, `## Variants`, `## Key sources`.

New person stub: required frontmatter `id`, `title`, `type`, `created`,
`updated`, `key_sources: [sources/<slug>]`, `affiliations: []`.
Body sections: `## Profile`, `## Key sources`.

Full templates in `_lumina/schema/page-templates.md`.

Write checkpoint: `phase: "stubs"`.

### Phase 5 — Build bidirectional edges

For every forward link in the source page, write the reverse link in the same
`add-edge` operation. This is not optional — it is what makes the wiki compound.

```bash
# Source introduces a concept
node _lumina/scripts/wiki.mjs add-edge sources/<slug> introduces_concept concepts/<concept>
node _lumina/scripts/wiki.mjs add-edge concepts/<concept> introduced_in sources/<slug>

# Source uses an existing concept
node _lumina/scripts/wiki.mjs add-edge sources/<slug> uses_concept concepts/<concept>
node _lumina/scripts/wiki.mjs add-edge concepts/<concept> used_in sources/<slug>

# Author attribution
node _lumina/scripts/wiki.mjs add-edge sources/<slug> authored_by people/<person>
node _lumina/scripts/wiki.mjs add-edge people/<person> authored sources/<slug>

# Source builds on another source
node _lumina/scripts/wiki.mjs add-edge sources/<slug> builds_on sources/<other>
node _lumina/scripts/wiki.mjs add-edge sources/<other> built_upon_by sources/<slug>
```

`add-edge` is idempotent: calling it twice with the same arguments is a safe no-op.

Exemptions (see README.md Cross-Reference Rules): `foundations/**`, `outputs/**`,
and external URLs are terminal — no reverse edge needed for these.

Write checkpoint: `phase: "edges"`.

### Phase 6 — Add citations

For every other source this one explicitly cites:

```bash
node _lumina/scripts/wiki.mjs add-citation sources/<slug> sources/<cited-slug>
```

Only call this for sources that already exist in the wiki. Do not create stub
pages for cited sources that are not yet ingested — note them in `## Open Questions`
instead.

### Phase 7 — Update wiki/index.md

Add the new source page (and any new concept/person pages) to the catalog between
the `<!-- lumina:index -->` markers. Format: `- [[sources/<slug>]] — <one-line description>`

### Phase 8 — Lint and fix

```bash
node _lumina/scripts/lint.mjs --fix --json
```

Address all errors (see `/lumi-check` for severity breakdown). Zero errors required
before proceeding.

### Phase 9 — Log and finalize

```bash
node _lumina/scripts/wiki.mjs log ingest "Added \"<title>\" → <N> pages touched"
```

Write final checkpoint: `phase: "done"`.

## Output Format

Report to the user:
1. Source type detected and slug assigned
2. Pages written or updated (with counts: 1 source, N concepts, M people)
3. Edges written
4. Lint result (must be 0 errors)
5. Log entry written

## Examples

<example>
User: "/lumi-ingest raw/sources/attention-revisited-2026.pdf"

Normal case — new paper ingest:
```bash
node _lumina/scripts/wiki.mjs slug "Attention Revisited: Softmax Temperature Scaling"
# → { slug: "attention-revisited-2026" }
# Write wiki/sources/attention-revisited-2026.md
# Write wiki/concepts/softmax-temperature.md (new)
# Append to wiki/concepts/flash-attention.md (existing, add to key_sources)
node _lumina/scripts/wiki.mjs add-edge sources/attention-revisited-2026 introduces_concept concepts/softmax-temperature
node _lumina/scripts/wiki.mjs add-edge concepts/softmax-temperature introduced_in sources/attention-revisited-2026
node _lumina/scripts/wiki.mjs add-edge sources/attention-revisited-2026 uses_concept concepts/flash-attention
node _lumina/scripts/wiki.mjs add-edge concepts/flash-attention used_in sources/attention-revisited-2026
node _lumina/scripts/lint.mjs --fix --json
node _lumina/scripts/wiki.mjs log ingest "Added \"Attention Revisited\" → 3 pages touched"
```
</example>

<example>
User: "/lumi-ingest raw/sources/attention-revisited-2026.pdf" (second time)

Idempotency — re-ingest of the same file:
`read-meta` shows the source page already exists. Confirm with user before
proceeding. If confirmed: all `add-edge` calls are no-ops (idempotent), stubs
already exist and are only appended to, index.md entry is already present.
Final `wiki/` diff: empty — byte-identical result.
</example>

<example>
User: "Ingest raw/sources/mystery-file.pdf but don't create any concept pages."

Guardrail escalation — user asking to skip concept extraction:
Explain that concept and person stubs are what make the wiki compound over time.
Ask whether they want a minimal ingest (source page only, no stubs) or a full
ingest. Proceed only with explicit direction. Log which phases were skipped.
</example>

## Guardrails

- Never modify files in `raw/`. Read-only.
- Never overwrite an existing wiki page without user confirmation.
- Never fabricate citations for sources not yet in the wiki.
- Keep a checkpoint after every phase — an interrupted ingest must be resumable.
- If the source is too large to fully read, read in sections and checkpoint between them.
- `raw/tmp/` accepts additions only; never overwrite a file there.

## Definition of Done

Before reporting done, verify:

(a) `node _lumina/scripts/lint.mjs --json` shows `summary.errors === 0`
(b) `wiki/log.md` has a new `## [YYYY-MM-DD] ingest | ...` entry
(c) Running `/lumi-ingest` again with the same file produces byte-identical `wiki/`
    output (all add-edge calls are no-ops; stubs have same content; index.md entry
    already present)
