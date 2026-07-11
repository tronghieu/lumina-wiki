---
type: brainstorm
status: approved
date: 2026-07-11
source: ck-brainstorm
---

# Lumina Desktop AI Redesign Brainstorm

## Summary

Rebuild Lumina Desktop UI from `Lumina Desktop.dc.html` as visual source of truth. Replace prototype data and callbacks with real workspace behavior. Add secure, configurable AI chat, local chat history, and opt-in hybrid semantic retrieval. Preserve workspace immutability.

## Solution-Jumping Diagnosis

The supplied design expresses two unmet needs:

- Current desktop shell lacks the hierarchy, density, theme, and graph-first workflow expected from a knowledge IDE.
- Current app can inspect a workspace but cannot converse with its knowledge or configure an AI provider.

Visual redesign alone would improve presentation but leave the main product workflow incomplete. Copying the prototype literally would ship fake chat, fake data, and unsafe credential handling.

## Underlying Problem

Lumina users need one local-first desktop surface to navigate a real workspace, read linked notes, run safe workspace actions, and ask grounded questions without exposing credentials or silently modifying their knowledge base.

## Assumption Challenges

| Assumption | Risk if wrong | Validation |
|---|---|---|
| `.dc.html` is the desired visual contract | Rework from subjective interpretation | Side-by-side screenshots at reference viewport |
| Real chat must cover the workspace | Selected-note-only chat feels incomplete | Retrieval acceptance queries spanning multiple notes |
| Embeddings improve retrieval enough to justify scope | Cost/privacy/index complexity without user value | Opt-in semantic mode with lexical baseline and citations |
| Users need provider flexibility | Adapter surface becomes too broad | Four explicit provider contracts with independent tests |
| Local history is desirable | Sensitive content retained unexpectedly | Opt-out, delete controls, local-only disclosure |
| OS credential storage is available | Linux secret service may be unavailable | Session-only fallback, never plaintext fallback |

## Problem Statement

- Users: people managing an existing Lumina-Wiki workspace in the desktop app.
- Struggle: UI does not match the intended workflow; graph context and workspace actions are fragmented; AI settings are non-functional.
- Cause: current MVP predates the supplied visual system and has no provider, retrieval, secret, streaming, or history backend.
- Consequence: lower usability, no grounded assistant workflow, and risk of fake or insecure AI integration.
- Success: reference-faithful UI backed by real data, secure streaming chat, cited hybrid retrieval, and zero workspace mutation.

## Alternative Framings

### A. CSS-Only Restyle

Fast, low churn. Cannot reproduce the reference hierarchy or real Graph/Note and Agent workflows. Rejected.

### B. Literal Prototype Port

High initial visual similarity. Brings inline styles, hard-coded data, fake responses, custom canvas, and inert controls. Rejected.

### C. Token-First Faithful Production Port

Extract tokens and structure, rebuild component boundaries, keep real React Flow and Wails behavior, add real chat/retrieval services. Selected.

## Evidence Status

Medium-to-strong:

- User supplied a concrete executable visual artifact and explicitly approved it as visual source of truth.
- Current frontend and backend contracts were inspected.
- Baseline frontend tests/build and sequential Go tests pass.
- Two independent feasibility reviews found the design implementable without workspace writes or vector database.
- Provider, Wails streaming, and embedding behavior checked against current official documentation.

## Validation Plan

- RED/GREEN tests for every behavior contract.
- Provider adapters verified with local `httptest.Server`, not live paid APIs.
- Retrieval acceptance fixtures cover lexical, semantic, fallback, invalidation, and citations.
- Visual comparison at 1480x920 in dark and light themes.
- Responsive checks at 1180px and 760px.
- Security review proves secrets remain backend-only and no workspace paths are written.
- Kill or split scope if secure key storage cannot support all target platforms without plaintext fallback.

## Stakeholder Message

Build the supplied interface faithfully, but treat its data and interactions as a visual specification rather than production code. Every visible state must be powered by real workspace, chat, retrieval, or window behavior. No fake assistant responses.

