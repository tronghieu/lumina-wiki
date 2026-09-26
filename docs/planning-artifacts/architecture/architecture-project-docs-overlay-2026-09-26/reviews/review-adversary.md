# Adversarial Review — project-docs-overlay spine

Lens: two units one level down, each obeying every AD to the letter, that still build incompatibly.
Spine: `../ARCHITECTURE-SPINE.md`. Spec: `docs/specs/spec-project-docs-overlay/SPEC.md` + `ontology.md`.

**Verdict:** Not buildable in parallel yet. The spine fixes the fact-file envelope and who writes each directory, but leaves the fact record itself, the built graph, the merge of parse and agent output, and fragment identity undefined. Those four are the shared data every consumer depends on; two faithful teams would ship incompatible formats on day one.

Ranked by severity. Each entry: units, ADs both satisfy, the clash, proposed rule.

---

## Critical

### C1. The fact record has no shape, and its id has no canonical input

- **Unit A:** `facts-write` (AD-5, AD-10). Stores `{subject, relation, object, evidence:{quote, line}}`; hashes `JSON.stringify([relation, subject, object, anchor])`, where anchor is the evidence heading.
- **Unit B:** deterministic parse (AD-11, AD-12). Emits `{from, to, type, file, line}` edges and `{node, status}` attributes; never computes an id.
- **Both satisfy:** AD-10 fixes only the top-level envelope `{schemaVersion, source, sourceHash, ontologyVersion, facts[]}`. AD-11 says store references as written. Nothing defines a fact's fields.
- **Clash:**
  - Build receives two record shapes and must guess which is which.
  - Attribute facts (`status: superseded`, concept aliases) have no `object`, so `hash(relation, subject, object, anchor)` is undefined for them.
  - "anchor" could mean the subject's anchor, the object's anchor, or the evidence location.
  - Because references are hashed as written, one ingest writing `ADR-0009` and the next writing `docs/adr/0009-x.md` give the same edge two ids. That churn is exactly what AD-10 exists to prevent.
  - Hash serialization, algorithm, and truncation are unstated, so two implementations disagree on every id.
- **Proposed rule (new AD-18, Fact record):** `lib/fact.mjs` defines the one record shape used by both the parse output and fact files: `{id, kind: "edge"|"attr", subject, relation, object|value, evidence: {line, quote?}, provenance: "extracted"|"inferred"}`. `id` = the first 16 hex characters of sha256 over the canonical JSON array `[kind, relation, subject, object|value]`, with no evidence fields. `facts-write` rewrites each reference to its canonical form (C4) before hashing.

### C2. "The built graph" is not an artifact: lint, query, and view can each build their own

- **Unit A:** `query` / `view` read `_lumina/graph/graph.json`, written by `build` (AD-5: the engine owns `_lumina/graph`).
- **Unit B:** `lint` "runs on committed facts plus a fresh parse" (AD-14). In CI `_lumina/graph/` does not exist because it is gitignored, so lint builds in memory with its own merge code.
- **Both satisfy:** AD-5, AD-12, AD-14, AD-15.
- **Clash:**
  - Two build paths produce two answers. Lint flags a citer that query says is fine.
  - The parsed-part file format under `_lumina/graph/` has no owner. `refresh` writes it, `build` reads it, and neither AD fixes its schema or its file names (one file or per doc).
  - Typing is split too. AD-7 says "lint and graph build" resolve types. The `related:` typing rule (ontology.md) needs the target's meta-type, and only the resolver (AD-11, at build) knows it. So a parser that types `related:` at parse time has to embed a second resolver.
- **Proposed rule (new AD-19, One build function):** Every consumer calls one in-process `buildGraph(root)`, which returns `{nodes, edges, findings, freshness}` and is the only code that resolves references, applies project-to-meta mapping, applies `related:` typing rules, and falls back to `references`. The parse emits raw relation names only (`related`, link, mention). Files under `_lumina/graph/` are caches of this build, stamped with their input hashes. Define `graph.json` as `{schemaVersion, inputs, nodes[{id, kind, type, metaType, status, file, line}], edges[{id, from, to, relation, metaRelation, provenance[], evidence[]}]}`.

