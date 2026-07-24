# Rubric Review — ARCHITECTURE-SPINE.md (librarian-mode)

**Reviewer:** rubric walker (checklist-driven)
**Target:** `docs/planning-artifacts/architecture/architecture-librarian-mode-2026-07-24/ARCHITECTURE-SPINE.md`
**Cross-checked against:** `docs/project-context.md`, `docs/specs/spec-librarian-mode/{SPEC.md,registry-and-cli.md,routing-protocol.md,platform-integration.md}`, and the live brownfield code (`src/installer/commands.js`, `src/installer/fs.js`, `package.json`).

## Verdict

**Conditional pass.** The spine's ten ADs are individually sound and each capability is bound to at least one AD, but two structural gaps would let independently-built epics/stories diverge or silently break shipping: it never flags the *existing* `uninstallCommand` full-directory wipe as in-scope even though AD-8/CAP-9 explicitly bans that exact pattern, and it never mentions the publish/packaging pipeline impact of the three new installer modules it introduces. Both are fixable without touching any AD's substance.

---

## Critical

### C1 — Structural Seed omits the one existing file AD-8 must change

- **Targets:** `## AD-8 — Ownership-manifest deletion rule` (spine L83-87) and `## Structural Seed` (L135-147).
- **Finding:** AD-8's Rule states plainly: *"Whole-directory deletes of any skills dir are banned."* CAP-9 (platform-integration.md L60) says this "replaces the current wipe-the-directory behavior, which is a defect." I verified the defect is real and lives in `uninstallCommand` at `src/installer/commands.js:523`:
  ```js
  await rm(join(projectRoot, '.agents'), { recursive: true, force: true });
  ```
  `.agents/` at the project level contains nothing but `.agents/skills/<canonicalId>/` entries (confirmed — no other `.agents` write site in `commands.js`), so this is a literal whole-directory delete of the project's skills dir — exactly the pattern AD-8 bans. Yet the Structural Seed lists only new files (`registry.js`, `wikis-command.js`, `layout.js`, the hub skill subtree, the preamble partial) and never names `commands.js`/`uninstallCommand` as touched. An epic/story author working strictly from the Structural Seed will build the new global manifest-driven deletion path and leave the old project-level bulk-wipe untouched, so AD-8's own acceptance bar ("Foreign entries are untouchable, proven by test") stays unmet for the very case the AD cites as its motivating defect.
- **Fix:** Add a line to the Structural Seed (or a new row under AD-8) naming `src/installer/commands.js::uninstallCommand` as a required-change site: replace the bulk `rm('.agents')` with per-canonicalId removal driven by the same manifest AD-8 defines, mirroring the already-correct `.claude/skills` loop at L526-535 (which *does* filter by `lumi-` prefix today).

### C2 — Publish pipeline impact is unaddressed; new modules would ship broken

- **Targets:** `## Structural Seed` (L135-147); no corresponding section anywhere in the spine.
- **Finding:** `package.json`'s `files` allowlist enumerates every `src/installer/*.js` file **individually** (`banner.js`, `commands.js`, `fs.js`, `locales.js`, `manifest.js`, `prompts.js`, `template-engine.js`, `update-check.js`) — there is no `src/installer/*.js` glob. The three new modules the spine introduces (`registry.js`, `wikis-command.js`, `layout.js`) are not covered by any existing entry or glob, so an `npm publish` after building this spine ships a CLI whose `lumina wikis …` and agent-install subcommands `require`/`import` files that don't exist in the tarball — CAP-1 through CAP-10 fail for every real npm-installed user despite passing every local test. (By contrast, `src/skills/**/*.md` and `src/templates/**/*` already glob-cover the new hub skill and the preamble partial, so those two are fine.) `scripts/ci-package.mjs`'s required/prohibited assertions also aren't mentioned as needing new entries. This is a real operational/publish-envelope dimension the checklist calls out, and it is completely silent in the spine — not even named in Deferred.
- **Fix:** Add the three new installer files to `package.json`'s `files` array (or convert to a `src/installer/*.js` glob, verifying that doesn't accidentally pick up `*.test.js` given the existing `ci-package.mjs` prohibition on test files) and note in the spine that `ci-package.mjs`'s required-file list needs the corresponding update.

---

## High

### H1 — AD-7 overstates reuse of the template engine for skills