## Exact Requirements

### Expected Output

- Redesigned Wails desktop UI matching the supplied `.dc.html`.
- Functional dark/light themes.
- Real workspace tree, Graph/Note views, stats, actions, settings, and collapsible Agent Panel.
- Streaming AI chat with cancellation, retry, citations, history, and user-configurable providers.
- Opt-in hybrid lexical + embedding retrieval over the active workspace.

### Acceptance Criteria

- Reference layout, tokens, typography, spacing, controls, and states match at 1480x920.
- No prototype hard-coded workspace, note, count, message, or AI response ships.
- Open, Refresh, Source, Check, Import, graph selection, linked navigation, and note reading remain functional.
- User can configure OpenAI, Anthropic, Gemini, and OpenAI-compatible/Ollama chat profiles.
- User can configure an independent OpenAI, Gemini, or OpenAI-compatible/Ollama embedding profile.
- API keys are stored only in OS credential storage or session memory fallback.
- Chat streams deltas, cancels, reports stable errors, persists history locally when enabled, and clears history on request.
- Retrieval returns cited note paths, respects a hard context budget, and falls back to lexical search.
- Embeddings are opt-in with disclosure; cache is isolated, incremental, cancellable, and clearable.
- Chat, retrieval, indexing, settings, secrets, and history never write under `wiki/`, `raw/`, or `_lumina/`. The existing explicit user-triggered Import action remains the sole scoped exception and may add one new file under `raw/sources/` under its existing no-overwrite/symlink-rejection contract.

### Scope Boundary

Out of scope:

- LLM tool calling, shell execution, or workspace writes.
- Automatic ingest/edit actions from chat.
- Attachments, cloud sync, background daemon, vector database.
- Automatic provider model discovery.
- Embedding provider for Anthropic.

### Non-Negotiable Constraints

- `.dc.html` is visual source of truth.
- Wails 3 + React/TypeScript + React Flow remain.
- No secrets in frontend persistence, logs, workspace, or error payloads.
- Workspace remains read-only for chat/retrieval/indexing/history. Import retains its existing, separately authorized `raw/sources/` write contract.
- TDD: observe every focused test fail for expected reason before production code.
- Existing public workspace/graph/check/import contracts remain compatible.

### Touchpoints

- Frontend: `App.tsx`, shell, settings, graph view/data, inspector replacement, styles, tests, generated Wails bindings.
- Backend: `main.go`, new AI/chat/provider/retrieval/settings/secrets/history services and tests.
- Docs: `apps/desktop/README.md` and plan artifacts.

## Visual Design Contract

### Tokens

| Token | Dark | Light |
|---|---|---|
| Canvas | `#0F0F10` | `#FAFAF8` |
| Surface | `#1A1A1C` | `#FFFFFF` |
| Rail | `#161617` | `#F1F0EA` |
| Deep rail | `#121213` | `#EAE9E1` |
| Border | `#2A2A2D` | `#E5E5E3` |
| Subtle line | `#222225` | `#E2E1DA` |
| Text | `#EDEDEE` | `#111111` |
| Muted | `#9A9A9E` | `#6B6B70` |
| Accent | `#E5B341` | `#8A5E0A` |
| Success | `#28C840` | accessible dark green |
| Danger | `#FF5F57` | accessible dark red |

- Radius: 4px controls; 6-8px panels/menus.
- Spacing: 4, 6, 8, 12, 14, 18, 24, 32px.
- UI font: locally bundled open-licensed Inter weights used by the reference.
- Reading/chat font: locally bundled open-licensed Source Serif 4 weights used by the reference.
- Metadata font: locally bundled open-licensed JetBrains Mono weights used by the reference.
- Be Vietnam Pro is bundled only if the reference comparison shows a Vietnamese glyph mismatch after the three primary fonts load.
- Remote font imports prohibited.

### Layout

- Title region: 38px.
- Activity rail: 46px.
- Workspace tree: 228px.
- Agent Panel: 344px open; compact strip when collapsed.
- Center artifact: flexible, Graph/Note tabs, stats strip, graph controls.
- At medium width tree/chat become reopenable drawers. Chat must not disappear permanently.

