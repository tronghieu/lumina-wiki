# Platform Integration — OpenClaw & Hermes

Companion to SPEC-librarian-mode (CAP-8, CAP-9). Platform facts verified against official docs AND local source clones (`../openclaw`, `../hermes-agent`), 2026-07.

## Global skill directories

The AI Agents installer targets install **skills only** — no workspace payload (`_lumina/`, `wiki/`, entry-point stubs). Each wiki still gets its own full install via the normal flow; the global skills are the trigger surface, each wiki's own `_lumina/scripts/` remain the executing truth.

| Platform | Location | Authority |
|---|---|---|
| OpenClaw | User-level directory per documented loading order (`<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills` → `~/.openclaw/skills` → bundled → config `extraDirs`) | https://docs.openclaw.ai/tools/skills#loading-order |
| Hermes | `~/.hermes/skills/` (primary, "source of truth"); extra folders via `external_dirs` config | https://hermes-agent.nousresearch.com/docs/user-guide/configuration#directory-structure |

Exact directory choice per platform is an implementation decision made against those two pages (Q3 naming also pending). `~/.agents/skills` is notable: OpenClaw scans it natively and Hermes can point `external_dirs` at it — one install location can serve both.

## Platform facts that shape the design

**OpenClaw** (source-verified)
- SKILL.md open standard; loader requires `name` (falls back to directory name) and a **non-empty `description`** — a skill with an empty/missing description is silently dropped from discovery, no warning. No length limit is enforced on hand-authored skills; the docs' "under 160 characters" is a style suggestion (the 160-byte hard rejection applies only to the Skill Workshop proposal flow). No `version` frontmatter is read.
- Unknown frontmatter fields (including Claude-style `allowed-tools`) are silently ignored.
- Skills trigger via slash command and/or model decision; `exec` tool runs shell on the gateway host by default (sandboxing off by default) — local `node`/`lumina` invocations work if on PATH.
- Built-in cron + heartbeat — the scheduled-care hook for `lumina wikis doctor --json`.

**Hermes** (source-verified)
- SKILL.md per agentskills.io standard; validator requires `name` + `description` only. `description` hard ceiling: 1024 chars (skill-manager create/edit path). The system-prompt skill index truncates descriptions to the first 57 chars + "..." — so every description must front-load its gist. `version` frontmatter is not read anywhere; unknown fields (including `allowed-tools`, which Hermes tooling treats as spec-standard) pass through untouched.
- Terminal backends: local (default), Docker, SSH, Singularity, Modal, Daytona. Official Docker image bundles Node.js 22 + npm. Docker users must mount wiki paths and `~/.lumina` (documented caveat, not automated).
- `delegate_task` subagents share the persistent workspace — fits the fresh-context `/lumi-check` habit.
- Auto-generates its own skills from experience — the routing preamble and wiki invariants (mutations only via `wiki.mjs`) are the guard against it inventing bypass skills.

## Chat attachments (CAP-7, source-verified)

Both platforms ship first-party Telegram AND Lark/Feishu adapters, and both already solve "chat attachment → shell-reachable local file":

| | OpenClaw | Hermes |
|---|---|---|
| Saved where | Shared media store (`<configDir>/media/inbound/`), then **staged into the agent's workspace** (`media/inbound/…`) before every turn — sandbox or not, the shell always gets a reachable copy | `~/.hermes/cache/documents/doc_<uuid>_<name>` |
| Model sees | Media reference / staged path in the turn text | Raw absolute path in the turn text, with explicit "read it via the terminal tool" instruction; auto-translated to the in-container path on the Docker backend (cache dirs auto-mounted) |
| Size limits | Telegram bot API 20MB (hard, platform-side); Feishu 30MB; general media/staging cap **defaults to 5MB** — setup docs must tell users to raise `mediaMaxMb` for documents | Telegram 20MB (2GB with self-hosted bot API); Feishu inbound cap not found in source (platform-side limit assumed) |
| Backend caveat | Works in both sandboxed and host mode by design | Supported for this flow: **local and Docker only** — SSH/Modal/Daytona/Singularity have no cache-path translation today |

The ingest/hub skill instruction is therefore transport-free: use the path from the context note verbatim, verify it exists, `cp` into the resolved wiki's `raw/tmp/`.

## Installer UX (CAP-8)

- Prompt: new "AI Agents" choice group, entries OpenClaw and Hermes — its own flag and prompt group, deliberately separate from `--ide` (Q3 resolved).
- After install for these targets, print a next-steps notice (plain language, per project-context §3 rule 21):
  1. Register your wikis: `lumina wikis add <path> --name "..."` (or create one first).
  2. How routing works: name your wiki when asking; the agent asks when unsure.
  3. Optional: schedule a periodic health check (`lumina wikis doctor`).
- Interactive mode: pause with "Enter to acknowledge". Under `--yes`: print without pausing.
- These targets write nothing into OpenClaw/Hermes workspace files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`).

## Non-destructive skills install (CAP-9)

Applies to every skills directory the installer touches — global (AI Agents targets) and project-level (`.agents/skills/`, `.claude/skills/`):

- The installer manages only entries it owns, as recorded in its skills manifest (`lumi-*` canonical IDs).
- Foreign entries (any directory/file it did not install) are never deleted, overwritten, or renamed — proven by an automated test placing a foreign skill in the target before install/upgrade.
- Removal is limited to previously-installed `lumi-*` skills dropped from the current selection.
- This replaces the current wipe-the-directory behavior, which is a defect.
