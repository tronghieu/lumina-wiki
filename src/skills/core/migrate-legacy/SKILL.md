---
name: lumi-migrate-legacy
description: >
  Backfill missing schema fields (provenance, confidence) and resolve
  judgment-only lint findings (L01/L02 fields lint.mjs --fix could not safely
  infer, ambiguous L05 wikilinks) on legacy wiki entries after a Lumina
  version upgrade. Use proactively when /lumi-check reports L01/L02/L05/L11
  findings on multiple entries after a --fix pass, when manifest shows
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
about the entry. You also pick up wherever `lint.mjs --fix` had to stop:
`number`/`enum` frontmatter fields it couldn't safely default, and ambiguous
wikilinks it wouldn't guess at. Always let `--fix` run first — you spend your
reasoning only on what deterministic repair genuinely could not resolve.

This skill is **CHANGELOG-driven**, not hardcoded to any specific field set.
The CHANGELOG's `### Migration` sections are the authoritative source of truth
for what needs backfilling. This means the skill works for v0.8, v0.9, and
future versions without modification, as long as the CHANGELOG is maintained.

## Context

Key workspace paths:
- `_lumina/manifest.json` — `packageVersion`, `legacyMigrationNeeded`
- `_lumina/CHANGELOG.md` — `### Migration` sections per version (the spec)
- `_lumina/scripts/lint.mjs` — runs checks; `--fix` repairs L01/L02/L03/L05/
  L06/L07/L09/L19 wherever it safely can; L01 = missing required field (error),
  L02 = wrong frontmatter type (error), L05 = broken wikilink (error), L11 =
  missing `confidence` (warning) — this skill only ever sees the L01/L02/L05
  findings that `--fix` left standing, plus every L11; `--suggest` adds a
  `suggestion` string to each finding whose `fixable` is `false` (an L05
  finding also carries a `candidates` array of matching pages)
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

**Step 1.2 — Run the deterministic fix pass first.**

`lint.mjs --fix` now repairs L01, L02, L03, L05, L06, L07, L09, and L19
automatically wherever it safely can. Run it before spending any inference
effort, so this skill only has to reason about what deterministic repair
genuinely could not resolve. It is idempotent — safe to run even if a
previous migration or `/lumi-check` already ran it.

```bash
node _lumina/scripts/lint.mjs --fix --json > /tmp/lumi-lint.json
```

**Important — do NOT pipe `--json` straight into a heredoc.** On a large wiki
the full findings JSON can exceed the shell tool's ~30KB stdout buffer and get
truncated mid-string, breaking JSON.parse. Read the temp file with a filtered
projection instead:

```bash
node -e "
const j=JSON.parse(require('fs').readFileSync('/tmp/lumi-lint.json','utf8'));
const want=new Set(['L01-frontmatter-required','L02-frontmatter-types','L05-broken-wikilink','L11-confidence-missing']);
const hits=j.findings.filter(f=>want.has(f.id) && !f.fix_applied)
  .map(f=>({id:f.id,file:f.file,message:f.message}));
console.log(JSON.stringify(hits,null,2));
"
```

`!f.fix_applied` is the key filter: it drops everything the fix pass already
resolved and keeps only the findings that survived — the ones needing
inference or a human decision. The projected output (id + file + message
only) is bounded and parseable. If even that exceeds buffer (very large
wikis), read `/tmp/lumi-lint.json` with the Read tool instead — Read
paginates, Bash stdout does not.

Collect:
- Surviving `L01-frontmatter-required` findings (severity: error) — a
  required field `--fix` recognized but left standing, almost always a
  `number` or `enum` field with no safe default (e.g. a source's `year` or
  `importance`).
- Surviving `L02-frontmatter-types` findings (severity: error) — same shape:
  a `number`/`enum` value that fails validation and that `--fix` cannot
  repair on its own.
- Surviving `L05-broken-wikilink` findings (severity: error) — a wikilink
  whose basename matched zero or more than one page, so `--fix` would not
  guess.
- All `L11-confidence-missing` findings (severity: warning) — entries missing
  the optional-but-recommended `confidence` field. `--fix` never touches L11;
  every instance survives.

If the projected list above is empty:

```
No migration work needed. Lint is clean (after auto-fix).
```

Log and exit:
```bash
node _lumina/scripts/wiki.mjs log migrate-legacy "No migration needed — lint clean after auto-fix."
```

