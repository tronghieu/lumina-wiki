---
title: 'User documentation'
type: 'chore'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/specs/spec-project-docs-overlay/SPEC.md'
  - '{project-root}/src/templates/project/PROJECT.md'
  - '{project-root}/docs/user-guide/en.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Project mode ships with no user-facing docs, so nobody can find, install or run it without reading specs.

**Approach:** Add a project-mode guide in en, vi and zh, link it from each README, and add a CHANGELOG entry.

## Boundaries & Constraints

**Always:**
- **Files:**
  - `docs/user-guide/project-mode.{en,vi,zh}.md` (new)
  - one short project-mode section with a link in `README.md`, `README.vi.md` and `README.zh.md`
  - `CHANGELOG.md` `[Unreleased]` `### Added`
- **Guide content, in this order:**
  1. What project mode is: a typed graph over your own docs, with no `wiki/` or `raw/`.
  2. When to use it instead of the classic wiki.
  3. Install with `npx lumina-wiki install --mode project` and targets `claude_code`, `codex` or `antigravity`.
  4. What the install writes, and what is committed versus gitignored.
  5. The six skills in workflow order: setup, ingest, ask, check, verify, view. Give each one line and one example request.
  6. Keeping it fresh: no hook; `status` states; re-ingest.
  7. Common fixes: an orphaned fact file, a stale doc, a `config-check` error, a mode conflict.
  8. Uninstall: `facts/` and `config/` are kept.
- **Facts come from the shipped files,** not the specs:
  - `src/templates/project/PROJECT.md`
  - `src/skills/project/*/SKILL.md`
  - `src/installer/project-mode.js`
  - `bin/lumina.js` for the CLI flags
- **Style:** match `docs/user-guide/en.md`'s register (plain, task-first) and headings. Skills are named without slash syntax, since invocation differs per host.
- **Translations:** vi and zh carry the same sections, commands and facts as en. Only the prose is translated; commands, paths and skill names stay verbatim. zh is Simplified (`zh-Hans`).

**Never:**
- No code, skill or spec edits.
- No emoji. No mention of internal story, CAP or AD ids.

</intent-contract>

## Code Map

- `docs/project-context.md:100` -- the multi-language sync rule.
- `README.md:152-161` -- the doc link list to extend. `README.vi.md` and `README.zh.md` have the same lists.
- `CHANGELOG.md` -- Keep a Changelog format; `[Unreleased]` is empty.

## Tasks & Acceptance

**Execution:**
- `docs/user-guide/project-mode.en.md`, `README.md`, `CHANGELOG.md` -- write these first; en is the source for the translations.
- `docs/user-guide/project-mode.vi.md`, `README.vi.md` -- translate from en.
- `docs/user-guide/project-mode.zh.md`, `README.zh.md` -- translate from en.

**Acceptance Criteria:**
- Given the three guides, when their headings and fenced commands are compared, then they match across languages.
- Given each README, when the doc link list is read, then it links that language's guide.
- Every command in the guide exits as the guide says when run in a scratchpad sandbox. This covers install, the uninstall flags and the `node _lumina/project/project.mjs` subcommands.

## Verification

**Commands:**
- A heading and command diff across `project-mode.{en,vi,zh}.md` -- expected: the same structure.
- `npm run test:all` -- expected: unchanged pass counts.

## Spec Change Log

## Review Triage Log

- Reviewed together with story 11; see its triage log. The guide fixes landed in en and were synced to vi and zh.

## Auto Run Result

- **Change:**
  - project-mode guides in en, vi and zh;
  - a Project mode section and link in each README;
  - CHANGELOG `[Unreleased]` entries for project mode, facts-prune, ask content reading and the ingest update mode.
- **Verification:**
  - Every documented command was run in scratchpad sandboxes: install with each target, the bad-flag errors, every engine subcommand, and facts-prune's deleted, renamed and bad-flag cases.
  - en, vi and zh parity: 9 headings, 3 fenced blocks and 80 inline-code tokens each, identical.
  - `npm run test:all` passes.
- **Residual risks:**
  - The out-of-scope `kept` case was verified in engine tests, not re-run against the guide text.
