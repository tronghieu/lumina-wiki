# Review: technical verification of the wiki-view spine

- Reviewed: `ARCHITECTURE-SPINE.md` and `.memlog.md` in the parent folder.
- Date: 2026-10-10.
- Question: was every committed technical decision checked against reality?
- Machine: macOS (darwin arm64), Node v24.18.0, git 2.54.0, HeadlessChrome 152 through `agent-browser`.
- Scratch: `/private/tmp/claude-501/-Users-luutronghieu-Projects-lumina-wiki/035139b7-c604-46f2-8aa4-a7cbf0981e78/scratchpad/review-tech/`. Nothing ran inside the repo. The repo tree is unchanged.

## Verdict

The Stack table and most platform claims hold. Two decisions fail against reality: the bundle cannot import `WIKILINK_RE` from `lint.mjs`, and `force-graph` has its own `innerHTML` sink that AD-14 does not cover. Four more decisions are wrong on one operating system or leave a gap.

Status words: **verified** means I observed it. **refuted** means I observed the opposite. **could-not-verify** means I had no way to observe it here; the source I relied on is named.

## Findings

### F1. High. AD-3, AD-14, AD-16. The client bundle cannot import `WIKILINK_RE` from `lint.mjs`. Refuted.

- AD-3 exports `WIKILINK_RE` from its home module, `lint.mjs`. AD-14 builds the wikilink rule on it inside `ui/lib/render.mjs`, which is bundled.
- `lint.mjs` imports `node:fs/promises`, `node:fs`, `node:path` (lines 47 to 49) and runs a `process.argv[1]` guard at line 3523.
- Observed: esbuild 0.28.2 with the exact AD-16 options, entry importing the real `src/scripts/lint.mjs`. Result: `BUILD FAILED`, six `Could not resolve "node:..."` errors.
- Observed: with `external: ["node:*"]` the build passes, but the output holds a `require` shim that throws in a browser and keeps the `process.argv` guard.
- `node --test` imports `lint.mjs` without error. `test:viewer` will pass while the build fails.
- Fix: move `WIKILINK_RE` into `schemas.mjs`, which has no imports. `lint.mjs` imports it from there. Reword AD-3 and the Structural Seed line "lint.mjs gains one export". Add a rule: `ui/lib/` may import from the engine only `schemas.mjs`.

### F2. Medium. AD-14, AD-15. `force-graph` writes labels with `innerHTML`. Refuted.

- AD-14 says no other component sets inner HTML.
- Source, `float-tooltip` 1.7.5: `state.tooltipEl.html(state.content)` for any string label.
- Observed in the browser under the AD-9 policy: a node label of `<b id="inj">bold</b><img src=x onerror=...>` put both elements in the DOM. The policy blocked the handler (`script-src-attr` violation). The markup injection still happened.
- The project-mode viewer already knows this: `src/project/view/viewer.js` lines 132 to 139 escape every label.
- Fix: add to AD-14: every string given to `nodeLabel` or `linkLabel` is HTML-escaped by one shared function. Add a hostile-title case to the AD-20 list.

### F3. Medium. AD-10, AD-20. SIGINT and SIGTERM do not behave as written on Windows. Could-not-verify by observation; verified in Node 24 docs.

- Node 24 `process.md`: "Sending `SIGINT`, `SIGTERM`, and `SIGKILL` will cause the unconditional termination of the target process". Also: "`'SIGTERM'` is not supported on Windows".
- Only Ctrl+C in a console reaches a `SIGINT` listener on Windows.
- A host that kills its background task on Windows ends the process with no handler and no exit 0. A test that calls `child.kill()` and asserts exit 0 fails on `windows-latest`.
- Observed on macOS: SIGINT gives exit 0 and the port is released.
- Fix: AD-10 states exit 0 for Ctrl+C on every system, and for a programmatic signal on Linux and macOS only. On Windows the contract is "port released, no file left". AD-20 asserts exit code off Windows only.

### F4. Medium. AD-10, AD-11. The port scan misreads two cases.

