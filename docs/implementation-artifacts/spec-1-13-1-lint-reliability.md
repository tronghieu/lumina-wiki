---
title: 'Harden lint and graph reliability for 1.13.1'
type: 'bugfix'
created: '2026-09-12'
status: 'done'
baseline_commit: 'b6400f200064239ed2a82812d57c585434d79612'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Lumina can silently accept an unreadable edge graph or dangling citations, and two automatic lint repairs can produce incorrect content. Graph helper protections, contributor setup guidance, and several lint messages also remain inconsistent with repository contracts.

**Approach:** Ship one 1.13.1 reliability patch covering issues #45, #46, #47, #51, #53, #54, and #55, with focused regression tests and release notes.

## Boundaries & Constraints

**Always:** Preserve lint finding IDs and JSON shapes; reuse the existing endpoint resolver, fenced-code detector, YAML rendering/editing helpers, citation type registry, and atomic write paths; retain existing exit-code contracts; keep fixes idempotent; document L20 in project context.

**Ask First:** Any new public configuration, change to existing finding severity, change to graph or citation storage format, or change that requires migration.

**Never:** Rewrite links inside fenced Markdown; append a duplicate YAML key; treat non-ENOENT graph read errors as an empty graph; auto-fix dangling citations; broaden work to malformed JSONL handling; bump/package/tag/publish 1.13.1; address #48, #49, #50, or #57.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Unreadable graph | `edges.jsonl` exists but cannot be read | Lint does not report a clean graph | Propagate failure; CLI exits 3 |
| Missing graph | `edges.jsonl` does not exist | Treat as an empty graph | No error |
| Dangling citation | Either internal citation endpoint is absent | Emit non-fixable L20 error; file remains unchanged | Lint exits 1 |
| Safe L01 repair | Required derivable key exists without a value | Replace the key in place exactly once | Subsequent lint is clean for that field |
| Safe L03 repair | Bare and qualified links point to a renamed page | Rewrite real links and preserve aliases | Fenced examples remain byte-identical |
| Citation edge helper | Remove/replace receives `cites` or `cited_by` | Reject before reading or writing graph data | Code 2 with existing guidance |

</frozen-after-approval>

## Code Map

- `src/scripts/lint.mjs` -- lint checks, graph parsing, automatic repairs, and visible findings.
- `src/scripts/lint.test.mjs` -- unit and integration regression coverage for #45, #46, #53, #54, and #55.
- `src/scripts/wiki.mjs` -- `removeEdge` and `replaceEdge` helper-level citation guards.
- `src/scripts/wiki.test.mjs` -- helper and CLI graph mutation coverage.
- `docs/DEVELOPMENT.md` -- supported isolated Python development setup for #51.
- `docs/project-context.md` -- authoritative lint catalog, including L20.
- `CHANGELOG.md` -- unreleased 1.13.1-facing summary and issue references.

## Tasks & Acceptance

**Execution:**
- [x] `src/scripts/lint.mjs` -- make graph reads fail visibly, add non-fixable L20 citation endpoint validation, make L01/L03 repairs safe, and replace banned user-facing terminology.
- [x] `src/scripts/lint.test.mjs` -- cover missing/unreadable graph files, valid/dangling citations, idempotent valueless-key repair, qualified/fenced link rewriting, and visible wording.
- [x] `src/scripts/wiki.mjs` and `src/scripts/wiki.test.mjs` -- move citation guards into remove/replace helpers while preserving CLI behavior and ordinary edge semantics.
- [x] `docs/DEVELOPMENT.md` -- replace global pip advice with a virtual environment and `src/tools/requirements.txt` workflow.
- [x] `docs/project-context.md` and `CHANGELOG.md` -- document L20 and the complete unreleased patch scope.

