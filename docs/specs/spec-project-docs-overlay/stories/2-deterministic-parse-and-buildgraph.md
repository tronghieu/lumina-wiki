---
title: 'Deterministic parse and buildGraph'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'cece6fe39b857fbec7f7974ca765e5d968b04dd7'
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
- [x] `src/project/lib/frontmatter.mjs` + test -- split frontmatter, js-yaml `CORE_SCHEMA`, body start line.
- [x] `src/project/lib/markdown.mjs` + test -- body scan: headings with rendered-text anchors and dedup suffixes, inline and reference-style links, lines outside skipped regions; `matchAll(pattern, text)` with the lookarounds.
- [x] `src/project/lib/parse.mjs` + test -- `parseDoc(path, text, config)` pure; `parseAll(root, config)` over `selectScope`.
- [x] `src/project/lib/evidence.mjs` + test -- `quoteMatches(source, quote)`: NFC and whitespace collapse, substring (AD-22; story 3 reuses it).
- [x] `src/project/lib/graph.mjs` + test -- `buildGraph({config, parsed, facts, exists})` pure (`exists(path)` injected for out-of-scope files); `loadFacts(root)` reads `_lumina/facts/**/*.json` envelopes.
- [x] `src/project/lib/config.mjs`, `src/project/ontology.mjs` -- extensions and P17-P20.
- [x] `src/project/project.mjs` + tests -- `build`, `status` per Design Notes.
- [x] `src/project/test-fixtures/parse-*/` -- synthetic repo covering every matrix row, with Seli- and Capigo-style frontmatter and status.

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

Parse-to-graph contract. `parseDoc(path, text, config)` returns:

```js
{ path, hash,                  // contentHash hex
  includeRoot,                 // first include pattern (config order) that selects the doc, `*` replaced by the doc's segment, cut at `**`
  frontmatterType,             // raw string frontmatter `type` or null
  type, metaType,              // config type name or null; meta-type, default 'Document'
  declares,                    // declared ID or null
  declaresLine,                // 1-based line of the declaration or null
  status,                      // resolved status value or null
  headings: [{ level, text, anchor, line }],
  facts: [/* makeFact edge records, subject `doc:<path>` */],
  findings: [/* P12, P17, P19, P20 */] }
```

Parse facts are edges only. `relation` is the raw name: the frontmatter key (`related`, `superseded_by`, ...), `link`, or `mentions`. `object` and `ref` are the item, link target, or matched ID exactly as written, except a concept mention: `object` = `concept:<slug>`, `ref` = matched text. `parseAll(root, config)` returns `{ docs }` sorted by path. `buildGraph` owns resolution, typing, inversion, merging, and P09/P10/P18.

Relation typing order: `relations` map for the key, key is a meta-relation name, `related` through `relatedRules`, `mentions`, else `references`. Agent facts from fact files resolve `subject` and `object` with the same resolver as `ref`.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `npm run test:scripts` -- expected: unchanged.
- Seli acceptance: copy `../seli/docs` into a temp repo with `_lumina/config/project.yaml`; from it run `time node /Users/luuhieu/Projects/lumina-wiki/src/project/project.mjs build` -- expected: exit 0, under 1 s, ADR-0009 checks above.

## Implementation Notes

- Built in three waves: frontmatter/markdown/evidence and config/rules in parallel; parse and graph in parallel against the contract above; then CLI, seam removal, and Seli acceptance.
- `status` sources accept a single object (optional `map`), an ordered list, or `{sources, map}`; all normalize to `{sources, map}`.
- `refResolves` for `status` checks a fact's evidence tuple against the built graph's edge evidence; merge keeps dropped edges' evidence on the kept edge so the check holds.
- After review patches: `buildGraph` returns a non-serialized per-fact `resolution` map that `status` uses; `parseAll` returns `{docs, texts}` and hashes raw bytes; regexes compiled once. Seli build 0.17-0.20 s.
- Seli copy before review patches: 0.73 s, 317 nodes, 1471 edges, no P10, ADR-0009 one node, 5 edges into C002. P09 count (565) is mostly unconfigured FR/NFR IDs and `_bmad-output` paths absent from the temp copy.

