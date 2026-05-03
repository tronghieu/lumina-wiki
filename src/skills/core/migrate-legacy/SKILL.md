---
name: lumi-migrate-legacy
description: >
  Backfill missing schema fields (provenance, confidence) on legacy wiki entries
  after a Lumina version upgrade. Use proactively when /lumi-check reports
  L01/L11 findings on multiple entries, when manifest shows
  legacyMigrationNeeded:true, or when user mentions "lint do", "upgrade",
  "missing provenance", or "schema gap" after running install.
allowed-tools:
  - Bash
  - Read
---

# /lumi-migrate-legacy

Read `README.md` at the project root before this SKILL.md.

## Role

You are the wiki's schema migration agent. After a Lumina version bump that
introduces new required or optional frontmatter fields, existing entries may
be missing those fields. Your job is to read the CHANGELOG, find the exact
fields each version introduced, and backfill them with *inferred* values —
not blind defaults. Every field you set should reflect what you actually know
about the entry.

This skill is **CHANGELOG-driven**, not hardcoded to any specific field set.
The CHANGELOG's `### Migration` sections are the authoritative source of truth
for what needs backfilling. This means the skill works for v0.8, v0.9, and
future versions without modification, as long as the CHANGELOG is maintained.

## Context

Key workspace paths:
- `_lumina/manifest.json` — `packageVersion`, `legacyMigrationNeeded`
- `_lumina/CHANGELOG.md` — `### Migration` sections per version (the spec)
- `_lumina/scripts/lint.mjs` — runs checks; L01 = missing required field
  (error), L11 = missing `confidence` (warning)
- `_lumina/scripts/wiki.mjs` — `read-meta`, `set-meta`, `list-entities`, `log`
- `wiki/graph/edges.jsonl` — citation/edge counts for confidence inference
- `raw/` — source snapshots for provenance inference

## Instructions

### Phase 1 — Detect

**Step 1.1 — Read manifest.**

```bash
node -e "const m=JSON.parse(require('fs').readFileSync('_lumina/manifest.json','utf8')); console.log(JSON.stringify({packageVersion:m.packageVersion,legacyMigrationNeeded:m.legacyMigrationNeeded},null,2))"
```

Note `packageVersion` and `legacyMigrationNeeded`. If `legacyMigrationNeeded`
is `false` or absent, migration may still be needed — the flag is advisory.
Proceed to the lint check regardless.

**Step 1.2 — Run lint (read-only pass).**

First, get aggregate counts (tiny output, always safe):

```bash
node _lumina/scripts/lint.mjs --summary
```

If `errors === 0` and `by_check.L11` is `0` or absent, skip to the clean-exit
branch below. Otherwise, you need the per-entry findings.

**Important — do NOT pipe `--json` straight into a heredoc.** On a large wiki
the full findings JSON can exceed the shell tool's ~30KB stdout buffer and get
truncated mid-string, breaking JSON.parse. Instead, write it to a temp file
and read filtered slices:

```bash
node _lumina/scripts/lint.mjs --json > /tmp/lumi-lint.json
node -e "
const j=JSON.parse(require('fs').readFileSync('/tmp/lumi-lint.json','utf8'));
const want=new Set(['L01-frontmatter-required','L11-confidence-missing']);
const hits=j.findings.filter(f=>want.has(f.id))
  .map(f=>({id:f.id,file:f.file,message:f.message}));
console.log(JSON.stringify(hits,null,2));
"
```

The projected output (id + file + message only) is bounded and parseable. If
even that exceeds buffer (very large wikis), read `/tmp/lumi-lint.json` with
the Read tool instead — Read paginates, Bash stdout does not.

Collect:
- All `L01-frontmatter-required` findings (severity: error) — entries with
  missing required fields.
- All `L11-confidence-missing` findings (severity: warning) — entries missing
  the optional-but-recommended `confidence` field.

If `summary.errors === 0` and there are no L11 warnings relevant to migration:

```
No migration work needed. Lint is clean.
```

Log and exit:
```bash
node _lumina/scripts/wiki.mjs log migrate-legacy "No migration needed — lint clean."
```

**Step 1.3 — Read CHANGELOG migration notes.**

```bash
cat _lumina/CHANGELOG.md
```

Locate every `### Migration` section in versions **between the oldest affected
entry's install version and the current `packageVersion`**. These sections
describe exactly which fields were added and for which entity types. Read them
carefully — they are the specification for what you will backfill.

If no `### Migration` section exists but L01/L11 findings are present, the
fields are listed in the findings themselves (the `message` field names them).
Use the finding messages as the migration spec.

**Step 1.4 — Build work list.**

