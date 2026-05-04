# Step 1: Draft

## RULES

- Read `README.md` at the project root before this step. Bidirectional-link discipline applies to every edge you write.
- Never modify files in `raw/`. Read-only.
- Never hand-edit `wiki/graph/edges.jsonl` or `wiki/graph/citations.jsonl`; use `wiki.mjs add-edge` and `wiki.mjs add-citation`.
- Never overwrite an existing wiki page without user confirmation.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write to `wiki/*.md` directly. (Body text goes through Write tool atomically; finalizing frontmatter still uses `set-meta`.)
- `raw/tmp/` accepts additions only; never overwrite a file there.
- `raw_paths` must list permanent artifacts only. Reject `raw/tmp/*` entries.
- Keep a phase-level checkpoint after every phase — an interrupted run must resume cleanly.
- Do NOT advance `ingest_status` until the user accepts at the gate at the end of this step.

## INSTRUCTIONS

### Phase 0 — Resume check

```bash
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename>
```

If a phase-level checkpoint exists and `phase` is not `"done"`, ask the user whether to resume or restart. Resuming skips completed phases. Restarting deletes the checkpoint and starts from Phase 1.

### Phase 0.5 — Resolve input

Three input modes:

**Mode A — Local file path** (e.g. `raw/sources/foo.pdf`, `raw/notes/bar.md`)

Use directly as `source_path`. Proceed to Phase 1.

**Mode B — URL or identifier** (arxiv ID like `2604.03501v2`, arxiv URL, DOI, S2 paper ID, generic URL)

```bash
python3 _lumina/tools/fetch_pdf.py "<url-or-id>"
```

- For bare arxiv ID: pass `https://arxiv.org/abs/<id>`
- For DOI: pass `https://doi.org/<doi>`

On exit 0: read JSON output. Use `path` as `source_path`. Write the input URL as the first entry of `urls` on the source page.

On exit 2 (HTML response): URL likely points to a paywall or non-PDF page. Report and ask for a direct PDF URL or manual download.

On exit 3 (network error): retry once. If still failing, surface the exact error.

**Mode C — Title only**

```bash
node _lumina/scripts/wiki.mjs checkpoint-read research-discover shortlist
```

Match title to a shortlist entry, extract URL, fall through to Mode B.

### Phase 1 — Detect type

Read first ~200 lines of the source. Classify:
- "Abstract", "Introduction", "References" → `paper`
- Chapter structure → `book`
- Web byline + publication → `article`
- Speaker turns / transcript → `podcast`
- Else → `note`

Write checkpoint: `phase: "detect"`.

### Phase 2 — Generate slug

```bash
node _lumina/scripts/wiki.mjs slug "<Title>"
```

If `wiki/sources/<slug>.md` already exists: re-ingest — confirm with user before overwriting.

Write checkpoint: `phase: "slug"`.

### Phase 3 — Write source page

For PDFs / large sources, follow `pdf-preprocessing.md` first.

Draft `wiki/sources/<slug>.md` from `_lumina/schema/page-templates.md` Source template. Required frontmatter: `id`, `title`, `type`, `created`, `updated`, `authors`, `year`, `importance`, `provenance`. Optional but encouraged: `urls`, `raw_paths`, `confidence`.

Required body sections: `## Summary` (2–4 sentences), `## Key Claims` (bulleted, with confidence), `## Concepts` (`[[concept-slug]]` links), `## People` (`[[person-slug]]` links), `## Open Questions`.

Provenance rubric (raw-centric):
- `replayable` — `raw_paths` non-empty, every entry resolves to existing file
- `partial` — `urls` has entries but `raw_paths` empty or missing
- `missing` — neither

`raw_paths` MUST list permanent artifacts only:
- The primary file (`raw/sources/*`, `raw/notes/*`, `raw/download/<resource>/*`)
- Matching metadata JSON in `raw/discovered/<topic>/<id>.json` if present

Do NOT include `raw/tmp/*` or files outside `raw/`.

`confidence` defaults to `unverified` for fresh ingests; bump only after cross-check or user confirmation.

Write checkpoint: `phase: "source-page"`.

### Phase 4 — Concept and person stubs

For every concept name extracted in Phase 3:

```bash
node _lumina/scripts/wiki.mjs resolve-alias "<concept-name>"
```

If it resolves to a foundation, link via `[[foundations/<slug>]]` and add `grounded_in` edge instead of creating a stub. See `dedup-policy.md` § Foundation Resolution.

Apply `dedup-policy.md` before creating/updating stubs. Existing pages are updated conservatively.

New stubs use the templates in `_lumina/schema/page-templates.md`.

Write checkpoint: `phase: "stubs"`.

### Phase 5 — Build graph edges

For every cross-reference, call `add-edge` once for the forward relationship. `wiki.mjs add-edge` is idempotent and writes the reverse edge unless terminal/exempt/symmetric.

```bash
node _lumina/scripts/wiki.mjs add-edge sources/<slug> introduces_concept concepts/<concept>
node _lumina/scripts/wiki.mjs add-edge sources/<slug> uses_concept concepts/<concept>
node _lumina/scripts/wiki.mjs add-edge sources/<slug> authored_by people/<person>
node _lumina/scripts/wiki.mjs add-edge sources/<slug> builds_on sources/<other>
```

Exemptions: `foundations/**`, `outputs/**`, external URLs.

Write checkpoint: `phase: "edges"`.

### Phase 6 — Citations

For every other source this one explicitly cites AND that already exists in the wiki:

```bash
node _lumina/scripts/wiki.mjs add-citation sources/<slug> sources/<cited-slug>
```

Do not create stubs for cited sources not yet ingested — note them in `## Open Questions`.

### Phase 7 — Update wiki/index.md

Add the new source page (and any new concept/person pages) to the catalog between `<!-- lumina:index -->` markers. Format: `- [[sources/<slug>]] — <one-line description>`.

## Draft Gate

Present a draft summary to the user:
- Source slug, type, provenance
- Pages written / updated (counts: 1 source, N concepts, M people)
- Edges added
- Citations added
- Index updated: yes/no
- A 3–5 line excerpt of `## Summary` and `## Key Claims` so the user can sanity-check the draft

**HALT and ask human:** `[A] Accept` | `[E] Edit (revise draft)` | `[Q] Quit (preserve work, exit)`

- **A**: Mark gate accepted. Write `ingest_status: drafted` via `set-meta`:
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status drafted
  ```
  → NEXT
- **E**: Take the user's revision instructions. Re-edit the affected files (source page, stubs, or edges as instructed). Re-present the draft summary. Loop back to "HALT and ask human" — do not advance.
- **Q**: Leave the phase-level checkpoint in place; do not write `ingest_status`. **STOP — do not read the NEXT directive below.** Exit cleanly with no further action this run. The next `/lumi-ingest <slug>` invocation resumes from this point.

## NEXT

Read fully and follow `./step-02-lint.md`
