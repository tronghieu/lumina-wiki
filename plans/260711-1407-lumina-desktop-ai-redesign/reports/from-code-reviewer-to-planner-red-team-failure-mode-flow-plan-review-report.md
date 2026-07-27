# Red-Team Failure-Mode and Flow Review

The plan is unusually explicit about security and test intent, but six integration gaps remain. The most serious are not missing assertions; they are missing ownership and identity contracts between endpoint validation and dialing, editable workspace state and loaded graph state, and Wails cancellation and terminal-event delivery. Those gaps can pass package-local tests while still failing in the assembled desktop flow.

## 1. Endpoint validation is not bound to the network connection

**Severity:** Critical

**Plan Location:** Phase 02, Architecture and Interface Checklist (`phase-02-streaming-chat-provider-adapters.md:37,49,70-73,116`)

**Flaw:** `EndpointPolicy.Validate` resolves an endpoint before credentials attach, but the plan never requires the validated address set to be pinned into the transport's `DialContext`. A separate `HTTPDoer.Do` can resolve the hostname again. Re-resolving redirects does not close the initial validation-to-connect DNS-rebinding window. The file inventory has endpoint policy, SSE, retry, and adapters, but no transport/dialer component that connects only to a validated IP while preserving the original hostname for TLS/SNI.

**Failure scenario:** A custom OpenAI-compatible hostname resolves to a public address during `Validate`, then to `169.254.169.254` or a private service when `http.Transport` dials. The request passes the guard and sends the credential-bearing request to a forbidden target. Unit tests that inject a resolver into `Validate` still pass because the actual dial is outside that resolver.

**Evidence:** The plan promises validation of every hop before auth attachment (`phase-02-streaming-chat-provider-adapters.md:37`) and DNS-rebinding rejection (`:63`), but its transport abstraction is only `HTTPDoer.Do` (`:30-34`) and its inventory omits a pinned dialer (`:46-55`). The current desktop backend has no reusable HTTP transport or network guard to inherit: all registered services are workspace/graph/tools/importer services (`apps/desktop/main.go:22-27`), and the only existing external-process precedent starts `node` directly with a background timeout (`apps/desktop/internal/tools/service.go:55-67`). This must therefore be designed here, not assumed from existing code.

**Suggested fix:** Add a credentialed transport component to the phase: validate/resolve, choose an allowed IP, dial that exact IP, preserve the original hostname for TLS verification/SNI, disable ambient proxies, and repeat the same bound procedure on every redirect. Add a rebinding test in which validation and the system resolver return different addresses and assert the dial never reaches the second address.

## 2. Editable workspace text can diverge from the graph used for citations

**Severity:** High

**Plan Location:** Phase 07, Requirements and citation checklist (`phase-07-agent-chat-and-settings-integration.md:21,25-27,70-73,81,122`)

**Flaw:** The plan says to keep the current stale workspace/note guards and resolve citations against the current `KnowledgeGraph`, but it does not split the editable workspace-root field from the last successfully loaded workspace identity. In the current flow, editing the root immediately changes `workspaceRoot` and invalidates only summary/request counters; it leaves `graph`, `selectedNodeId`, and note content from the old workspace intact.

**Failure scenario:** Workspace A is loaded. The user types workspace B into the root field without successfully loading it, then submits chat. The request uses B because actions read `workspaceRoot`, while citation navigation resolves against A's still-mounted graph. An overlapping node ID can open the wrong A note; a B-only citation becomes inert. The current request guard cannot repair this because both states are locally “current.”

**Evidence:** The plan explicitly preserves the existing guards (`phase-07-agent-chat-and-settings-integration.md:21`) and requires citation navigation through the current graph (`:81`). In current code, `updateWorkspaceRoot` calls `beginWorkspaceRequest`, sets the root, and clears only the summary (`apps/desktop/frontend/src/App.tsx:202-206`); graph and selection remain in state (`apps/desktop/frontend/src/App.tsx:34-43`). Chat-adjacent actions read the mutable root directly (`apps/desktop/frontend/src/App.tsx:101-110,129-139`), while node selection reads the retained graph (`apps/desktop/frontend/src/App.tsx:214-229`). The root is edited on every input change (`apps/desktop/frontend/src/features/graph/node-inspector.tsx:77-82`).

