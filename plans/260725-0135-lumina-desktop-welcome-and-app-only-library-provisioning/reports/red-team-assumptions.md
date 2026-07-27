# Red-Team Assumption and Full-Tier Scope Audit

Scope: plan documents only. Claims were checked against the repository with
`rg`, `nl`, `wc`, and file enumeration. No code, tests, build, lint, or type
checks were run.

## 1. BLOCKER — The checked-in payload has no contract for runtime materialization

**Plan location:** `phase-01-generated-contract-and-core-payload.md:22-36`,
`:58-66`, `:84-95`; `phase-02-secure-native-provisioning.md:62-68`.

Phase 1 requires a checked-in deterministic payload that has semantic parity
with an install using a runtime project name, but its only generator interface
is `GenerateDesktopContract(profile, clock)`. Phase 2 then accepts only a
verified `Payload`; neither phase defines who substitutes the actual library
name, target root, install/update timestamps, manifest-resolved paths, YAML, or
derived file hashes at creation time.

**Failure scenario:** The generated payload either contains the fixed
conformance-fixture project name and paths, so every created library is wrong,
or the Go provisioner independently reimplements the installer composers. The
latter silently creates the second handwritten workspace contract that Phase 1
claims to eliminate.

**Repository evidence:** The installer derives template values at runtime,
including project name and date, in `src/installer/commands.js:290-355`, renders
config and README from them at `src/installer/commands.js:357-364`, and derives
timestamps, absolute resolved paths, and state manifests only after materialized
files exist at `src/installer/commands.js:415-446`. YAML serialization is also
runtime behavior in `src/installer/commands.js:860-930`.

**Required fix:** Split the generated boundary explicitly into immutable static
payload/templates and a versioned materialization recipe. Assign one phase an
API such as `Materialize(profile, RuntimeInputs{name, root, now})`, including
canonical YAML/JSON/CSV serialization and post-render hashing. Conformance must
compare multiple hostile runtime names and roots, not one fixed fixture. The
provisioner must consume that API rather than inventing its own renderer.

## 2. CRITICAL — “No root in React” breaks the still-supported Import workflow

**Plan location:** `phase-04-welcome-create-open-and-restore-ux.md:31-34`,
`:52-63`, `:70-78`, `:113-120`.

The phase removes canonical roots and frontend pickers from React, and explicitly
hides only `Run Check`. It does not remove Import, list the importer service as a
changed boundary, or define a capability-scoped replacement.

**Failure scenario:** Implementing the stated DTO boundary leaves Import unable
to call its backend because it no longer has a root. Keeping the current call
preserves absolute workspace/source/destination paths in React and violates the
new boundary. Quietly deleting Import is an unapproved public-feature cut.

**Repository evidence:** `apps/desktop/frontend/src/App.tsx:124-149` passes the
workspace root, source path, and Import callbacks through the shell.
`apps/desktop/frontend/src/features/workspace/use-workspace.ts:154-200` performs
the file picker and invokes `ImportToRawSources(root, sourcePath)`.
`apps/desktop/internal/importer/service.go:12-16` returns absolute source and
destination fields, and its method requires a raw root at `:25-45`.

**Required fix:** Make an explicit MVP decision. Either hide/unavailable Import
with `Run Check` in this focused plan, or add a capability-scoped native import
coordinator that owns the picker and active session and returns relative/safe
results only. Add the owning importer, Wails binding, UI, and regression files
to Phase 4; do not leave the behavior implicit.

## 3. CRITICAL — “Legacy opens read-only” is a label, not an enforced capability

**Plan location:** `plan.md:47-50`;
`phase-02-secure-native-provisioning.md:36-39`, `:66-68`;
`phase-04-welcome-create-open-and-restore-ux.md:70-89`.

The plan classifies legacy `README.md` plus `wiki/` libraries as read-only, but
no interface carries an access mode into the activated session, no backend
mutation service is required to reject writes for that mode, and no UI rule
disables existing mutations.

