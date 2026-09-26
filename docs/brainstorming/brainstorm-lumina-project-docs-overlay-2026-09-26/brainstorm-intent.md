# Brainstorm intent: Lumina project-docs overlay mode

## Problem and target reader

Agents write most code now; humans rely on high-level docs — decisions, requirements, features, workflows — to manage agents and make calls. Those docs carry an implicit, unchecked ontology (frontmatter, IDs, related-links, precedence rules) that rots: IDs renumbered by hand across dozens of files, superseded decisions still cited. Target reader: humans who manage agents or make decisions — not agents, not a map of the code.

## Positioning

graphify maps code: derived, regenerable, always true to current code, no memory. Lumina's edge is project memory — why decisions were made, what superseded what — as a typed, checked schema in git, no second source of truth. One line: graphify for code, Lumina for docs.

## Confirmed decisions (user)

- Scope: documentation only, not code.
- Primary reader: humans who manage agents or make decisions.
- Ship as a separate install mode (like `--agents openclaw/hermes`), not a content pack.
- Docs stay canonical; Lumina projects them into an ontology, never writes duplicate markdown pages. Write-back into frontmatter is **withdrawn** except frontmatter fixes the user explicitly wants.
- Source folders configurable via multiple include/exclude globs; default `docs/` (`_bmad-output/` skipped unless added).
- A setup skill scans the project and proposes folders, mapping, and ontology, flagging issues (e.g., ADRs with no frontmatter).
- **Two-tier ontology.** Meta-ontology fixed in Lumina — the nature of project knowledge, not folder names. Project ontology proposed by the setup skill from what the project has (ADR is-a Decision, Runbook is-a Process, KEP is-a Decision, Postmortem is-a Issue). Custom types allowed if each maps to a meta-type. Lint and `lumi-hub` key on meta-types.
- **Ingest is agent-guided, ontology-first — the v1 main path.** Per document the agent extracts entities, IDs/anchors, and relations guided by the ontology; every fact carries an evidence quote and file:line. Deterministic parse (frontmatter/links/IDs) is the cheaper, narrower fast path.
- **Node granularity**: document (container), fragment (ID/anchor-addressable — a requirement line, a status-table row, a data-model entity), concept (a term spread across docs, no file of its own — name, aliases, mentions, glossary pointer if any).
- **Graph is split.** Parsed part (frontmatter/links/IDs): not committed, `_lumina/graph/` gitignored, rebuilt deterministically. Agent-extracted part: **committed**, one file per source doc keyed by content hash — ingest isn't re-paid, CI can lint it, conflicts only when two branches edit the same doc.
- **Hook role**: cannot run the agent. It rebuilds the parsed part and marks agent-extracted facts stale on change; queries warn how many docs changed since last ingest. Real update via `/lumi-ingest` or a scheduled OpenClaw/Hermes job.
- **Graph view with an Obsidian-like UI** (the look and interaction; no Obsidian vault export). Self-contained HTML (e.g. `_lumina/graph/view.html`), regenerated on each build, gitignored, data embedded inline so `file://` works. Built on `force-graph` (2D canvas) directly; no React. 3D (`3d-force-graph`) only as a later option.

## Proposed design (coach, not yet decided)

- Glob semantics: in scope = ≥1 include match, 0 exclude; exclude wins, no `!`; only `*`/`**`; bare `docs` means `docs/**`; hook and scanner share one matcher. Always-excluded: `.git/`, `node_modules/`, `_lumina/`; other agent-tool dirs and `graphify-out/` default-excluded but overridable.
- An untyped `related:` link may still get its type inferred from (source meta-type, target meta-type) as an optional fast path — kept only where it still fits, not the main typing mechanism.
- Human channel: chat via agent answering from the graph, plus read-only views (traceability, violations) pointing back to sources.
- Graph view features: animated force layout with drag/zoom/pan; node size by degree; hover highlights neighbors and fades the rest; color by meta-type with legend; settings panel (filters by type/status/folder, orphans toggle, force sliders); local graph (N hops); search. Lumina-specific: edge-type labels with directional arrows/particles, lint violations and stale facts highlighted, detail panel with evidence quote and `vscode://file/...:line` link.
- Graph view constraints: canvas, not SVG (thousands of nodes); library vendored into the package, never loaded from CDN (zero-telemetry rule 10; check the `ci-package` allowlist); viewer generation lazily imported (cold start under 300 ms).
- External IDs: with default scope `docs/`, requirement IDs defined in `_bmad-output` but cited in `docs/` become `external_ids` (node, no definition, lint checks pattern only); FR→Epic→Story→QA-gate traceability is lost unless those subfolders are added. Capigo needs `status_from` (ADR status lives in a body heading).

### Meta-ontology (fixed in Lumina)

