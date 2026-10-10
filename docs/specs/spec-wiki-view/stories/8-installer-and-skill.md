---
title: 'Wiki view story 8: installer and skill'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '51dc899'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/delivery.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The viewer runs from the repo, but a user's workspace has no copy of it and no command that opens it. Nothing in the package guards that the viewer ships whole.

**Approach:** Install the viewer into every classic workspace from one explicit file list that fails loudly when a file is missing, add the `lumi-view` core skill with its help row, and extend the package and CI guards. Prove in CI, on all three operating systems, that the installed copy starts and serves. SPEC CAP-1, CAP-14; spine AD-2, AD-18, AD-19, AD-24.

## Boundaries & Constraints

**Always:**
- `src/installer/viewer-files.js` holds the one frozen list, `VIEWER_FILES`, of paths under `src/viewer/`. The installer, `ci-package`, and the completeness test all read it.
- A listed file missing from the package is an internal error, exit 3, found before the install writes anything. Nothing is skipped silently.
- The package guard requires every engine file the viewer imports, not only the viewer's own files.
- The viewer installs to `_lumina/viewer/` for every classic profile, `minimal` included, on fresh installs and upgrades alike. A project-mode install never contains `_lumina/viewer/`.
- The installed copy is checked by starting it: `node _lumina/viewer/view.mjs` in an installed workspace prints its ready line and answers `/api/health`, `/`, and `/api/wiki`.
- The skill's command is `node _lumina/viewer/view.mjs`. The skill reports the address and never opens or fetches the page.
- The skill's `description` follows the plain-language rule. No emoji.

**Never:**
- No run of the installer inside this repo; use `npm run dev:sandbox` or a temp folder.
- No change to `copyScripts`. No new subcommand in `bin/lumina.js`. No change to the layout checker.
- No file of `src/viewer/ui/` or `src/viewer/test-fixtures/` in the package, and no test file.
- No version bump, changelog entry, README, workspace README, or user guide change here: story 9 does those and ships in the same release.
- No change to how an upgrade picks its profile. That an upgrade without `--profile` turns a `minimal` wiki into a full one is existing behavior, logged as deferred work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fresh classic install | any classic profile | `_lumina/viewer/` holds exactly the listed files, byte-equal to their sources | N/A |
| Second install | same workspace | no diff under `_lumina/viewer/` | N/A |
| Upgrade | workspace installed before the viewer existed | the next install adds `_lumina/viewer/` | N/A |
| Listed source missing | a file removed from the package | install stops | exit 3, message names the file |
| Project-mode install | `--mode project` | no `_lumina/viewer/` | N/A |
| New file under `src/viewer/` not on the list | outside `ui/`, `test-fixtures/`, tests | the completeness test fails | N/A |
| Listed file not in `package.json` `files` | | the completeness test and `ci:package` fail | N/A |
| Installed viewer | `node _lumina/viewer/view.mjs` in the workspace | ready line; `/api/health` reports the installed version; `/` and both assets are served | N/A |
| Skill, viewer starts | host can keep a command running | the skill reports the address and how to stop the viewer | N/A |
| Skill, already running | `reused: true` | the skill reports the address and says it was already running | N/A |
| Skill, port refused | `reason: bind_refused`, from a sandbox that blocks listening, connecting, or both | the skill gives the user the command to run in their own terminal | N/A |
| Skill, user is on another machine | remote session, agent host | the skill says the address works only where the agent runs, and hands over the command | N/A |
| Skill, asked to stop | viewer started in this session | the skill ends that command | N/A |
| Skill, stale viewer it started itself | `reason: stale_server` after an upgrade | the skill stops its own viewer and starts once more | N/A |
| Skill, host cannot keep a command running | | the same hand-off | N/A |
| Skill, viewer files absent | workspace installed by an older version | the skill tells the user to run the installer again in that wiki | N/A |
| Skill, other failure | `no_workspace`, `stale_server`, `no_free_port`, `node_version`, `internal` | the skill reports what happened in plain words and stops | no retry loop |
| Help | `/lumi-help skills` | lists `/lumi-view` | N/A |

</frozen-after-approval>

## Code Map

