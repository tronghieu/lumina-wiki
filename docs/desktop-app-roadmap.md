# Lumina Desktop — Build-to-Complete Roadmap

This is the single progress checklist for completing Lumina Desktop as a
self-contained product. It tracks only Desktop work. The root
[project roadmap](../ROADMAP.md) owns the wider Lumina-Wiki direction, while the
[implementation plan](../plans/260725-0024-lumina-desktop-app-only-v192-sync/plan.md)
owns technical sequencing, tests, risks, and file-level work.

## Product completion contract

Lumina Desktop is complete when a non-technical user can install the app,
create or open a workspace, use its accepted knowledge workflows, maintain the
workspace, and update the app without installing Node.js, npm, Python, the
Lumina CLI, or using a terminal.

Build and test tooling may consume canonical CLI/workspace sources. The
packaged app must implement runtime behavior natively and remain compatible
with accepted Lumina workspace contracts.

## Locked product experience

- The app serves non-technical users first. Normal use exposes libraries,
  documents, notes, topics, and relationships rather than CLI, runtime, or
  filesystem terminology.
- A welcome screen owns first launch when no valid recent workspace exists.
  Later launches reopen the last valid workspace and restore its most recent
  conversation, reading context, and view.
- Chat is the entry point for official Lumina skills. Users may invoke the
  canonical `/lumi-*` skill ID directly, or Lumina may select an official skill
  when the request is clear.
- Canonical skill IDs remain visible for continuity with CLI users. Surrounding
  descriptions, progress, results, and errors use everyday language.
- Only versioned official Lumina skills ship in the initial product. Custom,
  workspace-provided, marketplace, and remotely loaded skills are out of scope.
- Chat and embedding models are configured only in Advanced settings. The
  normal interface does not expose a model selector or substitute
  Fast/Balanced/Deep modes.
- Semantic retrieval remains optional and falls back to workspace text search.
  Embedding similarity does not create authoritative graph relationships.

## Foundation already built

- [x] Native workspace picker and capability-bound active session.
- [x] Responsive workspace tree, graph canvas, Markdown note view, and node
  inspector backed by real workspace data.
- [x] Non-overwriting source import with filesystem validation.
- [x] Provider-backed AI chat with citations, cancellation, retry, and
  workspace-scoped history.
- [x] Backend-owned credentials, consent controls, lexical retrieval, and
  optional semantic retrieval.
- [x] Visual, accessibility, immutability, secret-boundary, native-package, and
  packaged-launch test foundations.

## Self-contained workspace foundation

- [ ] Generate a versioned Desktop contract and deterministic workspace payload
  from canonical Lumina sources during build.
- [ ] Generate, embed, and verify a versioned catalog of official Lumina skills
  from their canonical sources.
- [ ] Embed and verify that contract and payload in the packaged app.
- [ ] Remove packaged-runtime dependence on Node.js, npm, Python, CLI commands,
  and workspace executables.
- [ ] Add a contract-drift gate so accepted workspace changes cannot silently
  diverge from Desktop.

## First-run and workspace management

- [x] Show a welcome screen when no valid recent workspace exists, with clear
  Create library and Open existing library paths.
- [x] Provision and activate a standard workspace from the Create library flow
  without exposing CLI or internal filesystem concepts.
- [x] Detect empty folders, existing Lumina workspaces, and unsafe non-empty
  folders without overwriting existing content.
- [x] Validate and activate a newly created workspace automatically.
- [x] Remember recent workspaces and reopen the last valid workspace on later
  launches.
- [x] Restore the most recent conversation, open note or document, and active
  Chat, Note, or Graph view independently for each workspace.
- [x] Recover cleanly from cancellation, permission errors, interrupted writes,
  missing folders, and changed workspace identity.

## Native maintenance

- [ ] Run all workspace checks through L17 inside the app.
- [ ] Provide Quick update for managed Desktop workspace files.
- [ ] Provide Modify installation for pack and supported setting changes.
- [ ] Provide previewed repair and reset actions with explicit confirmation.
- [ ] Preserve user-owned `wiki/` and `raw/` content across normal lifecycle
  operations.
- [ ] Make create, update, repair, and reset atomic, idempotent, and recoverable.

## Current Lumina workspace compatibility

- [ ] Detect core, research, reading, and learning capabilities from the
  generated contract.
- [ ] Read and render sources, concepts, people, summaries, outputs,
  foundations, topics, readings, reflections, chapters, characters, themes,
  plots, and future compatible entity types.
- [ ] Read and render accepted relationships through Lumina v1.9.2.
- [ ] Display research ranking results and optional influence signals.
- [ ] Include readings and reflections in search, retrieval, graph navigation,
  and citations.
