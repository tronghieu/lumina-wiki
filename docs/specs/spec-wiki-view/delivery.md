# Delivery

How the viewer reaches a user, what the repo must change to allow it, and the evidence behind those choices.

## Shape

| Part | Where it comes from | When |
|---|---|---|
| Viewer code | One bundle, built by the maintainer, committed to git, shipped in the package | Built on change |
| HTML shell | A fixed file shipped in the package | Never generated |
| Wiki data | Read from disk by the local server | On each request |

Nothing is generated into the user's workspace.

## The server

- Built on `node:http`. No new runtime dependency.
- Runs in the foreground until it is ended.
- Prints the address once it is listening, as one JSON line with `ok` and `url`. Errors go to stderr as `{"error", "code"}` with exit code 2 or 3, as elsewhere in the engine.
- A second start for the same workspace reports the address already serving it.
- A port held by something else leads to another port and a clear message.
- A refused bind (`EPERM` or `EACCES`) exits 2 with a message naming a sandbox as the likely cause. The skill then hands the user the command. A sandbox that also refuses outgoing loopback connections ends the same way.
- Before listening, every candidate port is probed; only a port that refused the probe is used. A refused loopback connection can take over a second on Windows, so a start there takes about one second.
- Ending the command frees the port. No process and no file remain.

Who starts it:

| Starter | How | Ends when |
|---|---|---|
| Agent host | As a background task, where the host has one | The host ends the task or the session |
| User | One command in a terminal | Ctrl-C |

The skill tries the first and falls back to handing the user the command.

For a sandboxed host to recover, the failure must be visible: the server command itself must exit non-zero when the bind is refused. A wrapper that hides the failure behind exit 0 leaves the host with nothing to react to.

Rejected: a detached daemon with a state file and an idle timer. A spike showed it works on macOS, but it is where orphan processes and stale ports come from in comparable tools, and at least one host stops detached children at session exit anyway.

## Protection

A local server is reachable by any process on the machine and, without care, by web pages in the user's browser.

| Rule | Guards against |
|---|---|
| Bind `127.0.0.1` only | Access from the network |
| Reject a `Host` header that is neither `127.0.0.1:<port>` nor `localhost:<port>` | DNS rebinding |
| GET only | Any write path |
| No CORS headers | Another site reading responses |
| Request input never becomes a path; ids and asset names are looked up | Path traversal out of `wiki/` |
| Expose wiki content and own assets only | Exposure of `raw/`, config, or secrets |
| Content security policy on the shell | Script injected through page content |

## Build

- Bundler: `esbuild`, one pinned exact version, as a `devDependency`.
- UI: React 19.
- The bundle is committed to git.
- CI rebuilds it and fails on any difference, on every pull request and before publish. This is the same "regenerate, then `git diff --exit-code`" pattern as `ci:idempotency`.
- The bundle is marked `binary` in `.gitattributes`, so git never line-merges two builds. On a conflict, rebuild.
- The same build generates the third-party notices from each bundled package's own license file. CI diffs both files.
- CI and the publish workflow install with `npm ci --ignore-scripts`, so the build tool's install script never runs in a job that can publish.

The fallback of building in `prepack` was not needed: the bundle check passes on Linux, macOS, and Windows.

Rejected: bundling on the user's machine. `esbuild` is a 10.6 MB native binary with its own `postinstall`. It would become a runtime dependency and move build failures onto users.

Chosen renderer: `markdown-it`, over `marked`. It ignores raw HTML and rejects script URLs by default, and it needs no DOM-based sanitizer, so it is testable under `node --test`. Cost: 27 kB more after gzip.

Rejected: React without a build. React 19 ships no UMD build. The last version that does, 18.3.1, dates from April 2024.

## Reuse from the project-mode viewer

- Graph styling carries over.
- The `force-graph` library and the Node-side community detection in `src/project/lib/view.mjs` may be reused where they fit.
- No project-mode file is modified, and nothing else is shared.
- The repo has no markdown-to-HTML code. The reader's renderer is new.

## Policy amendments

| Document | Current text | Change |
|---|---|---|
| `docs/project-context.md` | No transpile; `devDependencies: {}` is a feature | Allow `devDependencies` for the viewer bundle only |
| `AGENTS.md` rule 5 | `devDependencies: {}` is a feature | Same amendment |
| `docs/planning-artifacts/architecture.md` | "Daemonless — no server, no long-running process" | Allow a foreground viewer server; still no background daemon |
| `docs/planning-artifacts/prd.md` NFR-M2 | No vendored or redistributed third-party code | Already untrue since the project-mode viewer; restate to match practice |
| `docs/project-context.md` edge shape | `{source,target,type,confidence}` | Correct to `{from,type,to,confidence}` |
| `docs/planning-artifacts/architecture.md` license audit | MIT/ISC/Apache-2.0 only | Add BSD-2-Clause and BSD-3-Clause; a BSD module already ships inside the project-mode viewer |

