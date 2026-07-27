---
title: "Scope audit: Welcome and app-only library provisioning"
created: 2026-07-25
status: not-ready
reviewed:
  - plan.md
  - phase-01-generated-contract-and-core-payload.md
  - phase-02-secure-native-provisioning.md
  - phase-03-app-local-library-and-restoration-state.md
  - phase-04-welcome-create-open-and-restore-ux.md
  - phase-05-packaged-runtime-and-cross-platform-gates.md
---

# Scope Audit

## Verdict

**Not implementation-ready.** The edited plan resolves the accepted red-team
security findings, but eight scope/ownership/dependency inconsistencies remain.
The most consequential are the focused plan's overclaim of umbrella phase 2
ownership, an unapproved hard-link-only product restriction, and an MVP A cut
that still has no independent packaged acceptance gate.

This audit compares the focused master and all five phases with:

- `plans/reports/brainstorm-260725-0121-welcome-library-provisioning.md`
- `plans/reports/red-team-260725-0121-welcome-library-provisioning.md`
- `plans/260725-0024-lumina-desktop-app-only-v192-sync/`
- `docs/desktop-app-roadmap.md`
- the applied decisions recorded in `reports/red-team-adjudication.md`

No code or tests were run and no implementation files were inspected.

## Findings

### 1. Critical — The focused plan cannot own all of umbrella phase 2

The focused master says it owns umbrella phases 2–3
(`plan.md:67-70`), and the umbrella says those phases synchronize from the
focused plan rather than execute independently (umbrella `plan.md:51-56`).
However, focused Phase 1 fixes a single `core-generic-en` provisioning profile
(`phase-01-generated-contract-and-core-payload.md:24-25`, `:57`, `:93-96`).
Umbrella phase 2 owns a broader contract: packages, entities, edge rules, lint
rules, and every accepted v1.9.2 capability
(`phase-02-generated-workspace-contract.md:24-29`, `:49-55`, `:61-74`).
The roadmap likewise retains learning/readings/reflections/ranking/v1.9.2
coverage (`docs/desktop-app-roadmap.md:92-103`).

**Failure:** completing the focused core payload either falsely marks umbrella
phase 2 complete or silently expands this focused slice into the entire v1.9.2
contract, contradicting its stated provisioning-only scope.

**Fix:** change ownership to “umbrella phase 2 provisioning subset and phase 3
Welcome/provisioning subset,” with a field-level handoff matrix. Keep full
v1.9.2 entity/edge/read/check contract coverage owned by umbrella phases 2 and
5, or explicitly expand focused Phase 1 and its effort/acceptance criteria.

### 2. High — Hard-link-capable storage is an unapproved product restriction

Focused Phase 2 makes hard-link support a v1 precondition and blocks Create on
unsupported storage (`phase-02-secure-native-provisioning.md:32-35`,
`:191-192`). The originating brainstorm instead requires cross-volume behavior
to be supported and tested (`brainstorm-260725-0121-welcome-library-provisioning.md:60-61`,
`:166-167`). The focused scout still recorded this as an unresolved product
decision (`reports/phase-02-focused-scout.md:435`), and the master Product
Decisions do not approve the restriction (`plan.md:41-54`).

**Failure:** Create is unavailable on exFAT or network-backed user locations
without the user ever approving that compatibility cut.

**Fix:** present this as an explicit product decision. Either accept the
restriction and add it to the master, Welcome limitations, docs, and platform
acceptance, or design a second safe no-clobber publication strategy. Do not hide
the decision only in Phase 2 requirements/risks.

### 3. High — MVP A still has no independent acceptance or release gate

The master defines MVP A as Phase 1 + Phase 2 + a Phase 4 Create/Open gate
(`plan.md:36-39`). Phase 4 says MVP A may be accepted without MVP B
(`phase-04-welcome-create-open-and-restore-ux.md:120-124`, `:142-150`).
But all native package/install/manual GUI evidence remains in Phase 5, whose
dependency is “Phases 1–4” and whose matrix requires recents and continuity
(`phase-05-packaged-runtime-and-cross-platform-gates.md:57-78`, `:80-84`).
The master success criteria also expose only the full three-OS gate
(`plan.md:56-65`).

