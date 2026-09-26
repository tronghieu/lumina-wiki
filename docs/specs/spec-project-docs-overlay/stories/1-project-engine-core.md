---
title: 'Project engine core'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '0a56f831feb028f687421abdaee3485eea319e29'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/source-scope.md'
  - '{project-root}/docs/specs/spec-project-docs-overlay/ontology.md'
  - '{project-root}/docs/planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Project mode has no engine. Every later story (parse, facts-write, lint, query, view) needs the meta-ontology, a validated `project.yaml`, one scope matcher, root discovery, and the fact record shape.

**Approach:** Create the self-contained engine tree `src/project/` with pure-data `ontology.mjs`, shared libs, vendored js-yaml, and a `project.mjs` CLI exposing `scope` and `config-check`, tested on synthetic fixtures (SPEC CAP-2, CAP-4; spine AD-5 to AD-9, AD-18, AD-21, AD-25).

## Boundaries & Constraints

**Always:**
- Edit only `src/project/`. Engine code imports only `node:` builtins and files inside `src/project/`; the only vendored import is `vendor/js-yaml.mjs` (AD-6).
- Exception: the glob parity test may import `src/scripts/lib/globs.mjs` (test-only, AD-9).
- JSON to stdout; `{error, code, ...}` to stderr. Exit 1 bad args or unknown subcommand, 2 invalid config / no root / unsafe path / case-fold collision, 3 internal error or newer `schemaVersion` or Node < 24 (AD-14).
- Output byte-identical for unchanged input: sorted arrays, no timestamps, no absolute paths.
- Tests: `node:test` + `node:assert/strict`, co-located `*.test.mjs`, fixtures under `src/project/test-fixtures/`.

**Never:**
- No edits to `package.json`, `scripts/`, `src/installer/`, `src/scripts/` (packaging and `test:project` wiring are story 7).
- No write paths, lock, atomicWrite, parse, or graph code (story 2+). Nothing speculative.
- No npm dependency, no `.gitignore` consultation, no `!` negation or `{a,b}` globs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Scope happy path | `include: [docs, "packages/*/docs"]`, `exclude: [docs/user-guide]` | sorted repo-relative markdown paths; exclude wins | N/A |
| Bare directory | `include: [docs]` | same set as `docs/**` | N/A |
| Empty include | pattern matches nothing | file list unaffected; warning with rule `P16` naming the pattern | exit 0 |
| Always excluded | `.git/`, `node_modules/` at any depth, root `_lumina/` | never listed, even if included | N/A |
| Default excluded | root `.claude/` etc. | excluded unless an include pattern's first segment names that dir | N/A |
| Unsafe pattern | `../x`, `/abs`, `C:/x`, `a\b` | not scanned | exit 2, error lists pattern |
| Case-fold collision | `docs/A.md` and `docs/a.md` in scope | none | exit 2, error lists the pair |
| No root | cwd has no ancestor with `_lumina/config/project.yaml` | none | exit 2 |
| Subdirectory cwd | run from `docs/adr/` | same output as from root | N/A |
| Invalid config | unknown key, unknown meta-type, bad regex, duplicate concept slug | none | exit 2, `errors[]` lists every problem at once |
| YAML syntax error | malformed file | none | exit 2 with parser message |
| Newer schema | `schemaVersion: 2` | none | exit 3 |
| config-check ok | valid config | `{"ok":true,"schemaVersion":1,"ontologyVersion":"<64 hex>"}` | N/A |

</frozen-after-approval>

## Code Map

- `src/scripts/lib/globs.mjs` -- classic `matchGlob` (`*` = one segment, `**` = any depth, regex-escaped). Reimplement semantics; parity-test against it. Do not modify.
- `src/installer/fs.js:141` -- classic `safePath` rules (reject absolute, drive letter, `..` segment). Mirror as a pure check on relative patterns; do not import.
- `node_modules/js-yaml/dist/js-yaml.mjs` (4.1.1, MIT, exports `load`, `CORE_SCHEMA`, `YAMLException`) and `node_modules/js-yaml/LICENSE` -- copy verbatim to vendor.
- `src/scripts/lint.mjs:3429-3481` -- classic CLI shape: parse argv, set `process.exitCode` rather than `process.exit()` after writing stdout.

## Tasks & Acceptance