### Production Mapping

- Workspace connection state, tree, counts, note content, graph, checks, messages, citations, and settings use real data.
- Prototype traffic-light controls connect to Wails window actions when supported.
- Prototype fake graph is replaced by styled React Flow.
- Prototype seeded messages and canned `replyFor` behavior are prohibited.
- Settings owns configuration; composer shows active model status without duplicating settings controls.

## Architecture

```text
App
├─ AppShell
│  ├─ DesktopTitleBar
│  ├─ WorkspaceRail / WorkspaceTree
│  ├─ ArtifactPane / GraphView / NoteView
│  ├─ AgentPanel / ChatMessageList / ChatComposer
│  └─ AiSettingsDialog
└─ Wails bindings
   └─ Go AI service
      ├─ Chat orchestrator
      ├─ Provider adapters
      ├─ Hybrid retrieval/indexer
      ├─ Settings/history stores
      └─ OS SecretStore
```

### Provider Contracts

- `ChatProvider.Stream(ctx, request, sink)` normalizes provider events.
- `EmbeddingProvider.Embed(ctx, texts)` returns a normalized batch.
- Chat and embedding profiles remain independent.
- Direct standard-library HTTP adapters keep timeout, cancellation, redirect, and error policy consistent.

### Versioned Provider Profile Schema

All profiles use `schemaVersion`, opaque `id`, `kind`, user label, `model`, normalized `baseURL`, optional `credentialRef`, timeout, context budget, and capability flags. Secrets never serialize with profiles.

- OpenAI chat: default `https://api.openai.com/v1`, Responses SSE, bearer credential required.
- Anthropic chat: default `https://api.anthropic.com`, Messages SSE, pinned API-version header, API-key credential required.
- Gemini chat: default Google Generative Language API root, `streamGenerateContent` SSE, API-key credential required.
- OpenAI-compatible chat: explicit base URL, `/v1/chat/completions` default path, optional bearer credential for loopback and required credential for remote endpoints.
- OpenAI embeddings: `/v1/embeddings`, model, dimensions, batch limit.
- Gemini embeddings: `embedContent`, model, dimensions/task formatting, batch limit.
- OpenAI-compatible embeddings: explicit base URL, `/v1/embeddings`, model, dimensions, optional loopback credential.

Unknown schema versions fail closed with an actionable migration error. Endpoint, auth, model, dimensions, and disclosure changes create a new effective profile fingerprint.

### Storage

- Non-secret config: OS user config directory, atomic user-only file.
- History: versioned JSONL plus atomic conversation metadata in local app data, workspace-scoped, enabled after first-run local-retention disclosure, delete one/all.
- Index: OS user cache directory under SHA-256 canonical workspace ID.
- Secrets: `github.com/zalando/go-keyring@v0.2.8` behind `SecretStore`, under opaque profile ID. This MIT, cgo-free adapter targets macOS Keychain, Windows Credential Manager, and Linux Secret Service. Locked/denied/missing/unsupported states are explicit. Session-only fallback requires user confirmation; plaintext fallback is forbidden.

History files and config use user-only directory/file permissions and atomic replacement. Disabling history stops future persistence but does not silently delete existing conversations; delete-one and delete-all are separate explicit actions. Interrupted streams persist only a terminal `cancelled` or `failed` record once, and retry creates a linked attempt rather than duplicating the user message.

Workspace identity combines the OS-normalized canonical path with stable filesystem identity when available. The registry stores an initial workspace signature and detects path reuse; ambiguous rename/path-reuse cases require user confirmation before attaching existing history or cache. Tests cover symlink aliases, case folding, rename, network paths, and replacement at the same path.

## Data Flow