- `src/installer/project-mode.js:56-73, 314-324` -- the pattern to mirror: a frozen list relative to a source folder, and a loop that throws `err.code = 3` naming the missing file before `atomicCopyFile(src, dest)`.
- `src/installer/fs.js` -- `atomicCopyFile(srcPath, destPath)` (creates the folder, temp file, rename), `pathExists`.
- `src/installer/commands.js` -- `PACKAGE_ROOT` at 74; step 8 `await copyScripts(projectRoot)` at 491-492, run for every classic profile; project mode returns early at 283-290, so nothing after it runs there; `coreSkills` at 2200-2210 with entries `{ name, canonicalId, displayName }`; agent hosts take the same list.
- `bin/lumina.js:89-96` -- `err.code === 3` becomes exit 3.
- `src/installer/project-mode.test.js:50-82` -- the completeness test to mirror: every non-test file under the source folder is listed, and every listed file is in `package.json` `files`.
- `package.json` -- `files` is per file; `test:installer` names its test files one by one.
- `scripts/ci-package.mjs:62-72, 74-118` -- `prohibitedPatterns`; `requiredFiles`, which spreads `PROJECT_ENGINE_FILES`.
- `scripts/ci-idempotency.mjs:23-71, 73-90, 132-137` -- scenarios (`isProject` marks the project one, which has its own `diffPaths`); `managedDiffPaths`; the one absence check, classic must not create `_lumina/project/`.
- `scripts/ci-agent-host-isolation.mjs:37-55` -- a copy of `managedDiffPaths`.
- `src/skills/core/check/SKILL.md` -- core skill shape: frontmatter `name`, folded `description`, block-list `allowed-tools`; body `# /lumi-check`, the README line, `## Role`, `## Context`, `## Instructions`, `## Output Format`, `## Examples`, `## Guardrails`, `## Definition of Done`. `src/skills/project/lumi-project-view/SKILL.md` -- the nearest precedent in tone.
- `src/templates/_lumina/schema/lumi-help.csv` -- header `id,menu,pack,phase,after,before,required,args,outputs,description`; `scripts/verify-lumi-help.test.mjs` fails on a core skill with no row.
- `src/viewer/view.mjs` -- prints `{"ok":true,"url":...,"port":...,"reused":...}`; failures on stderr as `{error, code, reason}`.

## Tasks & Acceptance

**Execution:**
- [x] `src/installer/viewer-files.js` -- `VIEWER_FILES` (`view.mjs`, `lib/server.mjs`, `lib/data.mjs`, `lib/communities.mjs`, `app/index.html`, `app/viewer.js`, `app/viewer.css`, `app/THIRD-PARTY-NOTICES.md`) and `copyViewerFiles(projectRoot, srcDir)` with the source folder defaulting to the package's `src/viewer`.
- [x] `src/installer/viewer-files.test.js` -- completeness both ways; every listed file and the module itself in `package.json` `files`; a copy into a temp folder is byte-equal; a missing source rejects with `code === 3` and names the file. Add it to `test:installer`.
- [x] `src/installer/commands.js` -- check the viewer sources before the first write of a classic install; call `copyViewerFiles` right after step 8; add `{ name: 'view', canonicalId: 'lumi-view', displayName: '/lumi-view' }` to `coreSkills`.
- [x] `package.json` -- `files` entries for the module and the eight viewer files.
- [x] `scripts/ci-package.mjs` -- require the module and spread `VIEWER_FILES`; require the engine files the viewer imports from `VIEWER_ENGINE_FILES`, a list a test keeps equal to the viewer's real imports; prohibit `^src/viewer/test-fixtures/` and `^src/viewer/ui/`.
- [x] `scripts/ci-idempotency.mjs` -- add `_lumina/viewer` to `managedDiffPaths`; assert a project install has no `_lumina/viewer/`; for one classic scenario, after the diff check, start the installed viewer with an async spawn, check the ready line, `/api/health`, `/`, and `/api/wiki`, and stop it in a `finally` that awaits its exit before the workspace is removed; a deadline on every wait; `git status --porcelain` equal before and after, to prove the viewer wrote nothing.
- [x] `scripts/ci-agent-host-isolation.mjs` -- add `_lumina/viewer` to its list.
- [x] `src/skills/core/view/SKILL.md` -- the skill.
- [x] `src/templates/_lumina/schema/lumi-help.csv` -- one row.
- [x] `AGENTS.md` -- add `/lumi-view` to the core list and `_lumina/viewer/` to the watched paths.
- [x] `src/viewer/lib/server.mjs`, `server.test.mjs` -- a probe whose connect is refused by policy (`EPERM`, `EACCES`) reports `denied`. Any denied probe ends the start with `bind_refused`, before any listen: the viewer cannot check its own port range for a viewer already serving this wiki. Without this a sandbox that blocks connecting reads as twenty busy ports.

**Acceptance Criteria:**
- Given `npm run dev:sandbox -- --keep`, when `node _lumina/viewer/view.mjs` runs in the sandbox, then the address it prints serves the viewer.
- Given `npm run ci:idempotency`, `npm run ci:package`, `npm run ci:agent-isolation`, `npm run test:installer`, and `npm run test:catalog`, then all pass.
- Given the pull request, then those gates pass on ubuntu, macos, and windows.

