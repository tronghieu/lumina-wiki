# Independent Adversarial Plan Audit — 2026-07-11

## Verdict

PASS AFTER PATCH. No Critical/High/Medium finding remains open.

## Findings and Disposition

### A1 — Capability issuance still accepted an arbitrary caller path — Critical

The first red-team patch replaced chat roots with a capability but named `ActivateWorkspace(root)`, allowing a compromised webview to mint that capability for any workspace-shaped path. Patched phase 5 to expose trusted-backend `ChooseAndActivateWorkspace` and native-confirmed `ConfirmAndActivateWorkspace`; denial makes zero AI reads. Phase 7 now keeps the prior loaded session on cancellation/denial.

### A2 — Parallel phase regression commands assumed packages from unfinished siblings — Medium

Phase 3 named phase-2 providers and phase 6 named phase-5/index/chat packages although their dependency DAG allows parallel execution. Patched both checkpoints to `go test ./...`, which tests every package present without requiring future package paths.

### A3 — Cancellation scenario wording contradicted event-authoritative cleanup — Low

Phase 7 matrix still said the binding is cancelled and listener removed once. Patched expected behavior to explicit backend cancellation, terminal handshake, then single listener removal.

## Traceability Audit

| User decision | Plan owner | Acceptance proof |
|---|---|---|
| `.dc.html` exact UI | 6, 8 | token/layout tests, pinned Playwright diff, side-by-side approval |
| Real configurable AI chat | 1, 2, 5, 7 | provider fixtures, generated facade, streamed UI E2E |
| Independent embeddings | 4, 7 | consent/profile isolation and lexical-fallback tests |
| OS credential store | 1, 5, 7 | keyring conformance, nonce fallback, secret DTO scans |
| Local workspace history | 1, 5, 7 | identity registry, concurrent mutation tests, delete controls |
| No AI workspace mutation | 3, 5, 8 | safe reads plus pre/post byte manifest |
| Existing Import exception | 6, 8 | callback preservation and one-file exception test |

## Consistency Audit

- No dependency cycle.
- No overlapping composition-root ownership.
- No public AI read accepts a workspace root or citation path.
- No visual/a11y gate is conditional.
- No fake production data is authorized; deterministic fake bridge exists only in browser tests.
- Every accepted red-team finding has a phase owner, concrete interface or file, and a test scenario.

Unresolved questions: none.
