# Step 1: Draft

## RULES

- Read `README.md` at the project root before this step. Bidirectional-link discipline applies to every edge you write.
- Never modify files in `raw/`. Read-only.
- Never hand-edit `wiki/graph/edges.jsonl` or `wiki/graph/citations.jsonl`; use `wiki.mjs add-edge` and `wiki.mjs add-citation`.
- Never overwrite an existing wiki page without user confirmation.
- Frontmatter discipline, two cases: (a) **initial creation** of a page that does not exist yet — Write the whole file (frontmatter + body) in one shot from the template; (b) **any change to an existing page's frontmatter** — always `wiki.mjs set-meta`, never Write/Edit on the frontmatter block. Body text of an existing page may be edited with Write/Edit; the frontmatter block may not.
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

Fallback: if the checkpoint does not exist (research pack not installed, or no discover run yet) or no shortlist entry matches the title, do not guess. Ask the user for a URL or identifier (arxiv ID / DOI), then fall through to Mode B with their answer.

### Phase 1 — Detect type

If the source is a PDF or too large to read comfortably in one pass, follow `pdf-preprocessing.md` **before reading anything** — on runtimes without native PDF reading, a direct Read of the binary fails here, not in Phase 3.

Read first ~200 lines of the source (or of the extracted text). Classify:
- "Abstract", "Introduction", "References" → `paper`
- Chapter structure → `book`
- Web byline + publication → `article`
- Speaker turns / transcript → `podcast`
- Else → `note`

**Long-source check.** Size the document (`extract_pdf.py --info` for PDFs;
estimate from file size/word count otherwise). If it is 50+ pages or ~50k+
tokens, read fully and follow `./long-source.md` — it wraps Phase 3 in a
multi-pass reading pipeline (structure map → per-unit notes under
`wiki/readings/` → synthesis from notes) and then hands control back to
Phase 4. Do not attempt a single-pass summary of a source that size.

Write checkpoint: `phase: "detect"`.

### Phase 2 — Generate slug

**Identifier dedup comes first.** If any external identifier is known at this point (DOI / arxiv ID / S2 ID — from Mode B resolution or parsed from the input URL), check for an existing source page carrying the same identifier BEFORE generating a slug — title variants produce different slugs, so slug comparison alone misses duplicates. See `dedup-policy.md` § Identifier Dedup. On a hit, this run is a re-ingest of the matched slug: confirm with the user and skip new-page creation.

```bash
node _lumina/scripts/wiki.mjs slug "<Title>"
```

If `wiki/sources/<slug>.md` already exists: re-ingest — confirm with user before overwriting.

The phase checkpoint is keyed by file basename (`ingest-<file-basename>.json`)
because it is written before the slug exists. Now that the slug is known,
merge it into the checkpoint so later skills (e.g. `/lumi-migrate-legacy`) can
match a checkpoint to a wiki entry by reading its content instead of guessing
the filename:

```bash
# 1) Read current state
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename>
# 2) Merge {"phase":"slug","slug":"sources/<slug>","source_basename":"<file-basename>"}
#    into the JSON above (preserve all other fields).
# 3) Write back via stdin:
echo '<merged-json>' | node _lumina/scripts/wiki.mjs checkpoint-write ingest <file-basename>
```

Write checkpoint: `phase: "slug"` (already included in the merge above).

### Phase 3 — Write source page

For PDFs / large sources, the extraction from Phase 1 (`pdf-preprocessing.md`) applies here too — draft from the extracted text, section by section for long sources. If Phase 1 routed to `long-source.md`, this phase writes only the source-page skeleton; `## Summary` and `## Key Claims` are drafted from the reading notes in its Phase L3, never from the raw text in one pass.

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

`## Key Claims` — each claim ends with a locator pointing at where the source supports it: a section anchor, page, or heading, e.g. `(§3.2)`, `(p. 5)`, `(Table 1)`. The grounding check in step-03 reads these locators to find evidence; a claim without one forces the reviewer to re-read the whole raw file and weakens the check. If a claim synthesizes multiple places, list the primary locator.

`## Concepts` — be selective, not exhaustive. A term earns a concept link only if (a) it is central to this source's contribution, or (b) it is likely to recur across other sources in this wiki. Aim for roughly 3–7 concepts per source; minor keywords belong in body prose, not as concept links. Every linked concept implies a stub + edges in Phases 4–5, so over-extraction dilutes the graph.

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