## Spec Change Log

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap):

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | `status` reports fresh for a fact whose ref is an undeclared ID (placeholder edge carries its evidence); self-loop or ignored facts stay stale forever; facts sharing an evidence tuple borrow resolution | medium | patch | `makeRefResolves` keys on evidence tuples; reproduced by the verification-gap layer |
| 2 | Malformed facts inside a valid envelope, or a `null` envelope, crash build/status (exit 3) | medium | patch | no per-fact validation in `buildGraph`; `envelope.error` on null |
| 3 | Pre-prefixed agent object or subject pointing at a missing doc/anchor/concept makes a phantom node, no P09; edge subject may be absent from `nodes` | medium | patch | prefixed ids passed through unchecked |
| 4 | Prototype-key relation (`toString`) gives relation `undefined` | low | patch | `config.relations[rawKey]` without `Object.hasOwn` |
| 5 | Fragment status from two envelopes depends on readdir order | medium | patch | unsorted envelope iteration breaks determinism |
| 6 | Existing directory link target becomes a `doc:` node | low | patch | `exists` is `existsSync` |
| 7 | Images, links in inline code, and footnote definitions become links | medium | patch | link regexes lack those exclusions |
| 8 | `<!--` inside inline code swallows the rest of the doc; a comment reopened on its closing line leaks | medium | patch | verified: later headings vanish |
| 9 | Anchors `Notes, Notes, Notes-1` collide on `notes-1` | low | patch | suffix counter keyed on base slug only |
| 10 | Setext headings not recognized | low | reject | pilots use ATX; fix adds a branch |
| 11 | Leading `---` thematic break then prose gives false P17 and drops lines | medium | patch | verified by edge-case layer |
| 12 | Non-string frontmatter `id` (`0009` parses as 9) declares a wrong ID | medium | patch | CORE_SCHEMA int |
| 13 | `idPattern` prefix match has no right boundary (`ADR-00091` declares `ADR-0009`) | medium | patch | verified |
| 14 | Status under heading starting with a list, blockquote, or subheading marker yields `''`/`###`, false P20 | medium | patch | verified `- Accepted` gives `''` |
| 15 | Status `map` not NFC-normalized, not boundary-matched, accepts `''` key | medium | patch | `startsWith` on raw text |
| 16 | Frontmatter relation evidence and P12 lines point at an earlier occurrence | medium | patch | `findQuoteLine` over the whole file |
| 17 | `findFrontmatterKeyLine` matches a nested `  id:` | low | patch | leading whitespace allowed |
| 18 | Hash computed from decoded text; status re-reads files | medium | patch | invalid UTF-8 never matches a raw-byte `sourceHash` |
| 19 | P19/P20 always at line 1 | low | patch | source line known |
| 20 | Lookarounds omit `\p{M}`; ID mentions not NFC | low | patch (NFC only) | lookaround text is fixed by the frozen spec |
| 21 | CR-only files number evidence lines differently | low | reject | rare; fix touches three libs |
| 22 | Regexes recompiled per line x pattern | medium | patch | Seli build at 0.73 s against a 1 s budget |
| 23 | Root-absolute link `/docs/x.md` tried doc-relative first | low | patch | leading slash dropped |
| 24 | `computeDocStatus` ignores envelope `schemaVersion` and `source` | low | patch | newer schema treated as fresh |
| 25 | `includeRoot` wrong for `docs/*.md` or exact-file include patterns | medium | patch | verified |
| 26 | `build`/`status` exit 3 on case-fold collision or unsafe path | medium | patch | only `runScope` maps them to 2 |
| 27 | Wrapped status form hides map errors behind source errors; missing `relation` key message | low | patch | early return |
| 28 | "internal error:" prefix on exit-2 errors; duplicated `['docs']` default | low | patch | cosmetic, direct fix |
| 29 | Unterminated regions give no finding | low | reject | needs new rules |
| 30 | `src/project` tests not in any npm script or CI | medium | defer | assigned to story 7 |
| 31 | Missing CLI tests: ref no longer resolves, collision exit 2 | medium | patch | untested paths |
| 32 | "C002 citations dangle" on the fixture | false | reject | fixture Convention type has no `idPattern`; the Seli run with `C\d{3}` gives 5 edges into C002; fixture gets the pattern (patch) |