**Execution:**
- [x] `src/project/vendor/js-yaml.mjs`, `src/project/vendor/THIRD-PARTY-NOTICES.md` -- vendor js-yaml 4.1.1 byte-identical; notice holds its MIT text (force-graph added in story 6).
- [x] `src/project/ontology.mjs` + test -- `META_TYPES`, `META_RELATIONS`, `RULES` per Design Notes; pure data, frozen; test ids unique and owners valid.
- [x] `src/project/lib/fsx.mjs` -- `assertSafeRelPath(p)` throwing `RangeError`.
- [x] `src/project/lib/scope.mjs` + tests -- `compileGlob`, `selectScope(root, sources)` per matrix; parity test vs classic `matchGlob` on a shared pattern/path list.
- [x] `src/project/lib/hash.mjs` + test -- `sha256Hex`, `canonicalJson` (sorted keys, recursive), `contentHash(buf)` (strip BOM, CRLF and lone CR to LF, AD-12).
- [x] `src/project/lib/markdown.mjs` + test -- `slug(text)` only: NFC, lowercase, drop chars not letter/mark/number/`_`/`-`/space, spaces to `-`; Vietnamese preserved.
- [x] `src/project/lib/fact.mjs` + test -- `makeFact()` and `factId()` per AD-18.
- [x] `src/project/lib/config.mjs` + tests -- `findRoot(cwd)`, `loadConfig(root)` (validate, collect all errors), `ontologyVersion(config)` (AD-21).
- [x] `src/project/project.mjs` + CLI tests -- Node >= 24 check, subcommands `scope`, `config-check`; every other subcommand exits 1.
- [x] `src/project/test-fixtures/` -- synthetic repos covering the matrix, including a CRLF/BOM file and a Vietnamese heading.

**Acceptance Criteria:**
- Given the fixtures, when `node --test src/project/` runs, then all tests pass with no import from outside `src/project/` except the parity test.
- Given the same fixture, when `scope` runs twice, then stdout is byte-identical.
- Given every `from '...'` / `import('...')` specifier in non-test `src/project/**/*.mjs`, then each starts with `node:` or `./`/`../` and none resolves outside `src/project/`.

## Design Notes

`project.yaml` shape (schema v1; later stories may add keys before release):

```yaml
schemaVersion: 1
sources: { include: [docs], exclude: [] }      # default include [docs]
types:
  ADR:
    metaType: Decision
    paths: ["docs/adr/**"]                     # at least one of paths / frontmatter
    frontmatter: { type: adr }
    idPattern: 'ADR-\d{4}'                     # compiled with the u flag
    status: { heading: Status }                # or { frontmatter: status }
relations: { implements: satisfies }           # project name -> meta-relation
relatedRules:
  - { source: Capability, target: Decision, relation: governs, inverse: true }
externalIds: [{ pattern: 'FR[\w.-]+' }]
concepts: [{ name: credit limit, aliases: [hạn mức] }]
```

`ontologyVersion` = `sha256Hex(canonicalJson({types, relations, relatedRules, concepts}))`. Concept slug via `slug(name)`; a slug or alias shared by two concepts is an error. In scope = extension `.md`, `.markdown`, or `.mdx`.

Meta-types: `Decision` (lifecycle `proposed|accepted|superseded|deprecated`), `Requirement`, `Rule`, `Capability`, `Process`, `Structure`, `Concept`, `Actor`, `Issue`, `Evidence`, `Document`; `governance: true` on the first three. Meta-relations: `supersedes`, `satisfies`, `governs`, `depends-on`, `part-of`, `contradicts`, `justified-by`, `owned-by`, `mentions`, `references`.

`RULES` (`id`, `owner`, `severity`):

| id | owner | sev | finding |
|---|---|---|---|
| P01 | supersedes | error | supersedes cycle |
| P02 | supersedes | warning | superseded target status is not superseded |
| P03 | supersedes | warning | doc cites a superseded part |
| P04 | satisfies | warning | requirement nothing satisfies |
| P05 | governs | warning | governor is superseded |
| P06 | depends-on | error | depends-on cycle |
| P07 | part-of | error | part-of cycle |
| P08 | contradicts | warning | contradiction |
| P09–P15 | engine | warning, error, warning, warning, warning, error, info | dangling reference, duplicate declared ID, external ID pattern mismatch, unmapped doc type, stale facts, broken evidence, rename candidate |
| P16 | engine | warning | include pattern matches no files |

