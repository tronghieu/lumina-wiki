# Step 4: Finalize

## RULES

- All frontmatter writes go through `wiki.mjs set-meta`.
- `wiki/log.md` is append-only. Use `wiki.mjs log` — never edit the file directly.
- The phase-level checkpoint at `_lumina/_state/ingest-<file-basename>.json` ends here; mark it `phase: "done"`.

## Why this step exists

Finalize is where the entry transitions from "in-progress workspace artifact" to "part of the wiki". This step runs automatically after the draft has been accepted and any source-check issues have been handled. It keeps the log entry timestamp aligned with the moment the entry actually becomes part of the wiki.

There is no human gate here. This step just records completion.

## INSTRUCTIONS

### Phase 9 — Log

```bash
node _lumina/scripts/wiki.mjs log ingest "Added \"<title>\" → <N> pages touched"
```

`<N>` counts the source page plus every concept/person stub that was created or appended to.

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

## Definition of Done

Before reporting done, verify:

- `node _lumina/scripts/lint.mjs --json` → `summary.errors === 0`
- `wiki/log.md` has a new `## [YYYY-MM-DD] ingest | ...` entry
- Frontmatter has `ingest_status: finalized`
- Re-running `/lumi-ingest <slug>` on the finalized entry triggers the "already finalized; restart?" guard, not a fresh ingest

## Idempotency check

Running `/lumi-ingest` again with the same source file on a finalized entry must produce a byte-identical `wiki/` (all `add-edge` calls are no-ops; stubs already exist; index entry already present) — except for `updated:` timestamps, which advance only on real changes.