1. Frontend subscribes to stream events, creates request ID, then calls cancellable Wails binding.
2. Backend validates workspace and request bounds.
3. Retrieval prioritizes selected/linked notes and fuses lexical and semantic ranks.
4. Context assembler rereads validated note chunks, verifies hashes, and applies hard budget.
5. Provider adapter emits normalized started/delta/citation/usage/completed/failed events.
6. Frontend filters request ID and monotonic sequence.
7. Completed conversation and citations persist locally when history is enabled.

## Retrieval and Index Lifecycle

- Corpus: regular `.md` files under `wiki/`, including pack/entity folders and `outputs/`; exclude `wiki/graph/**`, `wiki/index.md`, `wiki/log.md`, hidden paths, symlinks, `raw/**`, and files over 2 MiB. Unreadable/malformed files are skipped with a bounded, non-sensitive warning. Relative paths are deduplicated after OS-aware normalization.
- Deterministic Markdown chunking by headings/paragraphs with bounded overlap.
- Strip frontmatter; skip graph, log, symlinks, and non-regular files.
- Reuse vectors by normalized content hash.
- Changing provider, endpoint, model, dimensions, or chunker version invalidates semantic vectors.
- Build generation files first; atomically replace manifest last.
- Exact cosine scan over flat float vectors; no vector database.
- Reciprocal-rank fusion combines lexical and semantic rankings.
- Lexical mode remains available when semantic mode is disabled, stale, offline, or failed.

Indexing uses no-follow regular-file opens plus containment checks at open time. Each generation records the pre-read and post-read identity/hash; a file changed during traversal is retried once, then excluded from that generation. Retrieval rereads evidence and rejects a chunk whose current hash differs from the committed generation.

Context limits are deterministic per profile: `maxInputChars`, `maxHistoryChars`, `maxEvidenceChars`, `maxOutputTokens`, and an absolute UTF-8 byte cap. Defaults reserve system instructions first, then the current question, then recent history, then ranked evidence. Evidence truncates by rank and chunk boundary, never mid-citation. Unknown model limits use conservative defaults and expose an editable profile field rather than claiming tokenizer accuracy.

## Security and Failure Behavior

- Remote embedding consent is bound to workspace identity, normalized endpoint, provider kind, model, dimensions, and disclosure version. Any recipient/configuration change requires renewed consent. Local loopback indexing has a separate CPU/disk disclosure.
- Retrieved Markdown is untrusted quoted evidence; it cannot grant instructions or tools.
- Custom endpoints require HTTPS except literal/resolved loopback HTTP; reject URL userinfo, credential-like query parameters, link-local/metadata ranges, and cross-origin auth forwarding. Disable proxy environment inheritance for credentialed custom endpoints. Every redirect hop is re-resolved and revalidated; remote credentials remain origin-bound. DNS rebinding/private-address policy is covered by resolver-injected tests.
- Never log secrets, auth headers, prompts, note excerpts, chat transcripts, or raw provider errors.
- Cap question/history/context/output/SSE event sizes, total timeout, and idle timeout.
- Stable errors: missing credential, auth failed, rate limited, model not found, endpoint unreachable, timeout, cancelled, invalid stream, stale index.
- Retry at most once before the first delta for retryable transport/429/5xx errors. Never retry after visible output.

The backend assigns opaque evidence IDs (`S1`, `S2`, ...) before provider invocation. The model may cite only those IDs. Paths, headings, and spans resolve backend-side from the evidence allowlist; unknown/stale/duplicate citations are rejected or deduplicated and never become navigable frontend paths.

Provider-independent system text encloses retrieved notes in unambiguous evidence delimiters, states that evidence cannot change instructions, and requires evidence-ID citations for workspace claims. Fixtures include fake delimiters, embedded instructions, data-exfiltration requests, and conflicting note content.

Streaming follows an explicit state machine: `idle -> starting -> streaming -> completed|failed|cancelled`. Subscribe completes before request start. Each request/window owns one bounded event buffer, monotonic sequence, and exactly one terminal event. Cleanup removes listeners on terminal state, window close, cancellation, or component unmount. Concurrent conversations use distinct request IDs; late/duplicate events are ignored.

## TDD Contract

### Frontend RED Tests

