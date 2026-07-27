---
title: "Phase 2 Focused Scout: Secure Native Provisioning"
created: 2026-07-25
scope: "native provisioner, validator, and workspace-identity handoff"
status: complete
---

# Phase 2 Focused Scout

## Summary

Phase 2 should add a handle-relative provisioner to
`apps/desktop/internal/workspace`, strengthen the existing validator without
breaking its legacy read-only contract, and transfer a post-provision root
proof into `workspaceid.Manager` before runtime activation. The current phase
file is a placeholder, and Phase 1 has not yet defined an embedded-payload Go
API. Phase 2 implementation must not begin until Phase 1 supplies the bounded,
verified contract listed below.

The smallest safe commit protocol is: app-local process lock; classify through
held parent/target handles; immutable in-target journal; fully sync files in an
in-target transaction directory; publish with `os.Root.Link` so an existing
destination is never replaced; publish canonical state CSVs; publish
`_lumina/manifest.json` last; validate through the same held-root proof; then
begin the identity attach with that proof. Existing workspaces continue through
`Service.Validate` with no workspace writes.

The patched-Go gate is blocking. `apps/desktop/go.mod` says `go 1.25`, CI
resolves `"1.25.x"`, and the local toolchain is Go 1.26.1. `os.Root` is affected
by GO-2026-4970 before Go 1.25.12 and Go 1.26.5. Pin CI/package jobs to a fixed
release at or above those patched versions before the provisioner relies on
`os.Root`.

## Phase Boundary

Included:

- payload-to-filesystem provision transaction;
- target classification and interruption recovery;
- compatible/legacy/newer/malformed native validation;
- proof-preserving handoff into `workspaceid.Manager`;
- focused cross-process, race, crash, and compatibility tests.

Excluded:

- payload generation or template decisions (Phase 1);
- recent-library persistence and restoration (Phase 3);
- Wails/React Welcome and Create/Open flows (Phase 4);
- packaged first-run UX and release matrix beyond compile/test gates (Phase 5);
- source import, graph mutation, checks, history restoration, or native
  maintenance.

## Hard Dependency From Phase 1

Phase 1 must expose a Go-only, already-verified payload contract. Do not have
the runtime inspect installer templates or invoke external programs.

Required contract capabilities:

```go
type PayloadEntryKind string

const (
    PayloadDirectory PayloadEntryKind = "directory"
    PayloadFile      PayloadEntryKind = "file"
)

type PayloadEntry struct {
    Path   string
    Kind   PayloadEntryKind
    Mode   fs.FileMode
    Size   int64
    SHA256 [32]byte
}

type Payload interface {
    ContractVersion() int
    PayloadDigest() [32]byte
    Entries() []PayloadEntry       // sorted, unique, bounded, slash-relative
    Open(string) (io.ReadCloser, error)
    ManifestPath() string          // exactly "_lumina/manifest.json"
    StatePaths() []string          // canonical CSVs committed before manifest
}
```

Phase 1 owns validation of absolute/traversing paths, duplicates, case-fold
collisions, link/special-file types, size/count limits, digest integrity, and
the final-manifest designation. Phase 2 rechecks path and type invariants at
the trust boundary but must not duplicate archive parsing.

If Phase 1 chooses different names/package placement, preserve these semantics.
At present no `go:embed` workspace payload or payload package exists; the only
embed is `frontend/dist` in `apps/desktop/main.go`.

## Exact File Inventory

### Create in `apps/desktop/internal/workspace`

| File | Ownership |
|---|---|
| `provision.go` | public request/result/state types; `Provisioner`; orchestration |
| `provision-classify.go` | complete target classifier and recovery decision |
| `provision-journal.go` | bounded immutable journal encode/decode; inventory reconciliation |
| `provision-root.go` | safe relative path checks, exclusive directory creation, staged writes, `Root.Link`, sync barriers |
| `provision-lock.go` | app-local persistent lock-file verification and lifecycle |
| `provision-lock-unix.go` | nonblocking `flock` |
| `provision-lock-windows.go` | `LockFileEx`/`UnlockFileEx` |
| `provision-lock-fallback.go` | fail closed on unsupported platforms |
| `manifest.go` | bounded manifest syntax/version inspection through `*os.Root` |
| `provision-contract-test.go` | Phase 1 adapter and boundary tests |
| `provision-classify-test.go` | table-driven target state machine |
| `provision-test.go` | happy path, no-overwrite, cancellation, proof result |
| `provision-recovery-test.go` | crash-point replay and committed-residue cleanup |
| `provision-race-test.go` | root/entry replacement hooks and concurrent creators |
| `provision-lock-test.go` | independent-process lock, crash release, malicious lock entry |
| `manifest-test.go` | legacy/supported/newer/malformed validation |
| `provision-test-helpers_test.go` | payload fixture, operation hooks, filesystem snapshots |

