# Reconciliation Review — project-docs-overlay spine vs spec + memlog

Spine reviewed: `../ARCHITECTURE-SPINE.md`
Inputs: `docs/specs/spec-project-docs-overlay/SPEC.md` + companions (`ontology.md`, `source-scope.md`, `graph-view.md`, `brownfield.md`, `pilot-evidence.md`), `../.memlog.md`.

## Verdict

Mostly reconciled — the paradigm, capability map, and most AD/decision pairs match cleanly, but five binding rules a builder would only get from the spec/memlog are absent or narrowed in the spine, risking an incompatible build if the spine is followed alone.

## Method

Walked every CAP-1..12 intent/success/constraint in SPEC.md, every rule in the five companions, and every memlog line, against the spine's Inherited Invariants, AD-1..17, Capability map, and Structural Seed. Below are only items where the spine's silence or narrower wording would let a builder do something the spec/memlog forbids or omits a rule the spec/memlog states as binding — not detail that correctly lives only in the companions (e.g. graph-view.md's interaction list, ontology.md's meta-type table, pilot numbers are fine to leave out of the terse spine).

## Findings

### Gap 1 — Graph content-shape rule ("no prose") is not in the spine at all
- **Where it's binding:** SPEC.md:63 ("The graph holds typed relations, pointers, and evidence quotes — no prose") and SPEC.md:43 / ontology.md:46 ("concept... holding no prose... Holds name, aliases, and mentions only").
- **Spine:** Inherited Invariants table and AD-7 (meta-ontology as pure data) never state this constraint. AD-7 covers how `ontology.mjs` is structured, not what the built graph/fact records may contain.
- **Risk:** A builder could add a free-text `description`/`summary` field to concept or fragment nodes (e.g. to make the viewer nicer) without violating any spine rule, directly contradicting a constraint the spec states twice.

### Gap 2 — `_lumina/schema` dropped from the committed-files list
- **Where it's binding:** memlog:49 — "`_lumina/scripts, _lumina/config, _lumina/schema, _lumina/facts` are committed so CI runs `node _lumina/scripts/project.mjs lint` without installing Lumina."
- **Spine:** AD-14 and the Structural Seed both list only `_lumina/scripts, _lumina/config, _lumina/facts` as committed — `_lumina/schema` is absent from both the committed list and the gitignored list, so its existence/treatment in project mode is undefined.
- **Risk:** Builder has no signal whether project mode has a `_lumina/schema` directory at all, or whether it must be committed for CI lint to run without installing Lumina.

### Gap 3 — safePath scoped away from scope-glob patterns
- **Where it's binding:** source-scope.md:8 — "Patterns are repo-relative and pass `safePath()`; `..`, absolute paths, and drive letters are rejected."
- **Spine:** Inherited Invariants table row binds safePath explicitly to "fact files, graph files, config, marker blocks" only — scope include/exclude patterns are not in that list, and AD-9 (one scope matcher) doesn't mention safePath either.
- **Risk:** A builder treating the Inherited Invariants table as the exhaustive binding list would not validate glob patterns in `project.json` through `safePath()`, reopening a path-traversal vector the spec explicitly closes.

### Gap 4 — Byte-identical, deterministic parse output is unstated
- **Where it's binding:** SPEC.md:38 (CAP-5 success) — "Two consecutive parses of unchanged docs produce byte-identical output."
- **Spine:** AD-10's "pretty JSON, fixed key order, facts sorted by id" discipline is scoped to `_lumina/facts` (agent-extracted). No AD states the same determinism requirement for `_lumina/graph/` (the deterministic-parse output), and AD-12 (freshness) only discusses when to rebuild, not output stability.
- **Risk:** Builder could serialize the parsed graph via non-deterministic key/iteration order (e.g. `Map`/`Set` or unsorted arrays), breaking the CAP-5 acceptance test silently since nothing in the spine calls it out as a rule to satisfy.

### Gap 5 — Domain-neutrality constraint on setup-skill guidance is missing
- **Where it's binding:** SPEC.md:66 — "Setup-skill guidance must not assume software doc types, ID schemes, or folder names as the only frame."
- **Spine:** CAP-3 (setup skill) maps only to AD-1, AD-8, AD-13, none of which mention this. AD-7's domain-fit note ("Capability and Structure lean software") covers the ontology's meta-type list, not the setup skill's guidance/copy.
- **Risk:** Setup-skill prompts could be written assuming ADR/FR-style conventions as the default frame, which the spec explicitly rules out for non-BMAD repos (kubernetes/enhancements pilot).

## Notes on items checked but not flagged

- Evidence-quote requirement, external IDs, status-from-heading, always/default excludes, CAP-1 idempotency (marker-only diff) — all land correctly in AD-8/AD-9/AD-10/AD-3.
- Zero-match-include warning (SPEC.md:29) and sub-second Seli parse (SPEC.md:38) are absent from the spine too, but are narrower/perf-only acceptance details rather than structural rules — lower severity, not in the top list.
- Graph-view interaction feature list correctly lives only in `graph-view.md`; the spine's AD-16 only needs to (and does) cover delivery mechanics.
