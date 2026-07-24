---
id: SPEC-librarian-mode
companions:
  - registry-and-cli.md
  - routing-protocol.md
  - platform-integration.md
  - ../../project-context.md
  - ../../planning-artifacts/architecture/architecture-librarian-mode-2026-07-24/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Librarian Mode — Multi-Wiki Care by Persistent AI Agents

*(Internal codename. All user-facing surfaces say "knowledge assistant" / "trợ lý tri thức" — never "librarian".)*

## Why

An opportunity to capture plus a pain to solve. Always-on personal agents (OpenClaw, Hermes Agent) reach users through wide chat ecosystems (Telegram, Discord, Slack, email) and can act as knowledge assistants: the user sends a document or asks a question from anywhere, anytime. Lumina-Wiki's current contract blocks this — it assumes one session opened inside one wiki directory with user-invoked commands. Lưu Hiếu maintains multiple wikis (one per major topic, at arbitrary self-chosen paths, some pre-existing and synced to GitHub/Drive) and wants a single assistant agent to serve all of them. Two gaps stand in the way: there is no multi-wiki registry/routing story, and the installer currently wipes the whole skills directory on install — destroying a user's foreign skills, which makes global (agent-level) installs dangerous. Both platforms already support the agentskills.io SKILL.md standard Lumina uses (verified in their source), so the integration surface is routing + packaging, not skill format.

## Capabilities

- **CAP-1**
  - **intent:** User or agent can maintain a global wiki registry (name, aliases, absolute path, description, packs) and deterministically resolve a spoken wiki reference to its directory via a `lumina wikis` CLI.
  - **success:** With two wikis registered, `lumina wikis resolve "kỹ thuật AI"` (an alias) returns the correct absolute path with exit 0 and `--json` output; an unknown or ambiguous query exits 2 with candidates listed in the JSON error.
- **CAP-2**
  - **intent:** User can register a pre-existing wiki directory (e.g. cloned from GitHub or synced from Drive) without the registry tool writing anything inside that directory.
  - **success:** Registering an existing git-tracked wiki leaves `git status` clean in the wiki; a byte-level compare before/after registration shows no change inside the wiki directory.
- **CAP-3**
  - **intent:** Agent can create a new wiki at a user-chosen path on request ("mở wiki mới về chủ đề X") by running the existing installer non-interactively, then registering it.
  - **success:** From a chat instruction, a new directory passes the CAP-4 structure check and appears in `lumina wikis list` with the user's chosen name.
- **CAP-4**
  - **intent:** User or agent can check that a wiki directory conforms to the canonical Lumina layout via `doctor <name>`, and repair it additively — create missing required directories and skeleton, never overwriting or modifying existing content.
  - **success:** A conforming wiki checks clean (exit 0); a wiki with deleted required directories is reported, and the fix mode recreates the missing skeleton while every pre-existing file remains byte-identical.
- **CAP-5**
  - **intent:** Agent can run one fleet-wide health command that iterates the registry and runs structure check + lint per wiki, emitting an aggregated JSON report — read-only by default, with an explicit fix mode that applies CAP-4's additive repair per wiki. The entry point for scheduled care (OpenClaw cron / Hermes scheduled tasks).
  - **success:** `lumina wikis doctor --json` over N registered wikis returns one report with per-wiki status; a deliberately broken wiki is flagged without stopping the sweep; without the fix flag no file in any wiki is modified; with it, missing directories appear and nothing existing changes.
- **CAP-6**
  - **intent:** Skills installed for an AI-agent host resolve their target workspace before acting — resolve by name/alias, state or ask on ambiguity, read the target wiki's `README.md`, and prefix every command with a one-shot `cd` to the resolved absolute path. The routing preamble is rendered only into AI-agent global installs; classic per-wiki installs remain byte-identical to today.
  - **success:** From a non-wiki cwd with two registered wikis, an agent following the skill routes "ingest bài này vào wiki AI Engineering" to the right wiki and reads its README before any write; an ambiguous request produces a clarifying question, not a guess; a classic IDE install contains no multi-wiki or agent-host content at all.
- **CAP-7**
  - **intent:** User can send a document over a chat platform (e.g. Telegram attachment saved locally by OpenClaw/Hermes) and have it land in the resolved wiki's `raw/tmp/` as a new collision-safe file, then flow through the normal `/lumi-ingest`.
  - **success:** A PDF sent via chat ends up in the target wiki's `raw/tmp/` without overwriting any existing file, and the subsequent ingest completes with lint clean.
- **CAP-8**
  - **intent:** Installer offers an "AI Agents" choice group (OpenClaw, Hermes) — its own flag and prompt group, deliberately separate from `--ide` — that installs the skill set into the platform's documented global skills directory and, after install, shows a next-steps notice (register wikis, how routing works) requiring Enter to acknowledge in interactive mode.
  - **success:** A non-interactive install for an AI-agent target places all `lumi-*` skills in the platform's documented global skills directory and prints the next-steps notice; interactive mode pauses for acknowledgment; no workspace payload (`_lumina/`, `wiki/`, stubs) is written by these targets.
