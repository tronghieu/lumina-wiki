---
id: SPEC-project-user-config
companions:
  - ../spec-project-docs-overlay/SPEC.md
  - ../spec-project-parallel-ingest/SPEC.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# Project Mode — Reply Preferences

## Why

Project mode has no way to record how a user wants Lumina to talk to them. Classic mode renders `communication_language` into README; project mode records nothing, so every session starts from the default tone and language.

## Capabilities

- **CAP-1 — Ask at setup**
  - **intent:** When `_lumina/config/user.config.yaml` is absent, `lumi-project-setup` asks once, before scanning, for a reply language and a reply style. Both are optional; "skip" writes nothing. Given answers are written right away (the answer is the approval), only the keys given. When the file exists, setup reads and follows it without asking.
  - **success:** Fresh setup, user answers "Vietnamese, plain and non-technical": the file holds `schemaVersion: 1` and `response.language`/`response.style`, and the rest of setup replies in Vietnamese. User answers "skip": no file.
- **CAP-2 — Every project skill follows it**
  - **intent:** `PROJECT.md`, which every `lumi-project-*` skill reads first, tells skills to follow `response` in everything said to the user, and never let it change a fact's quote, a config value, a command, a path, or an identifier. Unknown keys are ignored, so later keys can be added without a schema bump.
  - **success:** With `language: Vietnamese`, `lumi-project-ask` answers in Vietnamese while quoted evidence stays verbatim in its source language.
- **CAP-3 — Personal, not shared**
  - **intent:** The file is gitignored through the installer's `.gitignore` marker block, so each team member keeps their own.
  - **success:** After install, `.gitignore`'s lumina block lists `_lumina/config/user.config.yaml`; an upgrade adds it to an existing block.

## Constraints

- No engine change: the engine never reads this file. No installer prompt: setup asks.
- Scope is `lumi-project-*` skills only, not every agent conversation in the repo.
- Shape: `schemaVersion: 1`, `response.language` and `response.style`, both free text and optional.

## Non-goals

- Classic mode (it already has `communication_language`).
- A fixed enum of styles.
- Re-asking on a setup re-run when the file exists; the user edits the file, or deletes it to be asked again.
- Removing `user.config.yaml` on uninstall; it stays with the rest of `_lumina/config/`, and shows in `git status` once the `.gitignore` block is gone.

## Success signal

- On a fresh install, setup asks for reply preferences, writes the file, and a following `lumi-project-ask` replies in the chosen language and style with evidence quotes verbatim.

## Assumptions

- Hosts follow the rule because every `lumi-project-*` skill reads `PROJECT.md` first; no host-specific wiring is needed.

