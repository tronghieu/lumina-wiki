---
name: lumi-help
description: >
  Orient the user in their Lumina wiki workspace. Three modes:
  Orientation (default — recommend ONE next action; offer to run),
  Catalog (on `skills`/`list` arg or features question — render
  lumi-help.csv grouped by pack), Framework Q&A (on `explain`
  arg or how-it-works question — answer from local docs with
  citations). Use when the user says "help", "what next", "I'm lost",
  asks for orientation, or asks how Lumina works.
allowed-tools:
  - Bash
  - Read
---

# /lumi-help

Read `README.md` at the project root before this SKILL.md.

This file is the contract — it has everything you need for normal invocations.
For precision detail (exact Bash commands, full output templates, multilingual
keyword lists, fallback codes) consult `_lumina/schema/lumi-help-runbook.md`
**only when the relevant section explicitly points to it**. Don't load it
upfront — Mode B never needs it.

## Purpose

Help the user know:

1. **Where they are** — installed packs, what's done, what's pending.
2. **What to do next** — ONE recommended skill with a cited reason.
3. **How to invoke it** — name, args, language hint; offer to run for them.
4. **What's available** — full catalog grouped by pack on demand.
5. **How Lumina works** — framework questions answered from local docs with citations.

## Step 0 · Read languages, ALWAYS first

Before mode routing, read `_lumina/config/lumina.config.yaml` and bind:

- `COMM_LANG` ← `communication_language` — language of every word back to user.
- `DOC_LANG` ← `document_output_language` — surfaced when recommending a write-skill.

User never passes a language flag. Match input tone (casual ↔ formal).

## Three modes (router decides AFTER Step 0, BEFORE other reads)

| Trigger | Mode | Job |
|---|---|---|
| no arg, or "help / what next / I'm lost" | **A · Orientation** | recommend ONE next action; offer to run |
| `skills`/`catalog`/`list`, or features question | **B · Catalog** | render `lumi-help.csv` grouped by pack |
| `explain`/`docs`, or how-it-works question | **C · Q&A** | answer with doc citations |

Keyword detection is multilingual (EN + VI + ZH). Mode B takes precedence over
C. If the question is about wiki *content* (not the framework), bridge to
`/lumi-ask` instead of answering in Mode C.

> When the user's input language is not English, or when the trigger is borderline,
> read the full keyword lists at `_lumina/schema/lumi-help-runbook.md` § Router
> before deciding. English plain-text triggers can be matched from this table alone.

## Mode A — Orientation (5 steps: locate → detect → compute → ground → cite)

Decision ladder is **load-bearing** — pick first match in this order:

1. Manifest missing → `/lumi-init`.
2. Required skill with both gates satisfied (`after` AND `before`),
   completed=false → that skill.
3. raw/ files not yet ingested → `/lumi-ingest`.
4. Default → `/lumi-ask`.

Output: skill recommendation + one-sentence reason in `COMM_LANG` + `→ Run`
line + (write-skill only) `DOC_LANG` note + citation arrow + **"Want me to run
it now? (yes / show me first / skip)"**. Skip the prompt for case (4). On
"yes" → invoke; otherwise don't.

> For the exact Bash reads at each step (locate / detect / ground), the full
> formal-and-casual output templates, the idle-wiki hint format, and fallback
> codes (`__NO_MANIFEST__`, `__NO_CATALOG__`, `__NO_GRAPH__`, `__NO_DATE__`),
> read `_lumina/schema/lumi-help-runbook.md` § Mode A before producing output.

## Mode B — Catalog

Parse `_lumina/schema/lumi-help.csv`. Group rows by `pack` in order
core → research → reading → other (alphabetical). Pack labels are hardcoded:

- `core` → "Core (always installed)"
- `research` → "Research pack"
- `reading` → "Reading pack"
- `learning` → "Learning pack"
- other → pack name with first letter capitalized

Each entry: `` `[<menu>]` `/<id>` <args if non-empty> — <description> ``. End with
two footer pointers to `/lumi-help` (orientation) and `/lumi-help explain <topic>`
(framework Q&A). **Mode B never needs the runbook.**

## Mode C — Framework Q&A (5 steps: same skeleton as A)

Doc paths are stable, all shipped to the workspace at install time:

| Doc | When |
|---|---|
| `README.md` (`<!-- lumina:schema -->` block) | core concepts: layout, page types, link syntax, cross-reference rules, constraints, skills overview |
| `_lumina/schema/page-templates.md` | page-type frontmatter + section structure |
| `_lumina/schema/cross-reference-packs.md` | bidirectional-link rules and pack extensions |
| `_lumina/schema/graph-packs.md` | edge type vocabulary for `wiki/graph/edges.jsonl` |
| `.agents/skills/<skill-id>/SKILL.md` | when the question is specifically about one skill's behavior |

Use the Read tool (not Bash). Read just the slice you need. Build a 1–4
sentence answer in `COMM_LANG` with a `**Source**:` line. If no doc covers
the question, say so and point at the closest.

> For the exact output templates (formal, casual, no-doc fallback) and the
> rules for when to append the optional "→ Try it" line, read
> `_lumina/schema/lumi-help-runbook.md` § Mode C before producing output.

## Data sources (read-only)

| Source | Read in |
|---|---|
| `_lumina/config/lumina.config.yaml` | Step 0 (every invocation) |
| `_lumina/manifest.json` | Mode A |
| `_lumina/schema/lumi-help.csv` | Mode A, B |
| `wiki.mjs list-entities`, `wiki/log.md`, `raw/`, `wiki/index.md` | Mode A |
| `README.md` schema block, `_lumina/schema/page-templates.md`, `cross-reference-packs.md`, `graph-packs.md`, target skill's `SKILL.md` | Mode C |

## Constraints

- Read only the sources above. Never write a file. Never call mutating
  `wiki.mjs` subcommands. Read-only ones allowed: `list-entities`,
  `read-meta`, `read-edges`, `read-citations`, `resolve-alias`.
- Respond in `COMM_LANG`. Surface `DOC_LANG` next to write-skills.
- Cite every non-trivial claim in Mode C — if a doc does not say it, don't assert it.
- Never read `wiki/` page bodies in Mode C, never `raw/`. Reading another skill's `SKILL.md` is allowed only when the user's question is specifically about that skill's behavior.
- "Want me to run it now?" is a soft prompt — invoke only on affirmative reply.
- Match the user's tone (casual ↔ formal).
- All Bash reads happen before reasoning; never infer state from prior conversation.
- When recommending a verification skill (`/lumi-check`, `/lumi-verify`) right after a write skill (`/lumi-ingest`, `/lumi-edit`, `/lumi-research-*`, `/lumi-reading-*`), suggest the user run it in a fresh context window or via a subagent — the writing context biases the check.
