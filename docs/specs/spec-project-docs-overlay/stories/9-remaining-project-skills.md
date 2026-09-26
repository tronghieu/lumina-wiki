---
title: 'lumi-project ingest, ask, check, verify and view skills'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
  - '{project-root}/src/templates/project/PROJECT.md'
  - '{project-root}/src/skills/project/lumi-project-setup/SKILL.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Project mode has an engine but only one skill. Nothing lets the host agent add facts (CAP-6), answer questions from the graph (CAP-10), report lint and broken evidence (CAP-11) or open the view (CAP-12).

**Approach:** Ship five host-neutral markdown skills. Each one drives `project.mjs` subcommands and reads only their JSON output (AD-15).

## Boundaries & Constraints

**Always:**
- **Files:** `src/skills/project/lumi-project-{ingest,ask,check,verify,view}/SKILL.md`.
- **Convention:** follow `lumi-project-setup`.
  - Frontmatter: `name`, a short `description` saying what the skill does and when it triggers (no explanation), and `allowed-tools`.
  - The body opens with the `PROJECT.md` line, then `## Role`, `## Context`, `## Instructions`, `## Output Format`, `## Examples`, `## Guardrails`, `## Definition of Done`.
  - Engine behaviour a skill depends on is stated in the skill. No host-specific tool names or slash syntax.
- **Read through the engine:** skills use `status`, `build`, `query`, `lint`, `verify-evidence`, `view` and `facts-write`. They never read or write `_lumina/facts/`, `_lumina/graph/` or `_lumina/_state/`. Reading in-scope docs and `project.yaml` is allowed.
- **ingest:**
  1. **Select docs** from `status`: states `never-ingested`, `changed` or `stale`, or the paths the user names. Show the count and get approval before a batch larger than 20 docs.
  2. **Per doc, gather what exists:**
     - Read the doc text and the doc's existing edges (`query node <path>`), so facts the parse already makes are not duplicated.
     - Take fragment ids (`frag:<path>#<anchor>`) and edge `scope` labels from `build` output, filtered by a one-line `node -e` over stdout.
     - Take concept names from `project.yaml`.
  3. **Extract only what the parse cannot see** (CAP-6):
     - Meta-relation edges read from prose (`supersedes`, `satisfies`, `governs`, `depends-on`, `part-of`, `contradicts`, `justified-by`, `owned-by`), each with its subject a `doc:` or `frag:` of this source.
     - Fragment `status` attr facts. Status never goes on a `doc:` subject; that fires P18.
     - Partial supersession uses a `frag:` target or a `scope` label. A label already in engine output for that target is copied verbatim (AD-27).
     - Every fact carries a verbatim `evidence.quote` from this doc. `provenance` is `extracted` when the quote states the fact, else `inferred`.
  4. **Write** with one `facts-write` call per doc, passing the doc's `status` `hash` as `sourceHash`. The call replaces the doc's whole fact set, so send the full current set every time. A doc with nothing to add gets `facts: []`, which still marks it ingested.
  5. **Handle `facts-write` errors:**
     - Exit 1 with `errors[]`: fix or drop the named facts, then retry once.
     - Hash mismatch: re-run `status` for a fresh hash.
     - Exit 3 (lock or internal error): stop and report.
  6. **Finish:** end with `status` counts and a suggestion to run check or verify in a fresh session or subagent.
- **ask:**
  - Read-only. Answer through `query` (`node`, `list`, `neighbors`) and nothing else.
  - Every claim cites `file:line` from engine output. Say when the graph holds no answer; never fill the gap by grepping or guessing.
  - Report `freshness`: name the stale docs, and give the changed and never-ingested counts as a caveat.
- **check:** run `lint`, report findings grouped by rule id with `file:line`, and name the likely fix for each group (a config change, a doc edit, or re-ingest for P13). Report-only.
- **verify:** run `verify-evidence`, list P14 broken evidence and P15 rename candidates by doc, and offer ingest for those docs. Report-only. Never move or edit fact files.
- **check and verify:** both open with a note. If ingest ran in this same context, suggest re-running in a fresh session or subagent, because that context carries ingest's bias.
- **view:** run `view` and report `_lumina/graph/view.html` as a `file://` path to open. No server.