- **macOS wildcard listener. Refuted.** Observed across two processes: one listens on `0.0.0.0:28461`, a second `listen(28461, "127.0.0.1")` succeeds. No `EADDRINUSE`. The second process then answers all `127.0.0.1` traffic. Same result with `::`. AD-11 would take a port another server holds.
- Fix: listen only when the health probe gets `ECONNREFUSED`. Any accepted connection that is not this viewer means "next port".
- **Windows `EACCES`. Could-not-verify by observation; verified in Microsoft docs.** `WSAEACCES` (10013) is returned by `bind` when "another application, service, or kernel mode driver is bound to the same address with exclusive access". AD-10 maps `EACCES` to exit 2 with a sandbox message. On Windows that message is wrong and the scan stops early.
- Observed on macOS: `EACCES` appears only for a privileged port (port 80). It cannot occur in 28000 to 28999 on Unix.
- Fix: inside the scan, treat `EACCES` like `EADDRINUSE`. Exit 2 only when every port in the window fails with `EPERM` or `EACCES`.
- **Verified:** a second `listen` on the same `127.0.0.1` port gives `EADDRINUSE`. A bind under macOS seatbelt with `network-bind` denied gives `EPERM` (syscall `listen`). A probe of a closed port fails in 1 ms. A probe of a silent listener times out at 303 ms.

### F5. Low. AD-14. Disabling the `image` rule produces a link, not hidden text. Verified, with a side effect the spine does not mention.

- Observed: `![alt](https://e/p.png)` renders `!<a href="https://e/p.png">alt</a>`.
- Observed: `![](url)` renders `!` plus an empty, invisible link.
- Observed: `[![alt](img)](page)` loses the outer link and prints `[!<a href="img">alt</a>](page)`.
- No `<img>` is emitted in any case. The "no outbound image request" goal holds.
- Fix: keep the rule enabled and override `md.renderer.rules.image` to emit an escaped text placeholder. Linked images then stay intact.

### F6. Low. AD-14. `validateLink` is a four-scheme blocklist. Verified, narrower than "and similar".

- Source, 15.0.2: `BAD_PROTO_RE = /^(vbscript|javascript|file|data):/`, with `data:image/(gif|png|jpeg|webp)` allowed.
- Observed rejected: `javascript:`, mixed case, entity-encoded, autolink form, reference form, `vbscript:`, `file:`, `data:text/html`, `data:image/svg+xml`.
- Observed accepted as live links: `ms-msdt:`, `search-ms:`, `vscode://`, `smb://`, `blob:`.
- Fix: override `md.validateLink` with an allowlist: `http:`, `https:`, `mailto:`, and relative targets.

### F7. Low. AD-17. Three gaps in the release guard.

- **Untracked bundle passes. Refuted.** Observed: with `viewer.js` present but not in git, `git diff --exit-code -- <path>` exits 0. Fix: add `git ls-files --error-unmatch <path>`.
- **Pins. Refuted as worded.** Observed: the bundle holds 40 packages. Four are exact `devDependencies`. The other 36 come from ranges such as `d3-drag: "2 - 3"` and are fixed only by `package-lock.json`. Fix: name the lockfile and `npm ci` as the pin. The notices file needs 40 entries.
- **Line order. Verified with a condition.** The attribute line works only when it comes after `* text=auto eol=lf`. Placed before it, `text` resolves to `auto`.
- **Verified:** `-text -diff linguist-generated` is valid. `git check-attr` reports `text: unset`, `diff: unset`, `linguist-generated: set`. A changed file marked `-diff` still gives exit 1 ("Binary files differ"). A deleted file and a CRLF rewrite also give exit 1.

### F8. Low. Stack. Two facts the table omits.

- `force-graph` 1.51.5 was published 2026-09-27. The spine names only 1.52.0. Diff of the ESM build: 1.51.5 drops the Babel helpers and ships modern syntax; 1.52.0 adds `linkSelfCurveRotation`. Neither changes style injection.
- Node 24 enters maintenance on 2026-10-20. Node 26 becomes LTS on 2026-10-28. CI tests Node 24 only, so ">= 24" is unproven on 26.

### F9. Low. AD-9. The `'unsafe-inline'` assumption is verified. The Deferred item is not reachable as written.

- Observed with the AD-9 policy: no style or script violation from React 19, `force-graph`, or `markdown-it`.
- Observed without `'unsafe-inline'`: four `style-src-elem` violations. The tooltip falls to `position: static` and the canvas to `display: inline`. The graph still draws.
- Observed with two `sha256` hashes in place of `'unsafe-inline'`: both sheets apply, yet two violations are still logged.
- Both `force-graph` and `float-tooltip` call `styleInject` at module load. React `style` props use the CSSOM and are never blocked.
- Fix: remove the `[ASSUMPTION]` tag. Reword the Deferred item: dropping `'unsafe-inline'` needs the two sheets copied into `viewer.css` and accepted console noise, or hashes.
- Add to AD-9: explicit `Content-Type` per asset with `charset=utf-8`. `nosniff` blocks a script or stylesheet with a wrong type. The bundle holds one raw non-ASCII character (U+2026).

