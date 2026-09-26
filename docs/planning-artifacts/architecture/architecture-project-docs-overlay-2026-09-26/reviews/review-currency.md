---
review: currency
spine: ../ARCHITECTURE-SPINE.md
date: 2026-09-26
---

# Currency Review — project-docs-overlay spine

## Verdict

All checked version and hook-doc claims hold up against the live web and the repo as of 2026-09-26; no named technology is stale, wrong, or nonexistent — one gzip-size figure is off by 13 bytes and AD-16's vendored file doesn't exist yet (expected pre-build).

## Findings

1. **Node/commander/@clack/prompts/js-yaml versions match `package.json` exactly** (`engines.node: ">=24.0.0"`, `commander: "^12.1.0"`, `@clack/prompts: "^0.9.1"`) — these are pinned deps, not claimed as "latest," so the spine is accurate to the source of truth it should be accurate to; both pinned versions exist on npm and are not deprecated.
2. **force-graph 1.51.4 is confirmed the current latest** (published 2026-04-16, per `npm view`), and `dist/force-graph.min.js` exists on unpkg as a self-contained UMD bundle exporting global `ForceGraph`, with `nodeAutoColorBy`, `nodeCanvasObject`, `linkDirectionalArrowLength`, `linkDirectionalParticles`, `onNodeHover`, `zoomToFit`, and `d3Force` all present in the minified source. Raw size matches exactly (177,599 B); the memlog's gzip figure (57,427 B) is 13 B off from a local `gzip -9` measurement (57,414 B) — immaterial, likely a different gzip implementation/header, not a version or existence problem.
3. **Claude Code hooks** (`code.claude.com/docs/en/hooks`): confirmed `.claude/settings.json`, `PostToolUse` event, `Edit|Write` matcher syntax, `tool_input.file_path` on stdin, exit 2 = block / other non-zero = non-blocking error, default timeout 600 s — all as the spine states.
4. **Codex hooks** (`learn.chatgpt.com/docs/hooks`): confirmed `.codex/hooks.json` / `[hooks]` in `.codex/config.toml`, `PostToolUse`, `apply_patch` matcher, exit 2 = block, default timeout 600 s, hash-based trust — matches AD-13 and the memlog note.
5. **Antigravity hooks and skills** (`antigravity.google/docs/hooks/` and Google's Antigravity skills docs): confirmed `.agents/hooks.json` (workspace) / `~/.gemini/config/hooks.json` (global), `PostToolUse` event, and matcher values `write_to_file`, `replace_file_content`, `multi_replace_file_content` exactly as named in AD-13. Skills confirmed at `.agents/skills/<name>/SKILL.md` reading `AGENTS.md` — matches AD-4's antigravity-joins-`VALID_IDE_TARGETS` claim. The memlog's caveat that Antigravity's exit-code/trust semantics aren't officially documented still holds — the fetched docs describe the handler contract but not a block/exit-code table, so that gap is honestly flagged, not asserted.
6. **Not yet built, as expected for a pre-implementation spine**: `src/vendor/force-graph.min.js` does not exist in the repo yet, and `antigravity` is not yet in `VALID_IDE_TARGETS` (`src/installer/commands.js:115` currently lists `claude_code, codex, cursor, gemini_cli, qwen, iflow, generic`). Both are exactly what AD-16 and AD-4 propose to add — not a currency defect, just unimplemented design.
7. **AD-16's plan to reuse `ci-package`'s `requiredFiles` list is grounded in a real, existing mechanism** (`scripts/ci-package.mjs:71`), not an invented tie-in.