**Never:**
- No engine, installer, config-schema or test change. The installer test already ships every skill directory.
- No doc edits by any of the five skills. No git operations.
- ingest never invents a fragment anchor, concept or scope label, and never re-emits links, ID mentions, frontmatter relations, concept mentions or heading status that the parse already makes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Seli partial supersession | Ingest `docs/adr/0052-*.md` and `0009-*.md` | Fragment-level or scoped `supersedes` facts from 0052 to 0009, with quotes; `status` shows both `fresh` | none |
| No change | Ingest re-run, no doc edits | Zero docs processed | none |
| Bad fact | `facts-write` rejects an unknown anchor | Fact fixed or dropped; one retry; the doc is written | exit 1 handled |
| Big batch | 400 never-ingested docs | Count shown; approval asked before starting | none |
| CAP-10 question | "Which features are governed by a superseded decision?" | `query list` then `neighbors`; every item has `file:line` | none |
| No graph answer | The question has no matching nodes | Says so; no grep answer | none |
| Stale fact | A quoted sentence deleted | ask names the stale doc; verify lists the broken fact | none |
| View | `view` | `file://` path to `view.html` reported | none |

</intent-contract>

## Code Map

- `src/skills/project/lumi-project-setup/SKILL.md` -- the structure and Engine facts style to mirror.
- `src/project/project.mjs`:
  - `status` prints `{docs[{path, hash, state}], summary}`.
  - `facts-write` reads stdin `{source, sourceHash, facts[]}` and prints `{ok, source, file, facts}`. It exits 1 on bad JSON, a hash mismatch or a bad fact (with `errors[{index, message}]`), 2 on an unsafe or out-of-scope source, and 3 on a lock timeout.
  - `verify-evidence` prints `{findings}` with P14/P15.
  - `lint` prints `{findings, summary}`.
  - `view` prints `{ok, file}`.
- `src/project/lib/fact.mjs:45-107`, `lib/factfile.mjs:73-205` -- the fact shape:
  - `kind` is `edge` or `attr`.
  - `subject` is `doc:<source>` or `frag:<source>#<anchor>`.
  - `relation` and `object` are for an edge; `value` is for an attr.
  - Optional `ref` and `scope`; `evidence: {quote}`, where the line is recomputed; `provenance`.
  - Validation is all-or-nothing.
- `src/project/project.test.mjs:575-587` -- a valid envelope: a scoped `supersedes` fact.
- `src/project/project.test.mjs:255-275` -- a doc-level `status` attr fires P18.
- `src/project/lib/graph.mjs:687-689` -- edge evidence in `build` output carries `scope`. `lib/query.mjs:27` drops `scope` from `query` evidence, so labels come from `build`.
- Capigo `build` output is about 1.1 MB, 593 nodes and 2,224 edges, so the skill filters it and never reads it whole. Fragment nodes are `{id: 'frag:<path>#<anchor>', kind: 'frag'}`.
- `src/skills/core/{ingest,check,verify,ask}/SKILL.md` -- the classic fresh-context note and the read-only ask pattern, to mirror in spirit only.
- Seli acceptance config: `/private/tmp/claude-501/-Users-luuhieu-Projects-lumina-wiki/319898e4-2485-43da-afba-d2e0a8a513d4/scratchpad/seli4/_lumina/config/project.yaml`.

## Tasks & Acceptance

**Execution:**
- `src/skills/project/lumi-project-ingest/SKILL.md` -- per Boundaries. The longest of the five.
- `src/skills/project/lumi-project-ask/SKILL.md` -- per Boundaries.
- `src/skills/project/lumi-project-check/SKILL.md` -- per Boundaries.
- `src/skills/project/lumi-project-verify/SKILL.md` -- per Boundaries.
- `src/skills/project/lumi-project-view/SKILL.md` -- per Boundaries.

**Acceptance Criteria:**
- Given a Seli copy with project mode and the acceptance config:
  - When a host agent without engine source ingests `0052` and `0009`, then `query neighbors ADR-0009 --direction in --relation supersedes` returns items with quotes, and `status` shows both docs `fresh`.
  - When ingest re-runs with no edits, it processes zero docs.
  - When ask receives the CAP-10 question, every listed item carries `file:line`.
