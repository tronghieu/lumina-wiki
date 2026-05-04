# Step 2: Lint

## RULES

- Read `README.md` at the project root before this step if you have not already in this session.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write to `wiki/*.md` directly.
- Auto-fix is conservative: it only applies the L0x rules listed below. Do not invent new fixes.
- If errors remain after auto-fix, never silently advance — surface them and let the user decide.

## Why this step exists

Lint is the cheapest semantic check we have on the wiki: kebab slugs, missing reverse edges, dedupe on symmetric edges, refresh of `<!-- lumina:index -->`. Running it before verify means the structural surface is already clean when we reason about claims, so any issue verify finds is genuinely about content, not formatting. If lint emits errors after auto-fix, the draft is structurally inconsistent — verify will spend tokens on the wrong problem.

## INSTRUCTIONS

### Phase 8 — Lint and fix

```bash
node _lumina/scripts/lint.mjs --fix --json
```

`--fix` auto-applies L01 (kebab slugs), L03 (missing reverse edges), L06/L07 (dedupe symmetric), L09 (refresh index block). Other lint rules report only.

Read the JSON output. Two cases:

**Case A — `summary.errors === 0`:**
- Auto-fix may have rewritten files. Inspect the diff and tell the user a one-line summary (e.g. "fixed 2 missing reverse edges").
- Proceed to the lint gate.

**Case B — `summary.errors > 0`:**
- Auto-fix could not resolve everything (typically L02 schema-validation errors, L04 cross-reference targets that don't exist, or L08 type mismatches).
- Surface each error with file path and rule code. Do not auto-edit.
- HALT and ask the user how to proceed:
  - Fix each error by hand (re-edit the offending wiki page; loop back into this step's Phase 8 after fixes).
  - Quit and resume later (`[Q]` path below — preserve `ingest_status: drafted`, do not advance).

## Lint Gate

Present a lint summary to the user:
- Errors before auto-fix
- Errors auto-fixed (count + brief description)
- Errors remaining (zero in the happy path)

**HALT and ask human:** `[A] Accept` | `[E] Edit (revise to address remaining issues)` | `[Q] Quit`

- **A**: Only available when `summary.errors === 0`. Write `ingest_status: linted`:
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status linted
  ```
  → NEXT
- **E**: User-driven fixes to wiki pages. After fixes, re-run the **full** Phase 8 instruction (`lint.mjs --fix --json`) — including `--fix`, otherwise auto-fixable errors will appear unresolved on the loop. Loop back to "Lint Gate" — do not advance.
- **Q**: Preserve current `ingest_status` (`drafted`). **STOP — do not read the NEXT directive below.** Exit cleanly with no further action this run.

## NEXT

Read fully and follow `./step-03-verify.md`
