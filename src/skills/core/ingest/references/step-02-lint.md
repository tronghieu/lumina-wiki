# Step 2: Lint

## RULES

- Read `README.md` at the project root before this step if you have not already in this session.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write to `wiki/*.md` directly.
- Auto-fix is conservative: it only applies the L0x rules listed below. Do not invent new fixes.
- If errors remain after auto-fix, never silently advance — surface them and let the user decide.
- This step has no user gate when it succeeds. Report one short, non-technical sentence, write the status, and continue.

## Why this step exists

This step cleans up mechanical wiki issues: page names, missing return links, duplicate links, and the index. These do not need user approval when the tool can fix them safely. Ask the user only when something remains that requires judgment.

## INSTRUCTIONS

### Phase 8 — Lint and fix

```bash
node _lumina/scripts/lint.mjs --fix --json
```

`--fix` auto-applies L01 (kebab slugs), L03 (missing reverse edges), L06/L07 (dedupe symmetric), L09 (refresh index block). Other lint rules report only.

Read the JSON output. Two cases:

**Case A — `summary.errors === 0`:**
- Auto-fix may have rewritten files. Inspect the diff and tell the user one short sentence in the user's language, avoiding tool words. Example: "I cleaned up two missing return links and the page list is current."
- Write `ingest_status: linted` and continue immediately:
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status linted
  ```
  → NEXT

**Case B — `summary.errors > 0`:**
- Auto-fix could not resolve everything (typically L02 schema-validation errors, L04 cross-reference targets that don't exist, or L08 type mismatches).
- Explain each remaining issue in plain language with the page path. Include rule codes only after the explanation in parentheses for debugging.
- Do not auto-edit beyond the supported fixes.

**HALT and ask human:** `[E] Edit and check again` | `[Q] Quit`

- **E**: User-driven fixes to wiki pages. After fixes, re-run the **full** Phase 8 instruction (`lint.mjs --fix --json`) — including `--fix`, otherwise auto-fixable errors will appear unresolved on the loop. Loop back to Phase 8 — do not advance.
- **Q**: Preserve current `ingest_status` (`drafted`). **STOP — do not read the NEXT directive below.** Exit cleanly with no further action this run.

## NEXT

Read fully and follow `./step-03-verify.md`
