# Adversarial Review — ARCHITECTURE-SPINE.md (librarian-mode)

**Reviewer stance:** adversary. Goal: find pairs of one-level-down units that each satisfy every AD to the letter yet still build incompatibly.

## Verdict

**Not build-ready.** The spine's dependency-direction rules (AD-1, AD-4, AD-10) are solid and close the obvious hub/spoke coupling holes, but it under-specifies *data shape* and *ownership* at exactly the seams where two independently-staffed epics would each make a locally-reasonable, mutually-incompatible choice: registry key normalization, who owns the global per-platform manifest, what "verify" means (there's already a shipped command using that word for something else), what "empty skeleton" means, and whether the new AI-Agent CI check is even wired into anything that exists. Ten holes found, three of them load-bearing enough to block implementation start.

---

## CRITICAL

### C1 — Registry key normalization: write-side slug vs match-side normalizer

**The two units:** the epic implementing `wikis add` / `registry.js` (CAP-2, AD-2) vs the epic implementing `wikis resolve` (CAP-1, AD-3).

**The incompatible build:** AD-3 pins the *match* algorithm precisely — "NFC + casefold + diacritic-strip normalization of both sides; priority key > name > aliases" — but never says what the *stored key itself* looks like, and registry-and-cli.md only says "Key: kebab-case slug of `name`." Kebab-casing a Vietnamese name like "Kỹ Thuật AI" is ambiguous by itself: does the slugger transliterate diacritics away (`ky-thuat-ai`) or just replace spaces (`kỹ-thuật-ai`)? Both readings satisfy "kebab-case slug" to the letter. Nothing says the write-side slugger and the read-side normalizer must be the *same function*, or that resolve re-normalizes the stored key before comparing (as opposed to comparing the normalized query against the raw stored key). An epic building `add` could plausibly write `key: "kỹ-thuật-ai"` (preserving diacritics, since nothing forbids it), while the epic building `resolve` normalizes the query to `"ky-thuat-ai"` and compares it against the literal stored key string — a permanent, silent non-match on exactly the CAP-1 acceptance scenario (`lumina wikis resolve "kỹ thuật AI"`). Each epic is individually AD-3-compliant; together they fail the spec's own success example.

**Proposed AD fix:** New AD (or tighten AD-3): pin one shared `normalizeKey()` function, exported from `registry.js`, used both to *compute* the stored key at `add` time and to *normalize* the stored key at compare time inside `resolve` (never compare a normalized query against a raw key). State explicitly: NFC → casefold → diacritic-strip → kebab, applied identically on write and on every read-side comparison.

### C2 — Two owners of one entity: the per-platform global manifest

**The two units:** the epic implementing the `wikis` CLI (`registry.js`, owns `~/.lumina/wikis.json` per AD-2) vs the epic implementing the agent-install flow (CAP-8, AD-7, AD-8, AD-9).

