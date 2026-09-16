# Step 4: Finalize

## RULES

- All frontmatter writes go through `wiki.mjs set-meta`.
- `wiki/log.md` is append-only. Use `wiki.mjs log` — never edit the file directly.
- The phase-level checkpoint at `_lumina/_state/ingest-<file-basename>.json` ends here; mark it `phase: "done"`.

## Why this step exists

Finalize is where the entry transitions from "in-progress workspace artifact" to "part of the wiki". This step runs automatically after the draft has been accepted and any source-check issues have been handled. It keeps the log entry timestamp aligned with the moment the entry actually becomes part of the wiki.

There is no human gate here. This step just records completion.

## INSTRUCTIONS

### Phase 8.7 — Retro-link and topic timeline

Read the phase-level checkpoint for the `topics` list written in `step-01-draft.md` Phase 7.5:

```bash
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename>
```

**Retro-link.** Older pages may have cited this source by identifier before it existed in the wiki. Resolve them now:

```bash
node _lumina/scripts/wiki.mjs resolve-pending-citations sources/<slug>
```

Read `resolved` from stdout — one entry per older page that cited this work before it was ingested. Count the entries as `<R>` for the Phase 9 log line and the Phase 10 report.

**Topic timeline.** Only when the checkpoint's `topics` array is present and non-empty (research pack; otherwise skip the rest of this phase). For each `{path, via}` entry, `path` and the checkpoint's own `slug` field (written in step-01-draft.md Phase 2) are already canonical (`topics/<name>`, `sources/<slug>`) — pass both unchanged, never prepend `topics/` or `sources/` to them:

```bash
node _lumina/scripts/wiki.mjs timeline-add <path> --kind ingest --source <slug> --text "<one sentence, in English, stating this source's main claim as it bears on the topic>"
```

The `--text` is always English regardless of the configured document language — one sentence, no trailing period needed. If the sentence begins with `--`, pass it as `--text="<text>"` so it is not read as another flag. Never edit an existing timeline line. Count the topics touched as `<T>` for the Phase 9 log line and the Phase 10 report.

### Phase 9 — Log

```bash
node _lumina/scripts/wiki.mjs log ingest "Added \"<title>\" → <N> pages touched"
```

`<N>` counts the source page plus every concept/person stub that was created or appended to. If Phase 8.7 found earlier citations to link or topic timelines to update, append to the same log line: ` | <R> earlier citations linked | <T> topic timelines updated` — include only the clauses whose count is non-zero.

### Phase 9.5 — Final state writes

Write the final phase-level checkpoint. `checkpoint-write` reads the new state from stdin (or a JSON file passed as `<json-file>` positional). Read the current checkpoint, merge `phase: "done"` into it, and write back:

```bash
# 1) Read current state
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename>
# 2) Merge {"phase":"done"} into the JSON above (preserve all other fields).
# 3) Write back via stdin:
echo '<merged-json>' | node _lumina/scripts/wiki.mjs checkpoint-write ingest <file-basename>
```

If you have access to `jq`, this is a one-liner:
```bash
node _lumina/scripts/wiki.mjs checkpoint-read ingest <file-basename> | jq '. + {phase:"done"}' | node _lumina/scripts/wiki.mjs checkpoint-write ingest <file-basename>
```

Then write the gate-level state:
```bash
node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status finalized
```

### Phase 10 — Report

Tell the user:
1. The new page name and source type
2. Pages written or updated (counts)
3. Connections added between pages
4. Whether page links are clean
5. Whether the page matched the source, had review notes, or was saved without a source check
6. Log entry written
7. Optional next step in plain language: run `/lumi-check` later to check wiki health, or `/lumi-verify --external <slug>` if the user wants a deeper outside-source comparison.
8. If Phase 8.7 resolved any pending citations: how many earlier pages now link to this one, in plain language (e.g. "2 earlier pages that cited this work now link to it").
9. If Phase 8.7 updated any topic timelines: which topics grew, and that running `/lumi-research-topic <name>` refresh will fold this new source into that topic's summary — `<name>` is the topic's `path` with the `topics/` prefix stripped for display, not the canonical value itself.

## Definition of Done

Before reporting done, verify:

- `node _lumina/scripts/lint.mjs --json` → `summary.errors === 0`
- `wiki/log.md` has a new `## [YYYY-MM-DD] ingest | ...` entry
- Frontmatter has `ingest_status: finalized`
- Re-running `/lumi-ingest <slug>` on the finalized entry triggers the "already finalized; restart?" guard, not a fresh ingest
- Every topic in the checkpoint's `topics` array has the new timeline line — re-running `timeline-add` for it returns `added:false`

## Idempotency check

Running `/lumi-ingest` again with the same source file on a finalized entry must produce a byte-identical `wiki/` (all `add-edge` calls are no-ops; stubs already exist; index entry already present) — except for `updated:` timestamps, which advance only on real changes. `resolve-pending-citations` is likewise a no-op on re-run: no pending citations remain to resolve (`resolved:[]`). An `ingest` timeline entry is deduplicated by source — the engine keys it on (topic, source), so a resumed or repeated finalize never adds a second line for the same source, regardless of date or text differences (`added:false`). `correction` and `note` entries have no source key and dedupe on the exact line only.
