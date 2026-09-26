# Ontology

Two tiers. The meta-ontology is fixed in Lumina and describes the nature of project knowledge, not folder names. The project ontology is proposed by the setup skill from what a project actually has; every project type declares its meta-type.

## Meta-types

| Meta-type | Examples across projects |
|---|---|
| Decision (lifecycle: proposed, accepted, superseded, deprecated) | ADR, RFC, KEP, design doc |
| Requirement / Goal | FR in a PRD, OKR, user story |
| Rule / Constraint | convention, policy, invariant, SLA |
| Capability | feature doc, product spec |
| Process | workflow, runbook, SOP |
| Structure | component, data model, service, bounded context |
| Concept | domain term, glossary entry |
| Actor | role, team, persona, owner |
| Issue | tech debt, risk, incident, postmortem, open question |
| Evidence | research, user interview, meeting note |
| Document | container for all of the above |

Domain fit: eight meta-types map naturally onto construction, marketing, and research projects; `Capability` and `Structure` lean software. Lint depends only on the governance meta-types (Decision, Requirement/Goal, Rule), so a naming change to the others does not affect lint.

## Meta-relations and lint

| Relation | Lint rule |
|---|---|
| `supersedes` (may be partial) | No cycles; target status must be superseded; flag every citer of the superseded part |
| `satisfies` | Flag a requirement nothing satisfies |
| `governs` | Flag a governed node whose governor is superseded |
| `depends-on`, `part-of` | Flag cycles |
| `contradicts` | Always flag |
| `justified-by`, `owned-by`, `mentions` | None |
| `references` | None; the default and the fallback for unmapped relations |

A relation that maps to no meta-relation falls back to `references`. A new meta-relation is added to Lumina only when pilots show an important relation keeps falling back; there is no user-defined lint.

## Project mapping examples

- `ADR is-a Decision`, `KEP is-a Decision`, `Runbook is-a Process`, `Postmortem is-a Issue`, `Convention is-a Rule`.
- A project without workflows has no Process type; a project with postmortems adds one. The setup skill proposes only types it finds.

## Node granularity

- **Document**: one in-scope file.
- **Fragment**: an ID- or anchor-addressable part of a document — a requirement line, a row in a decision's status table, one entity in a data-model doc. Addressed as `file#anchor`.
- **Concept**: a domain term spread across docs with no file of its own. Holds name, aliases, and mentions only. Points to the project's glossary entry when one exists; setup may propose writing a glossary inside the project's own `docs/`, which the project then owns.

## Fact record

Every fact, parsed or agent-extracted, carries:

- source `file:line` (or `file#anchor`);
- evidence quote (agent-extracted facts; required);
- provenance: `extracted` (parse) or `inferred` (agent);
- content hash of the source doc at extraction time, used for staleness.

## Typing sources, cheapest first

1. Frontmatter, links, ID mentions — deterministic parse.
2. Document structure (headings, tables, lists, diagrams) — agent, guided by the ontology.
3. Prose — agent.

Without this rule every parsed `related:` link would be `references` and parsed-part lint would be nearly useless. An untyped `related:` link in the parsed part is typed by a configured (source meta-type, target meta-type) rule, e.g. a Capability's `related:` entry naming a Decision yields Decision `governs` Capability; a Decision naming a Requirement yields Decision `satisfies` Requirement; anything else yields `references`.

## External IDs

IDs cited in scope but defined outside it (e.g. FRs defined in `_bmad-output/` PRDs but cited in `docs/`) are declared by pattern. They become nodes with no definition; lint checks only that the ID matches its pattern.
