# Step 4: Finalize

## RULES

- All frontmatter writes go through `wiki.mjs set-meta`.
- `wiki/log.md` is append-only. Use `wiki.mjs log` — never edit the file directly.
- The phase-level checkpoint at `_lumina/_state/ingest-<slug>.json` ends here; mark it `phase: "done"`.

## Why this step exists

Finalize is where the entry transitions from "in-progress workspace artifact" to "part of the wiki". A separate step (rather than auto-running after verify accepts) gives the user one last off-ramp without losing the verify decision they already made — and it keeps the log entry timestamp aligned with the moment the user actually committed the entry to the wiki.

There is no human gate here — the verify-gate accept already constituted the human commitment. This step just records it.

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
1. Source slug + type
2. Pages written or updated (counts)
3. Edges written
4. Lint result (errors === 0)
5. Verify verdict (`passed` / `findings_pending` / `skipped`)
6. Log entry written
7. Suggest next step: `/lumi-check` in a fresh session for an independent structural review, or `/lumi-verify --external <slug>` for adversarial open-web verification.

## Definition of Done

Before reporting done, verify:

- `node _lumina/scripts/lint.mjs --json` → `summary.errors === 0`
- `wiki/log.md` has a new `## [YYYY-MM-DD] ingest | ...` entry
- Frontmatter has `ingest_status: finalized`
- Re-running `/lumi-ingest <slug>` on the finalized entry triggers the "already finalized; restart?" guard, not a fresh ingest

## Idempotency check

Running `/lumi-ingest` again with the same source file on a finalized entry must produce a byte-identical `wiki/` (all `add-edge` calls are no-ops; stubs already exist; index entry already present) — except for `updated:` timestamps, which advance only on real changes.
