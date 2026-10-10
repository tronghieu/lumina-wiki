---
title: 'Wiki view story 3: server and process contract'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '8b979f9'
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Once the read model and the client bundle exist, nothing serves them. A host or a user needs one foreground command that starts the viewer on loopback, reports its address, refuses hostile requests, finds an already-running viewer without a state file, and leaves nothing behind when it ends.

**Approach:** Add `view.mjs` (workspace discovery, start, signals) and `lib/server.mjs` (routes, guards, headers, port walk) on `node:http`, with tests that run the real process on all three operating systems. Spine AD-7 to AD-12, AD-18, AD-21. Precondition: story 2 is in the tree.

## Boundaries & Constraints

**Always:**
- Listen on `127.0.0.1` only. Guard order: method, then `Host`, then route (AD-9). The AD-9 headers go on every response the handler writes.
- The seven routes of AD-7 and no others; exact `pathname` match.
- The server serializes what the read model returns and adds no key. `null` is 404, a throw is 500 with a fixed message, and the server keeps running.
- Assets come from a fixed three-entry map and are read from disk on each request.
- stdout carries exactly one line, ever. Failures are `{error, code, reason}` on stderr with the exit codes of AD-10; an uncaught failure is `internal`, exit 3.
- Probes use `node:http` against `127.0.0.1` with the two deadlines of AD-11. No `fetch` anywhere in the server or the entry.
- Imports: `node:` builtins, sibling viewer modules, and the engine by the AD-18 paths.

**Never:**
- No state file, no detached child, no timer that outlives a request or the start, no browser launch, no cache of wiki data.
- No `Access-Control-*` header. No request text joined onto a directory. No thrown text in a response body.
- No flag parsing. No module under `src/viewer/lib/` beyond `server.mjs` and its test.
- No test that assumes a fixed port is free, sleeps a fixed time, or waits without a deadline.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Start | cwd inside a workspace, range free | stdout `{"ok":true,"url":"http://127.0.0.1:<port>/","port":<port>,"reused":false}`; process stays up | N/A |
| Start from a subfolder | cwd is `wiki/sources/` | same; root is the workspace | N/A |
| No workspace | no `wiki/` in cwd or above, or `wiki` is a file | nothing on stdout | stderr `reason: "no_workspace"`, exit 2 |
| Listen refused | `EPERM`, or `EACCES` on every port | nothing on stdout | `reason: "bind_refused"`, exit 2 |
| Unexpected failure | unknown listen error; stdout closed before the line | nothing on stdout | `reason: "internal"`, exit 3 |
| Old Node | major below 24 | nothing on stdout | `reason: "node_version"`, exit 3 |
| Broken manifest | invalid JSON, or a non-string `packageVersion` | starts; `version: null` | N/A |
| Second start, same root and version | first still running | same `url`, `"reused":true`, exit 0 | N/A |
| Two starts at the same moment | same root | one line with `false`, one with `true`, same `url`; one process left | N/A |
| Second start, other version | `<root>/_lumina/manifest.json` `packageVersion` changed since the first start | nothing on stdout | `reason: "stale_server"`, exit 3 |
| Base port held on `127.0.0.1` | a foreign listener | next free port; one plain stderr line naming both ports | N/A |
| Base port held on `0.0.0.0` | a foreign listener | never listens on that port; next free port | N/A |
| Walk branches, with a fake probe and listen | all busy; `EACCES` on some; `EPERM`; `EADDRINUSE` then a same-root viewer; `EADDRINUSE` then busy | `no_free_port`; `bind_refused`; `bind_refused` at once; reuse; next port | N/A |
| POST, PUT, DELETE | any path | 405, `Allow: GET`, `{error: "method_not_allowed", message}` | N/A |
| HEAD | any path | 405, `Allow: GET` (no body to assert) | N/A |
| Foreign `Host` | `evil.example`, `127.0.0.1:1`, `[::1]:<port>`, `localhost.:<port>` | 403 `{error: "forbidden_host", message}` | N/A |
| No `Host` | HTTP/1.1 request sent without the header | 403 from the handler | N/A |
| Own `Host`, any case | `LOCALHOST:<port>`, `127.0.0.1:<port>` | served | N/A |
| Unknown path | `/api/nope`, `/view.mjs`, `/index.html`, `/assets/viewer.js/` | 404 `{error: "not_found", message}` | N/A |
| Target that only normalizes to a route | `//evil.example/api/health`, `/assets/../api/wiki`, `/%2e/api/health`, `/api\health`, absolute form | 404 | N/A |
| Unparseable target | `GET http://[bad HTTP/1.1` on a raw socket | 404; the next request is served | no crash |
| Page | `/api/page?id=sources%2Flora` | 200, body of `readPage` | N/A |
| Page, bad id | no `id`, unknown id, `id=../README` | 404 | N/A |
| Read model throws | injected `readWiki` that rejects | 500 `{error: "internal", message}` with a fixed message; `/api/health` then answers 200 | N/A |
| Live read | a page file added after start | the next `/api/wiki` holds it | N/A |
| Stop | SIGTERM or SIGINT, during startup or after the line | the test can bind the port itself; the workspace file list is unchanged | exit 0 off Windows |