- Given the ingested copy with one quoted sentence deleted, when verify runs, then it lists that fact as P14, and ask names the doc as stale.
- Given any copy, when view runs, then `_lumina/graph/view.html` exists and the reported path points to it.

## Verification

**Commands:**
- `npm run test:installer` -- expected: 0 fail (the ships-every-skill test covers six skills).
- `npm run ci:package`, `npm run ci:idempotency` -- expected: ok.
- Seli acceptance, above, with Sonnet host agents barred from engine source -- expected: every criterion met.

## Spec Change Log

- 2026-09-26: The "no engine change" Never rule was overridden for one root-cause bug that ingest exposed. An unprefixed `path#anchor` object with an unknown anchor widened silently to the whole doc, turning a partial supersession into a full one. The fixes are separate commits 5658c1d and cc01fdb: reject unknown anchors on in-scope targets; an out-of-scope target stays `doc:`. `PROJECT.md` gained one exception to the facts-dir rule: the user deletes an orphaned fact file whose source is gone. KEEP: the skills still change no engine code.

## Review Triage Log

### 2026-09-26 — Review pass
- verdicts: about 75 raw findings merged into 34 rows — high 6, medium 14, low 12, false 2, maybe-false 0
- live acceptance, before patching (Seli, host barred from engine source):
  - 0052 ingested with a scoped `supersedes` fact and 2 fragment status facts; 0009 got `facts: []`; both `fresh`.
  - The re-run processed 0 docs; the 228-doc batch was gated.
  - ask answered CAP-10 with citations and a freshness caveat.
  - After a quoted sentence was deleted, verify reported P14 and ask named the stale doc.
  - view wrote `view.html`.
  - Only blocker hit: the attr `relation` was undocumented.
- findings:
  - `[high]` `patch` ingest re-run drops prior agent facts, because `query node` shows them without provenance and the skill says skip them (Blind, Edge, Intent) — re-derive every prose-stated fact; skip only the parse-only kinds
  - `[high]` `patch` attr fact shape undocumented; `relation: "status"` required (Intent, Edge, acceptance) — full example
  - `[high]` `patch` object `path#anchor` with an unknown anchor silently widened to the doc (ingest implementer) — engine fix 5658c1d, cc01fdb; skill text updated
  - `[high]` `patch` fact files for a gone source can never be cleared: permanent P14, ghost edges (Edge, Blind) — `PROJECT.md` exception; verify/check tell the user to delete the file
  - `[high]` `patch` ask fabricates a content answer behind an `at` citation (Blind) — the graph holds no content; point to file:line
  - `[high]` `patch` ask reads every exit 2 as "no answer" (Blind, Edge) — only "no node resolves for ref"
  - `[medium]` `patch` ellipsized example quotes; raw markdown versus rendered (Blind, Intent) — verbatim raw text
  - `[medium]` `patch` scope-label rule contradicts itself (Blind, Intent) — copy an existing label, else a new label in the source's words; table rows go in `scope`
  - `[medium]` `patch` an unresolvable unprefixed object keeps the doc stale forever (Edge) — `query node` each object before writing
  - `[medium]` `patch` a misspelled relation silently becomes `references`; config `relations` applies to agent facts (Edge) — exact meta-relation names; claim corrected
  - `[medium]` `patch` relation stated only from the other side is lost (Blind) — config-mapped name, else report as uncaptured
  - `[medium]` `patch` CAP-10 misses `partially-superseded` (Intent, Edge, Blind) — query both
  - `[medium]` `patch` ask guesses the type mapping and has no fan-out cap (Blind) — read `project.yaml` types; stop above 20 calls
  - `[medium]` `patch` empty results reported as authoritative when docs are never-ingested; wrong governs claim (Blind) — caveat in Instructions
  - `[medium]` `patch` `build` filter: one run per target, no error handling (Blind) — once per batch; exit check
  - `[medium]` `patch` temp payload file in `/tmp` (Blind, Intent) — quoted heredoc
  - `[medium]` `patch` ambiguous stop rule; unhandled user paths (Blind) — skip-doc and stop-batch rules
  - `[medium]` `patch` check fix column wrong for P14-gone and agent-fact findings (Blind, Edge) — per-origin fixes
  - `[medium]` `patch` verify "no findings" read as fresh (Edge) — points to status/check
  - `[medium]` `patch` long descriptions; host tool names and slash syntax (Intent) — per the user's direction
  - `[low]` `patch` stray `## Engine facts` heading in the setup skill (Intent) — fixed
  - `[low]` `patch` allowed-tools missing Read in check and view (Blind, Intent) — added
  - `[low]` `patch` workspace-internal references (src paths, AD-ids, CAP-ids) (Blind, Intent) — removed
  - `[low]` `patch` the view error shape, "read-only" wording, file:// encoding and existence step (Blind, Edge, Intent) — fixed
  - `[low]` `patch` concept objects hand-slugged (Blind, Edge, Intent) — write the concept name
  - `[low]` `patch` count of doc versus frag/id items in list (Edge) — labelled
  - `[low]` `patch` stale meaning understated (Edge, Intent) — broadened
  - `[low]` `patch` verify bias-note placement and "spawned" wording (Intent, Blind) — aligned with check
  - `[low]` `patch` verify offer-to-ingest missing (Intent) — ask the user
  - `[low]` `patch` duplicate facts collapse; report the engine's count (Edge) — noted
  - `[low]` `reject` orphan-evidence warning in ask — covered by the verify/check remedy; rare
  - `[low]` `reject` renamed-heading frag in the `build` list — rare; the retry handles it
  - `[false]` `reject` the 15 failing tests once — a load flake; reruns 516/516
  - `[false]` `reject` ask should forbid Read entirely — Read is needed for `project.yaml` types