**Step 1.3 — Read CHANGELOG migration notes.**

```bash
cat _lumina/CHANGELOG.md
```

Locate every `### Migration` section in versions **between the oldest affected
entry's install version and the current `packageVersion`**. These sections
describe exactly which fields were added and for which entity types. Read them
carefully — they are the specification for what you will backfill.

If no `### Migration` section exists but L01/L02/L05/L11 findings are present,
the fields are listed in the findings themselves (the `message` field names
them, and `node _lumina/scripts/lint.mjs --suggest --json` adds a `suggestion`
string to each one). Use the finding messages and suggestions as the
migration spec.

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

1. Inbound citation/edge count (how many other entries link to this one):
   ```bash
   grep -c '"target":"sources/<slug>"' wiki/graph/edges.jsonl 2>/dev/null || echo 0
   grep -c '"target":"sources/<slug>"' wiki/graph/citations.jsonl 2>/dev/null || echo 0
   ```

**Inference rubrics — apply these to decide values:**

#### provenance + raw_paths (required on `sources`)

Use the following inference order. Stop at the first tier that yields a result.

**Tier 1 (authoritative): read the ingest checkpoint.**

Ingest checkpoints are keyed by the source file's basename
(`_lumina/_state/ingest-<file-basename>.json`), not by slug — there is no
direct `<slug>` lookup. List every ingest checkpoint and match by content:

```bash
ls _lumina/_state/ingest-*.json 2>/dev/null
```

Read each match with the Read tool and check its `slug` field. Newer ingests
(post-checkpoint-slug-merge) store `"slug": "sources/<slug>"` directly in the
checkpoint — match the checkpoint whose `slug` equals the entry being
migrated. Older checkpoints predate this field and won't have it; if no
checkpoint's `slug` matches (including the case where none carry the field at
all), fall through to Tier 2.

If a matching checkpoint is found and has a `source_path` field:
- If `source_path` is under `raw/tmp/*`: do NOT write `raw_paths`. Tell the user:
  "`<slug>` was ingested from a transient location (`<source_path>`). Move the
  file to `raw/sources/` or `raw/download/<resource>/` and re-run
  `/lumi-migrate-legacy` to backfill `raw_paths` properly."
  Set `provenance` to `partial` (if `urls` is non-empty) or `missing` (no `urls`).
- Otherwise: set `raw_paths` to `[source_path]` and `provenance` to `replayable`.
  Skip Tiers 2 and 3.

**Tier 2 (heuristic): scan raw/ for matching files.**

- Slug-prefix match: `raw/sources/<slug>*`, `raw/notes/<slug>*`, or
  `raw/download/<resource>/<slug>*`
- URL-derived ID match: parse the page's `urls` array via
  `node _lumina/scripts/parse-ids.mjs "<url>"` (one URL per call). For each
  validated value in the JSON output (e.g. `arxiv`, `doi`, `s2`), use that
  literal string as the ID token to scan `raw/sources/`, `raw/notes/`, and
  `raw/download/**` for filenames containing it. **Do not** interpolate a raw
  URL or path-traversal-shaped value into a glob — `parse-ids.mjs` already
  rejected non-URL inputs and `wiki.mjs` re-validates via `safeIdToken` before
  any path concatenation. (Legacy `url` string still supported for back-compat.)
- Research-pack flow: also scan `raw/discovered/<topic>/<id>.json` for a JSON
  whose `id` or `url` matches any entry in the page's `urls` array.

All non-`raw/tmp/` matches go into `raw_paths`. Set `provenance` to `replayable`
if any match was found.

**Tier 3 (fall back to urls heuristic): no checkpoint, no file match.**

- Has at least one entry in `urls`, no raw match → `partial` (leave `raw_paths` unset or `[]`)
- Neither → `missing`

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

#### `number`/`enum` required fields left absent by `--fix` (surviving L01/L02)

`lint.mjs --fix` only ever writes a value it can derive safely. It never
guesses a `number` or `enum` field with no obvious default (a source's
`year`, `importance`), so a surviving L01/L02 finding on one of these fields
is squarely this skill's job. Use the following inference order per field;
stop at the first tier that yields a confident value.