Produce a table of all affected slugs, which field is missing, and what entity
type they are. Group by field for efficient processing:

```
Field: provenance (required, sources)
  - sources/attention-is-all-you-need
  - sources/lora-2021

Field: confidence (optional, sources + concepts)
  - sources/attention-is-all-you-need
  - concepts/softmax-temperature
```

Always report this plan to the user before proceeding. For work lists of **30
or fewer entries**, continue without waiting for confirmation — small batches
are routine and the operation is safe to re-run. For **more than 30 entries**,
stop and ask the user to confirm before any writes. A large batch usually
means a long-dormant wiki or a major schema bump, and the user should have a
chance to spot-check the inference table before bulk changes land.

The safety net beneath this threshold:

- `set-meta` is atomic and idempotent — rerunning with a corrected value is
  a single command, no rollback needed.
- The inference rubric falls back to `unverified` when evidence is ambiguous,
  so wrong values err toward "honest about uncertainty," not overconfidence.
- Phase 4 re-runs lint and surfaces any remaining issues before clearing the
  manifest flag.

### Phase 2 — Plan

For each affected slug, determine the correct inferred value before writing
anything. Do not set any values yet — this phase is read-only.

**For each slug, run:**

```bash
node _lumina/scripts/wiki.mjs read-meta <slug>
```

This returns the current frontmatter as JSON. Read it to understand the entry's
existing fields (url, authors, year, type, etc.).

**For `sources` entries also check:**

1. Whether a raw snapshot exists:
   ```bash
   ls raw/sources/<slug>* 2>/dev/null || echo "no snapshot"
   ls raw/discovered/<slug>* 2>/dev/null || echo "no snapshot"
   ```

2. Inbound citation/edge count (how many other entries link to this one):
   ```bash
   grep -c '"target":"sources/<slug>"' wiki/graph/edges.jsonl 2>/dev/null || echo 0
   grep -c '"target":"sources/<slug>"' wiki/graph/citations.jsonl 2>/dev/null || echo 0
   ```

**Inference rubrics — apply these to decide values:**

#### provenance (required on `sources`)

Pick the one that matches what you can verify:

- `replayable` — A `url` field is present AND a raw snapshot exists under
  `raw/sources/` or `raw/discovered/`. The source can be re-verified end-to-end.
- `partial` — A `url` field is present but no raw snapshot was saved. Drift
  detection works against the URL, but the full text cannot be re-grounded.
- `missing` — No `url` field and no raw snapshot. Manual entry; verification
  has nothing to grip on.

#### confidence (optional-but-recommended on `sources` and `concepts`)

Pick based on inbound evidence signals:

- `high` — Cited by 3 or more other entries (inbound edges + citations), OR
  the entry has multiple independent summaries or cross-references. Well-verified.
- `medium` — Cited by 1-2 other entries. Some corroboration exists.
- `low` — No inbound edges, unverified claims, or content was hand-entered with
  no cross-checks. Use this when you have reason to doubt accuracy.
- `unverified` — Default for legacy entries with no signal. Use this when you
  cannot determine a better value from the available evidence. This is the safe
  fallback — it is more honest than `low` when the issue is lack of evidence
  rather than evidence of unreliability.

Do not guess. If evidence is ambiguous, choose `unverified` over a higher value.
Bumping confidence up is easier than correcting overconfident legacy data.

**For future fields** not listed above: read the `### Migration` section in
CHANGELOG carefully. It will specify the field, its allowed values, and how to
infer the right value. Apply the same pattern: read available evidence, apply
the rubric, choose conservatively when uncertain.

After the read phase, produce an inference table:

```
sources/attention-is-all-you-need:
  provenance: replayable  (url present, raw/sources/attention-is-all-you-need.pdf found)
  confidence: high        (7 inbound citations)

sources/lora-2021:
  provenance: partial     (url present, no raw snapshot)
  confidence: unverified  (0 inbound edges, no cross-checks)

concepts/softmax-temperature:
  confidence: medium      (2 inbound edges)
```

### Phase 3 — Backfill

For each entry in the inference table, set each missing field:

```bash
node _lumina/scripts/wiki.mjs set-meta <slug> <key> "<value>"
```

Examples:
```bash
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need provenance replayable
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need confidence high
node _lumina/scripts/wiki.mjs set-meta sources/lora-2021 provenance partial
node _lumina/scripts/wiki.mjs set-meta sources/lora-2021 confidence unverified
node _lumina/scripts/wiki.mjs set-meta concepts/softmax-temperature confidence medium
```

`set-meta` is atomic (temp + fsync + rename) and idempotent — calling it twice
with the same value is a no-op. It is safe to re-run this phase.

After backfilling all entries, proceed immediately to Phase 4.