- **Targets:** `## AD-7 — Skill projection and the preamble partial` (L77-81); `## Design Paradigm` (L21, "extends... without modifying it").
- **Finding:** AD-7 says AI-agent installs "render through the existing template engine with an `agent_host` flag." Verified in code: `copySkills()` (`commands.js:1203-1229`) copies each SKILL.md via raw `copyDir()` (`fs.js`) — a byte-for-byte recursive file copy with **zero** template processing. `template-engine.js`'s `{{#if}}`/`{{variable}}` machinery today only ever runs against `README.md`/schema docs (grep for `{{#if` under `src/skills/` returns zero matches). So "render through the existing template engine" is not reusing an established path for skills — it's wiring template rendering into `copySkills` for the first time, only for the `agent_host` case. That's a legitimate design choice, but the spine's framing ("extends... without modifying it") undersells that `copySkills` itself must change, which risks an implementer treating this as a config flag on an already-templated pipeline rather than new plumbing to build.
- **Fix:** Reword AD-7's Rule to say explicitly that `copySkills` gains a template-render step (new behavior) gated on `agent_host`, distinct from its current plain-copy behavior for classic installs — and keep the CI byte-identical check on the classic path as the acceptance proof (already stated, good).

### H2 — No "one owner" rule for the new global per-platform manifest

- **Targets:** `## AD-8` (L83-87) vs. `## AD-2 — Registry has one owner` (L47-51); `## Structural Seed` (L135-147, dependency diagram L107-117).
- **Finding:** AD-2 gives `~/.lumina/wikis.json` exactly one writer module (`registry.js`) and bans every other consumer from touching it directly. AD-8 introduces a second piece of global state — `~/.lumina/agents/<platform>-manifest.json` `[ASSUMPTION]` — with no equivalent ownership rule and no owning module named anywhere (it doesn't appear in the Structural Seed's file list or the mermaid dependency diagram). Without an AD-2-style constraint, the agent-install subcommand, a future agent-side `doctor`/uninstall path, and CAP-9's non-destructive-deletion logic could each grow their own read-modify-write logic against this file — precisely the "competing writers" failure mode AD-2 exists to prevent for the wiki registry, just left open for its sibling file.
- **Fix:** Add an explicit clause to AD-8 (or a new AD-8a) naming one module as sole owner of the per-platform global manifest, and add it as a node in the dependency diagram.

### H3 — `communication_language` source is undefined before any wiki is resolved

- **Targets:** `## Consistency Conventions` (L129, "hub-skill replies in configured `communication_language`"); CAP-10 in the Capability→Architecture Map (L187).
- **Finding:** `communication_language` is set per-wiki (in each wiki's own `lumina.config.yaml`, per existing architecture) — it is not a field in the registry schema (`registry-and-cli.md`'s schema is `name`/`aliases`/`path`/`description`/`packs`) and no global default is defined anywhere. But several `lumi-hub` interactions happen *before* any wiki is resolved — "tôi có những wiki nào?" (list the whole registry) or registering a brand-new wiki has no single wiki whose config could supply the language. The spine states the requirement ("hub-skill replies in configured communication_language") without saying which configuration source applies pre-resolution. Two independently-built stories could reasonably diverge: default to English, read the first-registered wiki's config, or ask the user each session.
- **Fix:** State explicitly in AD-10 or the Consistency Conventions row where the hub's pre-resolution language comes from (e.g., a new registry-level default field, an env var, or "ask once and cache" — any of these is fine, but it must be decided here, not left to story-level guessing, especially since the registry schema explicitly forbids adding arbitrary new top-level fields casually — `topics` is already a banned name, so a new field here needs the same scrutiny).

---

## Medium

### M1 — Symlink-ladder reuse for global skill installs is unspecified

- **Targets:** `## AD-7` (L77-81); `## AD-9 — CLI surface` (L89-93).
- **Finding:** Classic per-project Claude Code installs use the symlink fallback ladder (`linkDirectory`: symlink → junction → copy, persisted in `manifest.symlinkStrategies`). The spine never states whether the new global "AI Agents" skill deployment (into OpenClaw/Hermes global directories) reuses this ladder or does a plain `copyDir`. This is not a cosmetic detail: symlinks into a shared, foreign-owned global directory interact differently with Windows Developer Mode requirements, with OpenClaw/Hermes's own file-watching/loading behavior, and with CAP-9's "prove foreign entries survive" test design (a symlinked entry behaves differently under a naive `readdir`-and-delete foreign-skill test than a copied one).
- **Fix:** Either state "reuses `linkDirectory` unchanged" or "always plain-copies, no symlink ladder, because X" as an explicit line in AD-7, and reflect the choice in the Structural Seed.

