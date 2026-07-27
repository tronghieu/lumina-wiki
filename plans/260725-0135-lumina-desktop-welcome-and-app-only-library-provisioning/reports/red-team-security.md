---
title: "Security adversary review: Lumina Desktop Welcome and app-only provisioning plan"
reviewed: "plans/260725-0135-lumina-desktop-welcome-and-app-only-library-provisioning"
created: 2026-07-25
status: findings
---

# Security Adversary Review

This review checks the plan document against the current repository contracts. It
does not assess implementation quality and did not run lint, build, or tests.

## Findings

### 1. Critical — Hiding `Run Check` does not remove the renderer-callable workspace-code execution primitive

**Plan location:** `phase-04-welcome-create-open-and-restore-ux.md:39-40`,
`:57`, `:110`, `:120`, and `:149-150`; `plan.md:21-22` and `:67-68`.

The plan limits the change to hiding or making the action unavailable on the
app-only *surface*. Its file list does not remove the tools service from Wails,
and its regression criterion is only that no apparently functional Check is
present in the UX. Today the service is registered with Wails
(`apps/desktop/main.go:26-30`), its generated binding remains directly callable
(`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/service.ts:12-15`),
and `RunCheck` resolves `_lumina/scripts/lint.mjs` and starts `node` in the
workspace (`apps/desktop/internal/tools/service.go:40-47`, `:55-67`, `:74-76`).
Phase 1 deliberately packages scripts/tools (`phase-01-generated-contract-and-core-payload.md:24-26`).

**Concrete failure:** compromised renderer code, an injected frontend asset, or
any code able to call Wails bindings invokes `RunCheck` directly after the button
is hidden. On a machine with Node on `PATH`, Desktop executes code from the
user-controlled workspace with Desktop's privileges; on a clean machine it still
violates the claimed no-external-runtime contract.

**Required fix:** make backend unavailability an acceptance criterion. Do not
register `desktoptools.Service` in the app-only build, or make `RunCheck` fail
closed behind a backend feature/capability gate. Delete the generated binding and
add a packaged test that a direct Wails call cannot spawn Node. UI hiding is not
a security control.

### 2. High — Raw-root Wails services remain an authorization, disclosure, and mutation bypass

**Plan location:** `phase-03-app-local-library-and-restoration-state.md:11-13`,
`:32-33`, `:44-49`, and `:148`; `phase-04-welcome-create-open-and-restore-ux.md:31-34`,
`:52`, `:57`, and `:76-78`.

The plan says React receives no canonical root and that reads are authorized via
active session -> loaded runtime -> trusted root, but it does not remove the
existing workspace, graph, or importer registrations. All three are registered
as public Wails services (`apps/desktop/main.go:26-30`). Generated bindings still
accept arbitrary renderer-supplied roots for `Validate`, `Summary`, `Load`, and
`ReadNote`
(`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`;
`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph/service.ts:12-20`).
`ReadNote` reads and returns file content from the supplied root
(`apps/desktop/internal/graph/service.go:42-65`, `:69-83`), while
`ImportToRawSources(root, sourcePath)` accepts two arbitrary paths and writes
workspace bytes (`apps/desktop/internal/importer/service.go:25-44`, `:48-59`,
`:73-76`).

**Concrete failure:** renderer code bypasses the new session capability by
calling `ReadNote` against a known library that is not active, exposing its note
content across windows/libraries. It can also call `ImportToRawSources` to copy a
chosen local file into any path that passes the weak legacy workspace check,
contradicting the open-without-mutation guarantee.

**Required fix:** add `main.go` and generated-binding removal to the plan.
Unregister raw-root graph/importer/workspace methods from Wails, or wrap every
renderer-facing operation in the session lease and held-root authorization used
by the AI service. Keep raw-root helpers internal Go APIs only. Add hostile
direct-binding tests, not just frontend-import scans.

### 3. High — Default Create has no unforgeable native user-approval step