### Phase 4 — Verify

**Step 4.1 — Re-run lint.**

```bash
node _lumina/scripts/lint.mjs --summary
```

Confirm `errors === 0`. If you need to inspect remaining findings, re-run with
`--json > /tmp/lumi-lint.json` and project as in Step 1.2 — never parse full
`--json` from inline stdout on a large wiki. L11 warnings for
entries you set `confidence` on should also be gone.

If any L01 errors remain:
- Read the finding message — it names the exact field still missing.
- Return to Phase 2 and infer a value for that field.
- Apply via `set-meta` and re-run lint.
- Do not loop more than 3 times — if errors persist after 3 attempts, surface
  them to the user with the exact finding messages.

**Step 4.2 — Clear the manifest flag.**

```bash
node -e "
const fs = require('fs');
const path = '_lumina/manifest.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
m.legacyMigrationNeeded = false;
const tmp = path + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, path);
console.log('legacyMigrationNeeded cleared');
"
```

Only run this step if all L01 errors are resolved.

**Step 4.3 — Log the migration.**

```bash
node _lumina/scripts/wiki.mjs log migrate-legacy "Backfilled <N> entries: <field-list>. Lint: 0 errors."
```

Replace `<N>` with the count of entries updated and `<field-list>` with the
field names backfilled (e.g., `provenance, confidence`).

## Output Format

Report to the user:

1. Migration spec source — which CHANGELOG versions / finding messages drove
   the work list.
2. Entries updated — count and slugs grouped by field.
3. Inferred values — the inference table from Phase 2 (so the user can review).
4. Lint result after backfill — must show 0 errors.
5. Whether `legacyMigrationNeeded` was cleared in the manifest.

## Examples

<example>
User: "/lumi-migrate-legacy"

Clean wiki — no migration needed:
```bash
node _lumina/scripts/lint.mjs --json
# → { "summary": { "errors": 0, "warnings": 0 } }
```
Report: "No migration needed — lint is clean. Nothing changed."
Log entry written. Done.
</example>

<example>
User: "/lumi-migrate-legacy" (after upgrading to a version that added provenance)

Normal migration path:
```bash
node _lumina/scripts/lint.mjs --json
# → 4 L01 errors: sources/* missing provenance

# Phase 2 — for each source:
node _lumina/scripts/wiki.mjs read-meta sources/attention-is-all-you-need
# → { url: "https://arxiv.org/abs/1706.03762", ... }
ls raw/sources/attention-is-all-you-need*
# → raw/sources/attention-is-all-you-need.pdf (found)
# → infer: provenance = replayable

# Phase 3:
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need provenance replayable
# ... repeat for all 4 entries ...

# Phase 4:
node _lumina/scripts/lint.mjs --json
# → { "summary": { "errors": 0, "warnings": 2 } }  -- L11 warnings remain (advisory only)
# Clear manifest flag, write log.
```
Report: "4 entries backfilled (provenance). Lint: 0 errors, 2 advisory warnings."
</example>

<example>
User: "/lumi-migrate-legacy" (re-run on already-migrated wiki)

Idempotency — all fields already present:
```bash
node _lumina/scripts/lint.mjs --json
# → 0 L01 errors, 0 L11 warnings
```
Report: "No migration needed — lint is clean. Nothing changed."
Re-running this skill on a clean wiki produces zero file changes.
</example>

## Guardrails

- Never write a value you cannot infer from available evidence. When in doubt,
  use `unverified` (for confidence) or read the CHANGELOG rubric for the field.
- Never modify files in `raw/`. Read-only.
- Never hand-edit `wiki/graph/edges.jsonl` or `wiki/graph/citations.jsonl`.
- `set-meta` is the only permitted write path for frontmatter changes in this
  skill. Do not use Edit or Write on wiki pages directly.
- Do not clear `legacyMigrationNeeded` until lint confirms 0 errors.
- If the CHANGELOG has no `### Migration` section for the detected version gap,
  rely entirely on the L01/L11 finding messages to identify which fields need
  backfilling. Do not fabricate a migration spec.

## Definition of Done

Before reporting done, verify:

(a) `node _lumina/scripts/lint.mjs --json` shows `summary.errors === 0`
(b) `wiki/log.md` has a new `## [YYYY-MM-DD] migrate-legacy | ...` entry
(c) `_lumina/manifest.json` has `legacyMigrationNeeded: false`
(d) Running `/lumi-migrate-legacy` again immediately produces zero file changes

## Next step

Tell the user to run `/lumi-check` in a fresh session to confirm the wiki state
from a blank-context perspective. Same model, blank context catches any
inference bias from the migration session that just ran.
