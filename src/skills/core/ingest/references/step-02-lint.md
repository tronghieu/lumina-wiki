# Step 2: Lint

## RULES

- Read `README.md` at the project root before this step if you have not already in this session.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write to `wiki/*.md` directly.
- Auto-fix is conservative: it only applies the L0x rules listed below, and only where it can do so safely. Do not invent new fixes.
- The gate below is scoped to the pages *this ingest run* touched. Never let a
  pre-existing, unrelated problem elsewhere in the wiki block this entry, and
  never let this entry's own remaining errors slip through because the rest
  of the wiki happens to be clean.
- If errors remain on this entry's own pages after auto-fix, never silently
  advance — do not write `ingest_status: linted`; surface the findings and let
  the user decide.
- This step has no user gate when it succeeds. Report one short, non-technical sentence, write the status, and continue.

## Why this step exists

This step cleans up mechanical wiki issues: page names, missing return links, duplicate links, and the index. These do not need user approval when the tool can fix them safely. Ask the user only when something remains that requires judgment.

A real incident motivated the gate below: ten consecutive ingests each wrote
`ingest_status: linted` without checking whether the entry's own page still
had errors afterward, leaving 39 damaged pages behind before anyone noticed.
This step must never repeat that — an entry only reaches `linted` when its
own pages are actually clean.

## INSTRUCTIONS

### Phase 8 — Lint and fix

```bash
node _lumina/scripts/lint.mjs --fix --json > /tmp/lumi-lint-<slug>.json
```

`--fix` auto-applies L01 (missing frontmatter — derives a type-valid default
where one exists), L02 (frontmatter type repairs it can make safely, e.g.
wrapping a bare string into an array or rebuilding a `key_sources`/
`related_concepts` list from the graph), L03 (kebab slugs), L05 (rewrites a
broken wikilink only when exactly one page's basename matches), L06 (missing
reverse edges), L07 (dedupe symmetric edges), and L09 (refresh index block).
Everything else — plus any specific L01/L02/L05 finding `--fix` recognized
but could not safely resolve on its own (typically a `number`/`enum` field
with no safe default, or an ambiguous/unresolvable wikilink) — is left
standing and reported only.

Now narrow the result to the pages *this ingest run* touched — the source
page itself plus every page it links to (new or updated stubs) — so an
unrelated, pre-existing problem elsewhere in the wiki can never block this
entry, and this entry's own problems can never hide behind a clean wiki-wide
count:

```bash
node -e "
const fs = require('fs');
const body = fs.readFileSync('wiki/sources/<slug>.md', 'utf8');
const touched = new Set(['sources/<slug>.md']);
for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
  const target = m[1].split('|')[0].trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) touched.add(target.replace(/^\/+/, '') + '.md');
}
const j = JSON.parse(fs.readFileSync('/tmp/lumi-lint-<slug>.json', 'utf8'));
const relevant = j.findings.filter(f => touched.has(f.file));
const errors = relevant.filter(f => f.severity === 'error' && !f.fix_applied);
console.log(JSON.stringify({ errors_count: errors.length, relevant }, null, 2));
"
```

Two cases, based on `errors_count` from that scoped projection — **not** the
wiki-wide `summary.errors`, which can include unrelated debt this ingest did
not cause and should not be gated on. `errors_count` only counts errors that
are still unresolved after `--fix`; a finding `--fix` already repaired
(`fix_applied: true`) stays in `relevant` for visibility but never blocks the
gate:

**Case A — `errors_count === 0`:**
- Auto-fix may have rewritten files. Inspect the diff and tell the user one short sentence in the user's language, avoiding tool words. Example: "I cleaned up two missing return links and the page list is current."
- Write `ingest_status: linted` and continue immediately:
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status linted
  ```
  → NEXT

**Case B — `errors_count > 0`:**
- One or more findings on this entry's own pages survived `--fix` — typically
  a `number`/`enum` frontmatter field with no safe default (L01/L02), an
  ambiguous wikilink `--fix` would not guess at (L05), a missing edge
  confidence (L08), a foundation alias conflict (L10), or a dangling edge
  (L17).
- Do **not** write `ingest_status: linted`. This is the gate the incident
  above is about — an entry with a standing error on its own pages must never
  be marked clean.
- Explain each remaining issue in plain language with the page path. A
  "remaining" issue is a `relevant` entry with `fix_applied: false` — never
  mention an entry `--fix` already repaired, which would report a solved
  problem as outstanding. Include
  rule codes only after the explanation in parentheses for debugging. For
  anything that needs a judgment call, run
  `node _lumina/scripts/lint.mjs --suggest --json` and read the matching
  finding's suggestion before asking the user to decide — do not guess a
  value or a wikilink target yourself.
- Do not auto-edit beyond the supported fixes.

**HALT and ask human:** `[E] Edit and check again` | `[Q] Quit`

- **E**: User-driven fixes to wiki pages. After fixes, re-run the **full** Phase 8 instruction (`lint.mjs --fix --json`) — including `--fix`, otherwise auto-fixable errors will appear unresolved on the loop. Loop back to Phase 8 — do not advance.
- **Q**: Preserve current `ingest_status` (`drafted`). **STOP — do not read the NEXT directive below.** Exit cleanly with no further action this run.

## NEXT

Read fully and follow `./step-03-verify.md`