**Plan location:** `plan.md:57-61`; `phase-04-welcome-create-open-and-restore-ux.md:28-32`,
`:60-63`, `:70-78`, and `:115`.

The proposed public interface is
`CreateAndActivateLibrary(name, backendLocationChoice)` and only an optional
`Change location` is routed through a native picker. The plan never requires
native approval for accepting the default Documents/home destination, nor does
it define `backendLocationChoice` as a window-bound, single-use, expiring
capability. The existing secure Open path first resolves the calling window and
then obtains the directory from `NativeAuthority`
(`apps/desktop/internal/ai/service.go:57-80`); its authority contract exposes
native selection/confirmation methods
(`apps/desktop/internal/ai/service-types.go:69-77`).

**Concrete failure:** renderer code calls `CreateAndActivateLibrary` without a
user gesture and silently creates a library under Documents or home. If a
location choice is merely an enum/DTO, it can also replay or forge that value
from another window. The UI location summary is not an authorization boundary.

**Required fix:** require every Create mutation, including the default, to pass a
window-bound native approval. Either use a native save/directory dialog at commit
time or issue a backend-only one-time location capability bound to window,
canonical parent identity, proposed child name, expiry, and activation lease.
The Wails create call must not accept a reusable path or forgeable location
choice.

### 4. High — The “deterministic immutable payload” has no defined treatment for target-specific manifest paths

**Plan location:** `phase-01-generated-contract-and-core-payload.md:22-36`,
`:48`, `:62-66`, `:84-87`, and `:92-95`;
`phase-02-secure-native-provisioning.md:22-23`, `:30-31`, and `:87-90`.

Phase 1 makes the payload immutable, generated without host/path leakage, and
consumable through a verified read-only API. Phase 2 says it publishes that
payload and writes the manifest last, but no phase defines a trusted
target-specific manifest composer. The canonical manifest is not static: the
installer writes `projectRoot`, `wiki`, `raw`, `.agents`, and `_lumina` as
absolute `resolvedPaths` (`src/installer/commands.js:425-441`) and writes current
install/update timestamps (`src/installer/commands.js:429-431`). The generator
interface accepts only `(profile, clock)`, not the verified destination
(`phase-01-generated-contract-and-core-payload.md:62`).

**Concrete failure:** the embedded manifest either contains fixed fixture/build
paths (leaking the build host and pointing later tooling outside the created
library), contains semantically wrong paths for the user's destination, or the
provisioner performs an undocumented post-verification rewrite that invalidates
the claimed immutable payload/hash boundary.

**Required fix:** explicitly split static verified payload from a small
target-derived state composer. Reuse the canonical manifest composer with the
held target capability, derive every resolved path from the proven target, hash
and validate the final manifest, and publish that generated byte sequence last.
Add tests that no build/fixture path appears and every `resolvedPaths` value
matches the activated root.

### 5. High — “Manifest last” cannot be used as a universal trust marker for existing CLI libraries

**Plan location:** `plan.md:63-64`, `:81-89`;
`phase-02-secure-native-provisioning.md:24-25`, `:30-37`, `:75-78`, `:103`,
and `:148-155`.

The plan calls the manifest the last trust marker and says strict supported
schema 1-4 manifests open, but it does not distinguish Desktop-created
transactions from existing CLI installations or require validation of all three
installer state files before treating the latter as committed. The canonical CLI
currently writes the manifest **first**, then the skills CSV and files CSV
(`src/installer/commands.js:444-446`). Repository documentation confirms that
these are three separate atomic files, not one atomic transaction
(`src/installer/manifest.js:3-18`), and the manifest itself contains no file
inventory/hashes (`src/installer/manifest.js:45-55`).

**Concrete failure:** the CLI is interrupted after line 444. Desktop later sees
a valid schema-4 manifest plus `README.md`/`wiki`, classifies it as a committed
supported library, and activates a partially installed workspace. Conversely,
recovery logic may mistake CLI residue for a Desktop transaction even though no
Desktop journal exists.