**Failure scenario:** A legacy library opens successfully, then the user clicks
Import. The app creates `raw/sources` and copies a file into a workspace the
product contract declared read-only. Future umbrella mutation features would
have the same hole.

**Repository evidence:** The current Import button remains enabled whenever a
workspace root exists in
`apps/desktop/frontend/src/features/graph/artifact-pane.tsx:80`.
`apps/desktop/internal/importer/service.go:37-49` treats the existing shape
validator as sufficient and creates directories, then creates and writes the
destination at `:58-80`. Its test fixture proves that `README.md` plus `wiki/`
is accepted at `apps/desktop/internal/importer/service_test.go:66-75`.

**Required fix:** Add a backend-owned `read-only | writable` capability to
classification, activation, and session/runtime state. Every mutation boundary
must reject read-only sessions regardless of UI state; the UI may additionally
hide or disable those actions. Add a legacy-open-then-import rejection test and
make the umbrella mutation phases consume the same capability.

## 4. HIGH — Exact destination preview contradicts the declared DTO surface

**Plan location:** `plan.md:43-46`;
`phase-04-welcome-create-open-and-restore-ux.md:28-32`, `:70-78`.

The accepted product decision requires showing the exact proposed destination
before mutation. The phase simultaneously prohibits the exact path from Wails
DTOs and exposes only `CreateAndActivateLibrary(name,
backendLocationChoice)`. There is no preview/default-location method and no
native confirmation interaction in the contract.

**Failure scenario:** React can show only a vague “Documents” summary, violating
the exact-destination decision, or a developer adds the canonical path to a DTO,
violating the privacy/capability decision. The first mutation becomes the first
time the user can learn the actual target.

**Repository evidence:** The current UI solves location display by retaining the
raw root in frontend state:
`apps/desktop/frontend/src/features/workspace/use-workspace.ts:78-124` and
`apps/desktop/frontend/src/App.tsx:124-129`. The existing native authority
returns the selected directory as a string in
`apps/desktop/internal/ai/wails-native-authority.go:38-70`; there is no opaque
location-choice/display contract to reuse.

**Required fix:** Choose and document one coherent interaction. The safest
option is a backend/native pre-mutation confirmation dialog that displays the
exact path without sending it to React and returns an opaque location token.
Alternatively, explicitly relax the DTO rule for a display-only path and define
its privacy treatment. Add preview/cancel/stale-token tests and the missing API
to the Phase 4 checklist.

## 5. HIGH — The focused plan claims phases 2–3 ownership but also duplicates phase 9

**Plan location:** focused `plan.md:22-34`; umbrella `plan.md:51-56`;
umbrella `phase-09-desktop-integration-and-release-gates.md:19-36`, `:49-60`.

The focused plan calls itself execution detail for umbrella phases 2–3, yet its
Phases 4–5 own Welcome integration, accessibility, packaged jobs, docs, and
cross-platform release evidence. The umbrella only says to synchronize phases
2–3, while its phase 9 independently owns those same UI, bindings, workflow,
documentation, and packaged-gate surfaces.

**Failure scenario:** Completing the focused plan leaves umbrella phase 9
“pending,” so a later executor repeats or rewrites already accepted UI and CI
work. Conversely, marking phase 9 complete from focused results falsely claims
the unrelated check/fix/ranking/long-source journeys that phase 9 also owns.

**Repository evidence:** Both plans name
`apps/desktop/frontend/src/app/app-shell.tsx`, generated bindings, and
`.github/workflows/desktop.yml` as modified surfaces. Umbrella phase 9 also
requires check/fix, answer filing, ranking, and long-source journeys at
`phase-09-desktop-integration-and-release-gates.md:49-58`, which the focused
plan explicitly excludes at focused `plan.md:22-24`.