**Failure:** MVP A can be “accepted” without proving the packaged Create/Open
path, or it remains blocked on Phase 3/MVP B, recreating the exact no-cut problem
that adjudication A7 claimed to fix (`reports/red-team-adjudication.md:35`).

**Fix:** split Phase 5 into an MVP A gate (packaged Create/Open/empty state,
containment, no runtime tools) and an MVP B gate (recents/continuity/full matrix),
or add explicit MVP A evidence and status criteria to Phase 4 and the master.

### 4. High — The read-only capability has no umbrella consumer contract

Focused Phase 2 adds backend-owned `read-only|writable` state and requires every
mutation boundary to enforce it
(`phase-02-secure-native-provisioning.md:45-48`, `:105-108`, `:145`).
Focused Phase 4 removes current raw-root mutations
(`phase-04-welcome-create-open-and-restore-ux.md:38-47`, `:72-73`).
But future mutation owners—umbrella native lifecycle, correction, filing, and
reading phases—do not depend on or mention this access mode. Umbrella phase 4
still describes `tools.Service` and lifecycle writes without the new capability
contract (`phase-04-native-lifecycle-and-checks.md:24-37`, `:49-60`, `:95-98`).

**Failure:** later umbrella work re-registers native mutation services that
authorize only by workspace shape/root, undoing the focused plan's read-only
guarantee.

**Fix:** add the access-mode/session contract as an explicit output of the
focused plan and an input/acceptance requirement for umbrella phases 4 and 6–8,
plus the retained phase 9 integration subset.

### 5. High — Phase 2's private pending-created state depends on privacy work assigned to optional Phase 3

MVP A requires Phase 2 to persist a private pending-created record before
activation and now states that it uses the shared Windows DACL contract
(`phase-02-secure-native-provisioning.md:49-57`, `:68`, `:119-120`).
However, Phase 2 names no platform protection implementation/reuse owner. The
only concrete cross-platform private-storage files, including Windows DACL
ownership, are assigned to Phase 3
(`phase-03-app-local-library-and-restoration-state.md:25-29`, `:47-50`).
Yet MVP A explicitly omits Phase 3 (`plan.md:38-39`).

**Failure:** the supposedly independently acceptable MVP A either duplicates
private storage/locking code in Phase 2, ships the pending record without the
Windows privacy guarantee, or secretly depends on Phase 3.

**Fix:** name the existing protected-store helper Phase 2 will reuse, or move a
reusable app-private atomic store/protection primitive into Phase 2 and let
Phase 3 consume it. Alternatively make the Phase 3 protection subphase an
explicit prerequisite of MVP A. Identify one owner for DACL, lock, temp, backup,
and final-file invariants.

### 6. Medium — App-state “repair” is indistinguishable from an excluded lifecycle feature

The master says maintenance is outside the slice (`plan.md:22-24`), and the
brainstorm explicitly excludes repair/reset
(`brainstorm-260725-0121-welcome-library-provisioning.md:63-68`). Phase 3 now
adds `RepairLibraryState`, a repair file, a quarantine/reset transaction, tests,
and UI recovery (`phase-03-app-local-library-and-restoration-state.md:37-41`,
`:49`, `:78-79`, `:91-95`, `:129-137`; Phase 4 `:114-115`).

This may be a justified app-local corruption escape hatch, but its present name
and acceptance language overlap the roadmap's separately owned workspace
repair/reset capability (`docs/desktop-app-roadmap.md:82-90`).

**Fix:** explicitly label it “Reset recent-view state” (or equivalent), state
that it never repairs/resets a library, and add that distinction to master
non-goals and UI copy. Otherwise move it to umbrella lifecycle ownership.

### 7. Medium — Focused and umbrella phase 3 still disagree on locale, naming, and recent-state representation

