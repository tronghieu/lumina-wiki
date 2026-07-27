---
title: "Red-Team Adjudication: Welcome and App-Only Provisioning Plan"
created: 2026-07-25
status: applied
---

# Red-Team Adjudication

All 20 findings carried direct repository evidence. Overlapping findings were
deduplicated during edits but retained below for traceability. None required
reversing an explicit user decision; they clarify security, recovery, evidence,
or milestone boundaries.

| # | Reviewer finding | Severity | Disposition | Applied contract |
|---|---|---|---|---|
| S1 | Hidden Check remains renderer-callable | Critical | Accept | Phase 3 unregisters/fail-closes raw-root Check; Phase 5 hostile-call gate. |
| S2 | Raw-root Workspace/Graph/Import bypass | High | Accept | Phase 3 removes renderer registrations and uses capability reads. |
| S3 | Default Create lacks native authority | High | Accept | Phase 3 requires a window-bound, expiring, one-use native location approval. |
| S4 | Immutable payload lacks target materialization | High | Accept | Phase 1 versioned materializer; Phase 2 target-derived state. |
| S5 | Manifest-last conflicts with CLI write order | High | Accept | Desktop journal marker scoped separately; CLI state set/consistency validated. |
| S6 | Windows 64-to-128 identity migration absent | Medium | Accept | Versioned, confirmed unique migration preserving workspace ID. |
| S7 | Windows app-state privacy undefined | Medium | Accept | Phase 4 applies and verifies owner+SYSTEM handle DACLs with native tests. |
| F1 | Committed Create can disappear after activation failure | Critical | Accept | Phase 2 persists `PendingLibraryOperation` before mutation; Phase 3 exposes recovery before activation. |
| F2 | Identity commits before runtime/session | High | Accept | Phase 3 uses prepared attach with coordinated identity/session commit and abort. |
| F3 | Global lock can span user confirmation | High | Accept | Phase 2 releases the lock after publication/proof and before any prompt/runtime load. |
| F4 | Hide A conflicts with preserve A on cancel | High | Accept | Phase 3 keeps A mounted behind a non-interactive activation veil until atomic B commit. |
| F5 | Latest history list/load race | High | Accept | Phase 4 provides backend-locked atomic `LoadLatestHistory` outcomes. |
| F6 | Preserved corrupt app state is permanently unwritable | Medium | Accept | Phase 4 provides an explicit, confirmed, bounded “Clear recent activity” recovery. |
| A1 | No runtime materialization seam | Blocker | Accept | Deduplicated with S4; hostile name/root/time conformance added. |
| A2 | No-root DTO breaks Import | Critical | Accept | Phase 3 keeps Import unavailable at backend/UI until a native capability replacement exists. |
| A3 | Legacy read-only is not enforced | Critical | Accept | Backend access mode centrally guards every workspace-byte mutation. |
| A4 | Exact destination preview contradicts pathless DTO | High | Accept | Phase 3 shows the exact path in a native dialog; React receives only an opaque approval capability. |
| A5 | Focused and umbrella integration ownership overlap | High | Accept | Master and umbrella phase 9 now track the Welcome subset independently. |
| A6 | Packaged creation evidence has conflicting definitions | Critical | Accept | Composed lifecycle + real package launch + fresh digest-bound manual GUI evidence. |
| A7 | No independently shippable MVP cut | High | Accept | MVP A secure Create/Open; MVP B recents/continuity/cross-platform completion. |

## Result

- Accepted: 20
- Rejected: 0
- Critical/blocker: 6
- High: 11
- Medium: 3

Implementation readiness now depends on validation confirming the edited phase
interfaces and evidence classes are internally consistent.