## Implementation Notes

## Spec Change Log

- **2026-10-10, plan critique before coding.** A sandbox that denies loopback connects made every probe "busy", so the viewer said `no_free_port` and the skill never handed the command over; reproduced with a deny-network profile. The start check in CI could leave a process running and mask its own failure on Windows. The package guard did not require the engine files the viewer imports. The skill tested a relative path before knowing the wiki root, forbade the restart that `stale_server` needs, had no way to stop the viewer, and said "opens" for something that reports an address. All amended here and in the skill before any code.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | A sandbox that refuses connects but allows listening could start a second viewer for the same wiki | medium | patch | probe state `denied`; `bind_refused` when the holder of a taken port cannot be identified |
| 2 | The test named for a denied probe never denied one; reverting the mapping kept the suite green and the process answered `no_free_port` | high | patch | mutation run; the fake probe now returns `denied`; four process-level cases with the connect refused |
| 3 | Unreachable-network errors on the probe read as busy | low | patch | counted as free |
| 4 | CI start check: spawn error unhandled; nothing proved it ran; ignored paths hidden from the write check; three routes only | medium | patch | error handler, run counter, `git status --ignored`, assets plus `/api/lint` and `/api/page` |
| 5 | Engine files the viewer imports were listed by hand in the package guard and not checked by the installer | medium | patch | `VIEWER_ENGINE_FILES`; a test walks the imports from `view.mjs` |
| 6 | Completeness test would trip on a dotfile | low | patch | dotfiles skipped |
| 7 | No install-level test for the minimal profile, for an upgrade, or for "fails before any write" | medium | patch | three mutations each stayed green; four tests added, each mutation now fails exactly one |
| 8 | Skill started the viewer before asking whether the user's browser can reach it | medium | patch | its own step, before the start |
| 9 | Skill searched parent folders before using the README it had just read | low | patch | the README's folder first |
| 10 | Hand-off command joined with `&&`, which older PowerShell rejects | medium | patch | two lines |
| 11 | A stale viewer that nobody can find left the user stuck | medium | patch | stop by port, only after a yes and a health check that names the viewer |
| 12 | "Stays up until you close this chat" promised more than a host guarantees | low | patch | reworded |
| 13 | Two rules for a repeated ask; an empty-wiki line the skill cannot verify | low | patch | one rule; line removed |
| 14 | "The same install command they used" is not a command | medium | patch | the literal command; a note for hub-managed wikis |
| 15 | Failure rows mixed the message with the action | low | patch | one sentence and one action per reason |
| 16 | A file dropped from the list stays under `_lumina/viewer/` after an upgrade | low | reject | AD-2 accepts it; nothing loads an unlisted file |
| 17 | An upgrade without a profile turns a minimal wiki into a full one | medium | defer | existing behavior; logged in deferred work; the skill warns |
| 18 | Final pass: with connects refused and listening allowed, a second viewer started when the first sat on another port of the range | medium | patch | reproduced; any denied probe now ends in `bind_refused` with no listen; the rule of row 1 is replaced by this simpler one |
| 19 | Final pass: the CI write check could not see a new file inside an ignored folder that already held files | medium | patch | reproduced; `--untracked-files=all` |
| 20 | Final pass: the skill's remote path handed over a command for a folder the user's computer does not have | medium | patch | wording: the two lines run where the wiki folder is, and the address opens there |
| 21 | Final pass: the skill's start step joined two commands with `&&` | low | patch | working directory first, then one command |
| 22 | Final pass: a host that cannot read a background command's output threw away a viewer that had started | low | patch | one sentence in the start step |
| 23 | Final pass: the broken-package test copied a local 67 MB virtual environment | low | patch | copy filter |
| 24 | Final pass: the CI start check has no signal handler, and a timeout in cleanup hides the first error | low | reject | CI runners reap the process tree; the first error is still printed by the scenario |

## Design Notes

The installed-viewer start check lives in `ci-idempotency` because that script already builds real installed workspaces on all three operating systems. It is the only proof that the viewer's imports of `../scripts/` resolve in the installed layout.

A workspace installed before this release has no `_lumina/viewer/`. The layout checker is left alone, so such a workspace is still valid; the skill says to run the installer again.

## Verification

**Commands:**
- `npm run test:installer && npm run test:catalog` -- expected: pass
- `npm run ci:package && npm run ci:idempotency && npm run ci:agent-isolation` -- expected: pass
- `npm run test:all` -- expected: no regression
