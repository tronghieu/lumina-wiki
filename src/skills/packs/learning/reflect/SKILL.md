---
name: lumi-learning-reflect
description: >
  Guide a self-reflection session on a concept, source, or topic the user has studied.
  Creates or updates a personal reflection page in wiki/reflections/ with a rewritable
  "Current understanding" section and an append-only "Evolution" log. AI acts as a
  metacognitive mirror — quotes the user's past words and asks questions — but never
  writes reflection content. Use whenever the user invokes /lumi-learning-reflect, says
  "reflect on <concept>", "update my reflection on <topic>", "what do I think about
  <concept>?", "I want to journal about <topic>", "phản tư về <concept>", "suy ngẫm về
  <topic>", "反思 <concept>", "我对 <topic> 的理解", or any phrasing indicating they want
  to record or revisit their personal understanding of a wiki concept or source.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /lumi-learning-reflect

Read `README.md` at the project root before this SKILL.md.

## TL;DR

Creates or updates a `wiki/reflections/<slug>.md` personal reflection page. AI acts as a
metacognitive mirror — it reads past entries, quotes the user's own words, and asks
questions — but **never writes reflection content**. The user writes their own understanding.

Reflection pages are a **personal overlay**. They do not write graph edges. They do not
require reverse links from academic pages. `reflections/**` is exempt from bidirectional-
link requirements.

## When to use

Invoke when the user wants to:
- Record their current understanding of a concept for the first time
- Revisit and update an existing reflection after learning more
- Compare their past understanding to their current one
- Receive prompting questions to deepen their thinking

This skill is **personal-layer only**. It does not modify concept, source, or any other
academic wiki pages.

## Inputs

- `<concept-id>` — optional. The slug of the concept, source, or topic to reflect on
  (e.g. `cognitive-offloading`, `the-memory-paradox`). If omitted, ask the user what they
  want to reflect on before proceeding.

## Preconditions

Before running:
1. Read `_lumina/config/lumina.config.yaml` to confirm `packs.learning: true`. If not
   present, halt and inform the user that the learning pack is not installed.
2. Read `_lumina/schema/page-templates.md` for the Reflection page template.
3. If `<concept-id>` is provided, check whether a reflection page already exists at
   `wiki/reflections/<concept-id>.md`.

## Workflow

### Step 1 — Load context (READ ONLY)

1. If the reflection page exists, read it fully. Note:
   - The current `## Current understanding` text.
   - The `## Evolution` log: how many entries, dates, and the trajectory of change.
   - The `evolution_count` frontmatter field.
2. If related concept/source pages exist (from `related_concepts:` / `related_sources:`),
   read their `## Definition` and `## Summary` sections only — do not scan the full page.
3. **Do not write anything yet.**

### Step 2 — Mirror mode (PROMPT ONLY)

Present to the user in their communication language (`communication_language` from
`_lumina/config/lumina.config.yaml`):

**If this is a new reflection (no existing page):**
> "There's no reflection yet on [Concept]. Before you write, tell me: what does
> [Concept] mean to you right now, in your own words?"

**If this is an existing reflection (page found):**
Quote 1–2 sentences from the user's most recent `## Evolution` entry (or from
`## Current understanding` if no Evolution entries exist). Then ask:
> "You wrote: '[quoted text]'. Has your understanding shifted since then? What would
> you add, remove, or change?"

Do **not** summarize the concept from the academic pages. Do not explain what the concept
means. Do not suggest answers. Just prompt and wait.

### Step 3 — User writes (WAIT)

Wait for the user to respond with their own words. **Do not proceed until the user
has provided content.** If the user asks "what should I write?" or "can you write it for
me?", respond:
> "This reflection is yours to write — I can only prompt you. What comes to mind when
> you think about [Concept]?"

### Step 4 — Ask follow-up questions (OPTIONAL, 1 round)

After the user has written something, you may ask **one clarifying question** to deepen
the reflection. Choose from question types appropriate to the trajectory:

- **Contrast**: "How is this different from [related concept] in your mind?"
- **Application**: "Can you think of a moment in your own learning where this happened?"
- **Uncertainty**: "What part of [Concept] are you least confident about?"
- **Implication**: "What would change in how you study if this is true?"

Then wait for the user's response, or let them decline to answer.

### Step 5 — Write the reflection page

Using the user's words (not a paraphrase, not a summary — their exact words), construct
or update the reflection page:

**Frontmatter updates:**
- `updated`: today's ISO date
- `evolution_count`: increment by 1 (or set to 1 for new pages)
- `related_concepts`: list any concept slugs the user mentioned or that were the focus
- `related_sources`: list any source slugs the user mentioned

**`## Current understanding` section:**
- Replace entirely with the user's written response from Step 3 (and any follow-up from
  Step 4 if provided). This section is always the user's most recent understanding.
- Do **not** add any AI-generated text, qualifiers, or commentary.

**`## Evolution` section:**
- **Append only** — never edit or delete existing entries.
- Add a new entry at the **bottom** of the section:
  ```markdown
  ### YYYY-MM-DD — <brief label in 3–5 words>
  <1–3 sentence summary of what the user wrote or changed in this session>
  ```
- The brief label should describe the shift (e.g. "First understanding", "Added contrast
  with spaced repetition", "Revised after reading Memory Paradox").
- The summary in the Evolution entry may be written by the AI — it is a record of what
  was written, not the reflection itself.

**Frontmatter `id` field (new pages only):** `reflection-<concept-id>` — flat slug with
`reflection-` prefix (e.g. `reflection-cognitive-offloading`). Do not use path-prefixed form.

**File path:**
- New page: `wiki/reflections/<concept-id>.md` — use `Write` tool
- Existing page: same path — use `Edit` tool. When editing, use the exact section heading
  `## Current understanding` as the start anchor and `## Evolution` as the end boundary.
  The `old_string` must span from `## Current understanding` through (but not including)
  `## Evolution` — never let the match region cross into the Evolution log.

### Step 6 — Log and confirm

Append a log entry via the wiki engine:

```bash
node _lumina/scripts/wiki.mjs log learning-reflect "reflected on <concept-id>; evolution_count=<N>"
```

Then report to the user:
- Page path written/updated
- `evolution_count` after this session
- A one-sentence confirmation that their reflection is saved

## Output / DoD

- `wiki/reflections/<concept-id>.md` exists with valid frontmatter (`id`, `title`, `type:
  reflection`, `created`, `updated`, `related_concepts`, `related_sources`, `evolution_count`).
- `## Current understanding` contains only the user's own words from this session.
- `## Evolution` has a new entry appended at the bottom; no existing entries are modified.
- `wiki/log.md` has one new appended line for this session.
- No academic pages (`wiki/concepts/`, `wiki/sources/`, `wiki/people/`, etc.) were modified.
- No graph edges were written (`edges.jsonl` unchanged).

## Boundary constraints (non-negotiable)

- **Never write to academic pages**: no edits to `wiki/concepts/`, `wiki/sources/`,
  `wiki/people/`, or any non-reflection path.
- **Never write graph edges**: do not call `wiki.mjs add-edge` or modify `edges.jsonl`.
  Frontmatter `related_concepts:` and `related_sources:` are the only connection mechanism.
- **Never generate reflection content**: the `## Current understanding` section must
  contain only the user's own words. AI may only edit the Evolution entry summary and
  the frontmatter fields.
- **No wikilinks in body**: reflection pages must not use `[[concept-slug]]` inline links.
  Frontmatter lists only.

## Error cases

| Situation | Response |
|-----------|----------|
| Learning pack not installed (`packs.learning` not in config) | Halt. Inform user the learning pack is required. |
| User declines to write | Acknowledge and exit. Do not create an empty page. |
| `concept-id` not found in `wiki/concepts/` | Proceed anyway — reflections can be on any topic, not just existing concept pages. Note to user that no concept page was found. |
| Evolution entry already exists for today | Append a second entry for today with a different label. Do not merge. |
