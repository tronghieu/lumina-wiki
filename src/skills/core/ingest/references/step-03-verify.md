# Step 3: Verify

## RULES

- Read `README.md` at the project root before this step if you have not already in this session.
- Reuse the existing `/lumi-verify` skill in grounding-only mode. Do not inline a duplicate grounding reviewer here — single source of truth for grounding logic lives in `src/skills/core/verify/`.
- All frontmatter writes go through `wiki.mjs set-meta`. Never write to `wiki/*.md` directly.
- Drift is a hard halt: a missing `raw_paths` file is a stronger signal than any finding and should not be silently downgraded.
- This step asks the user only when there are source-check findings, missing source files, or a confidence downgrade. If the source check passes, continue automatically.

## Why this step exists

Lint catches structural issues; verify catches whether the body actually reflects what the cited raw says. Running grounding-only here keeps ingest cheap (one reviewer, no `--external` web search, no Blind reviewer). Users who want deeper checks invoke `/lumi-verify --external <slug>` after finalize.

The verify gate is where `confidence` gets renegotiated: a passing run keeps the user's intended confidence; an `[W] Accept-with-warning` path knocks it down to `low` so downstream consumers (search, /lumi-ask) treat the entry as provisional.

When speaking to the user, call this "checking against the source" or the equivalent phrase in the configured communication language. Avoid saying "verify gate", "reviewer", or `verify_status` unless the user asks for implementation details.

## INSTRUCTIONS

### Phase 8.5 — Run grounding verification

Invoke `/lumi-verify` on the entry restricted to the grounding reviewer. Three runtime tiers, in order of preference:

**Tier 1 — Agent tool available (Claude Code):**

Spawn a sub-agent with the verify SKILL prompt and the slug, instructing it to run grounding only (skip blind, skip external). Wait for completion, then read the writeback:

```bash
node _lumina/scripts/wiki.mjs read-meta sources/<slug>
```

**Tier 2 — Bash-only runtime (Codex, Gemini, Cursor, generic):**

Read fully and follow `src/skills/core/verify/SKILL.md` Grounding pipeline (Section: "Grounding reviewer"), with this slug as the target. The verify skill's writeback contract is the same — `verify_status` and `findings` written to the entry frontmatter. After the grounding pass returns, control returns to this step's Phase 8.6.

If `src/skills/core/verify/references/reviewers.md` exists, it is the canonical Grounding reviewer prompt; load it as part of following the verify SKILL.

**Tier 3 — User opts out:**

If the user explicitly asks to skip verification (e.g. "I'll verify later"), set `verify_status: skipped`. The skip request itself is the user decision; continue after writing the status.

### Phase 8.6 — Read findings

```bash
node _lumina/scripts/wiki.mjs read-meta sources/<slug>
```

Inspect `verify_status` and `findings`:

| `verify_status` | Meaning | Gate behavior |
|---|---|---|
| `passed` | All claims grounded, no findings | Write verified status and continue automatically |
| `findings_pending` | Patch/defer findings written | Present findings inline; user chooses A/E/W/Q |
| `drift_detected` | `raw_paths` resolves to missing files | **Hard HALT** — do not present standard menu; force user to repair raw or set `provenance: missing` explicitly |
| `skipped` | Tier 3 opt-out | Write verified status and continue automatically; the user already opted out |

For `passed`, tell the user in one short sentence that the page matched the source closely enough to continue. Then write `ingest_status: verified` and go to NEXT:

```bash
node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status verified
```

For `skipped`, tell the user in one short sentence that the page is being saved without a source check because they asked to skip it. Then write `ingest_status: verified` and go to NEXT:

```bash
node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status verified
```

## Source-Check Findings

For `findings_pending`, present:
- A plain-language verdict in the user's language
- Each finding: one-line claim, one-line evidence excerpt, and suggested next action
- Keep `id` and `class` available for debugging, but do not lead with them

**HALT and ask human:** `[A] Accept` | `[E] Edit (revise body in response to findings)` | `[W] Accept-with-warning (downgrade confidence)` | `[Q] Quit`

- **A**: Write `ingest_status: verified` via `set-meta`. Findings stay as-is in frontmatter; the user has acknowledged them. → NEXT
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status verified
  ```
- **E**: User-driven edits to source page body. After edits, re-run Phase 8.5 (verify writes a fresh `findings:` array). Loop back to "Source-Check Findings".
- **W**: Confirm FIRST, write SECOND. Tell the user in their language: "I can save this with a low-confidence note. Use this only when you want to keep the page but revisit it later. Proceed?" Wait for explicit confirmation. Only then issue the writes (in this order — confidence first, ingest_status second, so a crash leaves a strictly-conservative state):
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> confidence low
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status verified
  ```
  → NEXT
- **Q**: Preserve current `ingest_status` (`linted`). **STOP — do not read the NEXT directive.** Exit cleanly with no further action this run. The next `/lumi-ingest <slug>` will re-enter at this gate.

For `drift_detected`, present:
- Which `raw_paths` entries are missing
- The drift cannot be ignored without explicit user direction

**HALT and ask human:** `[R] Repair raw_paths (point at the correct files)` | `[M] Mark as missing (set provenance: missing, drop raw_paths)` | `[Q] Quit`

- **R**: User edits `raw_paths`. Re-run Phase 8.5 from scratch. Loop back.
- **M**: Set `provenance: missing`, clear `raw_paths`, and reset `verify_status` to `skipped` (otherwise the stale `drift_detected` value would persist into a finalized entry):
  ```bash
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> provenance missing
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> raw_paths '[]' --json-value
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> verify_status skipped
  node _lumina/scripts/wiki.mjs set-meta sources/<slug> ingest_status verified
  ```
  Then tell the user in one short sentence that the page will be saved without a source file to compare against. → NEXT
- **Q**: **STOP — do not read the NEXT directive.** Exit cleanly. Re-running `/lumi-ingest <slug>` re-enters at this gate; raw_paths state is unchanged.

## NEXT

Read fully and follow `./step-04-finalize.md`
