---
title: "Phase 1: Generated Contract, Core Payload, and Materialization"
status: completed
effort: "4-5d"
---

# Phase 1: Generated Contract, Core Payload, and Materialization

## Overview

Generate a deterministic, checked-in Desktop workspace contract and uncompressed
core payload from the same authorities as the CLI installer. Embed and verify
static assets/templates plus a versioned materialization recipe in Go so
packaged runtime can safely derive project/root/time/state bytes without
external tools.

Context: [focused scout](./reports/phase-01-focused-scout.md),
[payload research](../reports/researcher-260725-0126-payload-contract.md),
[brainstorm](../reports/brainstorm-260725-0121-welcome-library-provisioning.md),
and [red-team](../reports/red-team-260725-0121-welcome-library-provisioning.md).

## Requirements

- [x] Before any `rootproof`, `os.Root`, loader, or materializer Go test, require
      exact `GOTOOLCHAIN=go1.25.12` locally and Go 1.25.12 in both Desktop CI
      jobs. A branch-aware assertion rejects 1.25.0-1.25.11 and
      1.26.0-1.26.4; later branches require explicit review.
- [x] Fixed profile is `core-generic-en`: core pack, generic target, English,
      canonical UTC clock fields, runtime project name, no IDE links.
- [x] Canonical installer selections, manifest/config composers, schema exports,
      lint IDs, scripts/tools, seeds, and nine core skills have one shared
      build-time authority; the stale config template is not used.
- [x] Generated boundary is `contract.json`, `contract.sha256`, and
      `payload/`, embedded with `//go:embed all:assets`.
- [x] Contract has strict version fields, limits, slash-relative sorted entries,
      kinds, sizes, per-file hashes, empty directories, and root digest.
- [x] Go loader rejects unknown fields/version, invalid or colliding paths,
      links/special entries, missing content, overflow, and all hash drift.
- [x] Contract separates immutable static/template inputs from runtime-derived
      README/config/manifest/CSV state; it declares allowed substitutions and
      canonical rendering/serialization/hash rules.
- [x] Native materialization accepts only friendly name, held verified root,
      and one injected instant; no fixture/build path can enter output.
- [x] `--check` builds in a temp directory and byte-compares without modifying
      the worktree.
- [x] One fixed-input Unicode fixture proves semantic parity with the canonical
      installer; generated machine data, not prose, owns the inventory.
- [x] The conformance harness operates only in an OS temporary directory outside
      the repository and rejects the repository root and every descendant before
      invoking any installer projection or write helper.
- [x] Skill files are packaged but inert: no Desktop advertisement, routing, or
      execution in this phase.

## Files

| Path | Action | Contract |
|---|---|---|
| `src/installer/workspace-definition.js` + test | create | Pure selected directories/files/skills/state metadata and internal fixed-clock projection consumed by installer and generator. |
| `src/installer/commands.js` | modify | Consume shared selections; preserve lazy CLI imports and output. |
| `src/scripts/schemas.mjs`, `schemas.test.mjs` | modify | Own/test ordered lint IDs with existing pure schema data. |
| `src/scripts/lint.mjs` | modify | Consume/export shared ordered check IDs without running CLI work on import. |
| `scripts/generate-desktop-contract.mjs` | create | Deterministic generate/check entry point; no host/path/time leakage. |
| `scripts/generate-desktop-contract.test.mjs` | create | Generator, path, determinism, and drift tests. |
| `apps/desktop/internal/contract/testdata/core-generic-en.json` | create | Single cross-language fixed-input profile. |
| `apps/desktop/internal/contract/assets/**` | generated | Checked-in contract, checksum, and payload tree. |
| `apps/desktop/internal/rootproof/{proof,proof-unix,proof-windows}.go` + tests | create | Neutral held-root/versioned platform proof leaf shared without higher-package imports. |
| `apps/desktop/internal/contract/contract.go` + test | create | Typed verified read-only contract and hostile `fs.FS` tests. |
| `apps/desktop/internal/contract/materialize.go` + test | create | Versioned template/config/manifest/CSV materialization from runtime inputs. |
| `scripts/check-desktop-go-version.mjs` + test | create | Branch-aware patched-toolchain preflight used locally and in CI. |
| `package.json`, `scripts/ci-package.mjs` | modify | Add explicit contract/test scripts and the shared definition to npm runtime allow/required lists; Desktop assets remain excluded. |
| `apps/desktop/go.mod` | modify | record minimum language line and `toolchain go1.25.12`; commands still force exact toolchain |
| `.github/workflows/desktop.yml` | modify | Pin Go 1.25.12, install root deps, and run preflight/generator/drift before Go. |

Generated assets and Wails bindings are machine-owned. Never hand-edit them.

## Interface Checklist

| Symbol/interface | Expected behavior |
|---|---|
| `GenerateDesktopContract(profile, clock)` | Pure deterministic projection from canonical sources. |
| `CheckDesktopContract()` | Temp-generate and compare; zero workspace/worktree writes. |
| `contract.Load()` | Verify checksum, strict decode, independent hard limits, paths, hashes, root digest once. |
| `contract.Bundle.Contract()` | Deep-copy/value view of versions/profile/inventory; no absolute source paths. |
| `contract.Bundle.Payload()` | Read-only verified subtree; callers cannot bypass verification. |
| `contract.Bundle.Materialize(RuntimeInputs)` | Return immutable target-ready inventory and state bytes derived from proven root/name/instant. |