Apply `dedup-policy.md` before creating/updating stubs — including the concept variant scan (acronym vs expansion, singular vs plural), which catches duplicates that exact-slug lookup misses. Existing pages are updated conservatively.

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

`add-edge` refuses `cites`/`cited_by` (exit 2) — citations are not graph
edges; use `add-citation` in Phase 6 instead.

Write checkpoint: `phase: "edges"`.

### Phase 6 — Citations

For every cited work whose wiki slug you already know (it is already ingested and you can name its page):

```bash
node _lumina/scripts/wiki.mjs add-citation sources/<slug> sources/<cited-slug>
```

For every other cited work — one this source explicitly cites but whose slug you don't already have — check whether it carries an identifier (DOI, arXiv ID, S2 ID, OpenAlex ID, or a canonical URL). If it does:

```bash
node _lumina/scripts/wiki.mjs add-citation-by-id sources/<slug> <ns> <value> [--title "<title>"]
```

`<ns>` is one of `doi`, `arxiv`, `s2`, `openalex`, `url`. This links immediately (`{"resolved":true,"to":"sources/<slug>"}`) when the cited work is already in the wiki; otherwise it records the citation as pending on this page (`{"resolved":false,"pending":true}`) and it becomes a real citation edge automatically when that work is ingested later (see `step-04-finalize.md` Phase 8.7).

Only a cited work with no identifier at all goes to `## Open Questions` as prose.

Do not create stub pages for cited works not yet ingested, identified or not.

Write checkpoint: `phase: "citations"`.

### Phase 7 — Update wiki/index.md

Add the new source page (and any new concept/person pages) to the catalog between `<!-- lumina:index -->` markers. Format: `- [[sources/<slug>]] — <one-line description>`.

Write checkpoint: `phase: "index"`.

### Phase 7.5 — Topic candidates

Only when `wiki/topics/` exists (research pack installed and at least one topic created). Skip this phase entirely otherwise — leave the checkpoint's `topics` field absent.

For every concept this source was linked to in Phase 5, find which topics already cover it:

```bash
node _lumina/scripts/wiki.mjs read-edges concepts/<concept> --type covered_by_topic --direction outbound
```

`to` is a canonical path (e.g. `topics/<name>`) — store it, and every other value read from `read-edges`, `key_sources`, or this checkpoint, unchanged everywhere downstream; never prepend `topics/`, `sources/`, or `concepts/` to a value that already has it. Across all linked concepts, collect the distinct topic paths from `to`, and for each one, which concept(s) led to it. Merge into the checkpoint:

```json
{"topics": [{"path": "topics/<name>", "via": ["concepts/<concept-slug>", "..."]}]}
```

Write checkpoint: `phase: "topics"`.

## Draft Gate

Present a draft summary to the user:
- Source slug, type, provenance
- Pages written / updated (counts: 1 source, N concepts, M people; long sources: K reading notes under `wiki/readings/<slug>/`)
- Edges added
- Citations added
- Index updated: yes/no
- Topics touched: `<topic-title> (via <concept>, <concept>)`, one entry per topic from Phase 7.5 — read the title via `read-meta <path>` on each entry's `path`; if that fails, show the name after `topics/` instead. Or `Topics touched: none` if the list is empty or the phase was skipped. Mention in one sentence that accepting the draft also confirms this source's membership in the topics listed.
- A 3–5 line excerpt of `## Summary` and `## Key Claims` so the user can sanity-check the draft

Use the user's configured communication language. Explain "provenance", "edges", "citations", and "index" in plain language, or hide the labels and show the outcome instead.

**HALT and ask human:** `[A] Accept` | `[E] Edit (revise draft)` | `[Q] Quit (preserve work, exit)`

- **A**: Mark gate accepted. Write `ingest_status: drafted` via `set-meta`:
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status drafted
  ```
  → NEXT
- **E**: Take the user's revision instructions. Re-edit the affected files (source page, stubs, or edges as instructed). If the revision added or removed any concept edge, re-run Phase 7.5 before re-presenting the draft summary, so "Topics touched" and the checkpoint match the final edges. Re-present the draft summary. Loop back to "HALT and ask human" — do not advance.
- **Q**: Leave the phase-level checkpoint in place; do not write `ingest_status`. Before exiting, tell the user in plain language that the draft pages and links written so far stay in the wiki as work-in-progress — coming back to `/lumi-ingest <slug>` continues from here, and `/lumi-reset` can clean up if they decide not to keep this source at all. **STOP — do not read the NEXT directive below.** Exit cleanly with no further action this run.

## NEXT

Read fully and follow `./step-02-lint.md`