### M2 — Test strategy and CI-matrix impact for the new modules is silent

- **Targets:** `## Structural Seed` (L135-147); `## Stack` (L131-133).
- **Finding:** Project convention (`docs/project-context.md` §8) is colocated `*.test.js`/`*.test.mjs` per module, and CI runs the full matrix (Node 20/22 × Ubuntu/macOS/Windows). The spine's Structural Seed lists `registry.js`, `wikis-command.js`, `layout.js`, the hub skill subtree, and the preamble partial with no paired test files, and never states whether the six-way CI matrix needs anything beyond the general "Windows-safe path" convention already covered under Consistency Conventions. This is a dimension the altitude owns (test strategy) and it reads as an omission rather than a deliberate "no special handling needed" call.
- **Fix:** Either add one line confirming "standard colocated tests, no CI matrix changes beyond existing Windows path handling" (if that's really sufficient) or flag what's different.

### M3 — No named capability/deferred item for "agent uninstall / deselect"

- **Targets:** `## AD-8` Rule text ("owned-and-deselected canonicalIds," L87); `## Deferred` (L189-195); SPEC.md Capabilities (CAP-1..10).
- **Finding:** AD-8's rule text presumes a reselection/upgrade flow exists for agent-install targets (deletion applies to "owned-and-deselected canonicalIds"), but neither the SPEC's ten capabilities nor the spine's Deferred list names an "agent-uninstall" or "deselect AI Agents pack" capability explicitly. It's implied but not fixed anywhere, which is exactly the kind of half-specified behavior that produces divergent implementations at story time.
- **Fix:** Either add a one-line Deferred entry ("re-running the AI Agents installer with a target removed reconciles global skills the same way `reconcileRemovedIdeTargets` does today — epic-level, no new AD") or bind it explicitly under AD-8/AD-9.

## Low

### L1 — CAP-5 (fleet doctor) map row omits AD-2

`## Capability → Architecture Map` (L182) lists AD-4/AD-5/AD-6 for CAP-5 but not AD-2, even though `doctor` must iterate the registry. Minor completeness nit — no actual divergence risk since `doctor` lives inside the same `wikis-command` module AD-2 already governs, but worth a one-token fix for a reader scanning the table in isolation.

### L2 — Dev-loop guidance for the new install group isn't mentioned

`docs/DEVELOPMENT.md` / `npm run dev:sandbox` flag-forwarding isn't mentioned as needing to cover the new "AI Agents" prompt group for local testing. Not architectural, but worth a pointer so epic authors don't have to rediscover the sandbox workflow constraint independently.

---

## Checklist walk-through (explicit)

| Rubric item | Verdict |
|---|---|
| Fixes real divergence points for epics/stories, misses none | **No** — misses C1, H2, H3, M1, M3 (see above) |
| Every AD's Rule is enforceable and prevents its divergence | **Mostly yes** — AD-1 through AD-6, AD-9, AD-10, AD-11 are enforceable as written; AD-7 is enforceable but mis-describes brownfield reuse (H1); AD-8 is enforceable for *new* code but doesn't reach the existing defect it cites (C1) |
| Nothing under Deferred could let two units diverge | **Mostly yes** — the five Deferred items are genuinely low-force (docs, non-goals, platform gaps); the gap is what's *missing* from Deferred (M3), not what's wrongly deferred |
| Named tech is verified-current | **Yes** — "no new dependencies" claim checked against `package.json`; all five listed deps and versions match exactly |
| Ratifies rather than contradicts the brownfield codebase | **Partially** — AD-1 through AD-6, AD-9 through AD-11 ratify cleanly; AD-7's "existing template engine" framing and AD-8's silence on the existing `uninstallCommand` wipe are the two contradiction points (H1, C1) |
| Covers every capability CAP-1..CAP-10 | **Yes** — all ten appear in the Capability → Architecture Map with at least one governing AD |
| Every dimension this altitude owns is decided/deferred/open — esp. operational/environmental envelope | **No** — deployment/publish-pipeline impact (C2), test strategy (M2), and symlink-vs-copy for global installs (M1) are silent rather than decided or deferred; Windows support and CI-matrix-as-inherited are the two envelope items that *are* covered (Consistency Conventions, Inherited Invariants) |
