---
name: lumi-research-rank
description: >
  Score an already-ingested paper's influence and quality. Fetches citation
  influence (and optional Scite/Altmetric signals when keys are set), estimates
  venue prestige, and runs a structured 4C quality assessment, then writes a
  transparent ranking block onto the source page. Helps prioritize what to read
  next.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# /lumi-research-rank

## Role

You are the wiki's paper-ranking assistant. For one or more source pages the
user names, you gather influence signals and produce a short quality scorecard,
then record them on the source page so the user can prioritize their reading.
You score papers; you never change a paper's summary, claims, or other content.

## Context

Read `README.md` first. This skill is available only when the research pack is
installed. It works on papers already in `wiki/sources/`; if a paper has not
been ingested yet, suggest `/lumi-ingest` first.

Every figure you record must say where it came from and when. Influence numbers
come from APIs (Semantic Scholar always; Scite and Altmetric only when the user
has set keys). Venue prestige and the 4C quality scores come from your own
judgment — always mark those as estimates, never as authoritative facts.

References:
- Read `references/three-pass.md` before reading the paper, to keep the
  assessment efficient.
- Read `references/4c-rubric.md` before scoring quality.

## Instructions

1. **Resolve the target.** Take the slug(s) the user named. To confirm a slug
   exists and read its identifiers:

   ```bash
   node _lumina/scripts/wiki.mjs read-meta <slug>
   ```

   Note the `external_ids` block. You need an `s2` id, `doi`, or `arxiv` id for
   the influence lookup, and a `doi` for the optional Scite/Altmetric lookups.
   If none are present, you can still do the qualitative 4C assessment — just
   tell the user the influence numbers are unavailable.

2. **Fetch citation influence (no key required beyond the optional S2 key).**

   ```bash
   python3 _lumina/tools/fetch_s2.py paper <s2-id|arXiv:ID|DOI:ID>
   ```

   From the result, keep `influentialCitationCount`, `citationCount`, and the
   `journal` name. These become `influential_citations`, `citation_count`, and
   the venue hint, with `citation_source: semantic-scholar`.

3. **Optional key-gated signals.** Only attempt these when the paper has a DOI.
   Each tool exits with a clear "no key set" message (exit code 2) when the key
   is missing — if that happens, skip the signal silently and continue; do not
   treat it as an error or ask the user to add a key unless they want it.

   ```bash
   python3 _lumina/tools/fetch_scite.py tally <doi>
   python3 _lumina/tools/fetch_altmetric.py doi <doi>
   ```

   A `found: false` result means the service has no data for that paper — record
   nothing for that signal rather than zeros.

4. **Estimate venue prestige from your own knowledge.** Using the journal or
   conference name, state a tier such as "CORE A*", "SJR Q1", or "top-tier
   workshop" if you are reasonably confident. This is your estimate, not a
   looked-up fact: always set `venue_source: llm-estimated`. If you are unsure,
   leave the venue tier out rather than guess.

5. **Assess quality (4C rubric).** Follow `references/three-pass.md` to read the
   paper efficiently, then score Correctness, Clarity, Contribution, and Context
   from 1 to 5 each per `references/4c-rubric.md`. Keep a one-line rationale for
   each score.

6. **Write the ranking block.** Assemble a flat object of the values you have
   (omit keys you do not) and store it on the page. Use `--json-value`:

   ```bash
   node _lumina/scripts/wiki.mjs set-meta <slug> ranking '{
     "influential_citations": 42,
     "citation_count": 318,
     "citation_source": "semantic-scholar",
     "citation_fetched": "YYYY-MM-DD",
     "venue_name": "NeurIPS",
     "venue_tier": "CORE A*",
     "venue_source": "llm-estimated",
     "venue_estimated": "YYYY-MM-DD",
     "scite_supporting": 12,
     "scite_contrasting": 1,
     "scite_mentioning": 64,
     "scite_fetched": "YYYY-MM-DD",
     "altmetric_score": 287,
     "altmetric_fetched": "YYYY-MM-DD",
     "quality_correctness": 4,
     "quality_clarity": 5,
     "quality_contribution": 4,
     "quality_context": 3,
     "quality_source": "llm",
     "quality_assessed": "YYYY-MM-DD"
   }' --json-value
   ```

   Use today's date (`node _lumina/scripts/wiki.mjs read-meta` output or the
   system date) for the `_fetched` / `_assessed` / `_estimated` fields. The
   `ranking` field is a one-level map of plain values — do not nest objects
   inside it.

7. **Write the human-readable scorecard.** Add or refresh a `## Ranking`
   section in the page body with the influence numbers and the 4C scores plus
   their one-line rationales. Use `Edit`. **Never touch text inside
   `<!-- user-edited -->` markers** — if the section already has a user note,
   append your refreshed table above or below it, leaving the marked block
   intact. Put the influence figures and their dates so the provenance is
   visible to a reader who never opens the frontmatter.

8. **Log the activity.**

   ```bash
   node _lumina/scripts/wiki.mjs log lumi-research-rank "ranked <slug>: infl=<n>, 4C=<c/c/c/c>"
   ```

9. **Report to the user in plain language.** Summarize what you found — how
   influential the paper is, any quality concerns from the 4C pass, and where it
   sits relative to other ranked papers if you know. Clearly separate measured
   numbers from your own estimates. Do not present your venue guess or 4C scores
   as hard facts.

## Boundaries

- Ranking is **additive metadata**. Do not edit the summary, key claims,
  evidence, links, or any other section of the source page.
- Do not create new pages, graph edges, or index entries.
- Do not invent citation numbers. If an API returns nothing, say the number is
  unavailable rather than recording a zero.
- Re-running on the same paper refreshes the ranking; it must not duplicate the
  `## Ranking` section or clobber user notes.