Fact record key order: `id, kind, subject, relation, object|value, ref, scope?, evidence{line, quote}, provenance`. `id` = first 16 hex of `sha256Hex(JSON.stringify([kind, relation, subject, object ?? value, scope ?? null]))`. `makeFact` rejects: `kind` not `edge|attr`, edge without `object`, attr without `value`, both present, `line` not an integer >= 1, empty `quote`, `provenance` not `extracted|inferred`.

## Verification

**Commands:**
- `node --test src/project/` -- expected: all pass.
- `cd src/project/test-fixtures/<repo>/docs && node ../../../project.mjs scope` -- expected: same JSON as from the fixture root.
- `npm run test:scripts` -- expected: unchanged, all pass.

## Implementation Notes

- Built by four parallel agents split by file (vendor+ontology; fsx+scope; hash+markdown+fact; then config+CLI).
- Every include/exclude pattern also matches everything beneath it, so `packages/*/docs` behaves like a bare directory.
- Symlinks are skipped during the scope walk (`ponytail:` comment in `lib/scope.mjs`).
- `.git/` and `node_modules/` fixture dirs are created by `scope.test.mjs` at run time; git cannot track them.
- Case-fold collision is unit-tested on `findCaseFoldCollisions`; a case-insensitive checkout cannot hold the pair on disk.
- Config rejects `!` negation and `{a,b}` in any glob, and non-string concept aliases.

## Spec Change Log

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap):

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | File-level patterns (`docs/*.md`, `docs/readme.md`) select nothing; file exclude ignored | high | patch | `normalizePattern` appends `/**` to every pattern; spec allows that only for bare dirs |
| 2 | `docs/` and `./docs` select nothing | medium | patch | compiled to `docs//**` and `./docs/**` |
| 3 | `?` in a glob throws SyntaxError (exit 3) or acts as a quantifier | medium | patch | not escaped in `compileGlob`; rejected in config instead, keeping classic parity |
| 4 | Prototype keys (`toString`) pass as meta-types | low | patch | `in` operator on `META_TYPES` |
| 5 | Two concepts with the same name accepted | medium | patch | owner check compares names |
| 6 | Punctuation-only concept slugs to '' | low | patch | no empty-slug check |
| 7 | `include: []` silently becomes `[docs]` | low | patch | `selectScope` default on empty length |
| 8 | `paths: []` passes paths-or-frontmatter rule | low | patch | presence check only |
| 9 | Default YAML schema turns dates into Date, canonicalized to `{}` | medium | patch | Code Map names `CORE_SCHEMA` |
| 10 | `factId` not canonical for object values | medium | patch | spine AD-18 says canonical JSON |
| 11 | `makeFact` accepts missing subject/relation/ref | medium | patch | no checks on those fields |
| 12 | `scope: null` kept in record, ignored by id | low | patch | `scope !== undefined` check |
| 13 | `findRoot` walks past a dir on EACCES | low | reject | unlikely; fix adds error branching |
| 14 | EACCES/EPERM/EISDIR exit 3, contract says 2 | medium | patch | rethrown to `main().catch` |
| 15 | Case-fold check ignores NFC/NFD | medium | patch | `toLowerCase()` only |
| 16 | Collision never exercised through `selectScope`/CLI; stderr drops pairs | medium | patch | test builds the error by hand |
| 17 | `_lumina` exclusion untested (no markdown there) | low | patch | fixture holds only `project.yaml` |
| 18 | `ontologyVersion` only shown to react to `types` | medium | patch | no test for other sections |
| 19 | Most config rules have no rejecting fixture | medium | patch | one invalid fixture covers four rules |
| 20 | Import-boundary AC checked by nobody | medium | patch | no scan test |
| 21 | Node < 24 exit 3 unverified | low | reject | 5-line check; faking `process.versions` adds test complexity |
| 22 | P16 literal not tied to `RULES` | low | patch | `const P16 = 'P16'` |
| 23 | Test `before()` pollutes checked-in fixture | low | patch | no cleanup |
| 24 | Vietnamese CRLF fixture unused by tests | low | patch | only read manually |
| 25 | Weak CLI/test assertions | low | patch | invalid-config scope checks exit code only; loose regex |
| 26 | Direct-run check fires for any `*project` script | low | patch | `endsWith('project')` |
