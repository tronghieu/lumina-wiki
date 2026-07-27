---
title: "Phase 1 Focused Scout: Deterministic Contract and Payload"
created: 2026-07-25
status: complete
scope: "Phase 1 only"
---

# Phase 1 Focused Scout

## Summary

Phase 1 should produce a deterministic, checked-in Desktop contract and
embedded core payload generated from shared installer authority. It should not
provision a user directory, expose a Wails service, or implement Welcome UI.

The current phase file is only a placeholder
(`phase-01-start.md:8-29`). No contract package, generator, or generated assets
exist. The implementation boundary below is therefore proposed from owning
symbols and existing repository conventions, with rationale for every new file.

The smallest dependency direction is:

```text
canonical CLI data
  -> shared pure workspace definition
  -> deterministic Node generator
  -> checked-in contract/checksum/payload
  -> private Go embed loader
  -> Phase 2 native provisioner
```

## Evidence Anchors

- Package identity/version: `package.json:3-4`.
- Root scripts and existing test commands: `package.json:92-109`.
- npm package allowlist: `package.json:33-79`.
- Core/wiki/raw directory ownership:
  `src/installer/commands.js:108-130`.
- Actual install sequence, runtime variables, payload copies, state-last writes:
  `src/installer/commands.js:308-446`.
- Real config authority:
  `src/installer/commands.js:860-930` (`renderAndWriteConfig`).
- README authority:
  `src/installer/commands.js:933-999` (`renderAndWriteReadme`,
  `extractSchemaTemplate`).
- Generic target intentionally writes no IDE stub:
  `src/installer/commands.js:1013-1022` (`ideTargetFilePath`).
- Static selection owners:
  `src/installer/commands.js:1169-1200` (`copyScripts`, `copyChangelog`);
  `src/installer/commands.js:1203-1229` (`copySkills`);
  `src/installer/commands.js:1243-1301` (`getSkillDefs`);
  `src/installer/commands.js:1303-1342` (`copyTools`,
  `renderSchemaDocs`);
  `src/installer/commands.js:1396-1428` (`writeGitignore`,
  `seedWikiFiles`);
  `src/installer/commands.js:1458-1498` (`buildFilesManifest`).
- Manifest version, headers, paths, and serialization:
  `src/installer/manifest.js:29-32`,
  `src/installer/manifest.js:65-87`,
  `src/installer/manifest.js:182-202`,
  `src/installer/manifest.js:213-282`,
  `src/installer/manifest.js:404-409`.
- Template semantics: `src/installer/template-engine.js:29-94` (`render`,
  `processConditionals`, `substituteVariables`) and
  `src/installer/template-engine.js:112-145` (`renderReadme`).
- Pure schema authority:
  `src/scripts/schemas.mjs:20-42`,
  `src/scripts/schemas.mjs:76-145`,
  `src/scripts/schemas.mjs:177-249`,
  `src/scripts/schemas.mjs:271` (`REQUIRED_FRONTMATTER`).
- Core `readings` versus optional `reflections`:
  `src/scripts/schemas.mjs:102-127`.
- Ordered lint IDs currently live in implementation:
  `src/scripts/lint.mjs:80-83`; they are exported at
  `src/scripts/lint.mjs:1511-1528`.
- Desktop uses Go 1.25: `apps/desktop/go.mod:1-9`.
- Desktop quality currently starts Go tests without a contract drift step:
  `.github/workflows/desktop.yml:13-57`.
- Package jobs compile with Wails from checked-in sources:
  `.github/workflows/desktop.yml:70-125`.
- Existing Go fixture convention:
  `apps/desktop/internal/workspace/service_test.go:9-27` and
  `apps/desktop/internal/testdata/lumina-workspace/**`.

## Exact File Inventory

### Create

| File | Responsibility and rationale |
|---|---|
| `src/installer/workspace-definition.js` | Pure canonical installer inventory/profile module extracted from private constants and helpers in `commands.js:108-130`, `1169-1342`, `1396-1428`, and `1458-1498`. A new boundary is required so CLI and generator consume the same data instead of duplicating it. |
| `src/installer/workspace-definition.test.js` | Focused tests for core/generic/en projection, core skills, directory selection, managed-file selection, and immutability. Colocation matches installer tests. |
| `scripts/generate-desktop-contract.mjs` | Build/test-only entry point and library functions for canonical JSON, source collection, path validation, per-file hashes, root digest, atomic output, and `--check`. `scripts/` is the established home for CI/build utilities. |
| `scripts/generate-desktop-contract.test.mjs` | RED/green generator, drift, path-safety, determinism, and canonical-source tests. Existing script tests are `*.test.mjs`. |
| `apps/desktop/internal/contract/contract.go` | Private Go package that embeds `all:assets`, verifies contract/checksum/payload, rejects unknown formats and unsafe entries, and exposes immutable copies/read-only FS. `internal/` prevents public API commitment. |
| `apps/desktop/internal/contract/contract_test.go` | Loader integrity, malformed injected `fs.FS`, hidden-path coverage, immutability, and no-external-runtime tests. Go tests are colocated. |
| `apps/desktop/internal/contract/testdata/core-generic-en.json` | One cross-language fixed-input conformance profile. It belongs beside the consumer package per existing `internal/testdata` convention, while the Node test reads this exact file; it avoids two handwritten fixtures. |

