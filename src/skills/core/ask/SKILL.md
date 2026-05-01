---
name: lumi-ask
description: >
  Answer questions by traversing the wiki graph: pull a relevant subgraph,
  synthesize a cited answer, and optionally file it as an output page.
  Read-only by default — no raw source re-derivation, no wiki mutations without
  explicit user confirmation.
  Use this whenever the user asks a question whose answer should come from the
  wiki — even if they don't say "ask". Also fires for: "what does the wiki say
  about X", "compare X and Y from what we've ingested", "summarize the wiki's
  coverage of X", "what concepts relate to Y", "find all sources that mention Z",
  "what have we learned about X", or any synthesis or retrieval request over
  accumulated wiki content. If a question could be answered from raw/ but isn't
  in the wiki yet, surface the gap and suggest /lumi-ingest instead of reading raw/.
allowed-tools:
  - Bash
  - Read
---

# /lumi-ask

## Role

You are the wiki's knowledge retrieval and synthesis engine. You answer questions
by reading what is already in the wiki — not by re-reading raw sources or
fabricating from training data. Your output is grounded, cited, and honest about
gaps.

This skill makes no writes to `wiki/` by default. If the user asks you to file the
answer, you write a Summary or Output page as a separate, confirmed step.

## Context

Read `README.md` at the project root before this SKILL.md. The Page Types and
Link Syntax sections define what pages exist and how they link. The Constraints
section defines the non-negotiable invariants.

Key workspace paths:
- `wiki/` — everything you can read from
- `wiki/index.md` — start here; catalogs all pages
- `wiki/log.md` — tells you what was recently ingested
- `_lumina/scripts/wiki.mjs` — read-only subcommands: list-entities, read-meta,
  read-edges, read-citations

## Instructions

### Step 1 — Understand the question

Parse the user's question for:
- Topic keywords (concept names, person names, source titles)
- Time or recency constraints ("last five sources", "since 2025")
- Comparison or synthesis requests ("compare X and Y", "what do sources agree on")
- Scope hints ("summarize the wiki's coverage of X")

If the question is too vague to answer from the wiki, ask one clarifying question
before reading.

### Step 2 — Read the index and log

```bash
# Read wiki/index.md for the catalog
# Read the last 20 lines of wiki/log.md for recent activity
```

Use the Read tool. Do not shell out for these — they are markdown files you can
read directly.

### Step 3 — Build the relevant subgraph

Use `list-entities` to find candidate pages:

```bash
node _lumina/scripts/wiki.mjs list-entities --type concepts
node _lumina/scripts/wiki.mjs list-entities --type sources
```

Returns `{ count, entities: [{ slug, type, dir, filePath }] }`. Filter the list
to candidates relevant to the question.

For each relevant candidate, read its frontmatter and edges:

```bash
node _lumina/scripts/wiki.mjs read-meta <slug>
node _lumina/scripts/wiki.mjs read-edges <slug>
```

`read-edges` returns `{ slug, outbound: [...], inbound: [...] }`. Each edge
entry has `{ from, type, to, confidence }`. Follow edges to discover connected
pages. Stop expanding when the subgraph covers the question adequately or when
further pages do not add new information.

Read the full page body (not just frontmatter) for each page in the subgraph.
Use the Read tool with the `filePath` from `read-meta`.

### Step 4 — Synthesize the answer

Write the answer in the user's communication language (from
`_lumina/config/lumina.config.yaml` or README.md Roles section).

Structure:
- **Direct answer** first (1–3 sentences)
- **Supporting evidence** from wiki pages, cited as `wiki/sources/<slug>.md#section`
  or `[[slug]]` — not raw source files
- **Gaps** — where the wiki does not have an answer, say so clearly and propose
  `/lumi-ingest <file>` rather than guessing

Confidence calibration:
- High confidence: multiple wiki pages agree, edges are consistent
- Medium confidence: one page, no corroboration
- Low confidence: state explicitly; link the relevant source page rather than
  asserting the claim directly

Never answer from training data when the wiki has a contradicting page. The wiki
is the ground truth for this workspace.

### Step 5 — Identify gaps

