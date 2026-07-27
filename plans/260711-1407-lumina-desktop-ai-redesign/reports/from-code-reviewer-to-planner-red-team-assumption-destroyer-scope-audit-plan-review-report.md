# Assumption Destroyer and Scope Auditor Plan Review

## Summary

Six evidence-backed findings. Coordinator-authored fallback after the assigned second child could not run because the team thread limit was exhausted. No plan or code changes performed.

## Finding 1: History has no concurrency ownership model

- **Severity:** Critical
- **Location:** Phase 1, Architecture/History Store; Phase 5, concurrent request/window requirements
- **Flaw:** JSONL append plus atomic metadata is specified without a per-workspace lock, single-writer queue, transaction boundary, or cross-process policy.
- **Failure scenario:** Two windows finish attempts together; both append, then race metadata replacement. One conversation disappears from the index, terminal uniqueness breaks, or delete-all races a late append.
- **Evidence:** Phase 1 lines 34, 55, 74-76 and phase 5 lines 25, 66 demand concurrency but never assign lock ownership. Current services are process-singletons registered in `apps/desktop/main.go:22-27`, while current per-call implementations freely construct helper services (`apps/desktop/internal/graph/service.go:56-65`, `apps/desktop/internal/importer/service.go:37-45`, `apps/desktop/internal/tools/service.go:40-47`); there is no existing shared lock/store pattern to inherit.
- **Suggested fix:** Define one process-owned history coordinator keyed by `WorkspaceID`, locking order for append/list/delete, fsync semantics, and explicit cross-process behavior; add concurrent append/delete/race tests.

## Finding 2: Stable workspace identity requires an unplanned registry

- **Severity:** High
- **Location:** Phase 1, WorkspaceID Architecture and Inventory
- **Flaw:** Hashing canonical path plus filesystem identity cannot both preserve rename identity and detect path reuse without persisting a path-to-signature/identity registry, but no registry schema/path/store/migration appears in the file inventory.
- **Failure scenario:** Rename changes the path hash and loses history, or reusing the old path attaches the previous workspace’s history because there is no durable signature association to challenge.
- **Evidence:** Phase 1 lines 37, 56, 75 and 119 require rename/reuse handling but inventory only `identity.go`. Current workspace validation stores nothing and returns only absolute root/valid/packs (`apps/desktop/internal/workspace/service.go:10-14`, `apps/desktop/internal/workspace/service.go:22-40`); React currently holds the root only in component state (`apps/desktop/frontend/src/App.tsx:32-38`).
- **Suggested fix:** Inventory/version a workspace registry under app config, define rename/path-reuse transitions and confirmation API, and specify atomic updates with collision/restore tests.

## Finding 3: Retrieval corpus and navigable graph have different universes

- **Severity:** High
- **Location:** Phase 3 corpus policy; Phase 5 citations; Phase 7 citation navigation
- **Flaw:** Corpus scans every eligible Markdown file under `wiki/`, while the graph only indexes a fixed entity-directory allowlist. A valid backend citation can therefore lack any graph node for navigation.
- **Failure scenario:** Retrieval cites an eligible note in a new/custom wiki folder; backend allowlists it, but frontend cannot select or open it because `KnowledgeGraph` contains no matching node.
- **Evidence:** Phase 3 line 25 includes broad `wiki/` Markdown and phase 7 lines 71, 81 promise graph navigation. Current graph traversal iterates only `entityDirs()` (`apps/desktop/internal/graph/service.go:103-130`), whose fixed allowlist is `sources` through `plot` (`apps/desktop/internal/graph/service.go:133-138`); selection only searches loaded nodes (`apps/desktop/frontend/src/App.tsx:219-229`).
- **Suggested fix:** Align corpus with graph-indexable notes or add a safe citation-to-note binding independent of graph membership and define UX for non-graph evidence.

## Finding 4: The planned real workspace tree lacks a backend data contract

- **Severity:** High
- **Location:** Phase 6, Requirements/Architecture
- **Flaw:** Phase 6 says the tree derives only from graph note paths, yet the reference hierarchy includes real workspace regions such as `raw` and `_lumina`, which graph DTOs cannot represent.
- **Failure scenario:** The hard-coded tree is removed; the replacement can show entity notes but not the promised reference workspace hierarchy, forcing either phantom folder labels or a late unplanned filesystem-listing API.
- **Evidence:** Current tree is entirely hard-coded, including `_lumina`, `raw`, entity folders, `index`, and `log` (`apps/desktop/frontend/src/app/app-shell.tsx:89-119`). Current graph nodes expose only ID/title/type/path/preview (`apps/desktop/internal/graph/types.go:8-14`), and workspace summary exposes counts/missing folders, not a tree (`apps/desktop/internal/workspace/summary.go:10-20`).
- **Suggested fix:** Decide the product contract: note-only entity tree, or create a bounded no-symlink workspace-tree DTO/service with exact included roots. Update visual acceptance accordingly without fake entries.

## Finding 5: Phase 7 assumes generated settings/history/index methods that no phase specifies

- **Severity:** High
- **Location:** Phases 1, 4, 5 and 7 binding contracts
- **Flaw:** Phase 7 integrates profiles, credential status, history and index lifecycle through generated bindings, but the plan never enumerates the public facade method signatures/DTOs that expose these stores. Phase 5 lists broad generated DTO categories without matching service methods.
- **Failure scenario:** Bindings regenerate with only `Chat`, leaving phase 7 blocked or causing ad hoc secret/history/index methods and DTO fields to be designed during UI implementation.
- **Evidence:** Wails currently generates one function per exported service method, e.g. workspace `ResolveInside`, `Summary`, `Validate` (`apps/desktop/frontend/bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace/service.ts:12-25`). Phase 1 only names store interfaces and an unspecified status/write facade; phase 5’s concrete service signature is only `Chat`; phase 7 expects all settings/history/index operations. Current registration requires a concrete service instance (`apps/desktop/main.go:22-27`).
- **Suggested fix:** Add a complete Wails facade contract table in phase 5 (method name, request/response DTO, context/cancellation, secret direction, store dependency) and make phase 7 compile against it.

## Finding 6: Font migration leaves duplicate current assets unowned

- **Severity:** Medium
- **Location:** Phase 6 font inventory; Phase 8 package scan
- **Flaw:** The plan adds `public/fonts/` and licenses but does not modify/delete the existing root-level Inter font/license, so package output can retain duplicate or stale font paths.
- **Failure scenario:** CSS moves to the new directory while old files remain packaged; license/package scans pass presence checks but distribution contains redundant assets and an unclear canonical source.
- **Evidence:** Existing assets are `apps/desktop/frontend/public/Inter-Medium.ttf` and `apps/desktop/frontend/Inter Font License.txt`; phase 6 inventories only additions. The Vite build packages `public` assets and current package scripts do not include a dedicated asset allowlist (`apps/desktop/frontend/package.json:6-11`).
- **Suggested fix:** Add exact move/delete/retain actions for existing font and license files and make phase 8 reject duplicate unreferenced font binaries.

## Unresolved Questions

- None.
