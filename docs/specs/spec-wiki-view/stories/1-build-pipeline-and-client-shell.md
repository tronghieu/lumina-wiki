---
title: 'Wiki view story 1: build pipeline and client shell'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'e7adbe3ca9706ba955e6b51b08297ca6dda484f1'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The viewer needs one committed bundle that provably matches its source on Linux, macOS, and Windows. The repo has no build step, no `devDependencies`, and no CI check for generated files.

**Approach:** Add the `esbuild` build script, the bundle check, and the viewer test script, wired into CI and publish. Author the HTML shell, the stylesheet, and a first client entry that calls React, `force-graph`, and `markdown-it`, so the first committed bundle exercises all three. Spine AD-16, AD-17, AD-20, AD-22.

## Boundaries & Constraints

**Always:**
- Exact versions: `react` 19.3.0, `react-dom` 19.3.0, `force-graph` 1.51.4, `markdown-it` 15.0.2, `esbuild` 0.28.2, all in `devDependencies`.
- Build options exactly as AD-16. Two generated files, the bundle and the notices; neither is written unless every check passes. No source map.
- The build fails on a bundled package whose license is outside MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, or that has no license text.
- License texts in the notices file come from the files each package ships in `node_modules`.
- CI installs with `npm ci --ignore-scripts`.
- Tests use `node:test` and `node:assert/strict`.

**Never:**
- No test framework. No runtime `dependencies` change. No `postinstall`.
- No edit to `package.json` `files`, `scripts/ci-package.mjs`, `src/installer/`, or `src/project/` (story 8 and project mode own them).
- No build in `prepack`. If bundle bytes differ across operating systems, stop and report.
- No CSS import from `ui/`. No inline script or inline style in the shell.

</frozen-after-approval>

## Code Map

