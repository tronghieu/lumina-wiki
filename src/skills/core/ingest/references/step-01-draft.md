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
- This is the only required user pause in the happy path. After the user accepts the draft, later steps continue automatically unless they find something that needs judgment.

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

**Mode B — URL or identifier** (arxiv ID like `2604.03501v2`, arxiv URL, DOI, OpenAlex Work ID, S2 paper ID, generic URL)

Pick the right tool based on whether the input is a *bare identifier* (no `://`) or a *direct URL*:

```bash
# Bare identifier (DOI, arxiv ID, openalex W-id) — runs the metadata anchor +
# multi-provider PDF ladder. Cross-walks identifiers and records every provider
# attempt in `sources[]`.
python3 _lumina/tools/resolve_pdf.py "<identifier>"

# Direct URL — single-shot download, no metadata cross-walk.
python3 _lumina/tools/fetch_pdf.py "<url>"
```

- For bare arxiv ID: prefer `resolve_pdf.py 2604.03501` (runs OpenAlex anchor so DOI is cross-walked).
- For DOI: prefer `resolve_pdf.py 10.x/y` (try OpenAlex → Unpaywall → CORE → arxiv ladder).
- For a URL that already points at a PDF: use `fetch_pdf.py`.

`resolve_pdf.py` exit 0 outputs `{external_ids, sources, pdf_path, status}`:
- `status: "ok"` → PDF downloaded; `pdf_path` is the relative path under `raw/download/`.
- `status: "metadata_only"` → metadata cross-walk succeeded but no OA copy. Source page is still draftable with `provenance: partial`. Ask the user whether to attach a manually-downloaded PDF.
- `status: "failed"` → exit 3; metadata anchor itself failed (network or OpenAlex 5xx). Retry once; if still failing, surface the error.

`fetch_pdf.py` exit codes (URL mode):
- 0: PDF downloaded. Read JSON `path` as `source_path`.
- 2: HTML response or SSRF guard rejection. Report and ask for a different URL.
- 3: network error. Retry once.

Write the input identifier/URL as the first entry of `urls` on the source page; persist the full `sources[]` array returned by `resolve_pdf.py` into the source page's `sources` frontmatter (it already records every provider attempt + ns/value pairs).

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

Draft `wiki/sources/<slug>.md` from `_lumina/schema/page-templates.md` Source template. Required frontmatter: `id`, `title`, `type`, `created`, `updated`, `authors`, `year`, `importance`, `provenance`. Optional but encouraged: `urls`, `raw_paths`, `confidence`, `external_ids`.

After writing `urls`, populate `external_ids` from the canonical URL using the `parse-ids.mjs` wrapper (this avoids shell-injection from `node -e` interpolation):

```bash
ids_json=$(node _lumina/scripts/parse-ids.mjs "<canonical-url>")
node _lumina/scripts/wiki.mjs set-meta sources/<slug> external_ids "$ids_json" --json-value
```

`parse-ids.mjs` returns `{}` (empty JSON) for non-URL inputs and exits 2 on missing argument; either skip or leave the field unset in those cases. `set-meta` runs `sanitizeExternalIdsObject` automatically — only the four allowed namespaces (`doi`/`arxiv`/`s2`/`url`) are persisted.

Then record provenance for this fetch by appending one entry to `sources` (do this every time the page is (re-)drafted from a fetcher run):

```bash
entry=$(node _lumina/scripts/build-source.mjs <provider> "<canonical-url>")
node _lumina/scripts/wiki.mjs set-meta sources/<slug> sources "[$entry]" --json-value
```

`<provider>` is the fetcher slug used in this run: `arxiv`, `s2`, `pdf`, `wikipedia`. Omit `<canonical-url>` if there isn't one (Mode A — local file). On re-ingest of an existing page, read existing `sources` first and append the new entry; do not replace.

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

Use the user's configured communication language. Explain "provenance", "edges", "citations", and "index" in plain language, or hide the labels and show the outcome instead.

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
