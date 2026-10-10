# Deferred Work

## Deferred from: code review of spec-project-docs-overlay (2026-09-26)

- **Project skills missing from agent-context files** — repo `CLAUDE.md` skills list and `docs/project-context.md` §6 do not mention the `lumi-project-*` skills. Deferred because the fix edits agent-context files.
- **`facts-prune` realpath guard untested** — the check before unlink (`src/project/project.mjs:741`) is reachable only if a directory is swapped for a symlink between classify and unlink; a deterministic test needs a seam there.

## Deferred from: code review of spec-paper-ranking (2026-06-16)

- **404 "no data" results are not cached** — `_cache.py` only caches HTTP 200, so re-ranking a paper Scite/Altmetric do not index re-hits the API every run. By design across all fetchers; revisit only if it becomes a rate-limit problem.
- **Scite/Altmetric real-API contract is untested** — endpoint shapes and field names (`/tallies/{doi}`, `contradicting`, `/doi/{doi}` score fields) are assumptions exercised only against mocks. Verify against the live APIs once a `SCITE_API_KEY` / `ALTMETRIC_API_KEY` is available.

## Deferred from: code review of spec-learning-pack-reflection (2026-05-10)

- `answers.packs.includes('learning')` null-guard on upgrade path (`src/installer/commands.js`) — pre-existing pattern; research/reading carry same risk; audit upgrade path null-safety across all three packs.
- Upgrade pack-addition path not covered in `commands.test.js` — pre-existing gap; commands.test.js upgrade tests do not assert new directories/skills are created when packs are added on reinstall.
- L06 exemption only on `edge.to` not `edge.from` (`src/scripts/lint.mjs`) — if a future tool accidentally writes an edge from `reflections/` to a concept, L06 will still fire; consider adding `isExempt(edge.from)` check to fully enforce reflections exemption.
- `related_concepts` slug validation in `/lumi-learning-reflect` — AI infers slugs without verifying against `wiki/concepts/`; wrong slug silently breaks future `/lumi-learning-connect`; add a slug-resolution step in skill or wiki.mjs.

## Promoted out of deferred (record only)

- **Goal B — `/lumi-ingest` workflow rewrite (multi-step with HITL gates)** — originally split out of v0.9 on 2026-05-04, then promoted back into v0.9 scope on 2026-05-04 by user decision. The verify and ingest-workflow features now ship together in v0.9. New scope captured in a sibling spec: `spec-v0-9-ingest-workflow.md`.

---

## 2026-05-04 (review pass)

### Goal C — `--since <date>` batch read-meta path

**Deferred from:** v0.9 review, Blind hunter finding #9.

**Scope:** Current `/lumi-verify --since <date>` design fans out one `wiki.mjs read-meta` subprocess per entity to filter by `updated >= <date>`. Acceptable on small wikis (<50 entries), expensive on larger ones (200+ entries = 200+ subprocess spawns). Add a `wiki.mjs list-entities --filter updated:>=<date>` (or similar) batch path that returns matching slugs in a single call.

**Why deferred:** Subprocess cost is real but only bites at scale we don't yet have benchmarks for. Optimising before measuring is premature; revisit when a user reports `--since` slowness.

**Target milestone:** v0.10 or later.

### Goal D — Legacy YAML compatibility quirks

**Deferred from:** v0.9 review, Edge case hunter findings #2 and #8 (tab/CR escaping in flow-mapping values, unbalanced-brace inputs in hand-edited frontmatter).

**Scope:** The flow-mapping parser is now correct for the formats lumina-wiki itself produces. It is NOT robust against arbitrary hand-edited YAML — tabs/CRs inside string values are escaped on write but not all read paths handle the inverse round-trip from external editors that introduce these characters. Either harden the parser further or document "do not hand-edit `findings:` values" prominently.

**Why deferred:** Real-world frequency near zero. Findings are machine-written by `/lumi-verify`; hand editing is a rare path. The current parser handles the formats lumina-wiki produces; expanding to "any YAML editor's quirks" is a much larger swamp.

**Target milestone:** Not scheduled. Track only if a user reports it.

### Goal E — `--single` fallback tier (single-pass reviewer)

**Deferred from:** v0.9 spec design notes (mentioned as fallback option but not implemented).

**Scope:** A `--single` opt-in flag that runs exactly one reviewer with full context (no anti-anchoring, no parallel sub-agents). Documented as the weakest tier for users who explicitly accept the tradeoff.