- `package.json` -- `devDependencies` is `{}`. `test:project` shows the quoted-glob form to copy. `test:all` chains the suites.
- `package-lock.json` -- tracked, `lockfileVersion` 3. After install it must list `@esbuild/linux-x64` and `@esbuild/win32-x64`.
- `scripts/ci-idempotency.mjs` -- house style for CI scripts: shebang, `/** */` header, `repoRoot` from `fileURLToPath(import.meta.url)`, `spawnSync('git', ['diff', '--exit-code', '--', ...])`, failure by `throw new Error(...)`.
- `.github/workflows/ci.yml` -- job `installability`, three operating systems, `npm ci`, default shell. Steps run `npm run <script>`.
- `.github/workflows/publish.yml` -- job `publish`: `npm ci`, installer tests, idempotency, `ci:package`, publish.
- `.gitattributes` -- `* text=auto eol=lf`; the bundle needs its own line.
- `src/project/vendor/THIRD-PARTY-NOTICES.md` -- format to follow: `# Third-Party Notices`, one intro sentence, then per package `## <name> <version>`, bullets `- Source:`, `- License:`, `- Copyright ...`, and the full license text in a bare code fence.
- `src/project/view/viewer.css` lines 1-31 -- dark tokens (`--bg: #11111b`, `--fg: #cdd6f4`, `--muted`, `--panel-bg`, `--input-bg`, `--border`, `--accent`, `--error`, `--warning`, `--info`) and the base `html, body` rule. Copy the values; do not import or edit the file.
- `CONTRIBUTING.md` lines 51 and 83, `SECURITY.md` line 90 -- still say the repo has no `devDependencies`.
- `docs/DEVELOPMENT.md` section 5, `AGENTS.md` "Common commands" -- list the gates.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json` -- add the five exact-pinned `devDependencies`; add scripts `build:viewer` (`node scripts/build-viewer.mjs`), `ci:viewer-bundle` (`node scripts/ci-viewer-bundle.mjs`), `test:viewer` (`node --test "src/viewer/**/*.test.mjs" scripts/build-viewer.test.mjs`); append `npm run test:viewer` to `test:all`; regenerate the lockfile with `npm install` -- AD-17, AD-20.
- [x] `scripts/build-viewer.mjs` -- pure exports `bundledPackages`, `pickLicenseFile`, `collectNotices`, `renderNotices`, `checkOutputs`, and `buildViewer()`, which builds in memory with the AD-16 options, checks the single output, collects license texts and problems, and writes both files only when there is no problem. A package with no license file needs an entry in the script's `NO_LICENSE_FILE` table. The main-module guard compares real paths -- AD-16, AD-17.
- [x] `scripts/build-viewer.test.mjs` -- every pure export on hand-made input, the failure paths included; one test pins the `devDependencies` key set and exact versions.
- [x] `scripts/ci-viewer-bundle.mjs` -- fail when either generated file is not tracked by git; await `buildViewer()`; fail when `git diff --exit-code` over both files is 1, naming `npm run build:viewer` as the fix; report a git failure as a git failure -- AD-17.
- [x] `src/viewer/app/index.html` -- shell per AD-16: `lang="en"`, charset, viewport, title `Lumina Wiki`, stylesheet link to `/assets/viewer.css`, `<div id="root">`, `<script defer src="/assets/viewer.js">`.
- [x] `src/viewer/app/viewer.css` -- the dark tokens, the base rule, and a full-window pane grid: graph left, tree right, reader between them when present (`viewer-ui.md`, Layout).
- [x] `src/viewer/ui/main.jsx` -- mount an `App` at `#root` that draws the pane grid, creates a `force-graph` instance on an empty graph in the graph pane, and shows one status line produced by `markdown-it` (`html: false`, `linkify: false`). Later stories replace the body of `App`.
- [x] `src/viewer/app/shell.test.mjs` -- assert the shell has no inline script and no `style` attribute or element, links both assets by the AD-7 paths, and holds `#root`.
- [x] `src/viewer/app/viewer.js`, `src/viewer/app/THIRD-PARTY-NOTICES.md` -- run `npm run build:viewer` and keep both outputs for commit.
- [x] `.gitattributes` -- mark the bundle `binary linguist-generated` and the notices file `linguist-generated`.
- [x] `.github/workflows/ci.yml` -- add steps `Viewer tests` (`npm run test:viewer`) and `Viewer bundle is current` (`npm run ci:viewer-bundle`) after `Project engine tests`.
- [x] `.github/workflows/publish.yml` -- add `Viewer bundle is current` before `Package readiness`.
- [x] `CONTRIBUTING.md`, `SECURITY.md`, `docs/DEVELOPMENT.md`, `docs/code-standards.md`, `docs/codebase-summary.md`, `docs/project-context.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `AGENTS.md` -- correct the `devDependencies` wording and list the new gates.

**Acceptance Criteria:**
- Given a clean checkout after `npm ci`, when `npm run ci:viewer-bundle` runs, then it exits 0 and `git status` shows no change.
- Given one changed character in `src/viewer/ui/main.jsx`, when `npm run ci:viewer-bundle` runs, then it exits non-zero and names the fix.
- Given a notices file edited by hand, when `npm run ci:viewer-bundle` runs, then it exits non-zero.
- Given a bundled package with a disallowed license or no license text, when the build runs, then it fails, names the package, and writes neither file.
- Given the built bundle, then it contains code from `react-dom`, `force-graph`, and `markdown-it`, and the metafile lists no package licensed outside the allowed set.
- Given two consecutive builds, then `viewer.js` is byte-identical.
- Given the pull request, then `Viewer bundle is current` passes on ubuntu, macos, and windows.

## Implementation Notes

- First bundle: 502,623 bytes, 40 packages; licenses MIT, ISC, BSD-2-Clause, BSD-3-Clause. Two consecutive builds give the same bytes for both generated files.
- `bezier-js` ships no license file. Its entry in `NO_LICENSE_FILE` reuses the text already carried in `src/project/vendor/THIRD-PARTY-NOTICES.md`.
- The lockfile, generated on macOS, lists all 26 `@esbuild/*` platform packages.
- `esbuild` builds without its install script: the local install did not run it, and CI now passes `--ignore-scripts`.
- Open until the first pull-request run: the last acceptance criterion (the bundle check on ubuntu and windows).

## Spec Change Log

- **2026-10-10, review pass 1.** Trigger: the notices check compared headings only, so a library could ship without its license text; the generator was a throwaway, leaving 40 transitive packages with no upkeep path; esbuild wrote before the checks ran, so a CSS import would have overwritten the authored stylesheet. Amended: the notices file is generated by the build and guarded by the same regenerate-and-diff as the bundle; the build runs in memory. Avoids: a second parser for a hand-kept file, and a failed build that leaves new output on disk. The code was patched in place, not reverted and re-derived: the maintainer delegated approval, and the change is confined to two scripts. KEEP: `bundledPackages` and its tests; the exact esbuild options; the shell, stylesheet, and entry file; the CI step names.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Build failure paths run by no test; gate trusts the exit code | medium | patch | `main()` was unreachable from tests; checks moved into pure exports with tests |
| 2 | esbuild writes before the output check; a CSS import overwrites `viewer.css` | medium | bad_spec | reproduced by the reviewer with `write: false`; build now runs in memory |
| 3 | A failed notices check leaves a new bundle on disk | low | bad_spec | same cause as 2 |
| 4 | `(disabled):` metafile keys break the package path | low | patch | reproduced by the reviewer; prefix stripped |
| 5 | SPDX expression or object `license` is rejected | false | reject | no bundled package has one; a loud failure on an unseen form is the intended behavior |
| 6 | Notices check verifies a heading only; stale sections pass | medium | bad_spec | true of `checkNotices`; replaced by generation |
| 7 | No upkeep path for the notices file | medium | bad_spec | generator was out of the repo by design; now part of the build |
| 8 | Main guard fails open through a symlink and exits 0 | medium | patch | reproduced by two reviewers; guard compares real paths and CI awaits `buildViewer()` |
| 9 | `pathToFileURL(undefined)` throws on import without `argv[1]` | low | patch | same guard |
| 10 | `-text -diff` lets git line-merge two bundles | medium | patch | reproduced in a scratch repo; bundle marked `binary`; AD-17 amended |
| 11 | Publish job runs esbuild's install script with publish rights | medium | patch | lockfile has one `hasInstallScript` entry; both workflows use `--ignore-scripts`; the local build already ran without the script |
| 12 | `devDependencies` policy enforced nowhere | medium | patch | one test pins the key set and exact versions |
| 13 | `code-standards.md`, `codebase-summary.md` state the old policy | medium | patch | corrected |
| 14 | Gate lists miss the new commands | low | patch | CONTRIBUTING, PR template, DEVELOPMENT, code-standards, project-context updated |
| 15 | Three changed doc lines were untrue | low | patch | reworded |
| 16 | `dangerouslySetInnerHTML` outside the reader | low | patch | AD-14 allows one injection point; now a text child |
| 17 | Graph canvas takes the window size | low | patch | width and height passed at creation; resize arrives with story 4 |
| 18 | `ForceGraph` throwing blanks the page | low | reject | needs a guard for a state never shown; the placeholder is replaced in story 4 |
| 19 | No layout for viewports under 640px | low | reject | desktop tool; adds rules for a case outside the spec |
| 20 | Palette credit dropped; unused `--stale`; translucent panel color | low | patch | corrected |
| 21 | No icon link, so each load requests `/favicon.ico` | low | patch | `data:,` icon link added |
| 22 | Shell test misses `//host` URLs, `on*=` attributes, attribute order | low | patch | tightened |
| 23 | `git` missing or failing is reported as a stale bundle | low | patch | spawn errors and statuses above 1 reported as git failures |
| 24 | A staged but uncommitted bundle passes locally | low | reject | intended: the check runs before the commit; CI checks a clean checkout |
| 25 | Spec said `checkNotices(packages, noticesText)`; code took three arguments | false | reject | the function no longer exists |
| 26 | PR review: the build writes both outputs with `writeFile`; an interrupted run leaves a cut-off file | low | patch | both writes now go through `atomicWrite` from `src/installer/fs.js`; `ci:viewer-bundle` still reports no diff |

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all tests pass
- `npm run ci:viewer-bundle` -- expected: exit 0, clean tree
- `npm run test:all` -- expected: no regression
- `npm run ci:package` and `npm run ci:idempotency` -- expected: pass, unchanged behavior
- `node -e "const l=require('./package-lock.json').packages;for(const p of ['linux-x64','win32-x64','darwin-arm64'])if(!l['node_modules/@esbuild/'+p])throw new Error(p)"` -- expected: exit 0