### C3. Parse and agent assert the same edge or attribute, and nobody owns the merge

- **Unit A:** parse. From ADR-0009 frontmatter `related: [ADR-0052]` it emits `references` (no typing rule for Decision to Decision). From `status: accepted` it emits status on `ADR-0009`.
- **Unit B:** ingest. It emits `ADR-0052 supersedes ADR-0009` and "ADR-0009 status superseded (rows 3–5)".
- **Both satisfy:** AD-10, AD-11, and ontology.md "every fact, parsed or agent-extracted".
- **Clash:**
  - The graph ends up with both a `references` edge and a `supersedes` edge. Node degree doubles in the view, and query lists the pair twice.
  - When both sides produce the same typed edge, the ids match only if the as-written references match (C1). Otherwise lint double-flags the citer.
  - Status has two owners. The `supersedes` rule "target status must be superseded" reads parse status (`accepted`) and fires on every partial supersession. Query ("governed by a superseded decision") may read the agent status and disagree with lint.
- **Proposed rule (tighten AD-19):** Build merges edges by resolved `(from, metaRelation, to)`. It keeps one edge with the union of provenance and evidence, and drops a `references` edge whenever a typed edge joins the same pair. A document node's status comes only from the configured status source (frontmatter or heading). Agent facts may set status only on fragment nodes, and a document-level conflict becomes a finding, never a silent override.

### C4. Fragment identity: agent-invented anchors, two slug functions, and duplicate declared IDs

- **Unit A:** parse. Creates fragment nodes from headings, slugged by `lib/markdown.mjs`. Duplicate headings get `-1` suffixes (GitHub style, because humans copy GitHub anchors into links).
- **Unit B:** ingest. The flagship case is a row of ADR-0009's status table, which has no heading, so the agent writes `docs/adr/0009-x.md#row-3` and on the next run `#decision-table-row-3`. `facts-write` slugs it with the same function and accepts it.
- **Both satisfy:** AD-11 (one slug function, used in both the parser and `facts-write`), AD-10.
- **Clash:**
  - Sharing the slug function does not make the anchor exist.
  - The agent mints fragments the parse never sees. Two runs mint different ones for the same row, and a citer's `#status` link resolves to a parser fragment the agent never attached facts to.
  - Separately, `lib/slug.mjs` (the existing `slugify`) drops `đ` and other letters without a decomposition, so `Đổi` and `Ổi` both become `oi`. GitHub anchors keep them. If `lib/markdown.mjs` reuses `slugify`, human-written `#đổi-mới` links never resolve on Seli's mixed Vietnamese and English docs.
  - Two docs that both define `ADR-0009` (a pain point the spec names) give two owners of one node id, and AD-11's "declared project ID first" does not say which one wins.
- **Proposed rule (tighten AD-11):**
  - Fragment nodes come only from the parse: heading anchors (GitHub-compatible, Unicode-preserving, `-N` duplicate suffix in document order) and declared-ID definition sites. `facts-write` rejects an anchor that the parse of the current source does not produce.
  - A tableless or headingless part is addressed as its enclosing fragment plus the evidence line.
  - A declared ID defined in two places produces a duplicate-ID finding, and references to it resolve to neither.

---

## High

### H1. Project mode commits `_lumina/manifest.json`, which carries timestamps and is the only record of mode

- **Unit A:** installer project branch. It writes `_lumina/manifest.json` with `installedAt`/`updatedAt` (`src/installer/manifest.js:49-50`) and records `mode` there (AD-2).
- **Unit B:** the AD-3 `.gitignore` block. It ignores only `_lumina/graph/` and `_lumina/_state/`, so the manifest is committed alongside scripts, config, and facts.
- **Both satisfy:** AD-2, AD-3.
- **Clash:**
  - Every re-install changes a committed file, so CAP-1's "a second install produces no diff" fails in the project repo. The classic CI ignores the manifest only because classic never commits it.
  - If the manifest is ignored instead, a teammate's clone has no manifest. Their install then counts as fresh and asks classic vs project, which breaks AD-2's "fixed per repo".
