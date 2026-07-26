# Reality-Check Review — ARCHITECTURE-SPINE.md (librarian-mode)

**Verdict: PASS WITH FINDINGS.** Every checked codebase claim is either accurate or points at a real file/mechanism; no fabricated APIs or invented symbols were found. One Major gap: AD-7's plan to run SKILL.md content through the existing template engine collides with literal `{{...}}` sequences that already exist in shipped skill files and would be silently corrupted by that engine's current substitution rules. One Minor precision issue: the "wipe-the-directory defect" AD-8 cites is real, but lives in a different function than the one most readers would assume.

---

## 1. Stack pins (`## Stack`, line 133)

**Claim:** "Unchanged — no new dependencies. Inherited pins ... Node ≥20 ESM, commander ^12.1.0, @clack/prompts ^0.9.1, js-yaml ^4.1.0, glob ^11.0.0, picocolors ^1.1.1."

**Verified exact match against `/Users/luutronghieu/Projects/lumina-wiki/package.json`:**
- `commander`: `^12.1.0` (package.json:86) ✓
- `@clack/prompts`: `^0.9.1` (package.json:85) ✓
- `js-yaml`: `^4.1.0` (package.json:88) ✓
- `glob`: `^11.0.0` (package.json:87) ✓
- `picocolors`: `^1.1.1` (package.json:89) ✓
- `engines.node`: `">=20.0.0"` (package.json:82) ✓
- `devDependencies: {}` (package.json:91) — consistent with inherited invariant table.

**Finding: none.** Every pin is byte-exact. No stale or invented version.

---

## 2. Template engine and `{{#if}}` conditionals (AD-7, line 77-81)

**Claim:** "AI-agent installs render through the existing template engine with an `agent_host` flag; the routing preamble is one shared partial ... injected at render."

**Verified:** `/Users/luutronghieu/Projects/lumina-wiki/src/installer/template-engine.js:1-95` implements exactly the syntax described: `{{variable}}` substitution, `{{#if condition}}...{{/if}}` block conditionals (non-nested, v0.1 scope per its own doc comment at lines 6-13), unknown variables render as empty string (line 92: `if (value === undefined || value === null) return '';`). This part of the spine's claim is accurate — the mechanism exists as described.

### Major finding — collision not addressed by the spine

The engine's variable-substitution regex is `/\{\{([^#/}][^}]*)\}\}/g` (template-engine.js:89) — it matches **any** `{{...}}` span whose first character isn't `#` or `/`, with no escape syntax. Two shipped skill files already contain literal `{{...}}` sequences that are not installer template tags:

- `/Users/luutronghieu/Projects/lumina-wiki/src/skills/core/init/SKILL.md:118` — inside a fenced code example of a log line: `` ## [YYYY-MM-DD] init | Wiki initialized. Packs: core{{, research, reading}}. `` — a literal example of optional trailing text, not a template tag.
- `/Users/luutronghieu/Projects/lumina-wiki/src/skills/core/verify/references/reviewers.md:7` — `` Substitute `{{ENTRY_TEXT}}`, `{{RAW_CONTENTS}}`, and `{{GRAPH_EXCERPT}}` `` (also used at lines 55, 103, 109, 115, 167) — these are placeholders the **skill's own runtime instructions** tell an agent to substitute manually when building a sub-agent prompt. They are not installer variables and no such keys (`ENTRY_TEXT`, `RAW_CONTENTS`, `GRAPH_EXCERPT`) exist in the installer's variable set.

Today these are harmless because `copySkills` (`src/installer/commands.js:1203-1229`) never calls `render()` — it does a plain `copyDir(srcDir, destDir)` (line 1215). AD-7 proposes routing skill content for the agent-host path through `render()` for the first time. If that pass runs over full SKILL.md/reference bodies (not just a preamble-partial injection point), both examples above would have their `{{...}}` spans silently deleted — `substituteVariables` returns `''` for any unmatched key (template-engine.js:92) — corrupting documentation text and, in the `reviewers.md` case, breaking a real runtime instruction the `/lumi-verify` skill depends on.

The spine does not scope AD-7's render pass (partial-injection only vs. full-body render) nor add an escape mechanism or a pre-flight scan for pre-existing `{{` in skill sources. This is a concrete, evidence-backed gap the design should close before implementation — either by rendering only the injected preamble partial (not the rest of the file), or by adding an escaped-brace rule to the template engine and auditing skill sources for false positives.

---

## 3. `skills-manifest.csv` (AD-8, line 87)

**Claim:** "project: existing `skills-manifest.csv`."

**Verified:** `/Users/luutronghieu/Projects/lumina-wiki/src/installer/manifest.js` — `readSkillsManifest` (line 213, reads `_lumina/_state/skills-manifest.csv`, line 214) and `writeSkillsManifest` (line 233, same path, line 234) both exist and match the claim exactly.

**Finding: none.**

---

## 4. `copySkills` and the "wipe-the-directory" claim (AD-8, line 86)

**Claim:** "Prevents: the current wipe-the-directory defect, in both project and global skills directories" / (platform-integration.md:60) "This replaces the current wipe-the-directory behavior, which is a defect."

**Verified — but the defect lives somewhere more specific than a reader would assume from AD-8's phrasing:**