**Acceptance Criteria:**
- Given the seven tracked issues, when their focused regression tests run, then each previously failing behavior is reproduced and fixed.
- Given `npm run test:scripts`, when implementation is complete, then all script tests pass without skipped coverage caused by the changes.
- Given `npm run test:all`, `npm run ci:idempotency`, and `npm run ci:package`, when run from the source repository using approved workflows, then all gates pass.
- Given ordinary graph edges and valid wiki content, when lint and graph mutation commands run, then existing results, reverse-edge behavior, dry-run behavior, and output contracts remain unchanged.

### Review Findings

- [x] [Review][Patch] Refuse ambiguous L01 replacement when a key occurs more than once [src/scripts/lint.mjs:2032]
- [x] [Review][Patch] Revalidate citations after L03 renames change the known page set [src/scripts/lint.mjs:2753]
- [x] [Review][Patch] Rewrite qualified L03 targets that use the accepted `.md` spelling [src/scripts/lint.mjs:2335]
- [x] [Review][Patch] Keep links inside CommonMark fences whose fence-like lines are not valid closers [src/scripts/lint.mjs:2322]
- [x] [Review][Patch] Preserve indented YAML comments when replacing a valueless key [src/scripts/lint.mjs:2032]
- [x] [Review][Patch] Document L20 in the installed `/lumi-check` reference and remediation flow [src/skills/core/check/references/lint-checks.md:27]
- [x] [Review][Patch] Cover unreadable graph failures on Windows without skipping the regression [src/scripts/lint.test.mjs:2349]

## Spec Change Log

## Design Notes

L20 should share L17/L19 endpoint resolution semantics, including unique bare slugs and external URL exemptions. It reports citation integrity only and never rewrites `citations.jsonl`.

Qualified L03 rewrites must use each rename plan's wiki-relative old and new path without `.md`; bare rewrites retain current basename behavior. Both forms skip lines marked by `fencedCodeLines`.

## Verification

**Commands:**
- `npm run test:scripts` -- all lint and wiki regressions pass.
- `npm run test:all` -- JavaScript and Python suites pass.
- `npm run ci:idempotency` -- repeated sandbox installation produces no watched-path changes.
- `npm run ci:package` -- publish allowlist and safety checks pass.
- `git diff --check` -- no whitespace errors.

## Suggested Review Order

**Graph validation**

- Start where lint loads both graph stores and assembles all findings.
  [`lint.mjs:2659`](../../src/scripts/lint.mjs#L2659)

- L20 reuses canonical endpoint resolution without mutating citations.
  [`lint.mjs:1943`](../../src/scripts/lint.mjs#L1943)

- Missing files stay optional while other read failures propagate.
  [`lint.mjs:982`](../../src/scripts/lint.mjs#L982)

**Safe automatic repairs**

- Valueless required keys are replaced in place with derived values.
  [`lint.mjs:1983`](../../src/scripts/lint.mjs#L1983)

- Rename repair handles qualified links and skips fenced examples.
  [`lint.mjs:2265`](../../src/scripts/lint.mjs#L2265)

**Graph helper protection**

- Remove rejects citation types before graph I/O.
  [`wiki.mjs:1170`](../../src/scripts/wiki.mjs#L1170)

- Replace rejects either citation type before graph I/O.
  [`wiki.mjs:1236`](../../src/scripts/wiki.mjs#L1236)

**Regression coverage and documentation**

- Integration tests cover visible graph failures and L20 no-write behavior.
  [`lint.test.mjs:2337`](../../src/scripts/lint.test.mjs#L2337)

- Rename tests cover qualified links, fences, and deduplicated previews.
  [`lint.test.mjs:2790`](../../src/scripts/lint.test.mjs#L2790)

- Helper tests prove citation rejection happens before filesystem access.
  [`wiki.test.mjs:63`](../../src/scripts/wiki.test.mjs#L63)

- Contributor setup now installs the complete Python requirements in isolation.
  [`DEVELOPMENT.md:262`](../DEVELOPMENT.md#L262)

- Release notes summarize all seven tracked fixes.
  [`CHANGELOG.md:8`](../../CHANGELOG.md#L8)
