---
id: SPEC-project-docs-overlay
companions:
  - ontology.md
  - source-scope.md
  - graph-view.md
  - brownfield.md
  - pilot-evidence.md
  - ../../project-context.md
  - ../../planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md
sources:
  - ../../brainstorming/brainstorm-lumina-project-docs-overlay-2026-09-26/brainstorm-intent.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Project Mode — Typed Graph over a Project's Existing Docs

## Why

A pain to solve plus an opportunity. Agents now write most code, so the humans on a software project — mostly people who manage agents or make decisions — work from high-level docs: decisions, requirements, features, processes, conventions. Those docs already carry an implicit ontology (frontmatter, ID schemes, `related:` links, precedence rules) that nobody checks, so it rots: an FR renumbering was hand-propagated across 47 files, superseded decisions stay cited, IDs collide. Code-wiki tools (DeepWiki, Google Code Wiki) and graphify map code and generate their own prose; none treats a project's existing docs as the source of truth or checks consistency across them. Project mode projects existing docs into a typed, checked, queryable graph without writing a second copy of anything. Position: graphify for code, Lumina for docs. Software projects are the primary target; the design stays open to projects of similar complexity in other domains.

## Capabilities

- **CAP-1**
  - **intent:** User can install Lumina into an existing project repo through a separate install mode, distinct from `--ide` and `--agents`, that adds the engine, skills, and config but creates no `raw/` or `wiki/`. Existing entry files (`AGENTS.md`, `CLAUDE.md`) only gain a short block between `<!-- lumina:project -->` markers pointing host agents to the setup skill.
  - **success:** Installing into a copy of Seli changes pre-existing files only inside the `lumina:project` marker region and `.gitignore`; a second install produces no diff.
- **CAP-2**
  - **intent:** User can set which docs are in scope with multiple include and exclude globs, defaulting to `docs/`.
  - **success:** With `include: [docs, "packages/*/docs"]` and `exclude: [docs/user-guide]`, the scanner, hook, and lint select the same file set; an include pattern matching zero files produces a warning.
- **CAP-3**
  - **intent:** After install, the user opens their coding agent and runs a setup skill that scans the in-scope docs and proposes scope, a project ontology mapped to meta-types, ID patterns, status sources, external IDs, and a concept vocabulary, flagging frontmatter problems; nothing is written until the user approves.
  - **success:** On Capigo, setup reports the ADRs without frontmatter and proposes a heading-based status source for them; on a non-BMAD repo (kubernetes/enhancements), setup proposes a mapping onto meta-types with no Lumina code change.
- **CAP-4**
  - **intent:** The graph is typed by a fixed meta-ontology; each project type and relation declares the meta-type or meta-relation it maps to (see `ontology.md`).
  - **success:** A lint rule written against `Decision` fires identically for a project that calls decisions "ADR" and one that calls them "KEP".
- **CAP-5**
  - **intent:** A deterministic parse builds the fast-path graph from frontmatter, links, ID mentions, heading-based status, and concept-vocabulary mentions, with no agent involved.
  - **success:** Two consecutive parses of unchanged docs produce byte-identical output; parsing Seli's `docs/` (234 files) completes in under one second.
- **CAP-6**
  - **intent:** The host agent ingests docs guided by the ontology, extracting entities, fragments, and relations beyond what the parse sees; every fact carries an evidence quote and `file:line`; results are stored per source doc, and only docs whose facts no longer hold are re-ingested.
  - **success:** After ingest on Seli, `ADR-0009`'s partial supersession by `ADR-0052` appears as fragment-level facts with quotes; re-running ingest with no doc changes processes zero docs.
- **CAP-7**
  - **intent:** Nodes exist at three granularities: document, fragment (ID- or anchor-addressable part of a doc), and concept (domain term with name, aliases, and mentions, holding no prose).
  - **success:** Asking "what do we know about credit limit" returns the concept node with every mention across Seli's docs, each linked to `file:line`.
- **CAP-8**
  - **intent:** The graph stays fresh with no hook: every read parses the docs live; a doc's agent facts are stale only when an evidence quote is gone or a reference no longer resolves, and reads report how many docs are stale or changed since the last ingest.
  - **success:** Editing a doc with hooks disabled, then querying, returns results reflecting the edit plus a warning naming one stale doc.