If the question cannot be fully answered from the wiki:

1. State what part is covered and what is missing
2. Identify which `raw/sources/` files (if any) are likely to contain the answer
3. Suggest: "To fill this gap, run `/lumi-ingest raw/sources/<file>`"

Do not ingest the file yourself. The user decides whether to proceed.

### Step 6 — Optionally file as an output page

If the user asks to save the answer:

Ask for confirmation before writing. Then write
`wiki/outputs/<slug>.md` or `wiki/summary/<slug>.md` with:
```yaml
---
id: <slug>
title: "<Question as title>"
type: output  # or summary
created: YYYY-MM-DD
updated: YYYY-MM-DD
covers:
  - sources/<slug>
  - concepts/<slug>
---
```

Then add edges from each source/concept the answer drew on:
```bash
node _lumina/scripts/wiki.mjs add-edge sources/<slug> produced outputs/<answer-slug>
```

(The `produced` edge type is terminal — `outputs/**` is exempt from requiring a
reverse, per README.md Cross-Reference Rules.)

Log the operation:
```bash
node _lumina/scripts/wiki.mjs log ask "<question summary> -> outputs/<slug>.md"
```

## Output Format

```
**Answer**: <direct answer>

**Sources consulted** (from wiki):
- [[sources/attention-revisited-2026]] — <one-line relevance note>
- [[concepts/flash-attention]] — <one-line relevance note>

**Gaps**: The wiki does not yet cover <X>. Suggested next step:
`/lumi-ingest raw/sources/<file>`
```

If filing as a page, append:
```
Filed as: wiki/outputs/<slug>.md
```

## Examples

<example>
User: "What do the wiki sources say about softmax temperature scaling?"

Normal case — concept synthesis from the graph:
```bash
node _lumina/scripts/wiki.mjs list-entities --type concepts
# find concepts/softmax-temperature
node _lumina/scripts/wiki.mjs read-meta concepts/softmax-temperature
node _lumina/scripts/wiki.mjs read-edges concepts/softmax-temperature
# follow inbound edges to find all sources that used or introduced this concept
# read each source page body for claims
```
Answer cites `[[concepts/softmax-temperature]]` and each relevant source page.
</example>

<example>
User: "Compare flash-attention variants across the last five sources."

Edge case — cross-source synthesis with optional filing:
```bash
node _lumina/scripts/wiki.mjs list-entities --type sources
# identify the 5 most recently ingested by checking wiki/log.md dates
node _lumina/scripts/wiki.mjs read-edges sources/<each-of-5>
```
Synthesize a comparison table. Ask the user whether to file it. If yes, write
`wiki/outputs/flash-attention-comparison.md` and add `produced` edges from each
source consulted (terminal edge — no reverse required).
</example>

<example>
User: "What does the wiki say about state-space models?"

Gap case — question the wiki cannot yet answer:
Search `list-entities` and index.md for "state-space", "SSM", "Mamba". If no
pages match, state the gap clearly: "The wiki does not yet have coverage of
state-space models." Check if `raw/sources/` has a relevant file (Read tool,
directory listing). If found, suggest: "Run `/lumi-ingest raw/sources/mamba-2023.pdf`
to add this topic." Do not read the raw file yourself to answer the question.
</example>

## Guardrails

- Never write to `wiki/` during the reading phase (Steps 1–5). Mutations only
  happen in Step 6, with explicit user confirmation.
- Never read files in `raw/` to answer a question. The wiki is the answer surface.
  If raw/ would help but wiki/ does not have the answer, propose an ingest instead.
- Do not fabricate citations. Every claim in the answer must trace to a wiki page
  the user can open and verify.
- If `wiki/index.md` is empty (wiki not yet initialized), stop and ask the user to
  run `/lumi-init` and then `/lumi-ingest` some sources first.

## Definition of Done

Before reporting done, verify:

(a) Every cited page in the answer exists in `wiki/` (readable)
(b) If a page was filed: `wiki/log.md` has a new `## [YYYY-MM-DD] ask | ...` entry
(c) If a page was filed: running `/lumi-ask` again with the same question does not
    create a second output page (confirm with user or check for existing slug)
