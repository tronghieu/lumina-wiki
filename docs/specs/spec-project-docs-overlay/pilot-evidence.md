# Pilots and Evidence

## Pilot order

1. **Seli** — 234 docs in `docs/`, uniform frontmatter. Validates the core loop.
2. **Capigo** — ADRs without frontmatter, heading-based status, larger scale. The hard cases.
3. **kubernetes/enhancements (KEPs)** — non-BMAD structure (`kep.yaml`, clear lifecycle). Validates generality within software.
4. **Later, not a gate for this spec: GitLab Handbook** — public markdown policies, processes, roles, and decisions, no code. Validates the meta-ontology outside software; `Capability` and `Structure` naming is revisited after it.

## Kill criterion

On Seli, collect about ten real manager questions and lint cases. Continue only if graph + lint clearly beats an agent grepping `docs/` on most of them, on completeness, determinism, and cost.

## Seli (surveyed 2026-09-26)

- About 1,140 content `.md`; `docs/` 234 (adr 63, conventions 25, workflows 24, features 20, data-models 13, tech-debt 9); `_bmad-output/` 745.
- Frontmatter `title, type, status, id, created, updated, related, tags`.
- IDs: `ADR-0009`, `FR6.7a`, `TD-0001`, `C001`, Story `7.3`.
- Pains: FR renumbering hand-propagated across 47 files; `ADR-0009` partially superseded by `ADR-0052` at row level; `docs/README.md` states "ADR wins" over `architecture.md`.
- `graphify-out/` already present.

## Capigo (surveyed 2026-09-26)

- About 1,400 content `.md`; `docs/` 440 (user-guide 121, adr 95, features 79, workflows 49); `_bmad-output/` 936.
- 95 ADRs have no frontmatter; status under `## Status`.
- IDs: `ADR-088`, `FR-WMS-22-9`, `CAP-N`, `SPEC-*`, `C020`.
- Existing checkers: `scripts/check-frontmatter.mjs`, dead-link checker, ADR-number check, user-guide CI.
- `docs/templates/` carries placeholder IDs; `graphify-out/` already present.

## Competitive position (2026-09)

| Competitor | Overlap | Risk |
|---|---|---|
| DeepWiki, Google Code Wiki | Code-only, own prose, vendor cloud, no ontology or cross-doc lint | Direct low; substitution medium |
| graphify | Parses docs locally, EXTRACTED/INFERRED edges, MCP | Medium: could add a docs mode |
| Swimm | Doc-to-code drift | Low: out of scope |
| log4brains | ADR supersession only | Low |
| Agent grepping `docs/` | Free, one-off answers | High: the real competitor |

The moat is not technology: docs stay the truth, nothing is written, local and open source, lint tied to project semantics, runs in any agent host. Stay on the layer code cannot reveal: why, decided, required, conventions.

## Risks

- Per-project mapping cost: ID patterns and status locations differ.
- Generality beyond BMAD-shaped docs is untested until pilot 3.
- Concept mention matching by vocabulary can misfire on homonyms and mixed Vietnamese/English docs; measure the false-positive rate on Seli.
- Noise from templates and test artifacts with placeholder IDs.
