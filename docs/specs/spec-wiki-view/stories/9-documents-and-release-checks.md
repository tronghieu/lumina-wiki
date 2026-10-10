---
title: 'Wiki view story 9: documents and release checks'
type: 'docs'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bf9d875'
context:
  - '{project-root}/docs/specs/spec-wiki-view/delivery.md'
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The viewer and its skill exist, but no document a user reads names them, and the release notes are silent.

**Approach:** Add `/lumi-view` to every skill table a user sees, in English, Vietnamese, and Chinese, write the changelog entry, bring the project rules up to date, and report the checks no test can make. SPEC CAP-1; spine AD-24; `delivery.md`, "Registering the skill".

## Boundaries & Constraints

**Always:**
- Describe only what stories 1 to 8 built.
- Follow the plain-language rule of `docs/project-context.md` section 3. The three languages say the same thing.
- Name `/lumi-view` before the mention of opening the workspace in another markdown app.

**Never:**
- No version bump, no tag, no publish.
- No emoji. No mention of how the viewer is built in a user-facing table.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Reader of the repo README | any of three languages | finds `/lumi-view` in the skill table and before the other-app note | N/A |
| Reader of the workspace README | installed wiki, any of three languages | finds `/lumi-view` in the skill table and `_lumina/viewer/` in the layout | N/A |
| Reader of the command reference | any of three languages | one row: when to use it, how to call it, what comes back | N/A |
| Release notes | next release | the `[Unreleased]` entry names the viewer and the packaging change | N/A |
| Second install | sandbox | no diff in any installed document | N/A |

</frozen-after-approval>

## Code Map

- `README.md`, `README.vi.md`, `README.zh.md` -- skill table; the line about opening the workspace in another app.
- `src/templates/README.md`, `.vi`, `.zh` -- workspace skill table and layout list; rendered by the installer, so `ci:idempotency` covers them.
- `docs/user-guide/commands.en.md`, `.vi`, `.zh` -- the command table. Its four columns are the four-part form: command, when to use it, example, what you get.
- `docs/project-context.md` -- core skill list; the two lists of watched paths.
- `CHANGELOG.md` -- `[Unreleased]`.

## Tasks & Acceptance

**Execution:**
- [x] Repo README in three languages -- table row; the viewer named before the other-app note.
- [x] Workspace README templates in three languages -- table row; `_lumina/viewer/` in the layout.
- [x] Command reference in three languages -- one row each.
- [x] `docs/project-context.md` -- core list and watched paths.
- [x] `CHANGELOG.md` -- entry under `[Unreleased]`.
- [x] Spec folder -- `SPEC.md`, `delivery.md`, `viewer-ui.md`, and the memory log brought in step with what was built.

**Acceptance Criteria:**
- Given `npm run ci:idempotency` and `npm run test:catalog`, then both pass.
- Given the three languages of each document, then each has the same rows in the same places.

## Implementation Notes

The command reference is a table, not prose sections. Its four columns already are the four-part form, so `/lumi-view` gets one row like every other core command.

The spec folder changed with the build: the open question on bundle bytes is closed by CI, CAP-6 is retired by the maintainer, and the filter box and the wording "Problems", "Page type", "Cluster" are recorded in `viewer-ui.md`.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run ci:idempotency && npm run test:catalog` -- expected: pass

**Manual checks (if no CLI):**
- Ctrl-C in a Windows terminal stops the viewer and frees the port. Not run: no Windows terminal is available here. CI on Windows covers the stop signal sent by a parent process, not a key press.
- Pane behavior against `viewer-ui.md`. Run in Chrome on the contract fixture for stories 4 to 7. Not run on the maintainer's own wiki.
