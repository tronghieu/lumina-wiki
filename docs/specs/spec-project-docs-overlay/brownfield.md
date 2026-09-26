# Brownfield Notes

Project mode is a second product on the Lumina engine, not a toggle on the classic wiki.

## Classic invariants suspended inside a project-mode repo

- Reverse edges written into pages: reverse edges exist only in the graph.
- `wiki.mjs` as the page writer: project mode writes no pages.
- `raw/` and `wiki/` layout, `log.md`, `index.md`: not created.
- Topic two-zone pages (compiled + timeline): not used. Decision history comes from git, by diffing the graph between commits.

These invariants stay fully in force for classic installs.

## Reused

- Schema-as-pure-data pattern (`schemas.mjs`), extended with the meta-ontology.
- Graph engine and lint engine.
- `src/scripts/lib/globs.mjs` matcher.
- `/lumi-ask`, `/lumi-verify` patterns. `lumi-hub` registration is out of scope.
- Installer machinery: atomic writes, manifests, skills install, `.gitignore` handling, and the `<!-- lumina:schema -->` marker-region rewrite, reused for the `<!-- lumina:project -->` block in existing `AGENTS.md`/`CLAUDE.md`.

## Graph storage split

| Part | Rebuild cost | Committed |
|---|---|---|
| Parsed (frontmatter, links, IDs, headings, vocabulary mentions) | Sub-second, deterministic | No |
| Agent-extracted facts | Agent tokens, non-deterministic | Yes, one record per source doc keyed by content hash |

Per-doc records mean two branches conflict only when both edit the same doc, which already conflicts.

## Hook

The hook cannot run an agent. On doc change it rebuilds the parsed part and marks that doc's agent facts stale. The real update runs through the ingest skill, invoked by the user or a host scheduler.