Focused Phase 1 fixes English/generic and accepts a friendly runtime name
(`phase-01-generated-contract-and-core-payload.md:24-25`, `:38-39`).
Focused Phase 3 stores only opaque IDs/views, with canonical paths confined to
the identity registry (`phase-03-app-local-library-and-restoration-state.md:20-24`).
Umbrella phase 3 still derives the name from the selected folder, uses app/OS
language defaults, and says preferences retain recent roots
(`phase-03-app-only-workspace-provisioning.md:31-36`, `:53-60`).

**Failure:** an executor cannot synchronize umbrella phase 3 from focused
outcomes without choosing which conflicting contract is authoritative.

**Fix:** update umbrella phase 3 now to point to the focused profile/name/privacy
decisions and mark only those subsets delegated. Do not wait until Phase 5 to
resolve core input/state contracts.

### 8. Medium — User-facing documentation ownership is incomplete

Phase 5 requires everyday-language documentation but lists only the Desktop
README, roadmap, and umbrella plan
(`phase-05-packaged-runtime-and-cross-platform-gates.md:38-41`, `:43-55`).
The roadmap requires user guidance for installation, first workspace, privacy,
recovery, and limitations (`docs/desktop-app-roadmap.md:167-178`). Umbrella
phase 9 also requires language synchronization wherever root user guides change
(`phase-09-desktop-integration-and-release-gates.md:63-68`).

**Failure:** the roadmap is marked evidence-backed while the actual user guides
remain silent about Create, read-only legacy libraries, unsupported hard-link
storage, recovery, and app-local state.

**Fix:** identify the owning user-guide pages and language variants, or state
explicitly why Desktop README is the only user documentation surface. Add the
hard-link/read-only/recovery limitations to the acceptance checklist.

## Claim Coverage Matrix

Legend: **OK** aligned and owned; **PARTIAL** ambiguous or incomplete;
**ISSUE** maps to a finding above.

### Master plan — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| M1 | App-only Create/Open/return outcome | Roadmap `:9-18`, `:25-27` | OK |
| M2 | Skill execution remains outside | Brainstorm `:63-71`; roadmap `:114-132` | OK |
| M3 | Native checks/maintenance remain outside | Brainstorm `:63-68`; umbrella phase 4 | OK |
| M4 | Cosmetic restoration remains outside | Brainstorm `:138-145` | OK |
| M5 | Five-phase sequence covers focused outcome | Brainstorm `:171-180` | OK |
| M6 | MVP A is independent | Phase 4 `:120-124`; Phase 5 `:57-84` | ISSUE F3 |
| M7 | MVP B includes continuity/platform completion | Roadmap `:75-80`, `:167-174` | OK |
| M8 | Documents/home default with preview | Master `:43-44`; Phase 4 `:28-35` | OK |
| M9 | Collision never overwrites/auto-numbers | Brainstorm `:47-50`, `:152-165` | OK |
| M10 | Legacy/schemas 1-4 compatibility | Brainstorm `:44-47`; Phase 2 `:38-41` | OK |
| M11 | Raw Check/Import unavailable | Adjudication S1/S2/A2 `:16-18`, `:30` | OK |
| M12 | Recents never expose/search paths | Initial red-team `:79-82`, `:115-118` | OK |
| M13 | Restart confirmation preserved | Roadmap `:25-27`; Phase 3 `:30-31` | OK |
| M14 | Three-OS evidence and signing split | Roadmap `:167-176`; Phase 5 | PARTIAL, F3 |
| M15 | Owns all umbrella phases 2–3 | Umbrella phase 2 `:24-35`, `:61-74` | ISSUE F1/F7 |