**Tier 1 — confirm the finding is genuinely in this bucket.** Run
`node _lumina/scripts/lint.mjs --suggest --json` and read the matching
finding's `suggestion` field. For an L01/L02 `number`/`enum` finding this
string only restates the field name and expected type ("cannot be inferred —
provide a value manually") — it is not an inferred value, and never reads
`external_ids` or anything else on the page. Its job is to confirm you're
looking at the right finding before you spend Tier 2's reading effort; the
actual inference is entirely yours to do, starting at Tier 2.

**Tier 2 — read the page body and the raw source.** For `year`, check the
page body's citation or bibliography line, the `external_ids` block (a DOI or
arXiv ID often encodes or implies a publication year), and — if `raw_paths`
resolves to a real file — the source document itself (a PDF's title page or
metadata). For `importance` (1–5) or any project-specific enum, read how the
page talks about itself: how central the entry reads in its own summary, how
many other pages cite it, whether the CHANGELOG's `### Migration` section
gives explicit guidance for this field.

**Tier 3 — ask the user instead of guessing.** If Tiers 1–2 leave real
ambiguity (conflicting years across sources, an `importance` call that is
genuinely a judgment about the wiki owner's priorities, or an enum whose
options don't obviously fit the evidence), do not write a value. List the
slug, the field, and what you found under it in the report to the user and
ask them to pick — a `number`/`enum` field has no safe "unverified" fallback
the way `confidence` does, and `set-meta` will reject anything that doesn't
match the declared type anyway (exit 2, file unchanged), so a wrong guess
can't land silently even if you tried.

#### Ambiguous L05 wikilinks (ones `--fix` would not touch)

`--fix` only rewrites `[[basename]]` when exactly one page's basename
matches; every other broken wikilink is left standing on purpose. Run
`node _lumina/scripts/lint.mjs --suggest --json` and read the `candidates`
array attached to each surviving L05 finding (its `suggestion` field folds
the same list into one sentence, if you'd rather read that):

- **Zero candidates** — the target page genuinely doesn't exist yet. Suggest
  `/lumi-ingest` or `/lumi-edit` to create it, or ask the user whether the
  link should be removed instead. Do not invent a target.
- **One candidate that `--fix` still didn't rewrite** — this should be rare
  (it would mean `--fix` already handled it); if you see it, treat it as one
  candidate and resolve it the same way as below.
- **Multiple candidates** — read the linking page's surrounding paragraph and
  each candidate page's title/summary to judge which one the sentence
  actually means. Only pick when the context makes it unambiguous — e.g. the
  paragraph names a specific paper and only one candidate is a page about
  that paper. If two candidates are both plausible, do not guess: list them
  for the user with the sentence they appear in and ask which one is meant.

Resolve a wikilink by rewriting `[[old-target]]` to `[[full/slug]]` in the
page body with the Edit tool (this is a page-body edit, not a `set-meta`
call — wikilink targets live in prose, not frontmatter) and confirm with a
lint re-run that the specific L05 finding is gone.

**For future fields** not listed above: read the `### Migration` section in
CHANGELOG carefully. It will specify the field, its allowed values, and how to
infer the right value. Apply the same pattern: read available evidence, apply
the rubric, choose conservatively when uncertain.

After the read phase, produce an inference table:

```
sources/attention-is-all-you-need:
  raw_paths: ["raw/sources/attention-is-all-you-need.pdf"]  (Tier 1: checkpoint source_path)
  provenance: replayable  (raw_paths non-empty, file exists)
  confidence: high        (7 inbound citations)

sources/lora-2021:
  raw_paths: []           (Tier 3: url present, no file match)
  provenance: partial     (url present, no resolvable raw_paths)
  confidence: unverified  (0 inbound edges, no cross-checks)
  year: 2021              (L02 survivor; Tier 2: arXiv ID 2106.09685 → 2021)

concepts/softmax-temperature:
  confidence: medium      (2 inbound edges)

summary/transformers-overview.md:42 — [[flash-decoding]]:
  resolve to [[concepts/flash-decoding-v2]]  (--suggest: 1 real candidate after
  reading context; a second candidate, concepts/flash-decoding-draft, was
  ruled out — the paragraph names the shipped technique, not the draft note)
```

### Phase 3 — Backfill

For each entry in the inference table, set each missing field:

```bash
node _lumina/scripts/wiki.mjs set-meta <slug> <key> "<value>"
```

For `raw_paths` (an array field), pass a JSON array with `--json-value`:

```bash
node _lumina/scripts/wiki.mjs set-meta sources/<slug> raw_paths '["raw/sources/foo.pdf"]' --json-value
```

Examples:
```bash
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need raw_paths '["raw/sources/attention-is-all-you-need.pdf"]' --json-value
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need provenance replayable
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need confidence high
node _lumina/scripts/wiki.mjs set-meta sources/lora-2021 provenance partial
node _lumina/scripts/wiki.mjs set-meta sources/lora-2021 confidence unverified
node _lumina/scripts/wiki.mjs set-meta concepts/softmax-temperature confidence medium
```

`set-meta` is atomic (temp + fsync + rename) and idempotent — calling it twice
with the same value is a no-op. It is safe to re-run this phase.

**Schema-shape upgrade — `url` → `urls` (v0.9+):**

For every source page that has a top-level `url:` key (singular string) in frontmatter,
rewrite it as `urls:` (array) and remove the old key. Preserve placement — keep `urls`
where `url` was.

```bash
# Detect source pages that still have legacy url: (singular)
node _lumina/scripts/wiki.mjs list-entities | node -e "
const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
const ents=lines.map(l=>{ try{return JSON.parse(l);}catch{return null;} }).filter(Boolean);
ents.filter(e=>e.type==='sources').forEach(e=>console.log(e.slug));
" | while read slug; do
  node _lumina/scripts/wiki.mjs read-meta "$slug" | node -e "
const m=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(m.url && !m.urls) console.log(process.argv[1]);
" "$slug"
done
```

For each slug with a legacy `url:` field:

```bash
# Step 1 — read current url value
URL=$(node _lumina/scripts/wiki.mjs read-meta sources/<slug> | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).url)")

# Step 2 — write urls array
node _lumina/scripts/wiki.mjs set-meta sources/<slug> urls "[\"$URL\"]" --json-value
```

`set-meta` cannot remove a frontmatter key today — there is no `--remove`
flag. After confirming `urls:` was written successfully, remove the legacy
`url:` line with the `Edit` tool directly. This is the one sanctioned
exception to "never hand-edit wiki frontmatter" in this skill, and it is
limited strictly to deleting the obsolete `url:` key — do not use `Edit` for
any other frontmatter change.

After backfilling all entries, proceed immediately to Phase 4.

### Phase 3.5 — `--backfill-ids` (opt-in)

If the user invoked the skill with `--backfill-ids`, run the
`external_ids` backfill recipe documented in
`references/backfill-ids.md`. It is non-destructive (existing keys win) and
idempotent (no diff on second run). Mismatches between URL-derived values
and stored `external_ids` are intentionally left unchanged — lint check
**L16** surfaces them on the next `/lumi-check`. There is no `--dry-run`;
inspect the merge with `git diff wiki/sources/`.

Skip this phase entirely if `--backfill-ids` was NOT passed.

### Phase 4 — Verify

**Step 4.1 — Re-run lint.**

```bash
node _lumina/scripts/lint.mjs --summary
```

Confirm `errors === 0`. If you need to inspect remaining findings, re-run with
`--json > /tmp/lumi-lint.json` and project as in Step 1.2 — never parse full
`--json` from inline stdout on a large wiki. L11 warnings for
entries you set `confidence` on should also be gone.

Check for L12 warnings explicitly and surface them to the user:

```bash
node -e "
const j=JSON.parse(require('fs').readFileSync('/tmp/lumi-lint.json','utf8'));
const l12=j.findings.filter(f=>f.id==='L12-raw-paths-drift')
  .map(f=>({file:f.file,message:f.message}));
if(l12.length) console.log('L12 raw_paths drift:\n'+JSON.stringify(l12,null,2));
else console.log('No L12 warnings.');
"
```

L12 warnings mean one or more `raw_paths` entries point to files that do not
exist or are under `raw/tmp/`. Treat these as follow-up action items for the
user — the migration is not blocked, but the `raw_paths` value is inaccurate
until the referenced file is located or the entry is corrected.

If any L01, L02, or L05 errors remain:
- Read the finding message (and its `--suggest` suggestion, if any) — it
  names the exact field still missing/invalid, or the wikilink still broken.
- Return to Phase 2 and infer a value, or resolve the wikilink, for that
  finding.
- Apply via `set-meta` (frontmatter fields) or the Edit tool (wikilink
  targets in the body) and re-run lint.
- Do not loop more than 3 times — if errors persist after 3 attempts, surface
  them to the user with the exact finding messages. A field or wikilink that
  still can't be resolved after 3 attempts usually means Tier 3 applies:
  stop guessing and ask the user directly.

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
5. Whether the upgrade cleanup is finished.

## Examples

<example>
User: "/lumi-migrate-legacy"

Clean wiki — no migration needed:
```bash
node _lumina/scripts/lint.mjs --fix --json
# → { "summary": { "errors": 0, "warnings": 0 } }, nothing to fix or infer
```
Report: "No migration needed — lint is clean. Nothing changed."
Log entry written. Done.
</example>

<example>
User: "/lumi-migrate-legacy" (after upgrading to a version that added provenance,
plus a handful of legacy L02/L05 findings a previous, weaker --fix left behind)

Normal migration path:
```bash
node _lumina/scripts/lint.mjs --fix --json > /tmp/lumi-lint.json
# → --fix resolves the mechanical stuff on its own (kebab slugs, reverse
#   edges, most L02 array shapes, unambiguous wikilinks). What survives:
#   4 L01 errors: sources/* missing provenance (no safe default — required
#   on `sources`, not an array/date/id/type/title case --fix could derive)
#   1 L02 error: sources/lora-2021 "year" must be a number, got "2021" (a
#   quoted string in legacy frontmatter — --fix can't repair number values)

# Phase 2 — for each source:
node _lumina/scripts/wiki.mjs read-meta sources/attention-is-all-you-need
# → { urls: ["https://arxiv.org/abs/1706.03762"], ... }
ls raw/sources/attention-is-all-you-need*
# → raw/sources/attention-is-all-you-need.pdf (found)
# → infer: provenance = replayable
# sources/lora-2021 "year" — Tier 2: external_ids.arxiv is 2106.09685 → 2021

# Phase 3:
node _lumina/scripts/wiki.mjs set-meta sources/attention-is-all-you-need provenance replayable
node _lumina/scripts/wiki.mjs set-meta sources/lora-2021 year 2021 --json-value
# ... repeat for all remaining entries ...

# Phase 4:
node _lumina/scripts/lint.mjs --json
# → { "summary": { "errors": 0, "warnings": 2 } }  -- L11 warnings remain (advisory only)
# Clear manifest flag, write log.
```
Report: "5 entries backfilled (provenance, year). Lint: 0 errors, 2 advisory warnings."
</example>

<example>
User: "/lumi-migrate-legacy" (re-run on already-migrated wiki)

Idempotency — all fields already present:
```bash
node _lumina/scripts/lint.mjs --fix --json
# → 0 L01 errors, 0 L02 errors, 0 L05 errors, 0 L11 warnings
```
Report: "No migration needed — lint is clean. Nothing changed."
Re-running this skill on a clean wiki produces zero file changes.
</example>

## Guardrails

- Always run `lint.mjs --fix` before any inference (Step 1.2). Never spend a
  Phase 2 reasoning pass on a finding deterministic repair could have handled.
- Never write a value you cannot infer from available evidence. When in doubt,
  use `unverified` (for confidence), Tier 3 (ask the user, for `number`/`enum`
  fields), or read the CHANGELOG rubric for the field.
- Never guess an ambiguous L05 wikilink target. Multiple plausible candidates
  or zero candidates both mean: ask the user, don't pick.
- Never modify files in `raw/`. Read-only.
- Never hand-edit `wiki/graph/edges.jsonl` or `wiki/graph/citations.jsonl`.
- `set-meta` is the only permitted write path for frontmatter changes in this
  skill, with two sanctioned exceptions: deleting the obsolete `url:` key
  during the `url` → `urls` schema-shape upgrade (Phase 3), and rewriting a
  resolved `[[wikilink]]` target in a page body once you've confidently
  matched it to exactly one candidate — both because `set-meta` has no way to
  make either change. Do not use Edit or Write on wiki pages for anything
  else, and never use Edit to invent a value `set-meta` would have rejected.
- Do not clear `legacyMigrationNeeded` until lint confirms 0 errors.
- If the CHANGELOG has no `### Migration` section for the detected version gap,
  rely entirely on the L01/L02/L05/L11 finding messages (and `--suggest`
  suggestions) to identify which fields or wikilinks need backfilling. Do not
  fabricate a migration spec.

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