No extra Go files are justified initially. Split `contract.go` only if the
verified implementation becomes materially harder to review.

### Modify

| File | Required modification |
|---|---|
| `src/installer/commands.js` | Import and consume workspace definition for dirs, selected scripts/tools/schema docs/skills/managed files, template inputs, and config object. Preserve install order and behavior at `commands.js:308-446`. Add an injectable clock only to the pure projection/test path; public CLI defaults remain current UTC behavior. |
| `src/scripts/schemas.mjs` | Export ordered `LINT_CHECK_IDS` as pure contract data. This file already owns pure schema data and is copied into workspaces. |
| `src/scripts/lint.mjs` | Replace local `ALL_CHECK_IDS` at `lint.mjs:80-83` with the shared schema export while preserving its existing exported alias/API at `lint.mjs:1511-1528`. |
| `src/installer/commands.test.js` | Add core/generic/en output contract coverage and prove extraction did not change CLI behavior. Existing pack and skill assertions are at `commands.test.js:47-145` and `900-980`. |
| `src/scripts/schemas.test.mjs` | Add complete contract export assertions, especially lint ID order, entity/edge coverage, core `readings`, and optional `reflections`; current focused coverage is `schemas.test.mjs:10-128`. |
| `package.json` | Add the new installer definition to npm `files`; add `desktop:contract:generate`, `desktop:contract:check`, and `test:desktop-contract` scripts. The current allowlist/scripts are `package.json:33-79` and `92-109`. |
| `.github/workflows/desktop.yml` | Run Node contract tests and `--check` before `go test ./...` in quality. Update Node cache/install only if generator imports root dependencies; current cache is frontend-only at `desktop.yml:27-35`. Package jobs consume checked-in assets and need no generation step. |
| `scripts/ci-package.mjs` | Require the newly imported `src/installer/workspace-definition.js` in the npm tarball. The required runtime list is `ci-package.mjs:71-105`; otherwise published `commands.js` would import a missing file. |

`src/installer/manifest.js` and `template-engine.js` should remain unchanged:
they already export the version/headers and render behavior the generator can
consume. If implementation discovers it needs private CSV serialization, move
that serializer with its existing tests rather than reimplementing it; this is
a conditional refactor, not part of the initial inventory.

### Generated and Checked In

| Path | Generation contract |
|---|---|
| `apps/desktop/internal/contract/assets/contract.json` | Canonical JSON: four explicit versions, schema exports, lint IDs, core profile, state headers, directory list, payload entries, totals, root digest. |
| `apps/desktop/internal/contract/assets/contract.sha256` | Lowercase SHA-256 of exact `contract.json` bytes plus final LF. |
| `apps/desktop/internal/contract/assets/payload/**` | Machine-owned uncompressed static/template tree. Exact path inventory lives only in `contract.json`; source selection comes from `workspace-definition.js`. |

Generated paths must never be edited manually. Empty target directories are
contract entries, not fake keep-files, because `go:embed` ignores empty dirs.

### Explicitly Not Modified in Phase 1

- `apps/desktop/internal/workspace/**`: validation remains read-only and weak
  (`service.go:22-40`); creation belongs to Phase 2.
- `apps/desktop/main.go` and generated Wails bindings: no service is exposed.
- frontend files: no Welcome behavior in this phase.
- Wails build config: Go embed is compiled automatically; no external resource
  copy is needed.
- templates/config file: it is not the real config authority; the composer at
  `commands.js:860-930` is.

## Function and Interface Checklist

### `workspace-definition.js`

- [ ] `CORE_PROFILE` is frozen: core pack, generic IDE, English locale and
  languages, empty purpose, no links.
- [ ] `workspaceDirectories(packs)` derives core/optional dirs without copying
  schema pack rules into Desktop.
- [ ] `workspacePayloadSources(packs)` returns ordered source-to-target entries
  for scripts, tools, schema docs, changelog, templates, seeds, git-ignore, and
  skills.
- [ ] `workspaceSkillDefinitions(packs)` owns canonical ID/display/source path
  order now in `getSkillDefs` (`commands.js:1243-1301`).
