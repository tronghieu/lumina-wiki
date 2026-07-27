---
phase: 2
title: "Generated workspace contract"
status: todo
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 2: Generated workspace contract

## Context Links

- [Phase 1](./phase-01-baseline-and-capability-matrix.md)
- [`src/scripts/schemas.mjs`](../../src/scripts/schemas.mjs)
- [`src/installer/manifest.js`](../../src/installer/manifest.js)
- [`package.json`](../../package.json)

## Overview

Generate one versioned Desktop contract and deterministic workspace payload from
the CLI sources so Desktop does not maintain a second handwritten schema.

The focused Welcome plan owns the `core-generic-en` provisioning payload,
runtime materialization recipe, and loader subset. This phase retains the full
v1.9.2 entities/edges/lint/check/mutation contract consumed by later phases; do
not mark this whole phase complete from the focused subset.

## Requirements

- Functional: export package version, packs, entities, edge rules, lint rules,
  managed-file metadata, and install payload inventory required by Desktop.
- Non-functional: generated assets are deterministic, hash-verified, embedded in
  the Go binary, and never generated at packaged-app runtime.

## Architecture

A side-effect-free Node generator imports canonical CLI data during build/test
and emits JSON plus an uncompressed deterministic payload tree. A native Go loader validates
the contract version and hashes before any service uses it. CI fails when checked
in assets differ from generated output.

## Related Code Files

- Create: `/Users/plateau/Project/lumina-wiki/scripts/generate-desktop-contract.mjs`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/contract/contract.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/contract/contract_test.go`
- Create: `/Users/plateau/Project/lumina-wiki/apps/desktop/internal/contract/assets/`
- Modify: `/Users/plateau/Project/lumina-wiki/package.json`
- Modify: `/Users/plateau/Project/lumina-wiki/.github/workflows/desktop.yml`

## Implementation Steps

1. Write RED Go tests for contract parsing, version rejection, hash mismatch,
   traversal entries, and complete v1.9.2 entity/edge coverage.
2. Write RED Node tests for byte-identical generation and drift-check mode.
3. Implement the generator using only canonical schemas, installer manifests,
   templates, and package metadata.
4. Embed and validate the assets in Go; expose an immutable typed contract to
   provisioning, graph, checks, and mutation services.
5. Add a CI command that regenerates into a temporary directory and compares
   bytes without mutating the working tree.

## Tests Before

- [ ] A missing `readings`, `reflections`, or v1.9.2 operation fails conformance.
- [ ] Changed CLI schemas without regenerated assets fail the drift check.
- [ ] Malformed version, hash, or payload logical path is rejected.

## Refactor

Move Desktop schema constants behind the contract API only after contract tests
pass; do not change user-visible behavior in this phase.

## Tests After

- [ ] Repeated generation produces identical bytes and hashes.
- [ ] The Go loader covers every accepted CLI capability through v1.9.2.
- [ ] The loader works with `PATH` excluding Node, npm, and Python.

## Regression Gate

Run the generator check, its Node tests, and
`cd apps/desktop && go test ./internal/contract/...`.

## Success Criteria

- [ ] CLI source changes cannot silently diverge from Desktop.
- [ ] Packaged runtime has a verified native contract and payload.

## Risk Assessment

Template ordering or runtime fields can make output nondeterministic. Normalize
logical paths, ordering, serialization, and injected runtime values before hashing.

## Security Considerations

Reject absolute paths, `..`, symlinks, duplicate payload entries, oversized
payloads, unknown contract versions, and hash mismatches before extraction.
