# Long Sources (books, theses, 50+ page documents)

Use this reference when step-01 Phase 1 detects a long source. It replaces the
single-pass "read and summarize" drafting of Phase 3 with a multi-pass reading
pipeline: map the structure first, read unit by unit writing page-anchored
notes, then draft the source page from the notes — never from the raw text.

## Why multi-pass

Attention dilutes over long contexts: summarizing a 300-page book in one pass
quietly loses the middle chapters. The fix is the one careful readers use —
never hold the whole book in working memory. Read in passes, externalize each
unit into a note page, and synthesize from the notes. The notes become durable
wiki pages under `wiki/readings/<source-slug>/`, so later questions about the
book are answered from notes + page anchors instead of a full re-read.

## Detection and routing

After extraction is possible (Phase 1), size the document:

```bash
python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --info
# → {"pages": 312, "chars": 640000, "est_tokens": 160000}
```

- `pages >= 50` or `est_tokens >= 50000` → follow this reference.
- Below both thresholds → ignore this reference; normal Phase 3 drafting.
- **Fiction the user is currently reading** (they mention being partway
  through, or ask to track their reading) → do NOT deep-read; that spoils the
  book for the reading pack. Suggest `/lumi-reading-chapter-ingest` (reading
  pack) and stop. This pipeline is for finished books and non-fiction the
  user wants fully absorbed.

Non-PDF long sources (epub/docx/txt/md): no page numbers exist. Run the same
pipeline but use section-heading locators (`(§2.3)`) instead of `(p. N)` in
notes and Key Claims; skip the `verify_quotes.py` steps (it needs page
markers) — the grounding check in step-03 still covers these claims.

## RULES (in addition to step-01 RULES)

- Reading notes are wiki pages: initial creation via `Write` with full
  frontmatter from the Reading note template in
  `_lumina/schema/page-templates.md`; later frontmatter changes only via
  `wiki.mjs set-meta`.
- Every note gets one `annotates` edge to the source page in the same
  operation that creates it. The engine writes the `annotated_by` reverse.
- Notes are exempt from `wiki/index.md` (the linter knows); do not add them
  to the index. The source page is the entry point to its notes.
- Quotes in notes carry `(p. N)` / `(pp. A-B)` citations and are verified
  mechanically before a unit is considered done.
- Checkpoint after every unit — a 300-page book must survive interruption
  mid-read without re-reading finished units.

## Phase L1 — Inspectional pass (structure map)

Goal: a confirmed unit plan, not a summary.

1. Read front matter of the book: table of contents, preface/introduction,
   and the conclusion/final chapter. Use page-window reads so markers give
   you real page numbers:

   ```bash
   python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --pages 1-15 --markers
   ```

2. Skim the first and last page of 2–3 sampled chapters to confirm the TOC's
   page numbers match the extraction's `[[page N]]` numbering (printed page
   numbers often differ from PDF page indices by a fixed offset — find that
   offset now, record it in the checkpoint, and use PDF page numbers
   everywhere).

3. Decide the units. One note per coherent argument unit, not one per
   heading: a book of 60 micro-chapters merges into its part/section
   divisions (often 10–20 units); a 6-chapter monograph keeps 6. Target
   roughly 10–40 pages per unit.

4. Merge the plan into the ingest checkpoint (read → merge → write back, as
   in step-01 Phase 2):

   ```json
   "long_source": {
     "page_offset": 0,
     "units": [
       {"id": "01", "from": 9, "to": 34, "title": "The Activity of Reading"},
       {"id": "02", "from": 35, "to": 60, "title": "Levels of Reading"}
     ],
     "next_unit": "01"
   }
   ```

Then continue step-01 Phases 2–3 as normal for the source page itself, with
one change: in Phase 3, write the source page skeleton (frontmatter + `##
Summary` placeholder noting the read is in progress) and come back to fill
`## Summary` / `## Key Claims` in Phase L3 below. Slug the source first —
notes need `sources/<slug>` to exist for their edges.

## Phase L2 — Analytical pass (one note per unit)

Loop over `long_source.units` starting at `next_unit`. For each unit:

1. Read only that unit's pages:

   ```bash
   python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --pages <from>-<to> --markers
   ```

2. Write `wiki/readings/<source-slug>/<id>-<unit-slug>.md` from the Reading
   note template (`_lumina/schema/page-templates.md`): an opening line
   `Part N of [[sources/<source-slug>]] (pp. <from>–<to>).`, then the
   question this unit answers, key terms, leading propositions, arguments
   (premises → conclusion, each page-cited), evidence offered, quotes with
   `(p. N)`, tensions/links to other units, open questions. Frontmatter:
   `source: <source-slug>`, `part: <n>`, `pages: "<from>-<to>"`.

3. Register the edge:

   ```bash
   node _lumina/scripts/wiki.mjs add-edge readings/<source-slug>/<id>-<unit-slug> annotates sources/<source-slug>
   ```

4. **Recite check** — before leaving the unit, while it is still in context:
   re-skim the unit and confirm every proposition in the note is actually
   what the author says, then verify the quotes mechanically:

   ```bash
   python3 _lumina/tools/verify_quotes.py --source raw/sources/<file>.pdf wiki/readings/<source-slug>/<id>-<unit-slug>.md
   ```

   Fix every `FAIL` (wrong words → re-quote; wrong page → fix the citation)
   and re-run until `fail` is 0. `NEAR` means the quote sits one page off the
   citation — fix the page number. After this check the unit may leave
   working memory; the note is the memory from here on.

5. Update `long_source.next_unit` in the checkpoint (or remove it after the
   last unit). Interruption at any point resumes from `next_unit` without
   re-reading finished units.

Key terms: collect them as you go (each note's Key terms section). They are
the concept candidates for step-01 Phase 4 — apply `dedup-policy.md` and the
3–7 concepts-per-source rubric there; most unit-local terms stay in note
prose and do not become concept pages.

## Phase L3 — Synthesis (draft from notes, not the book)

With all units noted, draft the source page body by reading **the notes
only** — do not re-read the raw text here; if a note is too thin to support
the synthesis, go back to Phase L2 for that unit instead.

- `## Summary` — what the whole book is about and how the argument is built.
- `## Key Claims` — the load-bearing claims across units, each ending with a
  page locator `(p. N)` carried over from the notes (grounding in step-03
  reads these).
- `## Concepts`, `## People`, `## Open Questions` — as in step-01 Phase 3.

Run the quote check once more over the whole set — source page plus notes:

```bash
python3 _lumina/tools/verify_quotes.py --source raw/sources/<file>.pdf wiki/sources/<slug>.md wiki/readings/<source-slug>/
```

Then return to step-01 Phase 4 (concept and person stubs) and continue the
normal pipeline. At the Draft Gate, include the note count in the summary
("N reading notes under wiki/readings/<source-slug>/") and mention that
follow-up questions will be answered from these notes.