- [ ] `managedFilePaths(packs, ideTargets)` owns the current files-CSV candidate
  list (`commands.js:1458-1477`).
- [ ] `buildTemplateVariables(input, now)` reproduces
  `commands.js:343-355`, including UTC date.
- [ ] `buildConfigObject(input, templateVars)` reproduces
  `commands.js:864-923`; serialization remains the existing `js-yaml` call.
- [ ] All returned arrays/objects are copied or frozen so consumers cannot
  mutate module state.

Avoid a general virtual installer. Phase 1 needs only canonical definition and
asset generation.

### `generate-desktop-contract.mjs`

- [ ] `generateDesktopContract({repoRoot, outputDir})` is callable by tests and
  CLI wrapper.
- [ ] `checkDesktopContract({repoRoot, assetsDir})` generates in OS temp,
  compares complete trees byte-for-byte, and never writes assets.
- [ ] `canonicalJSON(value)` recursively sorts object keys, preserves ordered
  arrays, emits two spaces and one LF.
- [ ] `validateLogicalPath(path)` rejects absolute, backslash, NUL, empty,
  dot/traversal, duplicate and case-collision paths.
- [ ] `collectPayloadSources(definition)` uses `lstat`; rejects symlinks and
  non-regular entries; fails when a selected canonical source is missing.
- [ ] `sha256(bytes)` and `payloadRootDigest(entries)` follow the report's
  explicit record format.
- [ ] `writeGeneratedTree()` stages to a temp sibling and replaces only after
  full validation.
- [ ] CLI accepts only default generate and `--check`; unknown flags fail.
- [ ] No generation timestamp, temp path, platform separator, or absolute
  source path enters artifacts.

### `contract.go`

- [ ] `//go:embed all:assets` is on a private `embed.FS`.
- [ ] Private decoded structs mirror contract v1; JSON decoding uses
  `DisallowUnknownFields`.
- [ ] `Load() (*Bundle, error)` verifies once and returns a safe immutable
  handle.
- [ ] Internal `loadFS(fsys fs.FS)` enables hostile `fstest.MapFS` unit cases.
- [ ] Verification order: checksum -> version/JSON shape -> logical paths and
  uniqueness -> counts/sizes -> per-file hashes -> root digest.
- [ ] `Bundle.Contract()` returns a deep copy/value view.
- [ ] `Bundle.Payload()` returns only verified payload subtree as `fs.FS`.
- [ ] No API writes to disk or runs a process.
- [ ] Hard count/byte ceilings are constants above generated totals and tested;
  contract-declared totals alone are not ceilings.

Do not expose raw `assets` or mutable slices/maps. Phase 2 should depend only on
`Load`, `Contract`, and `Payload`.

## Dependency Map

| Producer | Consumer | Contract |
|---|---|---|
| `package.json:3-4` | generator | installer package version |
| `manifest.js:29-32` | generator | manifest schema and CSV headers |
| `schemas.mjs` pure exports | generator, lint, Go contract | schema data and lint IDs |
| `workspace-definition.js` | `commands.js`, generator | installer selection/profile authority |
| `template-engine.js:29-145` | generator/definition tests | canonical render behavior |
| README/schema/skill/script/tool sources | generator | exact source bytes/templates |
| generator | `assets/**` | deterministic checked-in output |
| `assets/**` | `contract.go` | embedded verified bundle |
| `contract.go` | Phase 2 provisioner | immutable contract and read-only payload |
| generator test profile | Node and Go tests | single fixed conformance input |
| package scripts | Desktop quality job | reproducible test/drift commands |
| `commands.js` new import | npm tarball | forces `ci-package.mjs` required-file update |

No edge points from Go back to Node at runtime.

## Tests-Before Matrix

Write these as failing tests before implementation:

| RED test | File | Evidence/expected failure |
|---|---|---|
| Pure definition matches current core dirs, including `wiki/readings`, excluding reflections | `workspace-definition.test.js` | Owners at `commands.js:108-127`, schema distinction at `schemas.mjs:102-127` |
| Core generic profile yields nine inert skill rows and no IDE stub/link | `workspace-definition.test.js` | Skills at `commands.js:1243-1260`; generic null at `commands.js:1013-1022` |
| Config object exactly matches current core/generic/en semantics | `workspace-definition.test.js` | `commands.js:864-923` |
| Fixed clock emits UTC `created_at` | `workspace-definition.test.js` | `commands.js:343-355` |
| Existing installer output is unchanged after extraction | `commands.test.js` | Extend current output tests at `commands.test.js:47-145`, `924-947` |
| Lint ID order comes from pure schema export | `schemas.test.mjs` and existing lint tests | Current local list `lint.mjs:80-83` |
| Repeated generator runs are byte-identical | `generate-desktop-contract.test.mjs` | No generator exists |
| Generator rejects traversal, slash variants, duplicate/case collision, symlink, special file | same | Source safety required by artifact contract |
| Missing selected source fails instead of current copy helpers silently skipping | same | Current skips at `commands.js:1173-1189`, `1193-1200`, `1310-1321` |
| Contract contains four separate versions and complete schema, not operations | same | Sources above; operations have no pure authority |
| `--check` detects modified/missing/extra generated file and leaves worktree untouched | same | Required CI drift behavior |
| Outer contract checksum mismatch fails | `contract_test.go` | No loader exists |
| Unknown version/field, malformed JSON, duplicate/unsafe path, bad count/size/file/root hash fail | same using `fstest.MapFS` | Loader must fail closed |
| Production embed includes dot/underscore roots | same | `go:embed` directory patterns otherwise exclude them |
| Bundle accessors do not mutate cached state | same | Immutable loader contract |
| Loader works with `PATH` empty | same | Packaged runtime cannot require Node/npm/Python |
| Generated contract and canonical installer fixture agree for core/generic/en | Node test plus Go loader test | Current installer execution path `commands.js:308-446` |
| npm dry-run includes new imported definition and excludes Desktop assets | `ci-package` command gate | `package.json:33-79`, `ci-package.mjs:60-115` |

Do not write Phase 2 state-last crash tests here. Phase 1 verifies that state
files are described and payload is readable; it does not write a workspace.

## Execution Order

1. Add RED `workspace-definition.test.js`; extract pure definition and make
   `commands.js` consume it without behavior change.
2. Add pure lint IDs to `schemas.mjs`; update lint consumer and schema tests.
3. Add fixed conformance profile and RED generator tests.
4. Implement generator library/CLI and generate assets.
5. Add RED Go loader tests against injected filesystems.
6. Implement private verified embed loader.
7. Add package scripts, npm allowlist/required-file updates, and Desktop CI gate.
8. Run focused, then installer/script, Go, idempotency, and package regressions.

## Commands

Focused RED/green loop:

```bash
node --test src/installer/workspace-definition.test.js
node --test scripts/generate-desktop-contract.test.mjs
node scripts/generate-desktop-contract.mjs --check
cd apps/desktop && go test ./internal/contract
```

Owning regressions:

```bash
npm run test:installer:commands
npm run test:manifest
npm run test:template
node --test src/scripts/schemas.test.mjs src/scripts/lint.test.mjs
npm run ci:idempotency
npm run ci:package
cd apps/desktop && go test ./...
```

Final broad gate:

```bash
npm run test:all
```

Generation command is intentionally omitted from routine verification except
when accepting source changes; normal CI uses `--check`.

## Risks and Controls

| Risk | Control |
|---|---|
| Extraction changes installer behavior | Make existing command tests pass before generator work; `commands.js` remains orchestration owner |
| Stale config template is mistaken for authority | Test generated config against `buildConfigObject` extracted from `renderAndWriteConfig` |
| CLI and generator keep separate lists | Both import `workspace-definition.js`; generator tests fail if selected source is missing |
| New imported file is absent from npm package | Update both `package.json` allowlist and `ci-package.mjs` required list |
| Hidden payload omitted by embed | Use and test `all:assets` |
| Empty dirs vanish | Contract directory entries; no fake files |
| Platform ordering/case drift | Forward-slash paths, UTF-8 byte sort, reject case collisions |
| Source symlink/device enters payload | `lstat` and regular-file/directory allowlist |
| Generated output carries host/time data | Fixed profile, injected clock, explicit forbidden-value tests |
| Two clocks produce different created/installed times | One injected instant in fixture/projection |
| Contract hash is treated as signature | Document/test integrity only; no authenticity claim |
| Loader trusts malicious declared totals | Independent hard count/byte ceilings |
| Mutable Go result corrupts cached state | Private fields and deep-copy accessors |
| Importing `lint.mjs` pulls implementation or runs main | Move lint IDs into pure `schemas.mjs`; generator never imports `lint.mjs` |
| Phase grows into native provisioning | No disk-write/process/Wails API in `internal/contract`; defer to Phase 2 |
| Generated payload duplicates mutable inventory in code | Exact inventory exists only in generated contract; prose/code use source selectors |

## Unresolved Questions

1. Confirm UTC `created_at` parity versus a coordinated CLI/Desktop local-date
   change. Default Phase 1 assumption: preserve UTC.
2. Confirm semantic YAML/JSON equivalence is sufficient for future native
   provisioning. Phase 1 can generate templates/metadata without deciding the
   native serializer.
3. Define hard loader count/byte ceilings from generated totals plus explicit
   headroom during implementation; do not guess them in the plan.

