---
title: 'Deterministic parse and buildGraph'
type: 'feature'
created: '2026-09-26'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/stories/1-project-engine-core.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The engine can select docs but extracts nothing. Lint, query, and view need one typed graph built without an agent, correct on every read.

**Approach:** A pure deterministic parse turns frontmatter, headings, links, IDs, status, and concept mentions into raw facts per doc; one pure `buildGraph()` resolves, types, and merges them with any committed facts; `build` and `status` compute everything in memory on each call (SPEC CAP-5, CAP-7, CAP-8; spine AD-11, AD-12, AD-19, AD-20).

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`; imports as in story 1 (AD-6).
- Parse emits raw relation names and refs exactly as written; only `buildGraph()` resolves and types (AD-11, AD-19). Records built with `makeFact`, `provenance: extracted`, `evidence.line` 1-based in the file, `evidence.quote` the matched source text.
- Skip fenced code (``` and ~~~), HTML comments, and `<!-- lumina:project -->` blocks for headings, links, IDs, and concepts. Inline code is scanned.
- Every ID and concept match uses Unicode lookarounds `(?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_])` with the `u` flag; `\b` is forbidden. Trailing `.,;:-` is stripped from a body match.
- Output byte-identical on unchanged input: nodes by id, edges by `(from, relation, to)`, evidence by `(file, line, quote)`, findings by `(file, line, id, message)`; no timestamps; repo-relative paths.