**Suggested fix:** Introduce separate `workspaceDraftRoot` and immutable `loadedWorkspace { root, workspaceID, graphGeneration }`. Chat, history, retrieval, selected paths, and citations must use only the loaded identity. Editing the draft should not retarget calls; successful `Validate -> Summary -> Load` should atomically replace the loaded workspace and reset/cancel chat, selection, note, and history scope.

## 3. Cancellation can remove the listener before the promised terminal event arrives

**Severity:** High

**Plan Location:** Phase 05 stream lifecycle (`phase-05-chat-orchestration-and-wails-streaming.md:25,36-39,65,72,77`) and Phase 07 bridge lifecycle (`phase-07-agent-chat-and-settings-integration.md:25,38,66-68,78,106`)

**Flaw:** The backend promises exactly one terminal event, while the frontend cancels the generated binding and cleans the listener in `finally`. The plan never defines the ordering between (a) Wails rejecting the cancellable promise, (b) backend context cancellation, (c) emission/dispatch of the `cancelled` terminal event, and (d) frontend listener cleanup. Request ID and sequence filtering do not solve a terminal event that is emitted after unsubscription.

**Failure scenario:** The user presses Cancel. `.cancelOn(signal)` rejects the binding promise immediately, `finally` unregisters the stream listener, and only then does the backend observe `ctx.Done()` and enqueue `cancelled`. The UI remains in `streaming` or converts the promise rejection to a generic failure, history records cancellation backend-side, and the acceptance claim “every stream emits one terminal event” is invisible to the consumer.

**Evidence:** Phase 07 mandates both `.cancelOn(signal)` and cleanup in `finally` (`phase-07-agent-chat-and-settings-integration.md:25`), while Phase 05 makes terminal events part of the event sink contract (`phase-05-chat-orchestration-and-wails-streaming.md:25,65`). Existing generated bindings are cancellable promises, not event-correlated stream objects (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:6,12-25`). Current frontend async guards simply discard late results (`apps/desktop/frontend/src/App.tsx:173-183,229-236`); there is no existing terminal-handshake behavior to preserve.

**Suggested fix:** Specify one authoritative cancellation protocol. For example, abort the provider through a dedicated backend `Cancel(requestID)` call, keep the listener until the matching terminal event is reduced (with a bounded timeout fallback), then cancel/settle the binding and unsubscribe. Alternatively, make binding settlement carry the terminal state and treat events as deltas only. Add an ordering test that schedules promise rejection before terminal dispatch.

## 4. The corpus can produce citations the graph is structurally unable to navigate

**Severity:** High

**Plan Location:** Phase 03 corpus policy (`phase-03-workspace-corpus-and-lexical-retrieval.md:25,32-38`) and Phase 05/07 citation behavior (`phase-05-chat-orchestration-and-wails-streaming.md:27,39`; `phase-07-agent-chat-and-settings-integration.md:26,71,81`)

**Flaw:** Phase 03 includes every regular Markdown file under `wiki/` except a short exclusion list. Phase 07, however, only allows citation navigation through `KnowledgeGraph`. The current graph loader intentionally indexes a fixed set of entity directories, so a valid corpus hit in any other `wiki/<custom-folder>/note.md` has no graph node and cannot satisfy the “valid citations navigate” contract.

**Failure scenario:** A workspace contains `wiki/methods/calibration.md`. Retrieval indexes it, the model cites its backend-assigned evidence ID, and the backend correctly resolves it to `methods/calibration.md`. The frontend looks for that path in `KnowledgeGraph`, finds nothing, and renders a valid citation inert—the same behavior promised only for unknown citations.

**Evidence:** The corpus include rule is broad (`phase-03-workspace-corpus-and-lexical-retrieval.md:25`), while the frontend plan resolves only against graph nodes (`phase-07-agent-chat-and-settings-integration.md:81`). Current graph traversal visits only the hard-coded entity directories (`apps/desktop/internal/graph/service.go:103-139`), and note reads reject a path whose first directory is not on that same list (`apps/desktop/internal/graph/service.go:42-54,86-100`). Current frontend navigation likewise selects by graph node ID (`apps/desktop/frontend/src/features/graph/graph-data.ts:95-112`).

**Suggested fix:** Preserve the broad corpus policy, but define citation navigation independently of graph membership: return an allowlisted citation DTO tied to the loaded workspace/snapshot and add a backend read-by-citation operation that revalidates the chunk/path hash. Graph-node citations may still select nodes; valid non-graph citations should open a safe note artifact rather than becoming inert.

## 5. Session-only secret fallback has no confirmation-bearing contract

**Severity:** High

**Plan Location:** Phase 01 fixed state and facade (`phase-01-local-settings-secrets-and-history-foundation.md:25-27,72-75,104`) and Phase 07 settings integration (`phase-07-agent-chat-and-settings-integration.md:27,38,69,80,109`)

**Flaw:** The plan requires explicit confirmation before using session-only secret storage when the OS keyring is locked, denied, missing, or unsupported, but no facade method, request field, or state transition carries that confirmation. The listed Wails facade exposes status and write/delete only. Phase 07 mentions disclosure consent for embeddings, not consent to downgrade credential durability.

**Failure scenario:** Saving a credential on Linux without Secret Service returns `unsupported`. On retry, the backend must either silently place the credential in session memory (violating explicit confirmation), reject forever (making the promised fallback unusable), or infer confirmation from a repeated Save (ambiguous and unsafe). A UI test can verify a warning label while the backend still has no enforceable proof of the user's choice.

**Evidence:** The explicit-confirmation requirement is stated in Phase 01 (`phase-01-local-settings-secrets-and-history-foundation.md:27`), but the interface checklist exposes only `Put/Get/Delete/Status` and a status/write/delete facade (`:72-74`). The existing settings UI has only provider and model state (`apps/desktop/frontend/src/app/ai-settings-panel.tsx:3-11,53-58,69-88`), so there is no current confirmation contract to reuse. Current Wails services expose plain positional calls without an established confirmation-token pattern (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`).