`contract.RuntimeInputs` is exactly `{ProjectName string, Now time.Time,
Root rootproof.RootProof}`. It accepts no caller paths, locale, packs, or
arbitrary substitutions; Phase 2 acquires/revalidates the proof.

`workspace-definition.js` owns a pure
`projectWorkspace(selection, {now})` projection. Production `installCommand`
captures the current instant once and passes it to that projection; tests call
the same private projection with the fixture instant. No public CLI clock flag
or environment override is added.

Parity boundary: static and rendered Markdown/schema bytes are exact; config
YAML and manifest JSON are semantically equal to canonical installer output but
use one canonical Go serialization whose actual bytes are hashed; CSV
columns/order/quoting and hashes of all written bytes are exact.

## Dependency Map

Canonical installer/schema sources -> generator -> checked-in assets ->
Go loader -> Phase 2 provisioner. Root npm/package CI guards against accidental
Desktop asset publication.

## TDD Execution

### Tests Before

1. Generator tests fail for repeated-output drift, traversal, backslash,
   duplicate/case collision, symlink/special source, missing selection, and
   non-canonical JSON/LF/order.
2. Loader tests fail for unknown format/fields, malformed checksum, missing
   embedded entries, size/count overflow, invalid paths, and per-file/root hash
   mismatch.
3. Conformance test runs the canonical install projection for
   `core-generic-en` with a fixed clock and a project name containing spaces,
   Vietnamese, quotes, YAML and Markdown characters in a proven external temp
   root; compare complete sets, static bytes, parsed YAML/JSON semantics, CSV
   order and hashes, manifest fields, and excluded optional content.
4. Explicit embed-coverage tests require `.agents`, `.gitignore`, and `_lumina`.
5. Materialization tests use multiple hostile names and distinct temp roots;
   every manifest `resolvedPaths` value matches its proven root, state hashes
   match materialized bytes, and no fixture/build path survives.
6. Harness safety tests reject the repository root, a nested repo path, and a
   symlink resolving into the repo before any install-projection write.

### Implement

1. Extract only the pure installer data/composers needed by both callers.
2. Land and run the exact patched-Go preflight before rooted Go work.
3. Generate canonical static/template assets and a versioned recipe.
4. Implement verified loader plus native materializer with target-derived state.
5. Wire explicit test scripts and cross-language materialization conformance.

### Refactor

- Remove inventories duplicated between generator and installer.
- Keep CLI entry points lazy; importing pure contract data must not execute a
  command.
- Keep operation registry out of this phase until a later native workflow
  genuinely needs one.
- Do not treat a pre-rendered fixture manifest as payload; final target state is
  materialized and hashed after root proof is available.

### Tests After

```sh
node --test scripts/check-desktop-go-version.test.mjs
GOTOOLCHAIN=go1.25.12 node scripts/check-desktop-go-version.mjs
node --test src/installer/workspace-definition.test.js
node --test scripts/generate-desktop-contract.test.mjs
node --test src/scripts/schemas.test.mjs src/scripts/lint.test.mjs
npm run desktop:contract:check
cd apps/desktop && GOTOOLCHAIN=go1.25.12 go test ./internal/rootproof ./internal/contract
cd ../..
npm run test:all
npm run ci:idempotency
npm run ci:package
```

### Regression Gate

- Existing installer tests and sandbox/idempotency output remain unchanged.
- Canonical sample remains explainable by machine inventory (research baseline:
  50 files, 37 directories, 488,887 bytes); changes require intentional
  regenerated artifacts and conformance review, not hard-coded count edits.
- No generator or Desktop asset is added to the root npm package allowlist.

## Current RED Checkpoint

The current worktree already contains user-owned RED artifacts:
`src/installer/workspace-definition.test.js`,
`scripts/generate-desktop-contract.test.mjs`,
`src/scripts/schemas.test.mjs`, and
`apps/desktop/internal/contract/testdata/core-generic-en.json`. Cook reads,
reviews, and adopts them in place. It does not recreate, replace, or weaken
them. Their missing-module failures are the expected starting state.

## Success Criteria

- [x] Checked-in generation is repeatable and drift-free on CI.
- [x] Native loader verifies the full boundary without external runtimes.
- [x] Installer and native projection conform for fixed inputs.
- [x] Core payload includes inert official skills and excludes non-core packs,
      IDE stubs, `.claude` links, and fake graph content.

## Risks and Rollback

- Extracting installer authority can change CLI output: prove byte/semantic
  parity before and after; revert shared extraction and assets together.
- YAML serializers may differ: compare parsed meaning plus actual files-CSV
  hashes, while exact bytes remain mandatory for static content.
- `go:embed` silently excludes dot/underscore entries without `all:`: retain
  explicit coverage tests as a permanent regression gate.