### Phase 1 — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| P1.1 | Fixed `core-generic-en` profile | Master `:43-54`; payload research | OK for focused scope |
| P1.2 | Same canonical installer authorities | Brainstorm `:43-46`, `:101-109` | OK |
| P1.3 | Lint/schema/skill inputs shared | Umbrella phase 2 `:24-29` | PARTIAL: broader ownership unclear |
| P1.4 | Versioned checked-in boundary | Brainstorm `:101-109` | OK |
| P1.5 | Strict paths/limits/hashes | Initial red-team `:38-42`; brainstorm `:106-107` | OK |
| P1.6 | Static/runtime materialization split | Adjudication S4/A1 `:19`, `:29` | OK |
| P1.7 | Runtime inputs exclude build paths | Security finding S4 resolution | OK |
| P1.8 | Drift check does not mutate worktree | Brainstorm `:108-109` | OK |
| P1.9 | Unicode semantic parity | Initial red-team `:89-92` | OK |
| P1.10 | Skills packaged but inert | Initial red-team `:94-98`; master `:49-51` | OK |
| P1.11 | Shared definition file ownership | Umbrella phase 2 generator ownership | OK |
| P1.12 | Native materializer owned here | Phase 2 consumes result | OK |
| P1.13 | Complete embed coverage | Roadmap `:54-64` | OK |
| P1.14 | Core-only success criteria | Umbrella full v1.9.2 contract | ISSUE F1 |
| P1.15 | No official skill catalog execution | Roadmap `:58-59`, `:114-123` | OK; later owner retained |

### Phase 2 — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| P2.1 | Patched Go required | Master `:64`; filesystem research | OK |
| P2.2 | Verify payload before target access | Brainstorm `:43-52` | OK |
| P2.3 | Materialize after root proof | Phase 1 `:35-39`, `:75` | OK |
| P2.4 | Complete target classification | Initial red-team `:16-20` | OK |
| P2.5 | Handle-relative containment | Initial red-team `:32-36` | OK |
| P2.6 | Journal/stage/no-clobber/manifest-last | Initial red-team `:9-14`, `:27-30` | OK |
| P2.7 | Hard links are mandatory | Brainstorm cross-volume `:60-61`, `:166-167` | ISSUE F2 |
| P2.8 | Foreign/corrupt recovery fails closed | Brainstorm `:47-57` | OK |
| P2.9 | CLI-interrupted manifest state rejected | Adjudication S5 `:20` | OK |
| P2.10 | Windows 128-bit migration preserves ID | Adjudication S6 `:21` | OK |
| P2.11 | Read-only/writable capability | Adjudication A3 `:31` | PARTIAL, F4 |
| P2.12 | Prepared identity/session transaction | Adjudication F2 `:24`; staged session now explicit | OK |
| P2.13 | Pending-created recovery record/privacy | Phase 2 `:49-57`, `:119-120`; Phase 3 `:47-50` | PARTIAL, F5 |
| P2.14 | Creation lock released before prompts | Adjudication F3 `:25` | OK |
| P2.15 | “Manifest is last trust marker” success text | Interface scopes it to Desktop journal `:102-104` | PARTIAL: success text should match |

### Phase 3 — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| P3.1 | At most 12 recent IDs/views | Initial red-team `:79-82` | OK |
| P3.2 | Optional normalized note path | Brainstorm `:138-145` | OK |
| P3.3 | “State contains no paths” | Same phase permits `wiki/...md` | PARTIAL: say no absolute/root paths |
| P3.4 | Canonical roots only in identity registry | Adjudication S2/privacy decisions | OK |
| P3.5 | Bounded atomic locked store | Brainstorm `:54-57`, initial red-team `:110-113` | OK |
| P3.6 | Windows owner+SYSTEM DACL | Adjudication S7 `:22` | OK for Phase 3 |
| P3.7 | Restore revalidates ID/compatibility | Brainstorm `:54-59`, `:155-160` | OK |
| P3.8 | Open/restore never mutate workspace | Brainstorm `:53`, `:133-136` | OK |
| P3.9 | History-disabled remains disabled | Initial red-team `:55-58` | OK |
| P3.10 | Snapshot/note reads use session capability | Adjudication S2/A3 | OK |
| P3.11 | Corrupt state requires explicit recovery | Adjudication F6 `:28` | OK functionally |
| P3.12 | `RepairLibraryState` is in scope | Brainstorm non-goals `:63-68` | ISSUE F6 |
| P3.13 | Latest select/load is atomic | Adjudication F5 `:27` | OK |
| P3.14 | Remove recent never deletes data | Brainstorm recents/recovery | OK |
| P3.15 | Store is independently deliverable | MVP A dependency and Phase 2 pending state | PARTIAL, F5 |

