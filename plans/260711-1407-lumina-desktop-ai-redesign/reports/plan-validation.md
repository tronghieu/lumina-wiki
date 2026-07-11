# Deep Plan Validation — 2026-07-11

## Scope

Validated `plan.md` plus all eight phase files against the approved brainstorm, adjudicated red-team report, current desktop source, package scripts, and repository rules.

## Results

- Structure: PASS — 8/8 phases contain requirements, architecture, exact file inventory, scenario matrix, RED/GREEN gates, implementation steps, success criteria, and rollback notes.
- Traceability: PASS — real AI chat, independent embeddings, secure credentials, local opt-in history, lexical fallback, immutable workspace, and exact `.dc.html` UI each map to owned phases and executable gates.
- Dependencies: PASS — DAG is acyclic; phase 6 depends only on phase-3 tree contract and can run beside provider/index/orchestration work; phase 7 joins phases 5 and 6.
- Ownership: PASS — phase 5 alone owns `internal/ai/service.go`, `main.go`, and binding generation; phase 1 owns injected stores; phase 3 owns corpus/tree/citation-read primitives.
- Security contracts: PASS after patch — trusted native workspace activation, window-bound capabilities, approved-IP dial pinning, history coordinator, nonce session credential confirmation, opaque citation reads.
- Frontend continuity: PASS after patch — every current source/root/import callback is explicit; draft versus loaded workspace identity is specified; recursive test discovery precedes new suites.
- Verification: PASS — focused TDD, race tests, Playwright/axe, screenshot threshold, package/secret scans, workspace manifests, Wails build, and three-OS CI are unconditional.

## Evidence Checks

- Confirmed current service boundaries in `apps/desktop/main.go` and `apps/desktop/internal/{workspace,graph,tools,importer}`.
- Confirmed current frontend callback surface and editable root behavior in `apps/desktop/frontend/src/App.tsx` and `src/app/app-shell.tsx`.
- Confirmed existing nested tests are missed by the current shell-expanded test script.
- Confirmed existing root-level Inter asset/license need explicit migration ownership.
- Confirmed pinned registry versions available during validation: Playwright `1.61.1`, `@axe-core/playwright` `4.12.1`, keyring `v0.2.8` retained from prior research.
- Scanned authoritative plan/phase/research files for stale caller-root chat, `.cancelOn`, conditional harness, phase-1 facade registration, session-only history, placeholders, and whitespace errors: no unresolved authoritative occurrence.

## Validation Patches

1. Activation authority strengthened: backend native choose/confirmation is required before capability issuance.
2. Parallel checkpoints corrected: phases 3 and 6 use `go test ./...` so they do not assume other parallel phase packages exist.
3. Cancellation matrix corrected: listener removal occurs after terminal handshake, not binding cancellation.

## Verdict

READY FOR IMPLEMENTATION after plan-slice commit.

Unresolved questions: none.