**Required fix:** scope “manifest last” to journals bearing the Desktop
transaction format. For arbitrary existing manifests, validate the required
state-file set and consistency (or explicitly classify incomplete CLI state as
unsupported/recoverable without mutation). Add a crash fixture at each current
CLI write boundary and require the compatibility classifier to fail closed.

### 6. Medium — Replacing Windows' 64-bit identity with 128-bit identity lacks a compatibility migration

**Plan location:** `phase-02-secure-native-provisioning.md:38-39`, `:53-55`,
`:107`, and `:117`; `phase-03-app-local-library-and-restoration-state.md:27-28`,
`:43`, and `:78-79`.

The plan changes the signature implementation but does not version or migrate
existing registry signatures. Current Windows identities are serialized from
`VolumeSerialNumber + FileIndexHigh + FileIndexLow`
(`apps/desktop/internal/ai/workspaceid/signature-windows.go:12-24`). When the new
128-bit value differs, the current classifier sees one path match and no
signature match and labels it path reuse
(`apps/desktop/internal/ai/workspaceid/classify.go:10-14`, `:32-34`). Confirming
path reuse creates a new workspace ID and deactivates the prior record
(`apps/desktop/internal/ai/workspaceid/manager-confirm.go:57-78`).

**Concrete failure:** the first Windows launch after upgrade treats the user's
unchanged library as a replacement. Confirmation assigns a new ID, so recent
state and history remain attached to the old ID; an old 64-bit collision can
also make naive migration ambiguous. This breaks the promised safe continuity
precisely on the platform whose identity semantics are being corrected.

**Required fix:** specify a versioned signature format and a one-time,
fail-closed migration. For a unique same-path legacy record, require the normal
identity confirmation, obtain the 128-bit handle identity, update the signature
while preserving the workspace ID, and record the migration atomically.
Multiple legacy signature/path matches must remain ambiguous. Add upgrade
fixtures containing real legacy serialized records.

### 7. Medium — “Private permissions” for new app state is not a Windows security design

**Plan location:** `phase-03-app-local-library-and-restoration-state.md:20-26`,
`:37-42`, `:51`, and `:96-100`; `phase-05-packaged-runtime-and-cross-platform-gates.md:22-27`
and `:46-60`.

The plan requires private app-state permissions but names no Windows ACL helper,
ACL verification, or Windows privacy gate. Copying the nearest workspace-ID
store pattern would not satisfy the requirement: on Windows its permission
checks unconditionally return true
(`apps/desktop/internal/ai/workspaceid/private-mode-windows.go:1-8`), while the
store relies on those checks to accept directories/files
(`apps/desktop/internal/ai/workspaceid/store.go:54-65`;
`apps/desktop/internal/ai/workspaceid/store-io.go:18-23`). The repository already
has the stronger pattern needed for sensitive history: a protected owner/system
DACL applied through the opened handle
(`apps/desktop/internal/ai/history/protection-windows.go:31-52`, `:55-80`).

**Concrete failure:** under a permissive or tampered Windows config directory,
the app-state file is accepted as “private” even when another local principal
can read or replace it. That principal can learn recent opaque IDs and alter
restore/focus state; combined with the identity registry's canonical paths, this
undermines the plan's privacy and safe-restore assumptions.

**Required fix:** require handle-based owner/system DACL application and
verification for the app-state directory, lock, temp file, and final file;
prefer reusing/generalizing the existing history protection implementation.
Add native Windows tests for permissive inherited ACLs, hostile replacement, and
post-rename ACL preservation, and include them explicitly in the Windows gate
matrix.

## Disposition

The plan should not be considered implementation-ready until findings 1-5 are
resolved in the plan's interfaces, file ownership, and acceptance gates.
Findings 6-7 need explicit Windows migration/privacy contracts before the
cross-platform phase can credibly prove safe restoration.