### Phase 4 — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| P4.1 | No Welcome flash during restore | Roadmap `:25-27` | OK |
| P4.2 | Everyday language | Roadmap `:20-37`, `:145-165` | OK |
| P4.3 | Create/Open plus 12 recents | Brainstorm `:114-120`, `:138-145` | OK |
| P4.4 | Exact destination shown natively | Adjudication A4 `:32` | OK |
| P4.5 | One-use window-bound Create approval | Adjudication S3 `:18` | OK |
| P4.6 | Empty library uses real empty state | Initial red-team `:66-70` | OK |
| P4.7 | Read-only mode enforced in backend | Adjudication A3 `:31` | PARTIAL, F4 |
| P4.8 | Latest conversation/note/focus restored | Roadmap `:75-80` | OK |
| P4.9 | Model/provider only Advanced | Roadmap `:35-37`, `:155-156` | OK |
| P4.10 | Raw Wails services removed/fail closed | Adjudication S1/S2/A2 | OK |
| P4.11 | Import becomes unavailable | Roadmap says import already built `:46` | PARTIAL: temporary regression must be documented |
| P4.12 | No network/telemetry in lifecycle | Roadmap `:164-165` | OK |
| P4.13 | Created-not-active is recoverable | Adjudication F1 `:23` | OK |
| P4.14 | A remains safely veiled during B | Adjudication F4 `:26` | OK |
| P4.15 | MVP A independently acceptable | Phase 5 dependency/matrix | ISSUE F3 |

### Phase 5 — 15 claims checked

| # | Claim | Source trace | Result |
|---|---|---|---|
| P5.1 | Full quality gates under patched Go | Roadmap `:167-172` | OK |
| P5.2 | Real packages install/launch per OS | Roadmap `:171-174` | OK |
| P5.3 | Native composed lifecycle proves services | Adjudication A6 `:34` | OK |
| P5.4 | Manual installed GUI covers interaction gap | Adjudication A6 `:34`; umbrella phase 9 `:63-66` | OK |
| P5.5 | Manual evidence has owner/digest/freshness | Assumption audit A6 remedy | OK |
| P5.6 | Native filesystem semantics per OS | Brainstorm `:60-61`, `:166-169` | OK |
| P5.7 | Signing remains separate | Roadmap `:175-176` | OK if overall completion not claimed |
| P5.8 | Everyday-language docs updated | Roadmap `:177-178` | ISSUE F8 |
| P5.9 | Unicode Create on each OS | Brainstorm `:149-169` | OK |
| P5.10 | External runtimes absent | Brainstorm `:20-25`, `:149-150` | OK |
| P5.11 | Relaunch/continuity per OS | Roadmap `:75-80`, `:187-188` | OK |
| P5.12 | Raw-root hostile calls unavailable | Adjudication S1/S2 | OK |
| P5.13 | Evidence classes remain distinct | Adjudication A6; umbrella phase 9 `:63-66` | OK |
| P5.14 | Phase dependency supports MVP A | Master `:38-39`; Phase 5 `:80-84` | ISSUE F3 |
| P5.15 | Roadmap/umbrella synchronize from evidence | Umbrella `plan.md:53-56` | PARTIAL, F1/F7/F8 |

## Required disposition before implementation

1. Resolve findings 1–5 in the master/phase ownership and dependency contracts.
2. Obtain explicit user approval for the hard-link-only storage restriction.
3. Clarify findings 6–8 without broadening workspace maintenance scope.
4. Re-run this audit after the umbrella phase 2/3 text and MVP evidence split are
   synchronized; do not mark whole umbrella phases complete from subset evidence.