Tests may be split differently if files become too small; keep production
responsibilities separate because platform build tags and crash hooks are real
boundaries.

### Modify

| File | Exact change |
|---|---|
| `internal/workspace/service.go` | make `Validate` use a held `*os.Root`; preserve `ValidationResult`; add proof-aware internal/public-native validation without workspace mutation |
| `internal/workspace/tree-root.go` | factor common `openRoot`, `openTrustedRoot`, and shape validation; keep existing tree behavior |
| `internal/workspace/tree-safe.go` | generalize safe slash-relative validation and root-current proof for provisioner reuse |
| `internal/workspace/service_test.go` | add real-root/link/manifest compatibility tests and byte-immutability assertions |
| `internal/workspace/tree-trusted_test.go` | assert factored trusted open still rejects replacement |
| `internal/ai/workspaceid/candidate.go` | accept optional expected `os.FileInfo` and reject candidates not matching it |
| `internal/ai/workspaceid/manager-decisions.go` | add proof-preserving `BeginAttachTrusted` while preserving `BeginAttach` |
| `internal/ai/workspaceid/types.go` | add no new persisted fields; only an error/type if necessary |
| `internal/ai/workspaceid/signature-windows.go` | use `GetFileInformationByHandleEx(FileIdInfo)` 128-bit identity or fail closed when unavailable |
| `internal/ai/workspaceid/manager_test.go` | trusted attach success/replacement tests |
| `internal/ai/workspaceid/security_refinement_test.go` | proof change and token lifecycle tests |
| `internal/ai/workspaceid/trusted-root-identity_test.go` | provision-proof-to-trusted-handle continuity |
| `internal/ai/workspaceid/directory-race_test.go` | independent-manager trusted attach conflict/race |
| `internal/ai/workspace-validator-adapter.go` | expose proof-aware validation without returning root/path data to frontend DTOs |
| `internal/ai/wails_resolver_validator_test.go` | adapter proof, cancellation, typed-nil, and private-data tests |
| `internal/ai/service-types.go` | add narrow trusted validator/attacher interfaces; do not expose `os.FileInfo` in JSON/Wails DTOs |
| `internal/ai/service-activation-run.go` | factor shared validated attach/runtime/session sequence so provisioned activation can carry a proof |
| `internal/ai/service_activation_test.go` | assert provisioned trust order and no duplicate directory approval |
| `internal/ai/service_failures_test.go` | trusted validation/attach/runtime failure rollback |
| `internal/ai/service_test_helpers_test.go` | proof-aware stubs and call log |
| `ai-composition.go` | wire the same workspace service and identity manager into the proof-aware path |
| `ai-composition_test.go` | composition and proof-path construction |
| `go.mod` | establish a patched supported Go floor/toolchain policy |
| `.github/workflows/desktop.yml` | pin quality and package jobs to patched Go; add workspace package to race gate |

### Reference, Do Not Modify for This Phase

| File | Why |
|---|---|
| `plans/reports/researcher-260725-0126-filesystem-safety.md` | accepted safety/recovery basis |
| `src/installer/manifest.js` | canonical manifest version is 4; missing version is legacy schema 1 |
| `src/installer/commands.js` | canonical manifest/CSV shapes and resolved template values |
| `internal/ai/history/atomic.go` | file sync + rename + directory-sync pattern; rename replacement is not suitable for provision publication |
| `internal/ai/history/directories.go` | verified child-root proof pattern |
| `internal/ai/history/lock*.go` | tested kernel-lock pattern |
| `internal/ai/workspaceid/store-io.go` | strict bounded atomic app-state persistence pattern |
| `internal/ai/workspaceid/lock*.go` | persistent private lock verification and crash behavior |
| `internal/importer/service.go` | `O_EXCL`/`File.Sync` principle only; string paths are not a provisioning authority |
| `internal/ai/loaded-runtime-factory.go` | consumes `TrustedRootIdentity`; proves why attach must retain the root proof |
| `internal/ai/immutability_test.go` | existing-open mutation boundary |

`internal/graph` and `internal/tools` also consume `workspace.Service.Validate`;
validator refactoring must preserve their current behavior. They are regression
consumers, not Phase 2 owners.