`copySkills` (`src/installer/commands.js:1203-1229`) does an `rm -rf` **per skill**, not on the whole directory:
```js
const destDir = join(projectRoot, '.agents', 'skills', skill.canonicalId);
await access(join(srcDir, 'SKILL.md'), fsConstants.F_OK);
await rm(destDir, { recursive: true, force: true });   // wipes only THIS skill's own folder
await ensureDir(destDir);
await copyDir(srcDir, destDir);
```
This loop only touches `canonicalId` subfolders it knows about (from `getSkillDefs`, lines 1243-1301) — a foreign directory sitting alongside them under `.agents/skills/` is never enumerated or touched. So the *install/upgrade* path already satisfies "foreign entries untouched" for `.agents/skills/`.

The real wholesale wipe is in `uninstallCommand` (`src/installer/commands.js:522-524`):
```js
// Remove .agents/
await rm(join(projectRoot, '.agents'), { recursive: true, force: true });
```
This deletes the entire `.agents/` directory unconditionally on uninstall — including any foreign, non-`lumi-*` content a user might have placed there — regardless of manifest ownership. By contrast, the adjacent `.claude/skills/` cleanup in the same function (lines 526-535) is already manifest-scoped-by-convention: it iterates directory entries and only removes ones with a `lumi-` prefix, leaving foreign entries alone.

**Finding (Minor/precision):** AD-8's rule ("Every skills-writing path derives its owned set from a manifest ... Deletion is allowed only for owned-and-deselected canonicalIds") reads as though it's fixing the *install* path. The actual unconditional wholesale-delete defect is in `uninstallCommand`'s `.agents/` removal, not in `copySkills`. If AD-8's manifest-gated deletion isn't explicitly extended to the uninstall path too, the cited defect will survive librarian-mode's implementation. Recommend the architecture spine (or its companion spec) explicitly name `uninstallCommand`'s `.agents/` rm as in-scope for the AD-8 fix, not just the per-skill install loop.

---

## 5. `VALID_IDE_TARGETS` (AD-9, line 93)

**Claim:** "`VALID_AGENT_TARGETS` is a separate set from `VALID_IDE_TARGETS`."

**Verified:** `/Users/luutronghieu/Projects/lumina-wiki/src/installer/commands.js:130`:
```js
const VALID_IDE_TARGETS = new Set(['claude_code', 'codex', 'cursor', 'gemini_cli', 'qwen', 'iflow', 'generic']);
```
used at line 827 (`validateValues(ideOverride, VALID_IDE_TARGETS, 'IDE target')`). `VALID_AGENT_TARGETS` does not exist yet anywhere in the repo (confirmed by grep across `src/` and `bin/`) — consistent with the spine correctly marking this as new/proposed rather than claiming it already exists. No contradiction.

---

## 6. Lazy-loaded subcommand pattern (AD-9, line 93)

**Claim:** "`wikis` and agent-install verbs are lazy-loaded subcommand modules registered in `bin/lumina.js`."

**Verified:** `/Users/luutronghieu/Projects/lumina-wiki/bin/lumina.js` — every existing subcommand's implementation is imported inside its `.action()` callback via dynamic `await import(...)` (e.g. line 216 `const { installCommand } = await import('../src/installer/commands.js');` inside the action at line 200; line 255 `uninstallCommand` inside the action at line 249; line 285 `discover-runner.mjs` inside the action at line 283). This confirms the precedent the spine is extending is real and consistently applied — not a one-off.

**Finding: none.**

---

## 7. Platform-integration.md spot check

Cross-read `/Users/luutronghieu/Projects/lumina-wiki/docs/specs/spec-librarian-mode/platform-integration.md` against the spine's CAP-7/CAP-8/CAP-9 references and Deferred section:

- Deferred: "Hermes non-Docker remote backends (SSH/Modal/Daytona/Singularity) — platform gap" matches platform-integration.md line 39 ("Supported for this flow: local and Docker only — SSH/Modal/Daytona/Singularity have no cache-path translation today"). Consistent.
- Deferred: "size-limit UX (Telegram 20 MB, OpenClaw `mediaMaxMb`)" matches the Size limits row (platform-integration.md:38). Consistent.
- AD-8/AD-9's "Whole-directory deletes of any skills dir are banned" / "Foreign entries are untouchable, proven by test" matches platform-integration.md §Non-destructive skills install (CAP-9), lines 53-60, including its own explicit call-out of "the current wipe-the-directory behavior, which is a defect" (see Finding 4 above for where that defect actually lives).
- CAP-7 chat-inbox claim in the spine ("preamble + ingest skill") is consistent with platform-integration.md's "Chat attachments" section (lines 30-41) describing the transport-free `cp` into `raw/tmp/` pattern.

**Finding: none** — no contradictions found between the two documents.

---

## Summary of findings by tier

| Tier | Finding | Evidence |
| --- | --- | --- |
| Major | AD-7's "render through the existing template engine" plan is unscoped and will silently delete pre-existing literal `{{...}}` content in at least 2 shipped skill files if applied to full file bodies rather than just the injected preamble partial | `template-engine.js:89,92`; `src/skills/core/init/SKILL.md:118`; `src/skills/core/verify/references/reviewers.md:7,55,103,109,115,167`; `commands.js:1215` (today's plain `copyDir`, no render) |
| Minor | AD-8's "wipe-the-directory defect" is real but sits in `uninstallCommand`'s unconditional `.agents/` removal, not in the per-skill `copySkills` install loop (which is already foreign-entry-safe) — the fix's scope should explicitly name the uninstall path | `commands.js:522-524` vs. `commands.js:1203-1229` |

All other checked claims (dependency pins, `skills-manifest.csv`, `VALID_IDE_TARGETS`, lazy-load pattern, platform-integration.md cross-references) verified accurate with no discrepancies.