These edits were applied on 2026-10-10, ahead of the build.

Unchanged: runtime `dependencies`, no `postinstall`, no native modules on user machines, zero telemetry, cold start under 300 ms, no test framework.

## Shipping the assets

- `package.json` `files` is a per-file allowlist. The bundle, the shell, and the styles must be added by name.
- `scripts/ci-package.mjs` holds the list of files a package must contain. The bundle belongs there.
- `copyScripts` swallows copy failures, so the viewer does not use it. It installs from its own explicit list, which stops the install when a file is missing.
- Third-party notices currently live at `src/project/vendor/THIRD-PARTY-NOTICES.md`.
- The publish workflow runs from a `v*` tag in `.github/workflows/publish.yml`.

## Registering the skill

Adding a core skill touches these places:

| Place | What |
|---|---|
| `src/skills/core/<name>/SKILL.md` | The skill itself; body opens with the README line |
| `src/installer/commands.js` `getSkillDefs` | Entry in the `coreSkills` array |
| `src/templates/_lumina/schema/lumi-help.csv` | One row; a test checks it against the skill folders |
| `README.md`, `README.vi.md`, `README.zh.md` | Skill table |
| `src/templates/README.md` and its `.vi`, `.zh` versions | Workspace skill table |
| `docs/user-guide/` en, vi, zh | Skill section in the four-part form: purpose, when to use, how to invoke, what you get back |
| `AGENTS.md` | Core skill list |
| `CHANGELOG.md` | Release entry; the publish workflow reads release notes from it |

The README line that suggests opening the workspace in another markdown app should name `/lumi-view` first.

## Evidence

Build spike, macOS arm64, Node 24:

| Measure | Result |
|---|---|
| Inputs, first run | `react` and `react-dom` 19.3.0, `force-graph` 1.51.4, `marked` 18.1.0, `esbuild` 0.28.2 |
| Same bytes | Two native builds, a different absolute path, and `esbuild-wasm` all matched |
| Size | 449,479 bytes raw, 142,251 gzipped |
| Second run, with `markdown-it` 15.0.2 in place of `marked` | 502,466 bytes raw, 169,361 gzipped; two builds matched |
| Licenses in the install tree | MIT 24, ISC 16, BSD-3-Clause 1, BSD-2-Clause 1, PSF-2.0 1 (`argparse`, used only by a CLI and not bundled) |
| Build time | About 55 ms |
| Linux and Windows | Proven later by CI: the bundle check passes on ubuntu, macos, and windows runners |

Server spike, macOS arm64, Node 24: a 71-line zero-dependency server passed start, reuse, live read from disk, `Host` rejection, and clean exit. It also survived the Claude Code tool call that launched it.

The built server, in CI on ubuntu, macos, and windows runners: start, reuse, two starts at once, a stale version, busy ports, forced listen failures, loopback-only bind, and stop with the port released all pass. Typing Ctrl-C in a Windows terminal is the one behavior no runner can show.

Agent hosts:

| Host | Finding | Basis |
|---|---|---|
| Claude Code | Sandbox off by default; the server started and stayed up across tool calls. With the sandbox on, loopback needs an explicit setting. Detached children are stopped at session exit. | Run, plus documentation |
| Codex CLI 0.46.0 | Workspace-write sandbox: `listen EPERM: operation not permitted 127.0.0.1`. With `sandbox_workspace_write.network_access=true`: binds, and answers from outside the sandbox. | Run with `codex sandbox macos`, no model |
| Codex app, live session, probe script | The same `listen EPERM`. The probe exited 0, so Codex saw no failed command and did nothing further. | Run by the maintainer |
| Codex app, live session, server command run directly with the goal stated | Codex started the server as a background child of its own process and reported `http://localhost:<port>`. It answered from outside the sandbox 31 s later. The session used "Approve for me", and its transcript shows no approval prompt. | Run by the maintainer, checked from a separate shell |
| Cursor, Gemini CLI, Qwen Code, iFlow | Loopback and process cleanup are not documented. | Documentation |

Comparable tools:

| Tool | Server started by | Lesson |
|---|---|---|
| GitNexus | User, foreground | React 19 UI built in `prepack` with an asset assert; no `Host` check |
| Prisma Studio | User, foreground | A busy default port once failed silently |
| claude-mem | Agent hook, detached daemon | Orphan processes and stale ports; commits its `esbuild` bundle to git |
| Serena | Agent host, inside its own process | CVE-2026-49471: no `Host` check allowed DNS rebinding |

None of them runs from `file://`.