**Never:**
- No file writes of any kind: no cache, no lock, no `refresh`, no hook (user decision after review).
- No `facts-write`, lint rules beyond the findings below, query, or view (stories 3-6). No table-cell or mermaid semantics; no wiki-links.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Doc type | config type with `paths` and/or `frontmatter` (both given = both must match) | doc node `metaType`, `type`; first matching type in config order wins | no match: `Document`; P12 only when the doc has a frontmatter `type` and no config type matched |
| Declared ID | frontmatter `id` (first choice) or H1; value = first `idPattern` match anchored at its start, else the whole trimmed `id` value | one declaration per doc; the ID is an alias resolving to `doc:<path>` | same ID declared by two docs: P10, `id:<ID>` node, resolves to neither doc |
| Body ID mention | text matching any type `idPattern` or `externalIds[].pattern` | edge `mentions` to the declaring node, else `id:<ID>` | matches a type `idPattern` but undeclared: P09; external only: no finding |
| Frontmatter relation | key `related`, a meta-relation name, or a `relations` key; value list, scalar, or null | one raw edge per non-empty string item, `ref` as written | null or empty: none; non-string items skipped |
| Inverse | `relations: {superseded_by: {relation: supersedes, inverse: true}}` | edge from the target to this doc | N/A |
| Links | inline `[t](x.md#y)`, reference-style `[t]: x.md` definitions | raw edge `link`, typed `references`; `#y` alone is the same doc | URLs, directories, and missing files ignored (dead links are project tooling's job) |
| Path resolution | ref `data-models/x.md` in `docs/adr/a.md`; `#anchor` stripped, percent-decoded | tries doc-relative, the include root that selected the citing doc, other include roots in config order, repo root; first in-scope hit | existing file out of scope: `doc:<path>` node with `inScope: false`, no finding |
| Dangling | frontmatter ref that is no path, anchor, ID, or concept alias (e.g. `FR-group 17`) | none | P09 |
| `related` typing | Capability doc `related:` a Decision | `relatedRules` by (source meta-type, target meta-type); an external ID uses `externalIds[].metaType` when given | no rule: `references`; a `relations` entry for `related` overrides `relatedRules` |
| Merge | typed, `references`, and `mentions` edges for one `(from, to)` | keep typed edges, else `references`, else `mentions`; all evidence kept | self-loops dropped |
| Status | `status` source or ordered list, e.g. `[{frontmatter: status}, {heading: Status}]` | strip inline markup; value = longest `status.map` key at its start (case-insensitive), else first word lowercased, trailing punctuation stripped; first source with a value wins | sources disagree: P19; a Decision's status outside its lifecycle: P20 |
| Heading source | `## Status` (any level, case-insensitive) or, absent, a line `**Status:** Accepted` | first non-empty line of the section, or the text after `Status:` | none found: no status |
| Concept mention | concept `credit limit`, alias `hạn mức` | edge `mentions` doc to `concept:credit-limit`, NFC, case-insensitive | inside fenced code: ignored |
| Anchors | heading text after stripping inline markup (`_(BMAD)_`, backticks, link syntax); two `## Notes` | `slug()` of the rendered text; `notes`, `notes-1` | N/A |
| Bad frontmatter | YAML error, or not a mapping | doc parsed without frontmatter | P17 |
| Agent doc status | fact file sets `attr status` on a document | document status still from the parse | P18 |
| status | fact file absent / hash equal / hash differs, every fact's quote matches and ref resolves / a fact fails or `ontologyVersion` differs | `never-ingested` / `fresh` / `changed` / `stale` | unreadable or malformed fact file: `stale` |

</frozen-after-approval>

## Code Map

- `src/project/lib/{config,scope,hash,markdown,fact,fsx}.mjs` -- story 1 libs; reuse `selectScope`, `contentHash`, `slug`, `makeFact`. `slug` does not collapse spaces, matching GitHub (`AD-9 — x` gives `ad-9--x`).
- `src/project/lib/config.mjs` -- extend: `status` as object or ordered list plus optional `map`; `relations` values string or `{relation, inverse}`; `externalIds[].metaType`. Keep `ontologyVersion` covering them.
- `src/project/ontology.mjs` `RULES` -- add P17 frontmatter does not parse (warning), P18 agent fact sets document status (warning), P19 status sources disagree (warning), P20 Decision status outside lifecycle (warning).
- `src/project/project.mjs` -- add `build`, `status`; keep `exitCodeForError`.
- Pilot facts (`../seli/docs`, `../capigo/docs`, read-only): Seli ADR `adr/0009-…md:4` `id: ADR-0009` plus H1 `# ADR-0009: …`; `conventions/C002-migrations.md:2` `id: C002-migrations`, cited as `C002`; Seli `related:` doc-relative, Capigo `related:` relative to `docs/`; Capigo `superseded_by:` list, scalar, or null; Capigo status `**Accepted** - 2026-…` under `## Status`, `adr-011` inline `**Status:** Accepted`; Seli 0009 frontmatter `partially-superseded` vs heading `Accepted`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/project/lib/frontmatter.mjs` + test -- split frontmatter, js-yaml `CORE_SCHEMA`, body start line.
- [ ] `src/project/lib/markdown.mjs` + test -- body scan: headings with rendered-text anchors and dedup suffixes, inline and reference-style links, lines outside skipped regions; `matchAll(pattern, text)` with the lookarounds.
- [ ] `src/project/lib/parse.mjs` + test -- `parseDoc(path, text, config)` pure; `parseAll(root, config)` over `selectScope`.
- [ ] `src/project/lib/evidence.mjs` + test -- `quoteMatches(source, quote)`: NFC and whitespace collapse, substring (AD-22; story 3 reuses it).
- [ ] `src/project/lib/graph.mjs` + test -- `buildGraph({config, parsed, facts, exists})` pure (`exists(path)` injected for out-of-scope files); `loadFacts(root)` reads `_lumina/facts/**/*.json` envelopes.
- [ ] `src/project/lib/config.mjs`, `src/project/ontology.mjs` -- extensions and P17-P20.
- [ ] `src/project/project.mjs` + tests -- `build`, `status` per Design Notes.
- [ ] `src/project/test-fixtures/parse-*/` -- synthetic repo covering every matrix row, with Seli- and Capigo-style frontmatter and status.

**Acceptance Criteria:**
- Given an unchanged fixture, when `build` runs twice, then stdout is byte-identical (parse-determinism test).
- Given the fixture tree, when `build` and `status` run, then no file under the fixture changes (checked by hashing the tree before and after).
- Given a copy of `../seli/docs` with a hand-written `project.yaml` (ADR and convention types), when `build` runs, then ADR-0009 is one `doc:` node, no P10 fires, `C002` citations resolve to the convention doc, and the run takes under 1 s.

## Design Notes

Outputs (`schemaVersion: 1`):

```json
build:  {"nodes":[{"id":"doc:docs/adr/0009-x.md","kind":"doc","metaType":"Decision","type":"ADR","status":"partially-superseded","declares":"ADR-0009","inScope":true}],
         "edges":[{"from":"doc:…","relation":"supersedes","to":"doc:…","evidence":[{"file":"docs/…","line":4,"quote":"…","provenance":"extracted"}]}],
         "findings":[{"id":"P09","severity":"warning","file":"docs/a.md","line":12,"message":"…"}]}
status: {"docs":[{"path":"docs/a.md","state":"changed"}],"summary":{"fresh":0,"changed":1,"stale":0,"neverIngested":233}}
```

Relation typing order: `relations` map for the key, key is a meta-relation name, `related` through `relatedRules`, `mentions`, else `references`. Agent facts from fact files resolve `subject` and `object` with the same resolver as `ref`.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: unchanged.
- Seli acceptance: copy `../seli/docs` into a temp repo with `_lumina/config/project.yaml`; from it run `time node /Users/luuhieu/Projects/lumina-wiki/src/project/project.mjs build` -- expected: exit 0, under 1 s, ADR-0009 checks above.

## Implementation Notes

## Spec Change Log

## Review Triage Log