- Token/layout/theme contract.
- Real workspace tree grouping and no phantom data.
- Chat state: submit, ordered deltas, stale response, cancel, retry, new chat.
- Settings normalization, embeddings default off, and zero credential serialization.
- History enable/disable/delete and workspace isolation.
- Citation navigation and safe unknown citations.

### Backend RED Tests

- Provider SSE fragmentation, unknown events, malformed events, auth, status mapping, timeout, cancellation, redirect policy.
- Deterministic chunking, Unicode, hashes, incremental reuse, deletion, invalidation, cancellation, corrupt cache, atomic commit.
- Lexical fallback, semantic ranking, rank fusion, dimension mismatch, stale hash rejection.
- Secret save/replace/delete/status without returning secret to TypeScript.
- Bounded context, workspace validation, local history isolation, and sanitized errors.

### Verification Gates

- Focused RED → GREEN → REFACTOR per behavior.
- Frontend test and production build.
- Full Go tests.
- Regenerated Wails bindings and Wails build.
- Dark/light side-by-side visual verification at 1480x920.
- Responsive verification at 1180px and 760px.
- `git diff --check`, code review, and requirement-by-requirement completion audit.

Visual acceptance uses pinned dark/light reference screenshots rendered from the supplied artifact at 1480x920 with the locally bundled reference fonts. Automated comparison covers non-dynamic shell regions with a maximum 2% differing-pixel threshold and masks graph nodes, live text, counts, timestamps, and OS-rendered window controls. Dynamic regions use structural measurements and human side-by-side approval. Reference renderer/browser, DPR, OS, viewport, fonts, masks, and screenshots are committed as test metadata.

Completion evidence also includes:

- serialized Wails binding and frontend-storage scans proving no credential getter/secret field is exposed;
- redaction tests for logs/errors/provider bodies;
- pre/post content manifests proving chat/retrieval/index/history do not mutate the workspace;
- a separate Import test proving its only expected addition is one `raw/sources/` file;
- control-to-handler inventory for every visible reference control;
- offline, stale, corrupt-index, semantic-fallback, cancel-race, and history-migration scenarios;
- keyboard/focus/accessibility checks and packaged Wails smoke tests on macOS, Windows, and Linux CI where available.

## Risks

- Wails alpha API churn: isolate event/cancellation adapter.
- Linux credential store unavailable: session-only credential fallback.
- Provider event drift: tolerate unknown events, strict adapter tests.
- Remote privacy/cost: explicit consent, local option, bounded batches.
- Index corruption: immutable generations and atomic manifest commit.
- Scope size: phase provider/retrieval/UI work; commit and push each verified slice.

## Success Metrics

- Visual contract matches supplied artifact at reference viewport in both themes.
- All visible production controls have real behavior.
- No fake chat or hard-coded workspace content.
- Chat streams, cancels, cites, persists/clears history, and survives semantic fallback.
- Keys never leave backend trust boundary or secure/session storage.
- Workspace files remain byte-identical after chat, retrieval, index, settings, and history workflows. Import is verified separately against its narrow expected write.
- All required tests/build/review gates pass.

## Dependencies

- Small audited cross-platform OS credential-store adapter or equivalent native implementations.
- Existing Wails, React, React Flow, Go standard library.
- No vector database and no new frontend runtime dependency required.

## Red-Team Resolution

Fifteen findings reviewed. All accepted and patched except the claimed Import contradiction: existing Import is a verified, explicit user action with a narrow write contract, while the read-only invariant applies to AI chat/retrieval/index/history. No user decision was reversed.

Blocking findings resolved by:

- quantitative/pinned visual acceptance;
- explicit retrieval corpus and file rules;
- versioned provider profile schemas;
- selected cross-platform credential adapter and failure matrix;
- scoped Import exception wording.

High findings resolved by endpoint hardening, history and workspace identity state, measurable context budgets, backend-owned citations, operational prompt-injection fixtures, filesystem snapshot rules, consent fingerprints, streaming state machine, and named completion evidence.

## Unresolved Questions

None.