### F10. Low. AD-14. Three renderer edge cases, all observed.

- An aliased wikilink in a table cell is split at the pipe before any inline rule runs: `| [[sources/lora|LoRA]] |` yields two cells. Escaped as `\|` it survives.
- `[[foo]]` with a reference definition `[foo]: url` becomes a link through the built-in `link` rule. The wikilink rule must be registered before `link`.
- Stripping HTML comments before rendering also strips them inside code fences. A rule that swallows comments at parse time avoids that.

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| `react` 19.3.0 exists, is `latest` | verified | `npm view`; published 2026-09-09; MIT |
| `react-dom` 19.3.0 exists, is `latest` | verified | `npm view`; depends on `scheduler ^0.28.0` |
| `force-graph` 1.51.4 exists, behind on purpose | verified | Published 2026-04-16; `latest` 1.52.0; vendored file hash equals npm 1.51.4 `min.js` |
| `force-graph` maintained | verified | Two releases in the last 14 days |
| `markdown-it` 15.0.2 exists, is `latest`, maintained | verified | Published 2026-09-11 with a security fix; MIT |
| `esbuild` 0.28.2 exists, is `latest` | verified | Published 2026-08-08; has a `postinstall` of its own, dev-only |
| Node.js 24 supported | verified | Release schedule: LTS until 2026-10-20, end of life 2028-04-30 |
| `html: false`, `linkify: false` by default | verified | `new MarkdownIt().options` printed |
| Tables enabled by default | verified | Rule list shows `table:true`; a table rendered |
| `image` rule can be disabled by name | verified | `disable('image')` flips it; an unknown name throws |
| Disabled `image` leaves text | refuted | It produces a link. See F5 |
| `validateLink` rejects `javascript:` | verified | See F6 for the limit |
| HTML comments print as text with `html: false` | verified | Rendered as `&lt;!-- ... --&gt;` |
| AD-16 option names and values | verified | Present in `lib/main.d.ts` 0.28.2; build ran with 0 errors, 0 warnings |
| `metafile` lists bundled inputs | verified | 1,050 inputs, 40 packages derived |
| React 19, `jsx: "automatic"`, IIFE, no extra config | verified | 504 KB bundle ran in the browser |
| Same bytes on a second build | verified | Same sha256 twice, same machine |
| Same bytes across operating systems | could-not-verify | One machine only |
| `force-graph` imports as ESM and bundles | verified | `dist/force-graph.mjs`, bundled and rendered |
| `force-graph` injects `<style>` | verified | Two elements; see F9 |
| CSP directives valid | verified | Browser accepted the header; each directive enforced as expected |
| `script-src 'self'` allows the bundle | verified | Bundle executed from `/assets/viewer.js` |
| No `eval`, `blob:`, worker, inline script needed | verified | No such violation; `Function("return this")` from `lodash-es` is present but short-circuited |
| `listen` on `127.0.0.1` | verified | Address family IPv4, loopback only |
| `EADDRINUSE` | verified | Same address; refuted for a wildcard holder on macOS, F4 |
| `EPERM` under a sandbox | verified | macOS seatbelt only; Linux and Windows sandboxes could-not-verify |
| `EACCES` means sandbox | refuted | F4 |
| SIGINT, SIGTERM exit 0 | verified on macOS | Windows per F3 |
| Range below Linux ephemeral ports | verified | Kernel doc: default 32768 to 60999 |
| Range below macOS ephemeral ports | verified | `sysctl`: 49152 to 65535 |
| Range below Windows dynamic ports | could-not-verify by observation | Microsoft support article: 49152 to 65535 |
| Windows excluded port ranges avoid 28000 to 28999 | could-not-verify | No source fetched; treat as possible |
| Registered services in range | verified | IANA: seven TCP ports (28000, 28001, 28010, 28080, 28200, 28240, 28589). Community list adds games and Palo Alto ports. The scan covers a collision |
| `.gitattributes` syntax | verified | F7 |
| `git diff --exit-code` sees a `-diff` file | verified | Exit 1 |

## Not checked

- Any behavior on Linux or Windows hosts.
- Firefox and Safari handling of the policy.
- Bundle byte equality across operating systems. AD-17 already plans CI for it.