## Function and Interface Checklist

### Provisioner

- [ ] `NewProvisioner(payload Payload, configBase string, options ProvisionOptions) (*Provisioner, error)`
- [ ] `(*Provisioner).Classify(ctx context.Context, target string) (TargetClassification, error)`
- [ ] `(*Provisioner).Provision(ctx context.Context, target string) (ProvisionResult, error)`
- [ ] `ProvisionResult` contains canonical root, non-serializable `os.FileInfo`
      proof, and recovery disposition; never contains journal internals.
- [ ] `TargetState` covers invalid, unsafe parent, absent, unsafe entry,
      occupied file/special, empty, compatible existing, newer existing,
      malformed existing, owned interrupted, committed residue, dirty/ambiguous.
- [ ] `ProvisionOptions` exposes clock/random and named operation hooks only for
      deterministic tests; production defaults use secure randomness and real I/O.
- [ ] Verify the Phase 1 contract before acquiring the target lock or writing.
- [ ] Acquire one global app-local lock before classification and hold it
      through proof handoff or abort cleanup.
- [ ] Open/hold canonical parent and target roots; revalidate root identity
      before each publication and final manifest.
- [ ] Journal is immutable, `O_EXCL`, bounded, strict, and synced before stage.
- [ ] Stage only regular files inside the target volume; verify size/hash and
      sync before publication.
- [ ] Probe hard-link support before any final entry; fail without fallback if
      unsupported.
- [ ] Create final directories exclusively; publish files with `Root.Link`;
      never use replacing `Root.Rename`.
- [ ] Publish state CSVs before the manifest; manifest is the sole final commit
      marker.
- [ ] Remove only exact transaction-owned residue after committed validation.
- [ ] Cancellation before manifest leaves recoverable journal; cancellation
      after manifest must finish validation/cleanup and report committed success.
- [ ] Errors are stable codes/categories and never contain private paths or raw
      injected OS details.

### Validator

- [ ] Preserve `Service.Validate(string) (ValidationResult, error)` and its
      read-only legacy contract.
- [ ] Replace top-level `os.Stat(filepath.Join(...))` with
      `openTreeRoot`/`Root.Lstat`; `README.md` must be a real regular file and
      `wiki` a real directory.
- [ ] Add `ValidateTrusted(root string, expected os.FileInfo)` or equivalent;
      reopen and require `os.SameFile` before and after validation.
- [ ] Missing manifest is compatible legacy.
- [ ] Present manifest with absent/null `schemaVersion` is legacy schema 1,
      matching `migrateManifest`.
- [ ] Manifest versions 1 through 4 are compatible; greater than 4 is newer.
- [ ] Parse bounded JSON object syntax and reject duplicate `schemaVersion`,
      fractional/non-number versions, trailing values, link/special manifest,
      and oversize input.
- [ ] Do not `DisallowUnknownFields` for old workspaces: installer migrations
      preserve extra fields. Strictness applies to syntax/version, not an
      invented closed schema.
- [ ] Detect packs handle-relatively; do not follow links in optional pack
      directories.
- [ ] Validation does not create app-local history/index state and never writes
      the workspace.

### Identity Handoff

- [ ] Add `Manager.BeginAttachTrusted(root string, expected os.FileInfo)`.
- [ ] Refactor `BeginAttach` through one internal candidate routine; no duplicate
      decision/token/registry logic.
- [ ] Trusted begin opens its own directory handle and requires it to match the
      provision result proof before issuing a token.
- [ ] Existing `ConfirmAttach` revalidates that handle, atomically saves the
      registry, and adopts it for `TrustedRootIdentity`.
- [ ] Preserve current `AttachKind` and confirmation policy; a freshly
      provisioned root should normally be `AttachNew`.
- [ ] If another record matches path/signature, use the existing confirmation
      kinds; never force `AttachNew`.
- [ ] If validation, begin, confirmation, runtime load, or session activation
      fails, close/cancel the candidate and leave no capability active.
- [ ] Windows identity uses volume serial + 128-bit file ID; ReFS must not use
      the current non-unique 64-bit file index.
- [ ] Keep workspace ID and registry app-local; do not add an ID to the
      workspace.

### AI Integration Seam

Use narrow capability extension rather than changing the existing frontend
activation DTO:

```go
type TrustedWorkspaceValidator interface {
    ValidateTrusted(context.Context, string, os.FileInfo) (WorkspaceShape, error)
}

type TrustedWorkspaceAttacher interface {
    BeginAttachTrusted(string, os.FileInfo) (workspaceid.AttachDecision, error)
}
```

The eventual Phase 4 library coordinator should call an internal AI activation
entry point with `ProvisionResult.Root` and `ProvisionResult.Proof`. Do not
export `os.FileInfo`, journal data, absolute paths, or attach tokens through
Wails bindings.

## Dependency Map

```text
Phase 1 verified embedded Payload
                |
                v
workspace.Provisioner <--- configBase ---> app-local provision lock
        |                         |
        |                         +--> flock / LockFileEx
        v
held parent/target *os.Root
        |
        +--> classifier --> journal/recovery --> staged sync --> Root.Link
        |                                                |
        |                                                v
        +--------------------------------------- manifest committed last
                                                         |
                                                         v
workspace.Service.ValidateTrusted(root, proof)
                                                         |
                                                         v
workspaceid.Manager.BeginAttachTrusted(root, proof)
        --> ConfirmAttach --> TrustedRootIdentity
                                                         |
                                                         v
LoadedRuntimeFactory.Load --> session.Registry.Activate
```

Forbidden dependency directions:

- provisioner must not import Wails, frontend, Node, Python, CLI, graph, tools,
  importer, history, or provider packages;
- `workspaceid` must not import `workspace`; it receives only standard-library
  proof types;
- Phase 2 must not read installer templates at runtime;
- validator must not trust `ResolveInside` string containment.

## TDD Matrix

| Area | Red test first | Expected invariant |
|---|---|---|
| contract | unsupported version/digest, unsorted or duplicate entry, traversal, absolute/backslash path, link/special type, limit overflow | no target access before rejection |
| request | empty, relative, unclean, invalid UTF-8/control, oversized target | invalid without path disclosure |
| parent | missing, file, symlink/junction/reparse, replaced after open | no outside write |
| target absent | two creators race at first mkdir | one owner; loser reclassifies/busy |
| target type | file, FIFO/socket/device where available, symlink/junction | collision/unsafe; no mutation |
| target empty | existing real empty directory | journal is first entry |
| existing legacy | real README + wiki, no manifest | compatible; byte-for-byte unchanged |
| manifest | missing/null/1/2/3/4/5, malformed, duplicate key, fractional, trailing JSON, oversize, symlink | legacy/supported/newer/malformed exactly |
| dirty | arbitrary entry, corrupt/foreign journal, unexpected transaction entry | never clean or overwrite |
| journal | write/close/sync/root-sync failure | untrusted; safe retry or explicit conflict |
| staging | short read, oversize stream, hash mismatch, file sync failure | no final path |
| publish | destination appears before `Link`; directory replaced; root renamed/replaced | abort; foreign entry unchanged |
| hard link | supported probe; unsupported filesystem simulation | proceed or fail before final publication |
| ordering | hooks at each CSV and manifest | manifest is always last final entry |
| crash replay | kill after journal, every stage sync, mkdir, link, each state file, manifest, validation, cleanup | absent/full final files only; retry converges |
| committed residue | valid manifest + exact journal/stage leftovers | validate, remove exact residue, open |
| cancellation | before journal, during stage, during publish, after manifest | cancelled or recoverable before commit; success after commit |
| lock | independent processes, busy owner, owner crash, symlink/nonregular lock path, stale release | one process; kernel releases crash; lock file persists |
| validator race | root/README/wiki/manifest replacement at every open | proof mismatch or invalid, never follow |
| trusted attach | proof matches, root replaced before begin, during signature, before confirm | only exact root gets token/ID |
| identity | new, known, same-volume rename, copy, path reuse, missing signature, collision | existing AttachKind semantics preserved |
| Windows identity | 128-bit FileIdInfo success/failure/ReFS | unique signature or fail-closed ambiguity |
| integration | provision → trusted validate → trusted begin → confirm → runtime → activate | exact call order and one capability |
| rollback | validation/attach/runtime/session failure | handles closed; token cancelled; prior session preserved |
| privacy | injected private paths/OS errors/journal IDs | stable sanitized errors/DTOs |
| regressions | graph/tools/importer call existing Validate | current compatible workspaces still work |

Use operation hooks, not sleeps, for deterministic replacement and crash-point
tests. Use subprocess helpers for kernel-lock crash behavior, following
`workspaceid.TestCrashLeftLockIsRecovered`.

## Verification Commands

Narrow loop:

```sh
cd apps/desktop
go test ./internal/workspace -run 'Test(Provision|Classify|Manifest|ValidateTrusted)'
go test ./internal/ai/workspaceid -run 'Test(Attach|Trusted|PendingHandle|IndependentManagers)'
go test ./internal/ai -run 'Test(WorkspaceValidator|Provisioned|ApprovedKnownWorkspace)'
```

Concurrency and package gates:

```sh
cd apps/desktop
go test -race ./internal/workspace ./internal/ai/workspaceid ./internal/ai
go test ./internal/workspace ./internal/ai/workspaceid ./internal/ai ./internal/graph ./internal/tools ./internal/importer
go test ./...
GOOS=windows GOARCH=amd64 go test -exec=true ./internal/workspace ./internal/ai/workspaceid
```

Patched toolchain gate:

```sh
cd apps/desktop
GOTOOLCHAIN=go1.25.12 go version
GOTOOLCHAIN=go1.25.12 go test ./internal/workspace ./internal/ai/workspaceid ./internal/ai
```

Before implementation, update both `desktop.yml` jobs from floating `1.25.x`
to an explicitly reviewed patched release, initially `1.25.12`, and add
`./internal/workspace` to the race command. Package tests must run under the
same pinned release. A future upgrade to 1.26 requires 1.26.5 or later.

Current baseline evidence:

- focused workspace/workspaceid/AI tests pass;
- workspace/workspaceid race tests pass;
- local linker emits macOS deployment-version warnings for the AI test but
  tests pass;
- local toolchain Go 1.26.1 is vulnerable and is not acceptable evidence for
  the new provisioner.

## Implementation Order

1. Land the patched-Go CI/package gate.
2. Accept Phase 1's payload interface, limits, and manifest/state ordering.
3. Write classifier and manifest compatibility tests; refactor validator to
   held-root operations.
4. Write app-local process-lock tests and implementation.
5. Write journal/stage/link happy-path tests and provisioner.
6. Add deterministic crash, cancellation, collision, and TOCTOU matrices.
7. Add `BeginAttachTrusted` and Windows 128-bit identity tests.
8. Add proof-aware validator/AI handoff and rollback tests.
9. Run focused, race, cross-compile, consumer regression, and full suites.

## Risks and Guardrails

- **Payload API missing:** Phase 1 is still a placeholder. Do not encode a
  second payload schema in Phase 2.
- **Vulnerable standard library:** a passing test on Go 1.26.1 does not prove
  rooted containment. Pin patched Go before accepting security results.
- **Hard-link availability:** exFAT and unusual/network filesystems may reject
  links. V1 must fail before publication unless product scope funds
  platform-specific no-replace rename.
- **Power-loss durability:** `File.Sync` plus directory sync is strongest on
  Unix; some Windows/filesystems reject directory sync. Promise deterministic
  process-crash recovery, not universal hardware durability.
- **Validator compatibility:** `Service.Validate` is used by graph, tools,
  importer, AI, and Wails. Do not turn optional legacy-manifest absence into
  rejection or close JSON fields not owned by Desktop.
- **Manifest authority drift:** source says schema 4 while
  `docs/project-context.md` says 1. Source and tests are authoritative.
- **Proof loss:** returning only a canonical string between provisioning and
  attach reopens the path-replacement race. Carry `os.FileInfo` internally.
- **Identity drift on Windows:** current 64-bit file index is not sufficient for
  ReFS. Do not claim stable isolation without 128-bit `FileIdInfo`.
- **Split locks:** never unlink a persistent lock file while an owner holds it;
  another process could lock a new inode.
- **Over-broad cleanup:** delete only the transaction directory named by a valid
  matching journal. Unknown or corrupt state is a conflict.
- **Post-commit cancellation:** once the manifest is linked, the operation is
  committed; finish validation/cleanup instead of returning a false cancelled
  result.
- **Wails surface leakage:** `os.FileInfo`, canonical paths, tokens, journal
  details, and raw errors remain backend-only.
- **Scope creep:** do not refactor the three existing lock implementations,
  add repair/update flows, or change importer safety in this phase.

## Unresolved Questions

1. What exact package and interface will Phase 1 expose for the verified
   embedded payload?
2. Is hard-link-capable storage an accepted v1 requirement?
3. Should proof-aware activation be an internal AI method now, or land only as
   validator/attacher interfaces for the Phase 4 library coordinator?
4. Is `1.25.12` the chosen pinned branch, or should Desktop standardize on
   Go 1.26.5+?
