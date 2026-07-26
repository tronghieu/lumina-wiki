# Routing Protocol (Librarian Preamble)

Companion to SPEC-librarian-mode (CAP-6, CAP-7). This is the workspace-resolution step prepended to `/lumi-*` skills — **rendered only into AI Agents global installs** via the template-conditional mechanism. Classic per-wiki IDE installs receive no trace of it and stay byte-identical to today. SKILL.md sources remain single-source; only the projection differs.

## Why it lives in the skill body

OpenClaw injects workspace files (`AGENTS.md`, `TOOLS.md`) into its system prompt, but Hermes has no equivalent always-present context file. The only context guaranteed present at invocation time on both platforms is the SKILL.md body itself — so the protocol ships inside the skills.

## Protocol

1. **Mode check.** If the current working directory (or a parent found via the existing project-root walk) contains `_lumina/manifest.json` → classic single-wiki mode. Proceed exactly as today; skip the rest of this preamble.
2. **Librarian mode.** Run `lumina wikis list --json` to load the registry.
3. **Pick the target wiki**, in strict order:
   - The user named a wiki explicitly (name or alias) → use it.
   - Exactly one wiki matches the request's subject with high confidence (via `description`) → use it, and state the choice aloud in the reply.
   - Otherwise → ask the user which wiki. Never guess.
4. **Resolve.** Run `lumina wikis resolve <choice> --json` and take `path` from its output. Never construct or recall the path any other way. On exit 2, relay the candidate list to the user.
5. **Read the wiki's README.** Before any operation, read `<path>/README.md` — it is the per-wiki truth (version, packs, custom rules). This step is mandatory.
6. **One-shot commands.** Prefix every shell command with `cd "<path>" && …`. Never rely on cwd persisting from a previous command.
7. **Say which wiki.** Every reply that mutates a wiki names the target wiki, so the user can catch a mis-route immediately.

## Registering a new wiki (CAP-3, CAP-10)

Routing above assumes the target wiki is already registered — step 3 only
ever picks among what `wikis list` already returns. Creating or registering a
wiki in the first place is a separate, three-phase flow (`inspect` a path →
ask the user what's missing → commit with `add [--provision] --yes`), owned
in full by the `lumi-hub` skill (`src/skills/agents/hub/SKILL.md`). When a
request needs a wiki that does not exist yet, or names a path routing cannot
resolve to any registered wiki, hand off to that flow instead of improvising
steps here.

## Chat inbox flow (CAP-7)

When the user sends a document via a chat platform and asks to ingest it (verified for Telegram and Lark/Feishu on both platforms):

1. Take the attachment path **exactly as given in the platform's context note** — both platforms inject the saved file's location into the user turn (OpenClaw stages a copy inside the agent's own workspace under `media/inbound/`; Hermes gives an absolute path under `~/.hermes/cache/documents/`, already translated for its Docker backend). Verify the file exists before proceeding; never guess or reconstruct the path.
2. Resolve the target wiki (steps 2–5 above).
3. Copy the file into `<path>/raw/tmp/` under a collision-safe name (if the name exists, suffix rather than overwrite — `raw/` is additions-only).
4. Run the normal `/lumi-ingest` flow against that file, inside the resolved wiki.
5. Follow the existing post-ingest habit: fresh-context `/lumi-check` (subagent where the platform supports it — e.g. Hermes `delegate_task`).

Size caveats live in `platform-integration.md` (Telegram bot API 20MB ceiling; OpenClaw's 5MB default media cap must be raised for documents).

## Failure modes and their required behavior

| Situation | Required behavior |
|---|---|
| No registry / empty registry in librarian mode | Tell the user; hand off to the `lumi-hub` registration flow ("Registering a new wiki" above). |
| Resolver exit 2 (unknown/ambiguous) | Ask, presenting the candidates from the JSON error. |
| Target wiki fails manifest check | Surface it; suggest `lumina wikis doctor`. Do not operate on the directory. |
| Skill needs a pack the wiki lacks (per registry `packs`, which is fresh after the resolve in the same turn) | Refuse early; suggest installing the pack in that wiki. |