</frozen-after-approval>

## Code Map

- `src/viewer/lib/data.mjs` -- `readWiki(root)`, `readPage(root, id)` (`null` for a non-page), `readLint(root)`; all async. `readWiki` rejects when `wiki/` is missing.
- `src/scripts/lint.mjs` -- `findProjectRoot(startDir)`: async; walks up to the first folder holding `wiki/`; `null` at the filesystem root. Its CLI runs when `argv[1]` ends in `lint` or `lint.mjs`, so the entry keeps the name `view.mjs`.
- `src/viewer/app/` -- `index.html`, `viewer.js`, `viewer.css`; routes `/`, `/assets/viewer.js`, `/assets/viewer.css`.
- `<root>/_lumina/manifest.json` -- pretty-printed JSON; `packageVersion` is the version. Absent in a bare fixture.
- `src/viewer/test-fixtures/contract/` -- workspace and expected JSON.
- `src/project/project.test.mjs:38-49` -- house pattern for spawning a child with `process.execPath`. `src/scripts/lint.test.mjs:1925` -- `skip: process.platform === 'win32'`. No existing test opens a port or sends a signal.
- Node facts checked by experiment: `fetch` drops a `Host` override, rewrites `..` in a path, and follows redirects; `new URL('http://[bad', 'http://x')` throws; `server.listen(0)` binds all interfaces; `os.tmpdir()` is not a real path on macOS or Windows runners.

## Tasks & Acceptance

**Execution:**
- [x] `src/viewer/lib/server.mjs` -- exports:
  - `rootIdentity(realRoot)` -> `{rootId, basePort}` (AD-11).
  - `createViewerServer({root, rootId, version, data})` -> an unstarted `http.Server` built with `requireHostHeader: false`; `data` defaults to the `data.mjs` exports and exists so a test can inject a failure. The handler is wrapped so nothing it throws escapes.
  - `probePort(port)` -> `{state: 'free' | 'busy' | 'viewer', health?}` per AD-11.
  - `choosePort({basePort, rootId, version, probe, listen})` -> `{outcome: 'started', port}`, `{outcome: 'reused', port}`, or `{outcome: 'failed', reason}`; `listen(port)` resolves or rejects with an error carrying `code`.
- [x] `src/viewer/view.mjs` -- check Node 24; find the root; `fs.realpathSync.native`; read the version from the workspace manifest (`null` when missing or invalid); run `choosePort` with the real probe and a listen bound to `127.0.0.1`; print the line; on SIGINT and SIGTERM close the server and its connections and exit 0; a top-level catch maps anything else to `internal`, exit 3.
- [x] `src/viewer/lib/server.test.mjs` -- in-process on `listen(0, '127.0.0.1')` over a temp copy of the contract fixture. Requests go through `http.request` with `agent: false`, and a raw `net` socket for the no-`Host` and bad-target rows. Covers every HTTP row; all AD-9 headers on a 200, 403, 404, 405, and 500; no `Access-Control-*` header anywhere; `/api/wiki`, `/api/lint`, and the three pages deep-equal the expected JSON; the walk-branch row with fakes; `rootIdentity` on a known path.
- [x] `src/viewer/view.test.mjs` -- child process with cwd in a temp workspace, for every process row. Base ports come from `rootIdentity(fs.realpathSync.native(dir))`. Foreign listeners are `node:net` servers that close each accepted socket. Every wait for the stdout line has a 10 s deadline. `finally` kills each child, awaits its exit, then removes the folder with retries. The signal exit code is asserted off Windows only.