**Why deferred:** Adds prompt complexity for a tier we expect almost no one to use. Most runtimes that don't support Agent will hit the prompt-files-paste-back fallback first; `--single` is the third tier and rarely needed. Re-evaluate after dogfooding.

**Target milestone:** v0.10 or later, only if dogfooding surfaces demand.
- source_spec: `docs/specs/spec-project-docs-overlay/stories/2-deterministic-parse-and-buildgraph.md`
  summary: Register `src/project/**/*.test.mjs` in a `test:project` npm script, include it in `test:all`, and run it in CI.
  evidence: No npm script or CI job runs the project engine tests; story 1 assigns the wiring to story 7.

## Deferred from: code review of SPEC-project-parallel-ingest (2026-09-27)

- `docs/specs/spec-project-docs-overlay/stories/9-remaining-project-skills.md:85` still lists `status` as `{docs[{path, hash, state}], summary}`. It is a historical story in another spec, so it was not edited in this change.
- The end-to-end success checks for CAP-2, CAP-4, CAP-5 and CAP-6 are unproven. Still to run: the Seli 234-doc run, the forced lock-timeout cluster, a sweep with a missing doc, the one-approval handoff, and a wall-clock comparison. They need a manual pilot with real subagents.

- source_spec: `docs/specs/spec-wiki-view/stories/2-read-model-and-contract-fixture.md`
  summary: `runLint` throws on a JSON `null` line in `wiki/graph/edges.jsonl` or `citations.jsonl`, and on a non-string `to` of a reversible edge type.
  evidence: Reproduced during the wiki view read-model review; `parseEdgeLines` in `src/scripts/lint.mjs` pushes any parsed JSON value, and L06 and L17 then read properties of `null`. The viewer's `/api/lint` returns 500 on such a file while `/api/wiki` skips the row. Fix in the engine: keep only rows that are non-null objects.

- source_spec: `docs/specs/spec-wiki-view/stories/3-server-and-process-contract.md`
  summary: No test proves that the viewer finds its running copy when the workspace is entered through a non-real path on Windows (a short name or a junction).
  evidence: Replacing `fs.realpathSync.native(root)` with `root` in `src/viewer/view.mjs` passes every test on macOS, because `process.cwd()` is already physical there. A Windows-only case that starts the viewer from the unresolved `os.tmpdir()` spelling would settle it.

- source_spec: `docs/specs/spec-wiki-view/stories/5-reader-pane.md`
  summary: The engine's wikilink pattern is quadratic on text with many `[[` and no closing `]]`; `lint.mjs` still runs it unguarded.
  evidence: `WIKILINK_RE` scans to the end of the text from every `[[` before failing. The viewer guards its own two uses (the server's `readPage` and the client renderer). Lint applies the pattern per line and per frontmatter value, which limits the cost, but one very long line would still stall `lumi-check`. A constant-time pre-filter like the one in `src/viewer/lib/data.mjs` would close it.

- source_spec: `docs/specs/spec-wiki-view/stories/3-server-and-process-contract.md`
  summary: One run of the whole viewer suite in about 45 failed once in `view.test.mjs`; it did not reproduce.
  evidence: Seen by a reviewer during a full `npm run test:viewer` run with all test files in parallel; the subtest was not captured. Forty runs of `view.test.mjs` alone passed, and three CI runs on three operating systems passed. If it returns, look first at the 10 s deadline for the ready line under CPU contention.

- source_spec: `docs/specs/spec-wiki-view/stories/8-installer-and-skill.md`
  summary: An upgrade run without `--profile` installs the full profile even when the workspace was installed as `minimal`.
  evidence: `src/installer/commands.js` takes `profile` from the command options only (`opts.profile === 'minimal' ? 'minimal' : 'full'`) and never reads the existing manifest's `profile`. A hub-managed wiki that is re-installed to gain the viewer would gain per-project skill folders and stubs. Keeping the manifest's profile when the option is absent would fix it; that changes upgrade behavior and needs its own change.

- source_spec: `docs/specs/spec-wiki-view/stories/6-filters-local-graph-search.md`
  summary: Filter suggestions follow the last term of the text, not the term under the caret.
  evidence: `suggest` in `src/viewer/ui/lib/query.mjs` reads the text after the last space. Editing a term in the middle of a filter offers suggestions for the final term instead. It would need the caret position passed in from `GraphControls.jsx` and the replacement spliced at that position.