- **CAP-9**
  - **intent:** Skills installation is non-destructive everywhere: the installer manages only the `lumi-*` entries it owns (tracked in its skills manifest) and never deletes or overwrites foreign skills in any skills directory, global or project-level.
  - **success:** A foreign skill directory placed in the target skills location survives install and upgrade byte-identical, proven by an automated test; removal applies only to previously-installed `lumi-*` skills that are no longer part of the selection.
- **CAP-10**
  - **intent:** User can manage the fleet conversationally through a dedicated skill, canonicalId `lumi-hub` (list wikis, register a new or existing wiki, check fleet health) — the knowledge-assistant front door over the `lumina wikis` CLI.
  - **success:** Via chat, "tôi có những wiki nào?" lists the registry and "đăng ký wiki ở <path>" registers it, both through the skill without the user touching a terminal.

## Constraints

- No reliance on ambient cwd: every wiki operation is a one-shot `cd <abs-path> && <command>`; the path always comes from resolver output, never from model memory or a previous command's working directory.
- The registry lives at `~/.lumina/wikis.json` — outside any agent workspace, shared by OpenClaw and Hermes; the field name `topics` is forbidden in the registry schema (collides with the wiki `topics/` page type); use `name`, `aliases`, `description`.
- `resolve` verifies the target contains `_lumina/manifest.json` before returning a path — the model cannot receive a non-wiki path from the resolver.
- The word "verify" is reserved for the shipped `/lumi-verify` skill (semantic fact-checking); the structural check ships under `doctor` — no new surface may reuse "verify".
- In librarian mode the agent MUST read the target wiki's own `README.md` before any operation on that wiki (per-wiki truth: version, packs, custom rules).
- **Classic installs stay clean:** plain IDE installs contain zero OpenClaw/Hermes/multi-wiki content and remain byte-identical to today. The routing preamble and any agent-host customization are rendered only for AI Agents global installs, via the existing template-conditional mechanism — SKILL.md sources stay single-source.
- A document MUST exist under the target wiki's `raw/` before ingest — source extraction and ingest-time verification depend on the on-disk file. The chat-to-disk transport is platform/plugin-dependent and remains documented convention; no bundled transport helper.
- Skill `description` frontmatter: never empty (OpenClaw silently drops skills with empty descriptions), gist front-loaded in the first ~57 characters (Hermes prompt index truncates there), total under 1024 characters (Hermes hard ceiling). No other host-imposed limits exist (verified in both platforms' source).
- The AI Agents installer targets write no OpenClaw/Hermes workspace files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`); they touch only the global skills directory. Global skill locations follow each platform's official documentation (see `platform-integration.md`).
- User-facing naming is "knowledge assistant" ("trợ lý tri thức"); "librarian" appears only as internal shorthand in non-user-facing docs.
- All existing wiki invariants hold unchanged: `raw/` additions-only (via `raw/tmp/`, `raw/discovered/`), `wiki.mjs`-only graph/frontmatter mutation, append-only `log.md`, `atomicWrite` for all writes, `safePath` for relative fragments. Registry paths are absolute by design and validated by existence + manifest check instead of `safePath`.
- Repo policies hold: no new runtime dependencies, no `postinstall`, `devDependencies` empty, cold-start budget < 300 ms (the `wikis` subcommand is lazy-loaded), no emoji, plain-language rule for all user-facing text (project-context §3 rule 21), multi-language docs sync (en/vi/zh) for user-visible changes, existing exit-code contract (0/1/2/3/4).

## Non-goals

- Cross-wiki links, edges, or federated graph queries spanning wikis.
- Concurrent-write locking between multiple agents on one wiki (documented limitation; one primary assistant per wiki is the operating assumption).
- Agent-initiated autonomous ingestion (watch-folders, heartbeat-triggered ingest) — ingest remains user-driven; scheduled care covers health checks (CAP-5) only.
- Syncing wiki directories to GitHub/Drive — the user's own tooling owns that.
- Bundling OpenClaw/Hermes platform configuration (cron job creation, channel setup, Docker mounts) — documentation guidance only.
- A bundled chat-attachment transport helper — the file's arrival on disk is the platform's job; Lumina's contract starts at `raw/`.
- Second-model review plumbing (existing project rule; unchanged).
- Agent platforms beyond OpenClaw and Hermes in this iteration — the `generic` target remains the catch-all.

## Success signal

- On a machine with skills installed globally for OpenClaw and two real wikis registered (`ai-engineering`, `ai-work-social`), the user — via Telegram — sends a PDF with "ingest vào wiki kỹ thuật AI" and the file lands in `ai-engineering/raw/tmp/`, ingest completes, and lint is clean; a knowledge question gets a cited answer from the correct wiki after the agent read that wiki's README; and re-running the installer disturbs neither wiki and leaves every non-Lumina skill in the global skills directory byte-identical.

## Assumptions

- The `lumina` CLI is reachable globally by agents (`npm i -g lumina-wiki` or `npx`). (Chat attachments reaching a shell-visible path is no longer an assumption — verified in both platforms' source; see `platform-integration.md`.)
- Hermes users on the Docker backend mount their wiki paths and `~/.lumina` into the container themselves (documented, not automated; the attachment cache is auto-mounted, wiki directories are not).
- Two live wikis exist at `../ai-engineering` and `../ai-work-social` and serve as acceptance fixtures.