**Acceptance Criteria:**
- Given the repo's `src/viewer/view.mjs` and a workspace in another directory, when it starts there, then it serves that workspace and the committed bundle.
- Given a stopped viewer, then the workspace holds exactly the files it held before the start.
- Given `npm run test:viewer` on ubuntu, macos, and windows, then all tests pass, with no test left running.

## Implementation Notes

- Server, entry, and both test files were written by four agents from this plan alone. Two mismatches surfaced on the first run: a stop signal could arrive before its handler was registered, and a chunked reply in the raw-socket helper.
- `npm run test:viewer`: 153 tests in about 2.2 s on macOS, twice in a row.
- The viewer was opened in Chrome on a copy of the contract fixture.
- Not verified on this machine: every Windows behavior. The pull-request run is the proof.

## Spec Change Log

- **2026-10-10, plan critique before coding.** A 300 ms HTTP probe would have marked every free port busy on Windows; `fetch` could not test the `Host` rule and could leave loopback; one malformed request target would have killed the process; removing `wiki/` does not make the read model throw. The plan and AD-9, AD-10, AD-11 were amended before any code.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Routes matched a normalized path; `//evil/api/health`, dot segments, backslashes, absolute form got 200 | medium | bad_spec | reproduced by two reviewers; routes now match the raw target; AD-7 and AD-9 amended |
| 2 | Node's own 400 and 431 carry no AD-9 headers | false | reject | AD-9 covers responses the handler writes |
| 3 | A suspended same-root viewer reads as busy, so a second one starts | low | reject | needs a stopped process; a longer wait slows every start |
| 4 | A file named `wiki` is served as a workspace | low | patch | `no_workspace` unless it is a folder |
| 5 | A stop signal during the port search killed the process by signal | medium | patch | handlers registered before the search; the search takes a second on Windows |
| 6 | Node below 14 fails on syntax before the version check | low | reject | the installer needs Node 24; such a Node cannot have installed the workspace |
| 7 | No-workspace test could hang when an ancestor holds `wiki` | low | patch | `access` check and a deadline |
| 8 | Loopback-only bind unverified | high | patch | mutation `listen(port)` survived; test connects on `::1` and a LAN address |
| 9 | `node_version`, `bind_refused`, `internal` never produced by a process test | medium | patch | preload modules force each one |
| 10 | Present-but-invalid manifest untested | low | patch | two cases added |
| 11 | Live reads verified for `/api/wiki` only | medium | patch | a cache on page or lint survived; test rewrites a page and reads again |
| 12 | `realpathSync.native` cannot change a result under the tests | medium | defer | only matters on Windows short names and junctions; needs a Windows-only case |
| 13 | The 1 s connect deadline is not exercised off Windows | low | defer | a silent loopback port cannot be built portably; the Windows CI leg covers it |
| 14 | stdout `EPIPE` handler left an orphan server | medium | patch | reproduced; handler removed, the failure exits as `internal` |
| 15 | Probe read every pre-connect error as free | medium | patch | reproduced under a descriptor limit; only `ECONNREFUSED` or the deadline is free |
| 16 | A 500 left no trace | low | patch | one stderr line per failure |
| 17 | `stale_server` dropped the other viewer's port | low | patch | port returned and named in the message |
| 18 | `rootIdentity` test repeated the formula | low | patch | literals |
| 19 | Mixed `EACCES` rows and three busy branches untested | low | patch | added |
| 20 | Range size written in four places | low | patch | `PORT_RANGE` exported once |
| 21 | Moved-port line could say "in use" for a refused port | low | patch | reworded |
| 22 | Live-read test changed the copy other tests compare | low | patch | own copy and server |
| 23 | A comment narrated how the file was written | low | patch | removed |

## Design Notes

`EPERM` and `EACCES` on a real listen cannot be forced on a CI runner. They are tested through `choosePort` with a fake listen, and `EPERM` was observed for real in the sandbox runs recorded in `delivery.md`.

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass, no test left running
- `node src/viewer/view.mjs` from a scratch workspace, then `curl -s http://127.0.0.1:<port>/api/health` -- expected: `{"app":"lumina-view",...}`
- `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' http://127.0.0.1:<port>/` -- expected: `403`