- [ ] Handle malformed, oversized, or newer workspace metadata safely.

## Knowledge correction

- [ ] Preview and remove a relationship.
- [ ] Preview and replace a relationship type while preserving valid metadata.
- [ ] Preview and remove a citation.
- [ ] Apply reverse, symmetric, terminal, and exemption rules consistently.
- [ ] Serialize concurrent changes, commit atomically, rerun checks, and refresh
  the workspace after success.

## Guided knowledge workflows

- [ ] Let users discover and invoke canonical `/lumi-*` skills from the chat
  composer without memorizing them.
- [ ] Route clear natural-language requests to an appropriate official skill,
  show which skill was selected, and let the user cancel or change it.
- [ ] Restrict skill execution to packaged official instructions and an
  allowlisted native tool registry; never execute workspace-provided skill code.
- [ ] Represent skill context, progress, cancellation, preview, approval, and
  results as accessible chat states.
- [ ] Let the user review and file a completed AI answer into the workspace.
- [ ] Update the page, index, append-only log, and graph as one recoverable
  change.
- [ ] Rank research sources using available evidence and clearly label optional
  or estimated signals.
- [ ] Keep provider credentials in the backend and disclose remote requests
  before they occur.
- [ ] Never allow AI-generated workspace changes without a visible preview and
  explicit user approval.

## Long-source reading

- [ ] Extract page-marked text from supported PDFs natively.
- [ ] Detect long sources and process them in bounded, resumable passes.
- [ ] Create source and reading notes with annotation relationships.
- [ ] Verify quotes against source pages before offering a commit.
- [ ] Support progress, cancellation, retry, and safe resume after app restart.
- [ ] Report scanned, encrypted, malformed, or excessive PDFs as unsupported
  instead of producing low-quality notes.
- [ ] Keep OCR outside this completion scope.

## Product integration

- [ ] Present Create, Open, Manage, Check, Correct, File, Rank, and Read actions
  as one coherent chat-led workflow.
- [ ] Provide a Home or Chat focus for starting work, the three-pane reading
  workspace for source-grounded conversation, and a Graph focus for relationship
  exploration.
- [ ] Use everyday labels for user-facing libraries, documents, notes, topics,
  relationships, checks, and recovery while preserving canonical `/lumi-*`
  skill IDs.
- [ ] Keep provider and model selection in Advanced settings only; retain
  separate chat and embedding profiles without simplified AI mode aliases.
- [ ] Polish the existing optional semantic-search controls around disclosure,
  index status, rebuild, clear, and lexical fallback without making embedding
  setup a first-run requirement.
- [ ] Provide clear empty, loading, progress, cancellation, success, warning,
  and recovery states.
- [ ] Complete keyboard navigation, focus recovery, screen-reader labels, and
  reduced-motion behavior for every new workflow.
- [ ] Remove obsolete Node-path settings, process bridges, and disconnected UI.
- [ ] Keep normal local use free of telemetry and unapproved network requests.

## Release readiness

- [ ] Pass native unit, frontend, integration, accessibility, visual, security,
  contract-conformance, and workspace-safety gates.
- [ ] Package and launch-test macOS, Windows, and Linux builds with external
  runtimes unavailable.
- [ ] Test install, first launch, workspace creation, reopen, update, recovery,
  and uninstall on supported platforms.
- [ ] Complete application signing, macOS notarization, trusted distribution,
  and update verification.
- [ ] Publish user guidance for installation, first workspace, privacy,
  recovery, and supported limitations.

The checked first-run items above record implemented engineering behavior and
local automated evidence only. They do not claim that native package jobs,
manual installed-GUI acceptance, artifact digest reports, signing,
notarization, or trusted distribution have passed.

## Done

- [ ] Every unchecked item above is complete and backed by passing evidence.
- [ ] A clean machine can use the full supported product with only Lumina
  Desktop installed.
- [ ] A user can invoke an official skill directly or let Lumina select one
  from chat without installing or executing the CLI.
- [ ] Reopening the app restores the last valid workspace, its latest
  conversation, and the content that was being read.
- [ ] Accepted Lumina v1.7.0-v1.9.2 workspace capabilities in scope are usable
  without a CLI or terminal.
- [ ] User content survives update, repair, recovery, and uninstall validation.

## Synchronization rule

Future CLI or workspace changes do not automatically expand Desktop scope.
When an accepted user-facing capability changes, assess its Desktop impact,
append only the necessary native work to this checklist, and require the same
interaction, data-safety, compatibility, and packaged-app evidence.