**Suggested fix:** Add an explicit two-step backend contract: `SaveCredential` returns a typed `session_confirmation_required` challenge bound to profile/status/nonce; `ConfirmSessionCredential` accepts that nonce plus the secret and stores it only in memory. Expire challenges, clear the component secret in all outcomes, and test locked-to-confirm-to-session plus status changes/restart loss.

## 6. The quantitative visual gate has no executable harness in scope

**Severity:** High

**Plan Location:** Phase 08 architecture, inventory, and gates (`phase-08-visual-accessibility-packaging-and-release-gates.md:25-28,37,41-59,77,89-103,107-116`)

**Flaw:** Phase 08 requires pinned-renderer pixel diffs, structural browser measurements, focus behavior, and packaged interaction smoke, but it conditionally adds a browser harness only “if already-approved tooling is available.” No browser dependency, runner script, harness file, capture/diff command, or CI workflow modification is included in the file inventory. Source-level Node tests cannot execute layout, focus trapping, font readiness, screenshots, or Wails window interactions.

**Failure scenario:** Implementation creates the two PNGs and JSON metadata, then `npm run test` merely scans source strings and `npm run build` compiles. The reported 2% pixel threshold and keyboard/focus claims have no command that can fail, so Phase 08 can be marked green without ever rendering the application. Packaged smoke is likewise a manual assertion with no launch/drive mechanism or result artifact.

**Evidence:** The plan itself makes the harness conditional (`phase-08-visual-accessibility-packaging-and-release-gates.md:37`) while making pixel and interaction results mandatory (`:25-28,66-73`). The current frontend scripts provide only Vite, TypeScript, and Node's source-level test runner (`apps/desktop/frontend/package.json:6-11`); dependencies contain React/Wails/Vite but no browser automation or image-diff library (`apps/desktop/frontend/package.json:13-24`). Existing layout tests read component/CSS files as strings (`apps/desktop/frontend/src/app/app-shell-layout.test.mjs:1-8`) and assert regexes (`:10-41`), confirming they cannot measure rendered geometry or focus behavior.

**Suggested fix:** Make the harness unconditional and name it in scope: choose/pin the approved browser automation and image-diff mechanism, add exact scripts, fixtures, reference provenance, font-ready waits, Wails launch strategy, and CI jobs/artifacts. If adding a dependency is disallowed, define an external pinned tool/container and its command instead; do not treat source regex tests as the visual/accessibility gate.

## Unresolved Questions

- What is the authoritative loaded-workspace identity exposed to the frontend, distinct from editable path text?
- Which Wails v3 primitive will identify and target the originating window/client, and what ordering does it guarantee relative to call cancellation?
- Which pinned browser/image-diff harness is approved for Phase 08, and where will its reference artifacts originate?
