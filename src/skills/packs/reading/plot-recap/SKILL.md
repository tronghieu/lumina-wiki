---
name: lumi-reading-plot-recap
description: >
  Generate a spoiler-safe progressive recap of a book up to (but NOT including) the
  user's current chapter cursor. Use whenever the user asks for a summary of what has
  happened so far — including phrasings like "where am I in the story", "what's happened
  so far", "recap up to chapter 3", "remind me of the plot", "catch me up", "what do I
  know so far", or "summarize the story to this point".
---

# /lumi-reading-plot-recap

## TL;DR

Given a cursor of the form `<book-slug>:<chapter-slug>`, generates a recap of the plot,
characters, and themes as of the chapter *immediately before* the cursor. The cursor
chapter and everything after it are strictly excluded from the recap output.

The spoiler boundary is the defining feature of this skill. A recap that leaks even
one event from the cursor chapter or later has failed its core contract.

## Context

Read `README.md` at the project root for the full schema. This skill reads from:
- `wiki/chapters/<book-slug>/` — chapter pages with `number` frontmatter for ordering
- `wiki/characters/<book-slug>/` — character pages
- `wiki/themes/<book-slug>/` — theme pages
- `wiki/plot/<book-slug>/` — plot-beat pages written by chapter-ingest

No wiki writes happen during a recap (read-only). The only output is the recap text
delivered to the user in the conversation.

## Inputs

- `<book-slug>:<chapter-slug>` — the chapter the user is *currently reading* (not yet
  finished). The recap covers everything *before* this chapter.
  Example: `great-gatsby:03-the-parties` means "recap chapters 1 and 2; do not
  mention anything from chapter 3 or later."
- Optional `--format narrative|bullets|character-focused|theme-focused` — output style.
  Default: `narrative`.

## Spoiler Boundary Contract

This is safety-critical for the reading experience. The rules are:

1. **The cursor chapter is NOT finished.** The user is currently reading it. Do not
   summarize, hint at, or allude to any event in the cursor chapter.
2. **Everything after the cursor is unknown territory.** Do not reference any chapter
   whose `number` >= the cursor chapter's `number`.
3. **The recap covers chapters with `number` < cursor `number` only.**

If the ordering information is ambiguous or unavailable (see Step 1 below), stop and
ask the user to confirm the chapter order rather than guessing. A wrong guess could
spoil the book. This is the one case where the skill must not proceed autonomously.

## Workflow

### Step 1 — Resolve chapter ordering

Read the cursor chapter's frontmatter to get its `number`:

```bash
node _lumina/scripts/wiki.mjs read-meta chapters/<book-slug>/<chapter-slug> --json
```

The `number` field (integer, 1-based) is the canonical ordering key. It is set by
chapter-ingest and must be present on every ingested chapter page.

If `number` is missing from the cursor chapter's frontmatter, check
`wiki/chapters/<book-slug>/index.md` for a manually maintained order list.

If neither source provides a reliable order, **stop and ask the user**:
"I cannot determine chapter ordering for `<book-slug>` from the frontmatter or index.
Please confirm: which chapters come before `<chapter-slug>`?"

Do not guess. A spoiler caused by wrong ordering is worse than asking one clarifying
question.

### Step 2 — Collect safe chapters

List all ingested chapters for this book:

```bash
node _lumina/scripts/wiki.mjs list-entities chapters/<book-slug> --json
```

For each chapter, read its `number` field:

```bash
node _lumina/scripts/wiki.mjs read-meta chapters/<book-slug>/<each-slug> --json
```

Build the safe set: chapters whose `number` < cursor `number`. Call this set S.

If S is empty (cursor is at chapter 1), respond: "You are at the very beginning of
`<book-slug>`. There is no prior history to recap."

### Step 3 — Pre-flight spoiler check (mandatory)

Before generating any recap text, list the slugs in S and assert their ordering. Output
this check to yourself internally (not to the user) before writing the recap:

```
Spoiler check:
  cursor: <chapter-slug> (number <N>)
  safe chapters: [<slug1> (1), <slug2> (2), ..., <slugN-1> (N-1)]
  assertion: every chapter in safe set has number < <N>  -> PASS
```

If the assertion fails for any chapter, remove it from S and note the anomaly. Do not
include chapters whose number is ambiguous or >= cursor number.

### Step 4 — Gather source material for the safe set

For each chapter slug in S:

1. Read the chapter page body (narrative events):
   ```bash
   # Read the file directly — plot-recap reads wiki files but never writes them
   ```
   Use the `Read` tool on `wiki/chapters/<book-slug>/<slug>.md`.

2. Read the chapter's plot beats page if it exists:
   Use the `Read` tool on `wiki/plot/<book-slug>/ch<N>-beats.md`.

3. Read character mentions for this chapter:
   ```bash
   node _lumina/scripts/wiki.mjs read-edges --from chapters/<book-slug>/<slug> --type features --json
   ```

### Step 5 — Read character and theme context

For each character who appears in at least one safe chapter:

```bash
node _lumina/scripts/wiki.mjs read-edges --from characters/<book-slug>/<character-slug> --type appears_in --json
```

Filter to appearances in S only. Read the character page body for context.

For themes promoted across safe chapters, read theme pages from `wiki/themes/<book-slug>/`.

### Step 6 — Generate the recap

Write the recap covering only material from S. Structure:

- **Story so far** — narrative summary of events in chronological order (chapters in S).
- **Characters** — who has appeared, their key traits and relationships established so far.
- **Themes** — which themes have emerged across S (only promoted themes; skip stubs).
- **Open threads** — unresolved questions or tensions as of the end of S.

Tone: present-tense, engaging, concise. Aim for a recap the user can read in 2 minutes.

The `Open threads` section is especially valuable — it refreshes the user's anticipation
for the cursor chapter without revealing it.

### Step 7 — Post-generation spoiler audit

After writing the recap draft, scan it for any references to events, characters
introduced, or revelations that occur only in the cursor chapter or later. If any are
found, remove them before delivering the recap.

Signals that a spoiler may have leaked:
- A character whose `first_seen` frontmatter shows a chapter number >= cursor number
- An event not present in any of the plot-beat pages for S
- A theme that only appears in chapters outside S

## Output / Definition of Done

- Recap text covers only chapters in S (number < cursor number).
- Every sourced chapter slug is listed in the pre-flight check with its confirmed number.
- No events, characters, or themes from the cursor chapter or later appear in the output.
- This skill makes no writes to `wiki/`. It is entirely read-only.

## Guardrails

- If ordering cannot be confirmed, ask the user rather than proceeding. This is the one
  non-negotiable stop condition.
- Never generate a recap that references the cursor chapter, even indirectly ("what is
  about to happen", "the next chapter will reveal").
- This skill is read-only. Do not call `set-meta`, `add-edge`, or `batch-edges`.
- If the user asks for a recap beyond what has been ingested ("what happened in chapter 7"
  when only chapters 1-5 are in the wiki), respond: "Chapter 7 has not been ingested yet.
  Run `/lumi-reading-chapter-ingest` first."

## Examples

<example>
Book: "Dusk of Five Moons" (fictional). 5 chapters ingested with numbers 1-5.
Input: --cursor dusk-of-five-moons:03-the-crossing
Spoiler check: cursor number = 3. Safe set = [01-arrival (1), 02-the-market (2)].
Recap covers only chapters 1 and 2. Chapter 3, 4, 5 are not mentioned.
Output: "In chapter 1, Lena arrives at the port city... In chapter 2, she encounters
the merchant guild... Open threads: the sealed letter Lena received remains unopened."
</example>

<example>
Book: same. Input: --cursor dusk-of-five-moons:01-arrival
Safe set is empty (cursor number = 1, no chapters with number < 1).
Output: "You are at the very beginning of Dusk of Five Moons. There is no prior
history to recap."
</example>

<example>
Ordering unknown: chapter pages exist but none have a `number` field in frontmatter,
and there is no index.md order list.
Output: "I cannot determine chapter ordering for dusk-of-five-moons from the frontmatter
or index. Please confirm: which chapters come before 03-the-crossing?"
Do not attempt to order by filename or alphabetically without user confirmation.
</example>

<example>
Book: same. Input: --cursor dusk-of-five-moons:03-the-crossing, format: character-focused.
Safe set: chapters 1 and 2. Generate recap focused on each character's arc through those
two chapters. Theme section is brief. No chapter 3 events appear.
</example>

<example>
User asks: "remind me what happened in The Crossing chapter".
Action: The Crossing is the cursor chapter (not yet finished). Respond: "That is your
current chapter — I cannot recap it without spoiling it. Would you like a recap of
everything up to The Crossing instead?"
</example>