**The incompatible build:** AD-2's "one owner" rule is scoped explicitly to `~/.lumina/wikis.json` ("Only the registry module... reads/writes `~/.lumina/wikis.json`"). AD-8 introduces a second file under the same root — `~/.lumina/agents/<platform>-manifest.json` `[ASSUMPTION]` — as the deletion-safety ledger for global skills, but no AD names *which module* owns it, and the Structural Seed lists `registry.js` and `wikis-command.js` but nothing for agent-install's own manifest I/O. Epic A (building `wikis`) could reasonably extend `registry.js` to also own everything under `~/.lumina/` for symmetry ("it's the one hub-state module"). Epic B (building agent-install) could reasonably write its own small manifest reader/writer colocated with the agent-install command module, by direct analogy to the *existing* per-project `manifest.js` pattern (skills-manifest.csv is owned by the installer's own manifest module, not by a shared "state" module). Both choices are individually consistent with everything written down; together you get either two writers racing on the same file, or — worse — nobody writes it because each epic assumed the other one would, since AD-8 talks about "deriving the owned set from a manifest" but never assigns the write path.

**Proposed AD fix:** Extend AD-2 (rename to "hub state has one owner per file, one module per concern") to explicitly enumerate *both* `~/.lumina/wikis.json` (owned by `registry.js`) and `~/.lumina/agents/<platform>-manifest.json` (owned by a named sibling module, e.g. `agents-manifest.js`), pin its schema (canonicalId list + platform + version, mirroring `SKILLS_CSV_HEADER`'s shape), and state that `agent-install` command code may only mutate it through that module — never inline in the command action.

### C3 — "wikis verify" collides with the already-shipped `/lumi-verify`

**The two units:** the epic implementing CAP-4 (`wikis-command verify` + `layout.js`, AD-5) vs the existing, already-shipped `/lumi-verify` skill (`src/skills/core/verify/SKILL.md`, added v0.9 per the skill inventory).

**The incompatible build:** I read the shipped skill directly. `/lumi-verify` is a **semantic fact-checking auditor** — "Check that wiki notes match the sources they cite... flags fabricated or drifted claims," writing to `_lumina/_state/lumi-verify-<ts>.json`. CAP-4's `wikis verify` is a **structural conformance checker** — directory/skeleton presence against `layout.js`. Nothing in the spine, SPEC, or companions acknowledges that "verify" is already a loaded term in this product with an unrelated, user-facing meaning. Two epics working in parallel — one from the librarian-mode SPEC, one just maintaining the existing v0.9 skill — would each be completely correct in isolation, and the result is a product where "verify" means two different things depending on whether you say `/lumi-verify` (fact-check a page) or `lumina wikis verify` (check directory skeleton). That's confusing for the user this whole feature is for (Lưu Hiếu, running both from chat) and for the agent choosing which one to invoke on "verify wiki X" — the routing-protocol.md failure-mode table even says "suggest `lumina wikis doctor`" for a failed manifest check, one step away from an agent instead suggesting `/lumi-verify` and silently running the wrong tool.

**Proposed AD fix:** Rename the new structural-check verb before any epic starts — e.g. `wikis check` or `wikis structure` — reserving "verify" for the existing semantic auditor. Add an explicit line to Inherited Invariants naming `/lumi-verify` (fact-check) as a term already in use, so no future capability reuses it. This is a naming decision cheap to make now and expensive to unwind after two epics ship code and docs against it.

---

## HIGH

### H1 — "seed empty skeleton" vs the installer's real templated content

**The two units:** the epic implementing `doctor --fix` / `wikis verify --fix` (AD-6, consuming `layout.js`) vs the existing installer's own template-render path (`template-engine.js` + `commands.js`, which the epic building CAP-3 "create new wiki" simply re-invokes).

**The incompatible build:** AD-6 says fix mode may "mkdir / seed empty skeleton" for missing entries. "Empty skeleton" for a directory is unambiguous; for a *file* (e.g. `log.md`, `wiki/index.md`) it is not — a literal empty file satisfies "seed empty skeleton" to the letter, but the installer's own templates produce these files with real content (headers, the `<!-- lumina:schema -->` markers, append-only conventions). If the doctor/verify epic writes bare-empty files while the installer epic (CAP-3) writes fully templated ones, a wiki repaired by `doctor --fix` after someone deleted `log.md` ends up in a state the installer itself would never produce — and downstream `lint.mjs` checks (L09 index-freshness, schema-region checks) may choke on a file lacking the markers they expect, since lint was written against installer-produced files, not doctor-produced ones.

**Proposed AD fix:** Tighten AD-6: "seed" means invoking the *same* template-engine render used by install, with default template variables, for exactly the missing paths named by `layout.js` — never a hand-written blank-file fallback. This also gives `layout.js` and the installer's template tree a natural place to share a data source (see H2).

### H2 — `layout.js` can drift from what the installer actually creates

**The two units:** the epic implementing `layout.js` (AD-5, new pure-data module) vs whichever epic (existing or future) changes the installer's template tree / `commands.js` write list.

**The incompatible build:** AD-5's stated purpose is "one definition" so install, verify, and doctor never disagree — but nothing ties `layout.js`'s hand-written list to the *actual* set of paths `commands.js` + the template tree produce. It's plausible (indeed likely, given this is a maintained product) that a future change adds a new required directory or renames one inside the template tree without anyone remembering to mirror it in `layout.js`. That produces exactly the failure mode AD-5 exists to prevent: `wikis verify` either false-flags a perfectly good, newly-installed wiki (layout.js lists something install no longer creates) or fails to catch real damage (install added something layout.js doesn't know about).

**Proposed AD fix:** Require a CI-enforced link, not just a code convention: a test that runs an actual `install --yes` into a sandbox and asserts the resulting path set is consistent with `layout.js`'s list (either generate `layout.js`'s data from a real install's file walk, or add a `layout.test.js` that fails the build the moment the two disagree). Name the owning test file in the spine's structural seed so no epic assumes "someone else already covers this."

### H3 — AD-7's "byte-identical to source" check doesn't exist yet and isn't the existing idempotency gate

**The two units:** the epic implementing the preamble/`agent_host` template conditional (AD-7) vs whoever assumes the existing `scripts/ci-idempotency.mjs` already covers it.

**The incompatible build:** AD-7 states "Classic IDE output must be byte-identical to source — enforced by a CI check," as though this check already exists or trivially follows from existing CI. It does not. `ci-idempotency.mjs`'s two scenarios (`core-default`, `full-pack` × 6 IDE targets) diff **install-run-1 vs install-run-2 of the same target** — a re-install idempotency check — not "classic-target output vs presence/absence of the new `agent_host` conditional." There is no scenario anywhere touching the new AI-Agents target group (OpenClaw/Hermes) at all, and the assertion AD-7 wants ("adding the `agent_host` branch never changes what a classic IDE target renders") is a *cross-target non-interference* check, structurally different from *same-target re-run* idempotency. An epic building the preamble feature could read AD-7, see `ci-idempotency.mjs` already exists, and conclude the gate is already in place — shipping a template-engine bug where the `{{#if agent_host}}` block leaks into, say, the `generic` target's rendered SKILL.md, with nothing in CI able to catch it.

**Proposed AD fix:** Name the new check explicitly and separately from `ci-idempotency.mjs` — e.g. a new scenario or script (`ci-agent-host-isolation.mjs`) that renders a fixed skill set once with an AI-Agents target selected and once without, and diffs the classic-target output between the two runs (must be empty). Pin this in the spine's CI section so the "existing idempotency CI" and "AD-7's new check" are visibly two different gates, not one assumed to subsume the other.

---

## MEDIUM

### M1 — `packs` cache staleness vs pack-gating trust

**The two units:** the epic implementing `registry.js`/`wikis add`/`doctor` (which treats `packs` as "mirror... refreshed by doctor, never authoritative on its own") vs the epic implementing the routing preamble / `lumi-hub` (routing-protocol.md's failure-mode table: "Skill needs a pack the wiki lacks (per registry `packs`) → Refuse early").

**The incompatible build:** The registry-and-cli.md companion is explicit that `packs` is a non-authoritative cache, refreshed only by `doctor`. The routing-protocol companion nonetheless specifies gating a refusal decision directly on that same cached field, with no instruction to double-check the live wiki manifest first. If a user upgrades one wiki's packs (`lumina install --packs +research`) without immediately running a fleet-wide `doctor`, the routing preamble — built faithfully to its own companion doc — will refuse a now-valid request based on stale data, while the registry epic considers this expected/documented behavior ("never authoritative on its own"). Both epics are individually correct against their own companion; the user experiences a wrong refusal.

**Proposed AD fix:** Either (a) require pack-gating in the routing preamble to shell out `cd <path> && cat _lumina/manifest.json` (an AD-1(c) read) for a live check rather than trusting registry `packs`, treating the registry field as UI/display-only, or (b) require `wikis resolve` itself to opportunistically refresh `packs` from the live manifest as a side effect of a successful resolve (cheap, since it already validates the path). Pick one and state it — right now both epics can defend a different reading.

### M2 — Doctor's aggregated JSON report has no pinned shape

**The two units:** the epic implementing `wikis doctor` (CAP-5) vs the epic implementing `lumi-hub` (CAP-10, AD-10 — "operates exclusively through `lumina wikis` commands").

**The incompatible build:** registry-and-cli.md describes doctor's behavior narratively ("aggregated JSON report; a broken wiki is flagged without aborting the sweep") but pins no field names, nesting, or per-wiki status vocabulary (pass/fail? ok:boolean? a status enum?). `lumi-hub` is a markdown skill prompt (not code) that must tell the agent in prose how to read that JSON to answer "fleet health" questions — but prose written against an unpinned shape is exactly where two people (or two passes of the same epic split across time) invent different field names, e.g. `{wikis:[{id,ok,issues}]}` vs `{results:{<id>:{status,lint}}}`. AD-10 forces `lumi-hub` through the CLI, which is right, but doesn't help if the CLI's own output isn't specified anywhere for `lumi-hub`'s author to target.

**Proposed AD fix:** Add the doctor JSON schema to registry-and-cli.md now (even a minimal `{schemaVersion, generatedAt, wikis: [{key, path, reachable, hasManifest, structureOk, lintOk, issues: [...] }]}`), and reference it from AD-11 ("New subcommands reuse the existing JSON/exit contract") so it's treated as part of the contract `lumi-hub` is written against, not invented ad hoc by whichever epic gets there first.

### M3 — Alias uniqueness across wikis is unvalidated at write time but assumed at resolve time

**The two units:** the epic implementing `wikis add` (CAP-2) vs the epic implementing `wikis resolve` (CAP-1, AD-3).

**The incompatible build:** Nothing in registry-and-cli.md requires `add` to reject an alias that's already registered on a *different* wiki (aliases are just a free-text array). `resolve`'s contract, though, treats "multiple matches" as an error condition to surface to the user — implying the design expects aliases to normally be unambiguous. An `add` epic built strictly to spec (no uniqueness check, since none is stated) will happily let a user register the same alias twice across two wikis; the `resolve` epic, built strictly to its own spec, then correctly reports "ambiguous, exit 2" for every subsequent lookup of that alias — a permanently degraded UX neither epic considers a bug in its own code.

**Proposed AD fix:** Add to AD-3 or registry-and-cli.md: `add`/an alias-adding operation must run the same normalization + a live `resolve`-equivalent check against the *existing* registry and reject (exit 1, user error) an alias that already matches another wiki. This turns a silent later failure into an immediate, fixable one at registration time.

---

## LOW

### L1 — Preamble injection point collides with skills' existing fixed opening line

**The two units:** the epic authoring the `librarian-preamble.md` partial (AD-7) vs the (frozen, per "SKILL.md sources stay single-source") existing SKILL.md bodies, which per project-context.md's skill convention all open with the fixed line "Read `README.md` at the project root before this SKILL.md."

**The incompatible build:** In librarian/agent-host mode, cwd is not inside any wiki until routing-protocol's step 4 resolves one — so the existing fixed opening line ("read README at the project root") is meaningless at the point it's reached if the preamble is merely *prepended* rather than substituted for the existing line. AD-7 pins that the preamble is "injected at render," but not *where* relative to that fixed sentence, nor whether the fixed sentence itself becomes conditional. Given `template-engine.js`'s documented limitation — no nested `{{#if}}` — making the existing opening line itself conditional on `agent_host` while the new preamble also needs internal conditional logic (e.g., anything platform-specific between OpenClaw/Hermes) risks requiring nested conditionals the engine cannot do.

**Proposed AD fix:** Pin the exact substitution: the fixed opening line becomes `{{#if agent_host}}` (preamble content, ending with its own "read the resolved wiki's README" step) `{{else}}` (today's fixed line) `{{/if}}` — one non-nested top-level conditional replacing the single line, with the preamble itself written flat (no internal platform-conditional branching; if OpenClaw/Hermes ever need different preamble text, that becomes a second explicit top-level variable, not a nested block).

---

## Summary of proposed AD changes

| # | Severity | Fix |
|---|---|---|
| C1 | Critical | Pin one shared `normalizeKey()`, used identically at `add`-time write and `resolve`-time compare |
| C2 | Critical | Extend AD-2 to name the owner + schema of `~/.lumina/agents/<platform>-manifest.json` |
| C3 | Critical | Rename `wikis verify` (e.g. `wikis check`) before implementation — "verify" is already `/lumi-verify`'s name for something unrelated |
| H1 | High | AD-6: "seed" = re-run the real template render, never a hand-written blank file |
| H2 | High | CI-enforce `layout.js` against a real install's file walk; name the test in the spine |
| H3 | High | Name a new, separate CI check for AD-7's cross-target byte-identity claim — it is not `ci-idempotency.mjs` |
| M1 | Medium | Decide and pin: routing preamble does a live manifest check, or `resolve` refreshes `packs` as a side effect |
| M2 | Medium | Pin doctor's JSON report schema in registry-and-cli.md, referenced by AD-11 |
| M3 | Medium | `add` must reject aliases that already resolve to a different wiki |
| L1 | Low | Pin the exact template substitution point for the preamble vs the existing fixed opening line; keep the preamble itself conditional-free |

Full file: `/Users/luutronghieu/Projects/lumina-wiki/docs/planning-artifacts/architecture/architecture-librarian-mode-2026-07-24/reviews/review-adversary.md`