| Meta-type | Grounded example |
|---|---|
| Decision | ADR, KEP — has lifecycle/status, supersedable |
| Requirement/Goal | FR |
| Rule/Constraint | convention |
| Capability | feature |
| Process | workflow, Runbook |
| Structure | component, data-model |
| Concept | domain term, no own file |
| Actor | — |
| Issue | tech-debt, Postmortem |
| Evidence | — |
| Document | container for all of the above |

### Meta-relations (fixed, with lint)

- `supersedes` — acyclic; target status must be superseded
- `satisfies` — flag if target requirement unsatisfied
- `governs` — flag if governing decision superseded
- `depends-on` / `part-of` — flag cycles
- `justified-by`, `owned-by`, `mentions` — no rule
- `contradicts` — always flag
- `references` — default, no rule

## Conflicts with current invariants + reusable parts

Inverts current invariants (bidirectional links written into pages, `wiki.mjs` as sole writer, timeline/compiled zones, `raw/` read-only). Reusable as-is: schemas engine, graph engine, lint, `lumi-ask`, `lumi-verify`, `lumi-hub`. A second product on the same engine.

## Competitive risk (coach assessment, 2026-09)

| Competitor | Overlap | Risk |
|---|---|---|
| DeepWiki, Google Code Wiki | Code-only, own prose, vendor cloud, no ontology/lint | Direct low, substitution medium |
| graphify | Parses docs locally, EXTRACTED/INFERRED edges | Medium: could add a docs mode |
| Swimm | Doc-to-code drift (patented) | Low, out of scope |
| log4brains | ADR supersession only | Low |
| Agent grepping `docs/` ad hoc | Free, one-off | High: the real competitor |

Moat is not tech: docs stay truth, nothing written, local/OSS, lint tied to project semantics. Ingesting docs is a small step for DeepWiki/Code Wiki, but typed ontology + lint is niche for them. Value needs docs with frontmatter/IDs; the setup skill widens that. Not in v1: code wiki generation, hosted UI, doc-to-code drift.

## Risks

- Per-project mapping cost (ID regexes, status locations differ).
- Overlaps existing per-file checkers (Capigo's `check-frontmatter.mjs`, dead-link, ADR-number) — scope to cross-doc checks only.
- Noise from test/template artifacts with placeholder IDs.
- Generality beyond BMAD-shaped docs untested until the third pilot lands.

## Open questions

1. Does the meta-type-pair inference fast path still earn its keep now that agent-guided ingest is the main path?
2. Is the fixed meta-type list complete, or will the third pilot surface a knowledge kind it doesn't cover?
3. No extension path exists for a relation that doesn't map to any meta-relation — falls back to `references`, losing lint. Acceptable long-term?

## Pilot plan

1. **Seli** — 234 docs, uniform frontmatter — validates the core loop.
2. **Capigo** — ADRs with no frontmatter, `status_from`, duplicate IDs — the hard cases.
3. **A third, non-BMAD project** (Kubernetes KEPs or Rust RFCs) — validates generality beyond BMAD docs.

Kill criterion: on Seli, collect ~10 real manager questions/lint cases; continue only if graph+lint clearly beats agent-with-grep on most.

## Evidence appendix

**Seli**: ~1140 `.md`; `docs/` 234 (adr 63, conventions 25, workflows 24, features 20, data-models 13, tech-debt 9). Uniform frontmatter; IDs `ADR-0009`, `FR6.7a`, `TD-0001`, `C001`, `Story 7.3`. Pains: FR renumbering hand-propagated across 47 files; `ADR-0009` partially superseded by `ADR-0052`.

**Capigo**: ~1400 `.md`; `docs/` 440 (user-guide 121, adr 95, features 79, workflows 49). 95 ADRs lack frontmatter (status in body). IDs `ADR-088`, `FR-WMS-22-9`, `CAP-N`, `SPEC-*`, `C020`. Existing checkers: `check-frontmatter.mjs`, dead-link, ADR-number. Pain: duplicate QA gate IDs (`1.20-...` vs `1.20....`).

## Withdrawn

- Flat "core entities" list (decision, requirement, feature, workflow, data-model, convention, tech-debt, component) — replaced by the meta-ontology plus mapped project types.
- Deferring custom edge/entity types — replaced by "custom types allowed if mapped to a meta-type."
- (Source type, target type) inference as the *main* relation-typing mechanism — demoted to an optional fast path.
- Deterministic-only-first for "LLM tier in v1?" — closed: agent-guided ingest is the v1 main path.
- "Agent writes facts back into frontmatter, graph stays deterministic" — frontmatter can't express fragment-level entities; most projects won't accept bulk agent edits.
- Blanket "never commit the derived graph" — replaced by the parsed/agent-extracted split.