**Required fix:** Add an explicit ownership/status matrix. Either state that the
focused plan owns umbrella phases 2–3 plus a named Welcome/provisioning subset
of phase 9, with phase 9 retaining the remaining journeys, or remove focused
Phases 4–5 and leave integration/release to umbrella phase 9. Status must be
tracked per acceptance subset, not by marking the whole umbrella phase complete.

## 6. CRITICAL — Packaged creation proof has two incompatible definitions

**Plan location:** focused `plan.md:93-94`;
`phase-05-packaged-runtime-and-cross-platform-gates.md:22-30`, `:54-71`,
`:123-140`; umbrella
`phase-09-desktop-integration-and-release-gates.md:33-36`, `:57-58`, `:73-80`.

The focused gate says package jobs prove only install/launch, composed native
tests prove lifecycle, and manual GUI evidence covers interaction. The umbrella
requires packaged workspace-creation smoke on every OS. The focused success
criteria then collapse these distinct evidence classes back into “packaged
create/open/relaunch/recovery evidence” without defining what is authoritative,
who records manual evidence, where it lives, or how stale evidence expires.

**Failure scenario:** The plan is declared complete from service integration
tests plus a five-second executable launch even though no packaged artifact
performed Create/Open. Alternatively it remains permanently blocked because an
automated package journey was expected but no automation boundary was planned.

**Repository evidence:** Current package CI only starts each executable, sleeps
five seconds, checks it is alive, and terminates it in
`.github/workflows/desktop.yml:157-186`. Current Playwright runs a Vite fixture,
not the packaged app, in
`apps/desktop/frontend/playwright.config.ts:49-53`; the visual specs navigate
that fixture in `apps/desktop/frontend/tests/visual/desktop-shell.spec.ts:3-6`.

**Required fix:** Pick one release contract before execution. Either specify a
real packaged-app automation boundary, harness owner, test entry point, and
artifact evidence for all three OSes, or change both plans to state
“service-level lifecycle + packaged launch + versioned manual checklist.”
For the manual option, define owner, checklist path, package digest/version,
date/freshness rule, and blocking semantics. Do not retain the umbrella’s claim
of automated packaged creation smoke.

## 7. HIGH — There is no independently shippable MVP cut inside a 13–19 day critical chain

**Plan location:** `plan.md:6`, `:18-20`, `:30-39`;
`phase-04-welcome-create-open-and-restore-ux.md:44-66`, `:99-121`;
`phase-05-packaged-runtime-and-cross-platform-gates.md:54-71`.

The plan binds payload extraction, a new security-sensitive transaction system,
identity handoff, a new cross-process app-state store, restore semantics across
three data domains, a shell rewrite, accessibility/visual work, three native
platform gates, and manual acceptance into one linear completion condition.
No phase yields a product increment that can be accepted if continuity or one
platform gate slips.

**Failure scenario:** Provisioning and safe Open are usable, but a late failure
in conversation restoration, semantic focus, Windows identity, or manual Linux
acceptance keeps the entire feature unshippable. Schedule pressure then invites
weakening a security rule or silently dropping a restore edge case because the
plan provides no sanctioned cut line.

**Repository evidence:** The current orchestration is already concentrated
across 1,188 lines in six central files (`App.tsx`, `use-workspace.ts`,
`app-shell.tsx`, `use-chat-history.ts`, `service.go`, and
`service-activation-run.go`). `apps/desktop/frontend/src/App.tsx:24-50` directly
couples workspace, session, chat, history, profiles, citations, and graph state;
`:110-150` passes the same coupled surface into the shell. Phase 4 proposes
changing nearly every one of those seams at once.

**Required fix:** Define two accepted milestones with separate release
criteria. MVP A should cover generated/materialized core payload, secure
Create/Open, read-only enforcement, activation, and the real empty-library
state. MVP B should add recents, identity-confirmed restart, conversation/note/
focus continuity, responsive/a11y polish, and the full three-OS installed
acceptance matrix. Keep the security invariants in MVP A; cut continuity and
release breadth, not containment or non-overwrite guarantees.