- **CAP-9**
  - **intent:** Cross-doc lint checks the rules attached to meta-relations and reports violations without editing any doc; it runs in CI with no agent.
  - **success:** On Seli, lint flags each doc still citing the rows of `ADR-0009` superseded by `ADR-0052`; running lint in CI with the committed facts gives the same result as locally.
- **CAP-10**
  - **intent:** A human can ask project questions through the host agent and get answers drawn from the graph, each claim cited to `file:line`.
  - **success:** "Which features are governed by a superseded decision?" returns a list whose every item links to its source line.
- **CAP-11**
  - **intent:** The system detects facts whose evidence quote no longer exists at its source.
  - **success:** Deleting a quoted sentence from a doc makes the corresponding fact reported as broken on the next check.
- **CAP-12**
  - **intent:** User can open a graph view with Obsidian-like interaction to browse nodes and relations, colored by meta-type, with lint violations and stale facts highlighted (see `graph-view.md`).
  - **success:** Opening the generated file via `file://` with no network shows Capigo's graph, filterable by meta-type, and clicking a node shows its evidence and opens the source line in the editor.

## Constraints

- Docs are the only source of truth. Lumina writes no markdown pages and never edits docs, except frontmatter fixes the user explicitly approves during setup. The graph holds typed relations, pointers, and evidence quotes — no prose.
- Lumina calls no LLM API. All inference is done by the host coding agent through skills; hooks never invoke an agent.
- The meta-ontology is pure data in code (the `schemas.mjs` discipline: no I/O). Lint and cross-wiki queries key on meta-types and meta-relations, never on project type names.
- Domain neutrality: lint attaches only to governance meta-types (Decision, Requirement/Goal, Rule) and generic relation rules (cycles, `contradicts`). Setup-skill guidance must not assume software doc types, ID schemes, or folder names as the only frame.
- Source selection follows `source-scope.md`: one matcher shared by every engine subcommand, with the same `*`/`**` semantics as classic `matchGlob`.
- Project config is YAML at `_lumina/config/project.yaml`.
- Project-mode host targets in this iteration: Claude Code, Codex, Antigravity.
- The viewer file is gitignored and the parsed graph is never stored; agent-extracted facts are committed, one record per source doc.
- The viewer is one self-contained HTML file that works from `file://`, loads nothing from the network (zero-telemetry rule 10), and uses no React (see `graph-view.md`).
- Classic IDE installs and AI-agent installs stay byte-identical to today; all repo policies in `project-context.md` hold (atomicWrite, safePath, no postinstall, no native modules, empty devDependencies, cold start under 300 ms with lazy imports, exit codes 0–4, no emoji, en/vi/zh doc sync).

## Non-goals

- Code analysis, code-wiki generation, or doc-to-code drift detection.
- Generated markdown pages of any kind, including an Obsidian vault export.
- A hosted UI or server.
- React or a 3D viewer in this iteration.
- Per-file checks that existing project tooling already owns (frontmatter presence, dead links, ADR numbering), beyond setup's one-time report.
- User-defined lint rules, or relations with no meta-relation mapping getting their own lint.
- Lumina-driven background ingest; scheduling is left to the host (e.g. an OpenClaw/Hermes job running the ingest skill).
- Registering project-mode repos in `lumi-hub` or querying across them.

## Success signal

- On Seli, with project mode installed, setup approved, and ingest run, about ten real manager questions and lint cases are handled clearly better by graph + lint than by an agent grepping `docs/` on most of them — the kill criterion in `pilot-evidence.md`. Capigo's frontmatter-less ADRs get their status through the heading source, and kubernetes/enhancements is mapped by setup with no Lumina code change.

## Assumptions

- Brainstorm items proposed by the coach and not rejected by the user are accepted: glob semantics, external IDs, heading-based status, the meta-type table, lint rules, the viewer feature list, and a concept vocabulary stored in config.
- Seli (`../seli`) and Capigo (`../capigo`) are available as local fixtures; the third pilot is the public kubernetes/enhancements repo.

## Open Questions

- Is the fixed meta-type list complete? The software pilots answer this for software; `Capability` and `Structure` naming is revisited after a later non-software pilot (see `pilot-evidence.md`).
- Install flag name: decided in architecture.
- Partial-supersession model for lint, decided before story 4: Seli's only real stale citer of `ADR-0009` (`adr/README.md:101`) links the path and cites no ID, and `partially-superseded` is not a Decision lifecycle value.
- Query contract (the fixed operations `lumi-project-ask` uses), defined before story 5.
- Whether a host hook is needed at all, revisited in story 8.