## Auto Run Result

- **Change:** five host-neutral skills: `lumi-project-ingest`, `-ask`, `-check`, `-verify` and `-view`.
  - Each drives `project.mjs` and reads only its JSON output.
  - ingest re-derives a doc's whole fact set on every call and pipes it through a heredoc to `facts-write`.
  - ask answers only from `query`, citing file:line, and states that the graph holds no content.
- **Engine fixes, separate commits:**
  - 5658c1d and cc01fdb: an unknown anchor on an in-scope `path#anchor` object is rejected instead of silently widened to the doc.
  - `PROJECT.md`: the user deletes an orphaned fact file whose source is gone.
- **Setup skill:** a stray heading was removed.
- **Files:**
  - `src/skills/project/lumi-project-{ingest,ask,check,verify,view}/SKILL.md` (new)
  - `src/project/lib/factfile.{mjs,test.mjs}`
  - `src/templates/project/PROJECT.md`
  - `src/skills/project/lumi-project-setup/SKILL.md`
- **Review:** 34 rows. 30 patched (6 high, 14 medium, 10 low); 2 low rejected; 2 false.
- **Follow-up review:** recommended. 6 high and 14 medium entries were patched, and ingest and ask were largely rewritten after the review.
- **Verification:**
  - `node --test src/project/`: 516 pass, 0 fail.
  - `test:installer`: 357 pass; the ships-every-skill test covers six skills.
  - `ci:package`: ok, 146 files. `ci:idempotency`: 6 `[ok]`.
  - Seli acceptance before patching met every criterion. After patching, the ingest implementer re-verified on Seli that a trivially edited 0052 re-ingests with its supersedes fact kept and returns to `fresh`.
- **Residual risks:**
  - The patched ask, check and verify were verified against the engine, not re-run by a fresh host agent end to end.
  - Out-of-scope `path#anchor` objects still collapse to `doc:` unchecked.
  - Orphaned fact files need a manual delete; there is no engine subcommand.
  - Codex and Antigravity hosts have not been run.

## Design Notes

Ingest rewrites a doc's whole fact set from the current text on every call, instead of patching prior facts. This keeps it inside AD-15, since prior agent facts are not distinguishable in engine output. It also makes `facts-write`'s replace-all semantics the natural fit.