- **Proposed rule (tighten AD-2/AD-3):** In project mode the manifest lives under a gitignored path (or goes in the `.gitignore` block). An install that finds a committed `_lumina/config/project.json` runs in project mode without asking, and `--mode classic` exits 3.

### H2. Staleness has two sources, the ingest skill has no engine contract, and a zero-fact doc re-ingests forever

- **Unit A:** the hook's `refresh`. It "marks that doc's agent facts stale" (brownfield.md) by writing `_lumina/_state/stale.json`, which AD-12 allows.
- **Unit B:** `query`. It computes staleness live from `sourceHash` (AD-12). Meanwhile `lumi-project-ingest` picks docs to process by reading fact files directly, because AD-15 binds only the ask, verify, and view skills.
- **Both satisfy:** AD-12, AD-15.
- **Clash:**
  - With hooks off (CAP-8's success test), `stale.json` and live staleness disagree.
  - "Changed since last ingest" is counted one way by query (docs with a fact file only) and another by ingest (docs without a file are also pending).
  - A doc with no extractable facts gets no fact file if `facts-write` skips empty arrays, so every ingest run re-processes it. That breaks CAP-6's "processes zero docs".
  - Race: the agent reads a doc and then spends minutes extracting. The user edits the doc in between, and `facts-write` stamps the new hash on facts drawn from the old text.
- **Proposed rule (tighten AD-12, extend AD-15):**
  - Freshness is always computed live from `sourceHash` against the current hash, and nothing about it is stored. Each doc is in one of three states: `fresh`, `stale`, `never-ingested`.
  - Every skill, ingest and check included, selects docs through `project.mjs status --json`.
  - `facts-write` requires the caller to pass the `sourceHash` it read and rejects a mismatch (exit 2). It writes a file even when `facts: []`.

### H3. Partial supersession has two valid encodings

- **Unit A:** an agent emits `supersedes` with object `docs/adr/0009-x.md#decision-table` (a fragment).
- **Unit B:** an agent emits `supersedes` with object `ADR-0009` plus `partial: true` and the row list in the quote.
- **Both satisfy:** ontology.md ("may be partial"), AD-10, AD-11.
- **Clash:**
  - Lint's "flag every citer of the superseded part" can only work with encoding A.
  - With encoding B, every citer of ADR-0009 is flagged, or none is.
  - The status rule fires or stays quiet depending on which encoding was used.
- **Proposed rule (tighten AD-7):** Partial supersession is expressed only as `supersedes` whose object is a fragment node, and the `supersedes` rule treats that fragment as superseded. A document-level object means full supersession. A citer of the whole document when only a fragment is superseded gets an `info` finding.

### H4. Concepts have two minting paths

- **Unit A:** parse. It creates `concept:<slug>` only for vocabulary entries in `project.json` (AD-8).
- **Unit B:** ingest. It finds "hạn mức tín dụng", which is not in the vocabulary, and `facts-write` stores it as written (AD-11). Build resolves it to no concept alias and emits a dangling reference. Alternatively, a different implementer mints `concept:han-muc-tin-dung`, and that collides with or duplicates the `credit-limit` alias.
- **Both satisfy:** AD-8 (config holds the vocabulary), AD-11 (resolution by concept alias).
- **Clash:**
  - CAP-7 ("every mention of credit limit") depends on which implementer wrote build.
  - The concept vocabulary can only grow through setup, because `facts-write` cannot write config, but no AD says so.
- **Proposed rule (new, under AD-8):** Concept nodes exist only for `project.json` vocabulary entries, with id `concept:<anchor-slug(canonical name)>`. Two entries or aliases with the same slug fail `config-check`. An agent mention of an unknown term becomes an `unknown-concept` finding that proposes a setup re-run, and `facts-write` never mints concepts.

### H5. `project.json` has two writers, and `ontologyVersion` has no definition

- **Unit A:** installer. It seeds `project.json` with `include: [docs]` so CAP-2's default and `config-check` work before setup, and then rewrites it on re-install for idempotency.
- **Unit B:** setup skill. It writes the file with its host `Write` tool, which is not atomicWrite, and hand-increments `ontologyVersion` as an integer. Another agent run forgets to increment it after remapping a type.
- **Both satisfy:** AD-8 ("the setup skill writes it") and AD-10 ("an ontology change marks older facts").
- **Clash:**
  - A re-install reverts the approved config.
  - A forgotten bump leaves facts typed under the old mapping marked fresh.
  - A scope-only edit bumps the version needlessly and marks every fact for re-ingest.
  - A Lumina upgrade that changes `ontology.mjs` has no version at all.
  - `schemaVersion` (fact format), `ontologyVersion` (project mapping), and the meta-ontology version are never distinguished.
- **Proposed rule (tighten AD-8):**
  - The installer writes `project.json` only when it is absent.
  - Setup writes it through `project.mjs config-write` (JSON on stdin, validated, atomic).
  - `ontologyVersion` = sha256 of the canonical JSON of the typing keys only (type map, relation map, `related:` rules, vocabulary), computed by the engine and never hand-written.
  - `schemaVersion` versions file formats. `META_VERSION` in `ontology.mjs` versions the meta-ontology.

### H6. The installer writes a file that may be in scope

- **Unit A:** installer. It writes the `lumina:project` block into `AGENTS.md`/`CLAUDE.md` (AD-3).
- **Unit B:** scope matcher. The user's include is `["**/*.md"]`, or `packages/*/docs/AGENTS.md` exists (AD-9 excludes only `.git/`, `node_modules/`, `_lumina/`, and the default host directories).
- **Both satisfy:** AD-3, AD-9.
- **Clash:**
  - AD-1 says no installer step writes an in-scope file, so AD-1 and AD-3 contradict each other.
  - The block's text also gets parsed. Its skill names and links become mentions and dangling references, and every re-install that changes the block makes that doc stale.
  - The setup skill may also rewrite the block after setup, to point at ask and check. The next install reverts it.
- **Proposed rule (tighten AD-1/AD-3):**
  - Every reader strips Lumina marker regions (`lumina:project`, `# >>> lumina`) before hashing and parsing, so those regions are outside the source layer.
  - Only the installer writes them. Setup never edits them.

### H7. Uninstall leaves a hook that fails

- **Unit A:** uninstall. It removes `_lumina/scripts/` and "never touches hook files" (AD-17).
- **Unit B:** hook. The registered command is `node _lumina/scripts/project.mjs refresh` (AD-12/13).
- **Both satisfy:** AD-12, AD-13, AD-17.
- **Clash:**
  - After uninstall, every Edit/Write runs a command that fails: node prints `Cannot find module` and exits 1, which contradicts AD-12's "prints nothing, always exits 0".
  - CI that still runs `project.mjs lint` also breaks.
  - The kept `facts/` and `config/` plus a missing manifest trigger the fresh-install mode question from H1.
- **Proposed rule (tighten AD-12/AD-17):** The registered hook command guards itself (`test -f _lumina/scripts/project.mjs && node _lumina/scripts/project.mjs refresh; exit 0`). Uninstall prints the hook entries and the CI line the user must remove.

### H8. Evidence matching: `facts-write` and `verify-evidence` apply different tests

- **Unit A:** `facts-write`. It rejects a fact without a quote (AD-10) and accepts one if the quote is a substring anywhere in the file.
- **Unit B:** `verify-evidence`. It checks the quote starts exactly on `line` after CRLF-to-LF conversion (Conventions: "quote verbatim plus 1-based line").
- **Both satisfy:** AD-10, AD-12, Conventions/Evidence.
- **Clash:**
  - A quote the agent wrapped across two lines, stripped of `**`, or given with the wrong line passes Unit A and fails Unit B.
  - After one line is inserted above a quote, every fact below it reads as broken rather than moved, so CAP-11 reports noise.
- **Proposed rule (tighten Conventions/Evidence):**
  - `lib/evidence.mjs` holds the one matcher: whitespace runs collapse to one space, and the quote must occur within the text starting at `line`.
  - `facts-write` rejects a quote that fails it.
  - `verify-evidence` returns `ok`, `moved` (with the new line), or `broken`.

### H9. Orphan fact files: build uses them, lint drops them, and nobody can delete them

- **Unit A:** build. It loads every file under `_lumina/facts/` (AD-10: one file per source doc).
- **Unit B:** lint. It selects files through the scope matcher (AD-9), so after the user adds `exclude: [docs/user-guide]` it ignores fact files for excluded or deleted sources.
- **Both satisfy:** AD-9, AD-10 ("nothing auto-deleted").
- **Clash:**
  - Query shows edges that lint never checks.
  - Nobody can delete an orphan fact file: AD-5 makes the engine the only writer, and no subcommand removes facts. Orphans pile up in the commit.
- **Proposed rule (tighten AD-10):**
  - Build loads fact files only for in-scope, existing sources. Every other fact file becomes an `orphan-facts` finding, or a rename candidate when its hash matches.
  - `project.mjs facts-prune --yes` is the only deletion path.
  - `facts-write` rejects a source that is out of scope.

---

## Medium

### M1. Lint rule ids exist only for relation-owned rules

- **Units:** `lint`, which numbers relation rules `P01…` in `ontology.mjs` (AD-7, AD-14), and build/`config-check`, which emit dangling-reference, duplicate-ID, external-ID-mismatch, stale-hook, and zero-match-include findings.
- **Clash:** AD-14 says each rule is "owned by one meta-relation", so those other findings have no registry. Two units pick `P09` independently, and CI parses different meanings from one id.
- **Proposed rule:** `ontology.mjs` exports a `RULES` table covering every finding id the engine emits, each with an owner (a meta-relation or `engine`). An unregistered id is a test failure.

### M2. Concurrent writers of one doc and of the parsed part

- **Units:** the ingest skill fans out subagents (two per large doc, each calling `facts-write` for the same source), and parallel `PostToolUse` hooks each run `refresh`.
- **Both satisfy:** AD-5 and atomicWrite (each file write is atomic).
- **Clash:**
  - Last writer wins, so half of a doc's facts vanish silently.
  - A refresh that writes `parsed.json` and `_state/hashes.json` as two files can be read torn: new facts against old hashes.
- **Proposed rule:**
  - `facts-write` replaces one doc's entire fact set per call, and the skill contract says one call per doc.
  - The parsed part is one file that embeds the hash map it was built from, and a reader trusts it only when those hashes match.

### M3. A node id changes when a doc enters scope

- **Units:** build resolves an out-of-scope `FR6.7a` to `ext:FR6.7a` (AD-11). After the user adds `_bmad-output/` to scope, it resolves to declared `FR6.7a`.
- **Clash:**
  - Every node id and edge id touching FRs changes, so git-diffing the graph between commits (brownfield.md's decision-history method) reports all of them as removed and added.
  - Fragment ids (`<path>#<anchor>`) carry no prefix while the others do, so a declared ID containing `#` collides with the fragment form.
- **Proposed rule (tighten AD-11):** Every ID node is `id:<ID>` with `defined: true|false`. Fragments are `frag:<path>#<anchor>`. Every node id carries a prefix.

---

## Low

- **L1. Who deletes `view.html`?** `refresh` may clear `_lumina/graph/` before rewriting the parsed part, which deletes the file `view` wrote (AD-16). graph-view.md says it is "regenerated on each build", and AD-16 says `view` writes it. Rule: engine writers replace named files and never clear the directory, and only `view` writes `view.html`.
- **L2. Fact file paths on case-insensitive disks.** `docs/ADR.md` and `docs/adr.md` map to the same fact file on macOS and Windows. Rule: `config-check` fails when two in-scope paths are equal after lowercasing.
- **L3. Lint output only "mirrors" `lint.mjs --json`.** That shape has `schema_version`, `scanned_files`, `checks_run`, and `fixable`/`fix_applied` per finding. Two implementers will keep different subsets. Rule: list the exact project lint JSON keys in AD-14.
